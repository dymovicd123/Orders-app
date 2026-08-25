import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const root = process.cwd()
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')
const fail = (message) => { throw new Error(message) }
const check = (condition, message) => { if (!condition) fail(message) }
const between = (source, startMarker, endMarker) => {
  const start = source.indexOf(startMarker)
  check(start >= 0, `Marker missing: ${startMarker}`)
  const end = source.indexOf(endMarker, start + startMarker.length)
  check(end > start, `End marker missing after: ${startMarker}`)
  return source.slice(start, end)
}

try {
  const worker = read('worker/index.ts')
  const core = read('worker/domains/order-core.ts')
  const reservations = read('worker/domains/order-reservations.ts')
  const orders = read('worker/domains/orders-write.ts')
  const money = read('worker/domains/money.ts')
  const ordersRead = read('worker/domains/orders-read.ts')
  const returnsExchanges = read('worker/domains/returns-exchanges.ts')
  const references = read('worker/domains/references.ts')
  const workshopSchema = read('worker/domains/workshop-schema.ts')
  const apiClient = read('src/app/controllers/useApiClient.ts')
  const app = read('src/App.tsx')
  const appTypes = read('src/app/types.ts')
  const appUtils = read('src/app/utils.ts')

  check(worker.includes("orderCreateSaveIntegrity: '192b2a4'"), '192B2A4 health marker missing')

  // User/input errors are controlled 400/409 responses, not generic Worker 500s.
  for (const marker of ['OrderInputValidationError', 'OrderStockShortageError', 'criticalOperationErrorResponse']) {
    check(worker.includes(marker), `Order route error mapping missing: ${marker}`)
  }
  for (const marker of ['assertOrderItemInputs', 'assertOrderPaymentInputs', 'assertOrderTotalInput']) {
    check(core.includes(marker), `Order input validator missing: ${marker}`)
  }
  check(core.includes('amount > 0 && !method'), 'Payment amount without method is not rejected explicitly')
  check(core.includes('amount < 0'), 'Negative payment is not rejected')
  check(!orders.includes("throw new Error('Добавьте хотя бы одну оплату.')"), 'Unpaid orders are still blocked')

  // Late-entered orders must not keep today's default payment date when the business order date is changed.
  const createDraftUpdate = between(app, 'function updateCreateDraft<', 'function updateCreateItem(')
  check(createDraftUpdate.includes("key === 'orderDate'"), 'Create form does not react to order-date changes')
  check(createDraftUpdate.includes("payment.paymentKind === 'primary'"), 'Create form does not limit automatic date sync to primary payments')
  check(createDraftUpdate.includes('paymentDate: orderDate || payment.paymentDate'), 'Primary create payments do not follow the selected order date')

  // Structured stock shortage must point to original form rows and never apply to Workshop lines.
  const shortage = between(reservations, 'export async function assertCreateOrderShortageDecisions(', 'export async function reserveOrderItemV2(')
  check(shortage.includes('if (item.isWorkshop) continue'), 'Workshop item is still subject to Warehouse/Boutique shortage')
  check(shortage.includes('inputIndexes') && shortage.includes('throw new OrderStockShortageError(shortages)'), 'Structured shortage mapping missing')
  check(shortage.includes('excludeOrderId') && shortage.includes('r.order_id <> ?'), 'Edit shortage does not exclude its own existing reservation')
  check(!/\b(?:INSERT|UPDATE|DELETE|REPLACE)\b/i.test(shortage), 'Shortage preflight must remain read-only')

  // Create becomes a resumable state machine. Once the validated plan exists, live preflight is not rerun.
  const create = between(orders, 'export async function createOrder(', 'export async function updateOrderCritical(')
  check((create.match(/payment\.paymentKind === 'primary'/g) || []).length >= 2, 'Create path does not enforce primary-payment order dates in both fresh and legacy-resume planning')
  check((create.match(/paymentDate: orderDate/g) || []).length >= 2, 'Server can still persist an initial primary payment on the entry-day date')
  for (const marker of [
    'let plan = operationContext.plan',
    "advanceCriticalOperation(db, criticalOperation, 'validated'",
    "'order_created'",
    "'content_written'",
    'insertedContent',
    'completeCriticalOperation(db, criticalOperation, response)',
  ]) check(create.includes(marker), `Create resume phase missing: ${marker}`)
  const planGuard = create.indexOf('if (!plan)')
  const shortageCall = create.indexOf('await assertCreateOrderShortageDecisions(db, normalizedItems, preResolvedCatalog);')
  const validatedAdvance = create.indexOf("advanceCriticalOperation(db, criticalOperation, 'validated'")
  check(planGuard >= 0 && shortageCall > planGuard && validatedAdvance > shortageCall, 'Create shortage must be resolved before the immutable validated plan is persisted')
  check(create.indexOf('await assertCreateOrderShortageDecisions', validatedAdvance) < 0, 'Create retry can rerun live shortage after validated plan')
  check(create.includes('legacyInFlight') && create.includes('recoveredLegacyCreatePlan'), 'Pre-192B2A4 in-flight create recovery bridge missing')
  const legacyStart = create.indexOf('if (legacyInFlight)')
  const legacyEnd = create.indexOf('recoveredLegacyCreatePlan: true', legacyStart)
  const legacyBlock = create.slice(legacyStart, legacyEnd)
  check(!legacyBlock.includes('assertCreateOrderShortageDecisions'), 'Legacy in-flight recovery re-runs shortage against its own reservation')
  check(legacyBlock.includes("'customer_order_count', 'order_create'"), 'Legacy create recovery can double-increment customer count')

  // The critical boundary is order + content/reservations/workshop. Readback/audit/activity are secondary.
  const completeIndex = create.indexOf('await completeCriticalOperation(db, criticalOperation, response)')
  check(completeIndex > create.indexOf("'content_written'"), 'Create operation completes before critical content phase')
  check(create.indexOf('writeOrderManagerAudit', completeIndex) > completeIndex, 'Manager audit can still block order creation')
  check(create.indexOf('writeActivityLog', completeIndex) > completeIndex, 'Activity log can still block order creation')
  check(!create.slice(0, completeIndex).includes('await getOrder(db, orderId)'), 'Order readback is still inside create critical path')

  // Customer identity and count are retry-safe and eventually reconciled to actual orders.
  check(references.includes('upsertCustomerIdentityForOrderCreate') && references.includes('ON CONFLICT(phone_normalized)'), 'Concurrent customer identity upsert is not safe')
  const customerCount = between(orders, 'async function markCreateCustomerOrderCount(', 'export async function createOrder(')
  check(customerCount.includes('critical_operation_entities') && customerCount.includes("'customer_order_count'"), 'Customer create counter lacks idempotency marker')
  check(create.includes('recalculateCustomersAfterStorageCleanup(db, [customerId])'), 'Historical/pre-target customer count drift is not reconciled after safe create')

  // Actual reservation writes are atomic and late races are reported after commit instead of thrown mid-create.
  const reserve = between(reservations, 'export async function reserveOrderItemV2(', 'export async function releaseOrderReservationV2(')
  check(reserve.includes('await db.batch(statements)'), 'Reservation stock + reservation + item status are not one D1 batch')
  check(!reserve.includes('throw new OrderStockShortageError'), 'Late shortage throw can leave partial order content')
  check(reserve.indexOf('await db.batch(statements)') < reserve.lastIndexOf('concurrentShortage'), 'Concurrent shortage is not evaluated after committed reservation state')
  check(reserve.includes('alreadyApplied: true'), 'Reservation retry does not recognize existing order_item reservation')
  const inventoryMigration = read('migrations/0047_v72_human_inventory_model.sql')
  check(/order_item_id\s+INTEGER\s+NOT\s+NULL\s+UNIQUE/i.test(inventoryMigration), 'Reservation schema lost unique order_item_id retry key')

  // Legacy inventory mode must be retry-safe too: stock/movement/item marker are one D1 transaction.
  const legacyWrite = between(orders, 'export async function applyOrderStockWriteOff(', 'export async function reverseOrderStockWriteOffsForEdit(')
  check(legacyWrite.includes('await db.batch([') && legacyWrite.includes('stockStatement') && legacyWrite.includes('movementStatement'), 'Legacy write-off is still split across independent SQL writes')
  check(legacyWrite.includes("NOT IN ('written_off', 'negative')"), 'Legacy write-off lacks per-item retry marker guard')
  const legacyReverse = between(orders, 'export async function reverseOrderStockWriteOffsForEdit(', 'export function inventoryObligationIdentityKey(')
  check(legacyReverse.includes("stock_writeoff_status = 'reversed_edit'") && legacyReverse.includes('await db.batch(['), 'Legacy edit reversal can double-restore stock after partial failure')
  check(orders.includes("'reversed_edit', 'reserved'"), 'Retired edited rows do not normalize reversed_edit state')
  check(orders.includes("'pending_writeoff', 'reversed_edit')"), 'Delete path does not normalize a legacy reversal completed before delete continuation')

  // Edit uses the same immutable-plan pattern and shortage contract.
  const edit = between(orders, 'export async function updateOrderCritical(', 'export async function getOrder(')
  check(edit.includes('normalizeOrderPayments('), 'Existing-order editing lost ordinary payment-date preservation')
  check(!edit.includes('paymentDate: nextOrderDate'), 'Existing-order editing must not rewrite historical primary payment dates to the order date')
  check(edit.includes('let plan = operationContext.plan'), 'Edit resumable plan missing')
  check(edit.includes("advanceCriticalOperation(db, criticalOperation, 'validated'"), 'Edit validated phase missing')
  check(edit.includes('assertCreateOrderShortageDecisions(db, nextItems, rewritePreResolvedCatalog, { excludeOrderId: id })'), 'Edit does not run authoritative shortage with own-reservation exclusion')
  for (const phase of ['old_content_retired', 'order_updated', 'new_content_written', 'shipping_committed']) {
    check(edit.includes(`'${phase}'`), `Edit critical phase missing: ${phase}`)
  }
  const editComplete = edit.indexOf('await completeCriticalOperation(db, criticalOperation, completedResponse)')
  check(editComplete >= 0 && edit.indexOf('await getOrder(db, id)', editComplete) > editComplete, 'Edit readback can still convert a committed save into failure')
  check(edit.includes('refreshRequired: true'), 'Edit has no success fallback when secondary readback fails')

  // Manual debt/payment writes are idempotent too. A lost response must never create a second payment.
  const manualPaymentStart = money.indexOf('export async function createManualOrderPaymentCritical(')
  check(manualPaymentStart >= 0, 'Critical manual payment helper missing')
  const manualPayment = money.slice(manualPaymentStart)
  for (const marker of [
    "beginCriticalOperation(db, 'order_payment_create'",
    'insertCriticalMappedEntity(',
    "'manual_order_payment'",
    "'payment_written'",
    "'ledger_synced'",
    'await db.batch([event, syncOrder])',
    'await completeCriticalOperation(db, criticalOperation, response)',
  ]) check(manualPayment.includes(marker), `Manual payment idempotency phase missing: ${marker}`)
  check(manualPayment.includes('192b2a4:${criticalOperation.requestId}:manual-payment'), 'Manual payment money event key is not request-id deterministic')
  check(manualPayment.indexOf('await completeCriticalOperation(db, criticalOperation, response)') > manualPayment.indexOf("'ledger_synced'"), 'Manual payment completes before ledger sync')

  // Shipping and stock handover consider the physical D1 commit successful even if secondary readback fails.
  const handoverRoute = between(worker, "const orderStockHandoverMatch = url.pathname.match(", "const orderShippingMatch = url.pathname.match(")
  check(handoverRoute.includes('safeHandoverReadback'), 'Stock handover lacks safe post-commit readback')
  check(handoverRoute.includes('refreshRequired: !nextState || !nextOrder'), 'Stock handover readback failure can still masquerade as action failure')
  const shippingRoute = between(worker, "const orderShippingMatch = url.pathname.match(", "const orderMatch = url.pathname.match(")
  check(shippingRoute.includes('Order shipping readback after committed send failed'), 'Shipping readback is still on the critical success boundary')
  check(shippingRoute.includes('refreshRequired: !updatedOrder'), 'Shipping has no successful readback-fallback response')
  check(shippingRoute.includes('Order shipping readback after already-sent retry failed'), 'Already-sent retry can still fail only because order readback failed')

  // Archive restore and return/exchange workflows use the same success boundary: complete first, read back second.
  const restore = between(ordersRead, 'export async function restoreArchivedOrder(', 'export function retainedOrderSummaryPayload(')
  check(restore.includes('const safeReadback = async () =>') && restore.indexOf('const restored = await safeReadback()', restore.indexOf('UPDATE orders')) > restore.indexOf('UPDATE orders'), 'Archive restore readback guard missing')
  check(restore.includes('alreadyRestored: true'), 'Archive restore is not naturally idempotent after a lost response')
  check(restore.includes('refreshRequired: true'), 'Archive restore has no successful readback fallback')
  check(restore.includes('Order archive restore activity log after committed restore failed'), 'Archive restore activity log can still turn a committed restore into false failure')
  for (const [name, next] of [
    ['createReturn', 'export const noStandaloneReturnSql'],
    ['createExchange', 'export async function listExchanges'],
    ['cancelReturn', 'export async function cancelExchange'],
  ]) {
    const block = between(returnsExchanges, `export async function ${name}(`, next)
    const complete = block.indexOf('await completeCriticalOperation')
    const readback = block.indexOf('await getOrder', complete)
    check(complete >= 0 && readback > complete, `${name} can still fail on order readback after committed mutation`)
    check(block.includes('refreshRequired: true'), `${name} lacks successful refresh fallback`)
  }
  const cancelExchange = returnsExchanges.slice(returnsExchanges.indexOf('export async function cancelExchange('))
  check(cancelExchange.indexOf('await completeCriticalOperation') >= 0 && cancelExchange.indexOf('await getOrder', cancelExchange.indexOf('await completeCriticalOperation')) > cancelExchange.indexOf('await completeCriticalOperation'), 'cancelExchange can still fail on order readback after commit')
  check(cancelExchange.includes('refreshRequired: true'), 'cancelExchange lacks successful refresh fallback')
  for (const marker of [
    'Return activity log after committed return failed',
    'Exchange activity log after committed exchange failed',
    'Return cancellation activity log after committed cancellation failed',
    'Exchange cancellation activity log after committed cancellation failed',
  ]) check(returnsExchanges.includes(marker), `Committed return/exchange can still fail only because activity logging failed: ${marker}`)
  check(worker.includes('Order shipping activity log after committed send failed'), 'Committed shipping can still fail only because activity logging failed')
  check(worker.includes('Order stock issue activity log after committed handover failed'), 'Committed stock handover can still fail only because activity logging failed')
  check(worker.includes('Order payment activity log after committed payment failed'), 'Committed payment can still fail only because activity logging failed')
  check(reservations.includes('Order stock handover activity log after committed reconciliation failed'), 'Checkpoint reconciliation can still false-fail on activity log')
  check(reservations.includes('Order stock handover activity log after committed location check failed'), 'Checkpoint location confirmation can still false-fail on activity log')
  check(ordersRead.includes('Orders archive activity log after committed archive failed'), 'Committed archive can still false-fail on activity log')

  // Frontend clears idempotency tokens immediately on confirmed success and secondary refreshes cannot reclassify success as failure.
  const editSubmit = app.slice(app.indexOf("const criticalKey = `order-edit:${order.id}`"), app.indexOf('async function loadArchivePreview'))
  const editCompleteToken = editSubmit.indexOf('completeCriticalRequest(criticalKey, critical.requestId)')
  const editOrderBranch = editSubmit.indexOf('if (result?.order)')
  check(editCompleteToken >= 0 && editCompleteToken < editOrderBranch, 'Successful order edit leaves browser idempotency token uncleared on common result.order path')
  check(app.includes("const criticalKey = `order-debt-payment:${debtSelectedOrder.id}:${paymentIndex}`"), 'Debt payment UI does not assign a stable critical request per payment row')
  check(app.includes("headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': critical.requestId }"), 'Critical order-side writes are missing idempotency header')
  for (const key of ['return-create:', 'exchange-create:', 'return-cancel:', 'exchange-cancel:']) {
    const start = app.indexOf(`const criticalKey = \`${key}`)
    check(start >= 0, `Frontend critical key missing: ${key}`)
    const section = app.slice(start, start + 5000)
    const token = section.indexOf('completeCriticalRequest(criticalKey, critical.requestId)')
    const refresh = section.indexOf('Promise.allSettled([')
    check(token >= 0 && refresh > token, `${key} clears retry token only after secondary refresh`)
  }

  // Workshop schema must fail before critical order content writes, not halfway through task creation.
  check(workshopSchema.includes("'order_item_id'"), 'Workshop schema preflight does not require order_item_id')
  check(create.indexOf('assertWorkshopTaskDetailSchema') < create.indexOf('INSERT INTO orders ('), 'Create Workshop schema is checked after order insertion')
  check(edit.includes('if (rewriteItems && nextItems.some(item => item.isWorkshop)) await assertWorkshopTaskDetailSchema(db)'), 'Edit Workshop schema preflight missing')

  // Editor must round-trip hidden identity/value fields without triggering false inventory rewrites.
  check(appUtils.includes('unitPrice: Number(item.unitPrice || 0)'), 'Editor drops stored item unitPrice')
  check(appTypes.includes('audienceType') && orders.includes('audienceType:'), 'Order read/editor path drops audienceType')

  // Empty payment row is UI-only; it must not appear as a real optimistic payment.
  check(app.includes(".filter((payment) => String(payment.method || '').trim() && Number(payment.amount || 0) > 0)"), 'Optimistic created order still exposes blank payment row')

  // Browser reload must reuse an unresolved idempotency key without persisting customer/order payload.
  check(apiClient.includes('window.sessionStorage') && apiClient.includes('criticalRequestFingerprintTag'), 'Critical request id does not survive tab reload')
  check(apiClient.includes('orders-app:critical-request:'), 'Critical request storage namespace missing')
  check(!apiClient.includes('sessionStorage.setItem(criticalRequestStorageKey(key), fingerprint)'), 'Raw order payload/fingerprint is persisted in browser storage')
  const createSuccess = app.indexOf('completeCriticalRequest(criticalKey, critical.requestId)', app.indexOf("const criticalKey = 'order-create'"))
  const createUiMutation = app.indexOf('invalidateFinanceReadCaches()', createSuccess)
  check(createSuccess >= 0 && createUiMutation > createSuccess, 'Create retry token is not cleared immediately after confirmed server success')

  // Critical-operation mapping uniqueness remains the database-level final guard.
  const migration = read('migrations/0059_v72_critical_operation_idempotency.sql')
  const db = new DatabaseSync(':memory:')
  db.exec(migration)
  db.prepare("INSERT INTO critical_operations(request_id,operation_type,request_fingerprint,status,step,context_json,lease_token,lease_until_ms,created_at,updated_at) VALUES('save-1','order_create','f','started','order_created','{}','l',1,'t','t')").run()
  db.prepare("INSERT INTO critical_operation_entities(request_id,entity_type,entity_key,entity_id,created_at) VALUES('save-1','order_item','order_create:item:1',101,'t')").run()
  db.prepare("INSERT INTO critical_operation_entities(request_id,entity_type,entity_key,entity_id,created_at) VALUES('save-1','order_item','order_create:item:1',101,'t') ON CONFLICT(request_id,entity_type,entity_key) DO NOTHING").run()
  check(Number(db.prepare("SELECT COUNT(*) AS c FROM critical_operation_entities WHERE request_id='save-1' AND entity_type='order_item' AND entity_key='order_create:item:1'").get().c) === 1, 'Critical entity mapping permits duplicate order content')

  const release = read('scripts/release-check.mjs')
  check(release.includes('test-step192b2a4-order-create-save-integrity.mjs'), '192B2A4 is not chained into cumulative release gate')
  check(release.includes('step192b2a4-order-create-save-integrity-manifest.json'), '192B2A4 exact manifest is not required by release gate')

  console.log('STEP 192B2A4 ORDER CREATE/SAVE INTEGRITY TESTS PASSED — resumable create/edit, manual payments, shipping/handover, returns/exchanges, archive restore, controlled shortage/input errors, Workshop preflight, retry-safe counters/reservations, secondary read isolation, browser idempotency')
} catch (error) {
  console.error(`STEP 192B2A4 ORDER CREATE/SAVE INTEGRITY TESTS FAILED: ${error?.message || error}`)
  process.exit(1)
}
