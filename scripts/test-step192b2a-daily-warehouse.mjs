import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')
const fail = (message) => { throw new Error(message) }
const check = (condition, message) => { if (!condition) fail(message) }

function between(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  check(start >= 0, `Marker missing: ${startMarker}`)
  const end = source.indexOf(endMarker, start + startMarker.length)
  check(end > start, `End marker missing after: ${startMarker}`)
  return source.slice(start, end)
}

try {
  const worker = read('worker/index.ts')
  const reservations = read('worker/domains/order-reservations.ts')
  const ordersWrite = read('worker/domains/orders-write.ts')
  const orderCore = read('worker/domains/order-core.ts')
  const attention = read('worker/domains/warehouse-attention.ts')
  const contracts = read('shared/api-contracts.ts')
  const app = read('src/App.tsx')
  const appTypes = read('src/app/types.ts')
  const workspace = read('src/app/controllers/useWorkspaceViewModel.tsx')
  const inventory = read('src/features/sections/InventorySection.tsx')
  const operational = read('src/app/controllers/useOperationalViewModel.ts')
  const attentionHook = read('src/features/inventory/useInventoryAttentionActions.ts')
  const attentionPanel = read('src/features/inventory/views/renderInventoryAttentionPanel.tsx')
  const overview = read('src/features/inventory/views/renderInventoryOverviewPanel.tsx')
  const ordersTable = read('src/features/sections/OrdersTableSection.tsx')
  const css = read('src/styles/192b2a-warehouse-attention-actions.css')

  check(worker.includes("warehouseDailyAttentionUx: '192b2a'"), '192B2A health marker missing')
  check(appTypes.includes("| 'attention'"), 'InventoryPanel does not expose Attention')
  check(operational.includes("const inventoryManagerPanels: InventoryPanel[] = ['overview', 'attention']"), 'Attention tab can be selected by a manager but the panel visibility allow-list hides it')
  check(operational.includes("const inventoryAdminPanels: InventoryPanel[] = ['overview', 'attention', 'stocktake'"), 'Attention tab can be selected by an admin but the panel visibility allow-list hides it')
  check(operational.includes("inventoryPanel === panel ? undefined : 'none'"), 'Inventory panel visibility guard changed unexpectedly')
  check(app.includes("panel === 'overview' &&") === false, 'Legacy manager-only overview gate unexpectedly hard-coded')
  check(app.includes("nextPanel !== 'overview' && nextPanel !== 'attention'") && app.includes("inventoryPanel !== 'overview' && inventoryPanel !== 'attention'"), 'Managers are not allowed to open Attention safely')

  const quickRoute = between(worker, "if (url.pathname === '/api/inventory/stocktakes/quick'", "const inventoryStocktakeMatch")
  check(!quickRoute.includes('requireAdminAccess'), 'Exact single-SKU physical count is still admin-only')
  check(quickRoute.includes('quickInventoryStocktake(env.DB'), 'Exact count route no longer uses CAS-protected quickInventoryStocktake')
  const batchRoute = between(worker, "if (url.pathname === '/api/inventory/stocktakes/quick-batch'", "if (url.pathname === '/api/inventory/stocktakes/quick'")
  check(batchRoute.includes('requireAdminAccess'), 'Batch stocktake must remain admin-only')
  const cycleRoute = between(worker, "if (url.pathname === '/api/inventory/cycle-counts'", "if (url.pathname === '/api/inventory/stocktakes'")
  check(cycleRoute.includes('requireAdminAccess'), 'Cycle-count administration must remain admin-only in 192B2A')

  const shortagePreflight = between(reservations, 'export async function assertCreateOrderShortageDecisions(', 'export async function reserveOrderItemV2(')
  check(shortagePreflight.includes('requestedQuantity') && shortagePreflight.includes('hasObservation') && shortagePreflight.includes('acknowledged'), 'Server shortage preflight does not group one decision per exact SKU/source')
  check(shortagePreflight.includes('acknowledged: true') && shortagePreflight.includes('current.acknowledged = current.acknowledged && Boolean(item.shortageAcknowledged)'), 'A quantity edit on one duplicate SKU line can incorrectly inherit another line’s old shortage acknowledgement')
  check(shortagePreflight.includes('chunksOf(unresolvedDecisionGroups, 30)') && shortagePreflight.includes("'(?, ?, ?)'"), 'Server shortage preflight is not bounded to <=90 binds per read')
  check(shortagePreflight.includes("r.status = 'active'") && shortagePreflight.includes('SUM(r.quantity)'), 'Server shortage preflight does not use authoritative active reservations')
  check(shortagePreflight.includes('freeAfterReservation < 0') && shortagePreflight.includes('shortages.push') && shortagePreflight.includes('throw new OrderStockShortageError(shortages)'), 'Server shortage preflight is not actionable')
  check(reservations.includes('class OrderStockShortageError') && reservations.includes('Посчитайте фактическое количество') && reservations.includes('Сейчас проверить не могу'), 'Structured shortage conflict lost its actionable manager message')
  check(shortagePreflight.includes('inputIndexes') && orderCore.includes('inputIndex'), 'Server shortage response can no longer map through blank form rows safely')
  check(!/\b(?:INSERT|UPDATE|DELETE|REPLACE)\b/i.test(shortagePreflight), 'Server shortage preflight must remain read-only')
  check(orderCore.includes('shortageAcknowledged: Boolean'), 'Order normalization drops shortage acknowledgement')
  check(ordersWrite.includes('await assertCreateOrderShortageDecisions(db, normalizedItems, preResolvedCatalog);'), 'Create-order path does not execute shortage preflight')
  const shortagePreflightCall = ordersWrite.indexOf('await assertCreateOrderShortageDecisions(db, normalizedItems, preResolvedCatalog);')
  const firstCustomerWrite = ordersWrite.indexOf('const customerId = await upsertCustomerIdentityForOrderCreate(', shortagePreflightCall)
  const firstOrderInsert = ordersWrite.indexOf('INSERT INTO orders (', shortagePreflightCall)
  check(shortagePreflightCall >= 0 && firstCustomerWrite > shortagePreflightCall && firstOrderInsert > shortagePreflightCall, 'Shortage decision is not checked before customer/order content writes')
  const reserveFunction = between(reservations, 'export async function reserveOrderItemV2(', 'export async function releaseOrderReservationV2(')
  check(!reserveFunction.includes('throw new OrderStockShortageError') && !reserveFunction.includes('enforceShortageAcknowledgement'), 'Late reserve-time shortage throw returned; it can leave partial order content')
  check(reserveFunction.includes('concurrentShortage') && reserveFunction.indexOf('await db.batch(statements)') < reserveFunction.lastIndexOf('concurrentShortage'), 'Concurrent reserve race is not reported only after the atomic reservation commit')
  check(!ordersWrite.includes('enforceShortageAcknowledgement'), 'Create-only shortage enforcement plumbing leaked into write/reserve functions')

  for (const marker of ['Посчитать сейчас', 'Сейчас проверить не могу', 'Проверку отложили']) check(workspace.includes(marker), `Create-order shortage UX missing: ${marker}`)
  check(!workspace.includes('Не уточнять'), 'Decorative “Не уточнять” shortage escape returned')
  check(app.includes("shortageAcknowledged: item.sourceType !== 'workshop' ? Boolean(item.shortageAcknowledged) : undefined"), 'Create-order payload does not carry explicit shortage decision')
  check(app.includes('observedPhysicalQuantity') && app.includes('shortageAcknowledged'), 'Identity/quantity reset does not cover shortage decision state')
  check(ordersWrite.includes('if (previous !== undefined) {') && ordersWrite.includes('item.observedPhysicalQuantity = null'), 'Repeated identical SKU lines do not deduplicate one physical observation')
  check(!ordersWrite.includes('item.shortageAcknowledged = true'), 'Repeated identical SKU lines should not need a synthetic acknowledgement hack')

  check(attention.includes("url?.searchParams.get('details') === '1'"), 'Attention detail mode missing')
  check(attention.includes('ATTENTION_DETAIL_LIMIT = 50') && attention.includes('Math.min(50'), 'Attention detail query is not bounded to the current 50-item working window')
  check(attention.includes('handoverReservations') && attention.includes('reviewReserved') && attention.includes('ordinaryReserved') && attention.includes('fullyExplainedShortageKeys'), 'Handover/shortage de-duplication no longer uses reservation quantities')
  check(attention.includes('countRelevantReserved') && attention.includes('row.countRelevantReserved > row.physical'), 'A mixed SKU can no longer retain the ordinary shortage after handover reservations are separated')
  check(attention.includes("NOT EXISTS (\n                SELECT 1 FROM inventory_lifecycle_events") || attention.includes('NOT EXISTS (\n           SELECT 1 FROM inventory_lifecycle_events'), 'Catalog details no longer suppress lifecycle duplicates')
  check(!/warehouse_tasks|warehouse_cases|case_owner|deadline|\bSLA\b/i.test(attention + attentionPanel), 'Persistent task/case workflow was introduced')
  check(!/\b(?:INSERT\s+INTO|UPDATE\s+[A-Za-z_]|DELETE\s+FROM|REPLACE\s+INTO)\b/i.test(attention), 'Attention resolver must stay read-only')
  for (const marker of ['shortages', 'intake', 'lifecycle', 'catalog', 'handover', 'stocktakes']) check(contracts.includes(marker) || attention.includes(marker), `Attention detail category missing: ${marker}`)

  check(inventory.includes("label: `Внимание${Number(warehouseAttention?.total || 0)"), 'Warehouse Attention tab/count missing')
  check(inventory.includes('renderInventoryAttentionPanel'), 'Actionable Attention panel is not mounted')
  check(inventory.includes('useInventoryAttentionActions'), 'B2A daily actions were not kept out of the Inventory controller monolith')
  check(attentionHook.includes('quickInventoryStocktake({') && attentionHook.includes('expectedQuantity: simpleStockDetail.physical'), 'Attention/overview count does not use expected physical CAS')
  check(attentionHook.includes('loadWarehouseAttention(true)'), 'Physical count does not refresh Attention after success')
  check(overview.includes('Сверить количество') && overview.includes('На месте сейчас') && overview.includes('Сохранить факт'), 'Universal exact-SKU count UI missing from stock detail')
  check(!overview.includes('quickStocktakeCandidates'), 'Old multi-variant quick-count UI still leaks into normal stock detail')

  check(ordersTable.includes('Уточнить выдачу'), 'Orders table still uses unclear handover wording')
  check(!ordersTable.includes('Уточнить, где был товар'), 'Old handover button wording returned')
  check(app.includes('клиент уже получил этот товар?') && app.includes('Да, уже получил') && app.includes('Нет, товар ещё был здесь'), 'Handover modal is not the simple two-choice question')

  const shortageUiBlock = workspace.slice(workspace.indexOf('function renderOrderSourceAvailability'))
  const visibleNewUi = `${attentionPanel}\n${overview}\n${css}`
  for (const forbidden of ['Step 192', 'D1', 'migration', 'variant_id', 'forensic', 'canonical', 'SLA']) {
    check(!visibleNewUi.includes(forbidden), `Developer terminology leaked into user-facing B2A UI: ${forbidden}`)
  }
  for (const forbidden of ['Step 192', 'D1', 'migration', 'variant_id', 'forensic', 'SLA']) {
    check(!shortageUiBlock.includes(forbidden), `Developer terminology leaked into create-order shortage UI: ${forbidden}`)
  }
  check(!attentionPanel.includes('Отдельной очереди задач нет'), 'Internal architecture explanation leaked into Attention UI')

  const arrivalMarker = '<div className="inventory-arrival-legacy-workspace">'
  check(inventory.includes(arrivalMarker), 'Frozen Arrival workspace disappeared')

  const migrations = fs.readdirSync(path.join(root, 'migrations')).filter((name) => name.endsWith('.sql')).sort()
  check(migrations.at(-1) === '0061_v72_warehouse_attention_truth_gates.sql', '192B2A must not add a schema migration')

  const release = read('scripts/release-check.mjs')
  check(release.includes('test-step192b2a-daily-warehouse.mjs'), '192B2A test is not chained into cumulative release gate')

  console.log('STEP 192B2A DAILY WAREHOUSE TESTS PASSED — actionable derived Attention, exact known-SKU count for managers, explicit shortage decision, simple handover wording, no task/SLA system')
} catch (error) {
  console.error(`STEP 192B2A DAILY WAREHOUSE TESTS FAILED: ${error?.message || error}`)
  process.exit(1)
}
