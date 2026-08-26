import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')
const fail = (message) => { throw new Error(message) }
const check = (condition, message) => { if (!condition) fail(message) }

function functionBody(text, name) {
  const start = text.indexOf(`function ${name}`)
  check(start >= 0, `function missing: ${name}`)
  const brace = text.indexOf('{', start)
  let depth = 0
  for (let i = brace; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1
    else if (text[i] === '}') {
      depth -= 1
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  fail(`function not closed: ${name}`)
}

function functionSection(text, name, nextName) {
  const start = text.indexOf(`function ${name}`)
  check(start >= 0, `function missing: ${name}`)
  const end = text.indexOf(`function ${nextName}`, start + `function ${name}`.length)
  check(end > start, `next function missing after ${name}: ${nextName}`)
  return text.slice(start, end)
}

try {
  const lifecycle = read('worker/domains/lifecycle.ts')
  const exchanges = read('worker/domains/returns-exchanges.ts')
  const workshop = read('worker/domains/workshop.ts')
  const reservations = read('worker/domains/order-reservations.ts')
  const orderWrites = read('worker/domains/orders-write.ts')
  const catalogReview = read('worker/domains/catalog-review.ts')
  const lifecycleMigration = read('migrations/0051_v72_inventory_lifecycle_gate.sql')
  const cycleCountMigration = read('migrations/0053_v72_inventory_cycle_counts.sql')
  const stocktake = read('worker/domains/inventory-stocktake.ts')
  const apiClient = read('src/app/controllers/useApiClient.ts')
  const inventoryWriteRetry = read('src/app/controllers/inventoryWriteRetry.ts')
  const worker = read('worker/index.ts')
  const app = read('src/App.tsx')
  const returnUtils = read('src/app/utils.ts')
  const returnView = read('src/features/sections/OrderReturnsSection.tsx')
  const exchangeView = read('src/features/sections/OrderExchangeSection.tsx')

  check(worker.includes("warehouseTruthFreshness: '192a1'"), '192A1 live marker missing')
  check(!lifecycle.includes('resolveWorkshopCatalogProductOnly'), 'Workshop intake still uses product-only resolver')

  const exact = functionBody(lifecycle, 'resolveWorkshopCatalogExactCandidate')
  for (const required of ['findCatalogProductByIdentity', 'findCatalogExecutionV3', 'findCatalogCombinationV3', 'activeOnly: true']) {
    check(exact.includes(required), `Exact workshop resolver missing guard: ${required}`)
  }
  for (const forbidden of ['createCatalogCombinationV3', 'ensureCatalogExecutionV3', 'upsertReferenceValue', 'createCatalogProduct']) {
    check(!exact.includes(forbidden), `Exact workshop resolver may mutate catalog: ${forbidden}`)
  }

  const boundary = functionBody(lifecycle, 'trustedInventoryFullStocktakeBoundary')
  for (const required of [
    "s.status = 'completed'", "s.id LIKE 'REV-%-F-%'", "a.status = 'active'",
    "i.status = 'applied'", "c.check_type = 'full_stocktake'", 'fullCheckRows === totalItems',
  ]) check(boundary.includes(required), `Trusted stocktake boundary missing: ${required}`)

  const autoApply = functionBody(lifecycle, 'canAutoApplyFreshWorkshopInbound')
  if (autoApply.includes('inventoryLifecycleDeferredInboundDisposition')) {
    const disposition = functionBody(lifecycle, 'inventoryLifecycleDeferredInboundDisposition')
    for (const required of [
      "cleanText(event.direction) !== 'in'", "cleanText(event.status) !== 'pending'",
      '!boundary.trusted', 'createdAt <= boundary.completedAt', 'inventory_stock_checks', 'checked_at >= ?',
    ]) check(disposition.includes(required), `Shared workshop freshness guard missing: ${required}`)
  } else {
    for (const required of [
      "cleanText(event.direction) !== 'in'", "cleanText(event.status) !== 'pending'",
      '!boundary.trusted', 'createdAt <= boundary.completedAt', 'inventory_stock_checks', 'checked_at >= ?',
    ]) check(autoApply.includes(required), `Workshop auto-intake freshness guard missing: ${required}`)
  }

  const resolveCandidate = functionBody(lifecycle, 'resolveInventoryLifecycleCandidate')
  check(resolveCandidate.includes('if (isWorkshop) return await resolveWorkshopCatalogExactCandidate'), 'Workshop exact resolver not wired')

  check(exchanges.includes('variantId: resolved.variantId,'), 'Return lifecycle does not persist an exact workshop variant')
  check(exchanges.includes('variantId: resolvedOld.variantId,'), 'Exchange lifecycle does not persist an exact workshop variant')
  check((exchanges.match(/canAutoApplyFreshWorkshopInbound\(/g) || []).length >= 2, 'Freshness barrier is not wired to both return and exchange workshop intake')
  check((exchanges.match(/applyCanonicalInventoryLifecycleEvent\(/g) || []).length >= 2, 'Canonical atomic lifecycle movement is no longer used by return/exchange intake')

  const createReturnFlow = functionSection(exchanges, 'createReturn', 'hasActiveStandaloneReturn')
  check(createReturnFlow.includes("const explicitRestock = typeof rawItem?.restock === 'boolean' ? rawItem.restock : null"), 'Return transport no longer preserves explicit per-line restock intent')
  check(createReturnFlow.includes("const itemRestockRequested = isWorkshop ? selected.restock === true : selected.restock !== false"), 'Workshop return is no longer no-stock unless explicitly opted into inventory')
  check(createReturnFlow.includes("isWorkshop && itemRestockRequested && restockSource === 'boutique'"), 'Workshop return can again be sent to Boutique inventory')
  check(createReturnFlow.includes('if (wantsRestock) {'), 'No-stock return can no longer bypass inventory lifecycle resolution')
  check(!createReturnFlow.includes('restock: true,'), 'Return backend again forces every selected line into stock')
  check(exchanges.includes("oldItemIsWorkshop && oldReturnSource === 'boutique'"), 'Workshop exchange return can again be sent to Boutique inventory')
  check(app.includes('restock: item.restock'), 'Return frontend no longer transmits the per-line stock disposition')
  check(returnUtils.includes("restock: item.sourceType !== 'workshop'"), 'Workshop return draft no longer defaults to no-stock')
  check(returnView.includes('Принять на Склад'), 'Return UI lost the explicit Workshop-to-Warehouse decision')
  check(returnView.includes('Цех → Бутик нельзя'), 'Return UI no longer explains the Workshop Boutique restriction')
  check(exchangeView.includes('effectiveOldItemIsWorkshop'), 'Exchange UI no longer distinguishes Workshop old items')
  check(exchangeView.includes('Вещь из Цеха не попадает в остатки автоматически'), 'Exchange UI lost explicit Workshop disposition guidance')

  // Cross-workflow safety audit: Workshop task completion is a production-state transition only.
  // It must never silently become a second inventory intake path. Physical Workshop-origin inbound
  // belongs to return/exchange lifecycle where exact identity + freshness are already guarded.
  // Use section boundaries here because the TypeScript input type itself contains braces.
  const updateWorkshopTask = functionSection(workshop, 'updateWorkshopTask', 'bulkUpdateWorkshopTasks')
  for (const forbidden of ['inventory_stock', 'inventory_reservations', 'inventory_lifecycle_events', 'applyCanonicalInventoryLifecycleEvent']) {
    check(!updateWorkshopTask.includes(forbidden), `Workshop task status unexpectedly mutates inventory via ${forbidden}`)
  }
  check(!workshop.includes('inventory_stock'), 'Workshop domain unexpectedly owns physical inventory writes')
  check(!workshop.includes('inventory_reservations'), 'Workshop domain unexpectedly owns order reservations')
  check(!workshop.includes('inventory_lifecycle_events'), 'Workshop task status unexpectedly writes lifecycle events')

  // The 0051 lifecycle table is intentionally return/exchange-only. Do not disguise Workshop task
  // completion as a fake return; a future physical Workshop->Warehouse production transfer would need
  // an explicitly designed state transition and linked reservation/fulfillment semantics.
  check(lifecycleMigration.includes("operation_type IN ('return', 'exchange')"), 'Lifecycle operation scope changed; re-audit Workshop task semantics before release')
  check(lifecycleMigration.includes("event_type IN ('return_in', 'exchange_old_in', 'exchange_new_out')"), 'Lifecycle event scope changed; re-audit Workshop task semantics before release')

  // Normal order creation must keep Workshop outside Warehouse/Boutique availability/reservation.
  // insertOrderContent has inline object types in its signature, so a brace-count helper would stop
  // inside the type rather than at the real function body.
  const insertOrderContent = functionSection(orderWrites, 'insertOrderContent', 'createWorkshopTaskForOrderItem')
  const workshopBranch = insertOrderContent.indexOf('if (item.isWorkshop)')
  const stockBranch = insertOrderContent.indexOf('else if (autoWriteoffEnabled)', workshopBranch)
  check(workshopBranch >= 0 && stockBranch > workshopBranch, 'Order creation no longer separates Workshop from stock reservation/writeoff')
  const workshopSlice = insertOrderContent.slice(workshopBranch, stockBranch)
  check(workshopSlice.includes('createWorkshopTaskForOrderItem'), 'Workshop order line no longer creates its production task')
  check(!workshopSlice.includes('applyOrderStockWriteOff'), 'Workshop order line unexpectedly entered stock reservation/writeoff path')

  // Shipping fulfills reservation rows generically, while ordinary Workshop lines remain excluded
  // from stock blockers/handover. This distinction is critical: a future explicit Workshop intake
  // reservation could be fulfilled, but merely marking a task done must not create one implicitly.
  // fulfillOrderReservationsV2 has a default options = {} parameter, so use a section boundary.
  const fulfill = functionSection(reservations, 'fulfillOrderReservationsV2', 'getOrderShipmentInventoryBlockers')
  check(fulfill.includes("FROM inventory_reservations r"), 'Shipment no longer fulfills from reservation truth')
  check(!fulfill.includes('COALESCE(oi.is_workshop, 0) = 0'), 'Shipment fulfillment unexpectedly filters out explicit Workshop-backed reservations')
  const blockers = functionBody(reservations, 'getOrderShipmentInventoryBlockers')
  check(blockers.includes('COALESCE(oi.is_workshop, 0) = 0'), 'Ordinary Workshop lines unexpectedly became stock shipment blockers')
  // fetchOrderStockHandoverRows also has an inline object type in the options parameter.
  const handoverRows = functionSection(reservations, 'fetchOrderStockHandoverRows', 'stockHandoverItemFromRow')
  check(handoverRows.includes('COALESCE(oi.is_workshop, 0) = 0'), 'Early stock handover unexpectedly includes ordinary Workshop lines')

  // Applied lifecycle events are one-shot and cancellation is reversible. This is the critical
  // retry/lost-response boundary for auto-intake.
  const applyLifecycle = functionBody(lifecycle, 'applyCanonicalInventoryLifecycleEvent')
  check(applyLifecycle.includes("cleanText(event.status) === 'applied'"), 'Applied lifecycle event is not retry-idempotent')
  check(applyLifecycle.includes("status = 'applied'"), 'Lifecycle apply does not persist terminal applied state')
  check(applyLifecycle.includes("status = 'pending'"), 'Lifecycle physical mutation is not guarded by pending status')
  check(applyLifecycle.includes('await db.batch(statements)'), 'Lifecycle apply is no longer committed as one guarded D1 batch')
  const cancelLifecycle = functionBody(lifecycle, 'cancelInventoryLifecycleEvent')
  check(cancelLifecycle.includes("cleanText(event.status) === 'cancelled'"), 'Lifecycle cancellation is not retry-idempotent')
  check(cancelLifecycle.includes('reversalDelta = -originalDelta'), 'Applied lifecycle cancellation no longer reverses the exact physical delta')
  check(cancelLifecycle.includes("status = 'cancelled'"), 'Lifecycle cancellation does not persist terminal cancelled state')

  // A retry after a partially progressed multi-line return must recover the same return_item/event
  // instead of creating another physical intake for the already processed line.
  check(exchanges.includes('insertCriticalMappedEntity('), 'Return/exchange item creation lost critical-operation entity mapping')
  check(exchanges.includes('`return:${returnId}:item:${returnItemId}`'), 'Return lifecycle event key is no longer stable per return item')
  check(exchanges.indexOf('// Validate every selected row before inserting the return or changing stock.') < exchanges.indexOf('if (!returnId) {'), 'Return validation no longer completes before first business mutation')

  // Resolving a Workshop-origin physical return to a product must not surface a false catalog-review
  // task merely because Workshop order_items intentionally retain variant_id = NULL.
  const catalogOperational = functionBody(catalogReview, 'catalogReviewOperationalPredicate')
  check(catalogOperational.includes('is_workshop'), 'Workshop catalog-review scope missing')
  check(catalogOperational.includes('product_id IS NULL'), 'Resolved Workshop product may incorrectly remain in operational catalog review')

  // Lost-response integrity for stocktake and quick physical checks.
  check(cycleCountMigration.includes('check_key TEXT UNIQUE'), 'Physical-check replay proof is no longer unique')
  check(stocktake.includes('resumed: true'), 'Existing active stocktake is no longer resumed safely')
  check(stocktake.includes('const alreadyPersisted = currentQuantity === previousBaseline'), 'Repeated saved stocktake fact may rewrite evidence time')
  check(stocktake.includes('const requestReferenceId = requestId ? `stock-check:${checkType}:${source}:${requestId}`'), 'Quick check lost-response key is not durable')
  check(stocktake.includes('const replayAfterRace = await loadReplay()'), 'Concurrent quick-check replay cannot recover after the transaction race')
  check(stocktake.includes("${requestReferenceId ? 'INSERT' : 'INSERT OR IGNORE'} INTO inventory_stock_checks"), 'Quick-check duplicate key no longer rolls back a repeated mutation')
  check(stocktake.includes("if (sessionStatus === 'completed')"), 'Completed stocktake retry can become a false failure')
  check(inventoryWriteRetry.includes('managedInventoryWriteMode'), 'Stocktake writes are not opted into managed retry transport')
  check(inventoryWriteRetry.includes('prepareCriticalRequest(requestKey, basePayload)'), 'Stocktake request id is not persisted across reload')
  check(inventoryWriteRetry.includes("headers.set('X-Idempotency-Key', prepared.requestId)"), 'Stocktake managed writes do not enable safe transport retry')
  check(apiClient.includes('Boolean(managedInventoryRequestKey) && response.status >= 500'), 'Audited stocktake writes cannot recover from a post-commit 5xx')

  console.log('STEP 192A1 WAREHOUSE TRUTH / FRESHNESS TESTS PASSED — Workshop return/exchange intake requires explicit Warehouse disposition, Boutique is blocked, no-stock avoids lifecycle work, and explicit intake remains freshness-gated/idempotent')
} catch (error) {
  console.error(`STEP 192A1 WAREHOUSE TRUTH / FRESHNESS TESTS FAILED: ${error?.message || error}`)
  process.exit(1)
}
