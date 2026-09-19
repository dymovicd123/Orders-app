import fs from 'node:fs'

const app = fs.readFileSync('src/App.tsx', 'utf8')
const router = fs.readFileSync('worker/index.ts', 'utf8')
const reservations = fs.readFileSync('worker/domains/order-reservations.ts', 'utf8')
const stock = fs.readFileSync('worker/domains/stock-resolution.ts', 'utf8')
const check = (ok, message) => { if (!ok) throw new Error(message) }

try {
  const appStart = app.indexOf('async function markOrderSentToClient')
  const appEnd = app.indexOf('\n\n  async function correctMistakenOrderShipping', appStart)
  check(appStart >= 0 && appEnd > appStart, 'Phase2B shipping client function missing')
  const shippingClient = app.slice(appStart, appEnd)

  check(shippingClient.includes("result.code === 'stock_resolution_required'"), 'Phase2B client does not consume stock_resolution_required')
  check(shippingClient.includes("result.operationType === 'shipping'"), 'Phase2B client does not scope resolver to shipping')
  check(shippingClient.includes('прямо сейчас физически у вас') && shippingClient.includes('Это НЕ пересчёт всего остатка'), 'Phase2B possession wording is missing')
  check(shippingClient.includes('operationQuantity') && shippingClient.includes('expectedQuantity'), 'Phase2B client does not echo the exact operation/current-stock snapshot')
  check(!shippingClient.includes('window.prompt('), 'Phase2B shipping still asks the employee to invent a total stock count')
  check(!shippingClient.includes('countedQuantity'), 'Phase2B shipping still submits a fake full-SKU count')
  check(!shippingClient.includes('observations'), 'Phase2B shipping still submits legacy stock-count observations')

  const routeStart = router.indexOf("const orderShippingMatch = url.pathname.match(/^\\/api\\/orders\\/(\\d+)\\/shipping$/)")
  const routeEnd = router.indexOf('const orderDeleteMatch', routeStart)
  check(routeStart >= 0 && routeEnd > routeStart, 'Phase2B shipping route missing')
  const route = router.slice(routeStart, routeEnd)

  check(route.includes('normalizeShipmentStockConfirmations(input.stockConfirmations)'), 'Phase2B server does not normalize possession confirmations')
  check(route.includes("buildStockResolutionRequired('shipping'"), 'Phase2B server does not return the shared resolver contract')
  check(!route.includes("code: 'inventory_physical_shortage'"), 'Phase2B server still emits the legacy physical-count shortage code')
  check(!route.includes('normalizeShipmentObservations(input.observations)'), 'Phase2B route still accepts legacy full-count observations')
  check(route.includes('confirmation.expectedQuantity !== physical') && route.includes('confirmation.operationQuantity !== required'), 'Phase2B stale/changed confirmation guard missing')
  check(route.includes('stockConfirmations: normalizedStockConfirmations'), 'Phase2B confirmations are not forwarded into atomic fulfillment')

  const fulfillStart = reservations.indexOf('export async function fulfillOrderReservationsV2')
  const blockerStart = reservations.indexOf('export async function getOrderShipmentInventoryBlockers')
  check(fulfillStart >= 0 && blockerStart > fulfillStart, 'Phase2B fulfillment/blocker functions missing')
  const fulfill = reservations.slice(fulfillStart, blockerStart)
  const blockers = reservations.slice(blockerStart)

  check(fulfill.includes('boundedOutboundStock(quantity, requirement.required)'), 'Phase2B fulfillment does not use bounded outbound truth')
  check(fulfill.includes('bounded.requiresResolution && !stockConfirmation'), 'Phase2B fulfillment can bypass an unconfirmed shortage')
  check(fulfill.includes('stockConfirmation.expectedQuantity !== quantity') && fulfill.includes('stockConfirmation.operationQuantity !== requirement.required'), 'Phase2B fulfillment stale confirmation guard missing')
  check(fulfill.includes('confirmedOperationQuantity: state.stockConfirmation ? state.stockConfirmation.operationQuantity : null'), 'Phase2B operation evidence payload missing')
  check(fulfill.includes('INSERT OR IGNORE INTO inventory_operation_evidence'), 'Phase2B unexplained outbound evidence is not stored')
  check(fulfill.includes("SELECT 'shipping:' || ? || ':' || x.source || ':' || x.variant_id"), 'Phase2B evidence key is not shipping/SKU scoped')
  check(fulfill.includes('MAX(0, x.confirmed_operation_quantity - x.current_quantity)'), 'Phase2B unexplained quantity is not explicit')
  check(fulfill.includes('AND ${orderStillUnsentSql}'), 'Phase2B evidence is not guarded by current unsent order truth')
  check(fulfill.includes('SET quantity = MAX(0, (SELECT x.effective_quantity - x.required'), 'Phase2B tracked Physical can still go negative')
  check(!/stockConfirmation[\s\S]{0,500}inventory_stock_checks/.test(fulfill), 'Phase2B possession confirmation is being treated as an exact stock count')

  check(blockers.includes("...(shortageResult.results || [])"), 'Phase2B shipping shortages are not surfaced to the resolver')
  check(blockers.includes('Подтвердите только эти конкретные вещи'), 'Phase2B blocker copy still asks for a total physical count')
  check(stock.includes("code: 'stock_resolution_required'"), 'Phase2B shared stock resolver contract disappeared')

  console.log('STAGE02 PHASE2B SHIPPING POSSESSION RESOLVER PASSED — shortage confirmation proves only the concrete shipment, never a full SKU count; tracked Physical is bounded and unexplained outbound stays auditable/replay-safe.')
} catch (error) {
  console.error(`STAGE02 PHASE2B SHIPPING POSSESSION RESOLVER FAILED: ${error?.message || error}`)
  process.exit(1)
}
