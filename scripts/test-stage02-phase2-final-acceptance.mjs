import fs from 'node:fs'

const read = (path) => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }
const sliceFunction = (source, signature, nextSignature = '\nexport async function ') => {
  const start = source.indexOf(signature)
  if (start < 0) throw new Error(`Missing function: ${signature}`)
  const end = source.indexOf(nextSignature, start + signature.length)
  return source.slice(start, end > start ? end : source.length)
}

const stock = read('worker/domains/stock-resolution.ts')
const reservations = read('worker/domains/order-reservations.ts')
const movement = read('worker/domains/inventory-movement.ts')
const lifecycle = read('worker/domains/lifecycle.ts')
const returnsExchange = read('worker/domains/returns-exchanges.ts')
const stocktake = read('worker/domains/inventory-stocktake.ts')
const router = read('worker/index.ts')
const app = read('src/App.tsx')
const inventorySection = read('src/features/sections/InventorySection.tsx')
const ordersView = read('src/features/sections/OrdersTableSection.tsx')
const evidenceMigration = read('migrations/0071_v72_inventory_operation_evidence.sql')

const fulfill = sliceFunction(reservations, 'export async function fulfillOrderReservationsV2')
const manual = sliceFunction(movement, 'export async function applyInventoryMovement')
const transfer = sliceFunction(movement, 'export async function applyInventoryTransfer')
const reversal = sliceFunction(movement, 'export async function reverseInventoryTransferDocument')
const receive = sliceFunction(returnsExchange, 'export async function receiveReturnedItem')
const knownIntake = sliceFunction(lifecycle, 'export async function reconcileKnownPendingInventoryInbound')
const completeStocktake = sliceFunction(stocktake, 'export async function completeInventoryStocktakeSession')

check(stock.includes("export type StockResolutionOperationType = 'shipping' | 'handover' | 'transfer' | 'writeoff'"), '1. Operational resolver scope drifted into exact-count/intake workflows')
check(stock.includes('trackedPhysicalAfter: Math.max(0, trackedPhysicalBefore - operationQuantity)'), '2. Bounded outbound can make Physical negative')
check(stock.includes('explainedQuantity = Math.min(trackedPhysicalBefore, operationQuantity)') && stock.includes('unexplainedQuantity = Math.max(0, operationQuantity - trackedPhysicalBefore)'), '3. Explained/unexplained outbound split is missing')

check(fulfill.includes('INSERT OR IGNORE INTO inventory_operation_evidence'), '4. Shipping/handover unexplained outbound is not durably auditable')
check(fulfill.includes("SELECT 'shipping:' || ? || ':' || x.source || ':' || x.variant_id") && fulfill.includes("SELECT 'handover:' || ? || ':' || ? || ':' || x.source || ':' || x.variant_id"), '5. Shipping/handover evidence keys are not operation scoped')
check(fulfill.includes('SET quantity = MAX(0, (SELECT x.effective_quantity - x.required'), '6. Shipping/handover source Physical is not bounded at zero')
check(!/stockConfirmation[\s\S]{0,500}INSERT OR IGNORE INTO inventory_stock_checks/.test(fulfill), '7. Possession confirmation is being persisted as an exact physical count')

check(manual.includes("const stockConfirmations = movementType === 'writeoff'") && manual.includes(": [];"), '8. Manual resolver leaked into Arrival/manual exact-count workflows')
check(manual.includes('Списание больше не принимает полный фактический остаток'), '9. Writeoff still accepts operation-time full-stock observations')
check(manual.includes('targetQuantity = boundedOutbound.trackedPhysicalAfter') && manual.includes('delta = -boundedOutbound.explainedQuantity'), '10. Writeoff does not use bounded source truth')
check(manual.includes("SELECT 'writeoff:' || ? || ':' || ? || ':' || x.variant_id") && manual.includes("x.variant_id, 'writeoff', ?, x.current_quantity, x.operation_quantity"), '11. Writeoff unexplained outbound evidence is missing')

check(transfer.includes('Перемещение больше не принимает полный фактический остаток'), '12. Transfer still accepts operation-time full-stock observations')
check(transfer.includes('SET quantity = MAX(0, quantity) + (SELECT move_qty'), '13. Transfer destination does not receive exact +Q from a nonnegative baseline')
check(transfer.includes("SELECT 'transfer:' || ? || ':' || ? || ':' || x.variant_id") && transfer.includes("x.variant_id, 'transfer', ?, x.source_current, x.move_qty"), '14. Transfer unexplained outbound evidence is missing')
check(reversal.includes('const sourceRestoreQuantity = Math.max(0, fromQuantityBefore - fromQuantityAfter)'), '15. Transfer reversal can inflate source by unexplained Q')
check(reversal.includes('quantity = quantity - (SELECT move_qty'), '16. Transfer reversal no longer removes exact moved Q from destination')

check(evidenceMigration.includes('evidence_key TEXT NOT NULL UNIQUE'), '17. Operational evidence is not idempotency-guarded')
check(evidenceMigration.includes('CHECK (explained_quantity + unexplained_quantity = confirmed_operation_quantity)'), '18. Operational evidence arithmetic is not constrained')

check(knownIntake.includes("reason: 'later_physical_check'") || lifecycle.includes("reason: 'later_physical_check'"), '19. Newer exact physical truth does not supersede older pending inbound evidence')
check(knownIntake.includes('inventoryLifecycleDeferredInboundDisposition(db, event, variantId)'), '20. Direct intake reconciliation bypasses physical-truth precedence')
check(completeStocktake.includes('inventory_stock_checks') && completeStocktake.includes('counted_quantity'), '21. Explicit stocktake no longer records exact physical count truth')

check(receive.includes("eventType: operationType === 'return' ? 'return_in' : 'exchange_old_in'") && receive.includes("direction: 'in'"), '22. Return/exchange receipt is not represented as explicit inbound transaction truth')
check(receive.includes('applyCanonicalInventoryLifecycleEvent') && !receive.includes('buildStockResolutionRequired'), '23. Return/exchange intake was incorrectly converted into outbound possession resolver semantics')

const shippingRouteStart = router.indexOf("const orderShippingMatch = url.pathname.match(/^\\/api\\/orders\\/(\\d+)\\/shipping$/)")
const shippingRouteEnd = router.indexOf('const orderDeleteMatch', shippingRouteStart)
check(shippingRouteStart >= 0 && shippingRouteEnd > shippingRouteStart, '24. Shipping route missing')
const shippingRoute = router.slice(shippingRouteStart, shippingRouteEnd)
check(shippingRoute.indexOf("code: 'catalog_review_required'") >= 0 && shippingRoute.indexOf("code: 'catalog_review_required'") < shippingRoute.indexOf("buildStockResolutionRequired('shipping'"), '25. Catalog identity ambiguity is no longer separated from physical shortage')

check(app.includes("result.code === 'stock_resolution_required'") && app.includes("result.operationType === 'shipping'"), '26. Shipping does not resolve shortage in its own workflow')
check(app.includes("const resolverOperation = isTransfer ? 'transfer' : isWriteoff ? 'writeoff' : ''"), '27. Transfer/writeoff do not resolve shortage in their own workflow')
check(ordersView.includes('void openOrderStockHandover(order)'), '28. Handover requires Warehouse Attention instead of the order workflow')
check(inventorySection.includes('{warehouseClarificationCount > 0 ? <button') && inventorySection.includes('{warehousePendingIntakeCount > 0 ? <button'), '29. Empty Attention is still presented as a required daily inbox')
check(app.includes('reconcileKnownInventoryLifecycle') && app.includes('<OrderReturnsSection') && app.includes('<OrderExchangeSection'), '30. Known return/exchange intake lacks an owning-workflow recovery path')

check(manual.includes("const allowed = new Set<InventoryMovementKind>(['arrival', 'manual_set', 'writeoff', 'sale', 'return', 'revision', 'delete'])"), '31. Arrival movement support was accidentally removed')
check(manual.includes("const stockConfirmations = movementType === 'writeoff'"), '32. Arrival was accidentally coupled to stock-resolution confirmations')

console.log('STAGE02 PHASE2 FINAL ACCEPTANCE PASSED — bounded operational evidence, exact-count precedence, direct workflow recovery, transfer reversal truth, return/exchange intake separation, catalog separation, and Arrival isolation are all protected.')
