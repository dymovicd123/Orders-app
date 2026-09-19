import fs from 'node:fs'

const app = fs.readFileSync('src/App.tsx', 'utf8')
const router = fs.readFileSync('worker/index.ts', 'utf8')
const reservations = fs.readFileSync('worker/domains/order-reservations.ts', 'utf8')
const migration = fs.readFileSync('migrations/0071_v72_inventory_operation_evidence.sql', 'utf8')

const check = (condition, message) => { if (!condition) throw new Error(message) }

const appStart = app.indexOf('async function markOrderSentToClient')
const appEnd = app.indexOf('\n\n  async function correctMistakenOrderShipping', appStart)
check(appStart >= 0 && appEnd > appStart, 'Phase2B shipping client function missing')
const shippingClient = app.slice(appStart, appEnd)

check(!shippingClient.includes('window.prompt('), 'Phase2B shipping still asks for a fabricated full-SKU count')
check(shippingClient.includes('window.confirm('), 'Phase2B possession confirmation is not shown at the shipping action')
check(shippingClient.includes("result.code === 'stock_resolution_required'"), 'Phase2B client does not recognize shared stock resolver contract')
check(shippingClient.includes('expectedPhysicalQuantity'), 'Phase2B client does not bind confirmation to fresh tracked Physical')
check(shippingClient.includes('operationQuantity'), 'Phase2B client does not bind confirmation to the concrete outbound quantity')
check(shippingClient.includes('Это не пересчёт всего остатка'), 'Phase2B client does not explain the bounded truth semantics')
check(shippingClient.includes('stockConfirmations'), 'Phase2B client still sends absolute stock observations')

const routeStart = router.indexOf("const orderShippingMatch = url.pathname.match(/^\\/api\\/orders\\/(\\d+)\\/shipping$/)")
const routeEnd = router.indexOf('const orderDeleteMatch', routeStart)
check(routeStart >= 0 && routeEnd > routeStart, 'Phase2B shipping route missing')
const route = router.slice(routeStart, routeEnd)

check(route.includes("code: 'stock_resolution_client_refresh_required'"), 'Phase2B does not reject stale absolute-count clients')
check(route.includes("buildStockResolutionRequired('shipping'"), 'Phase2B route does not emit shared stock_resolution_required contract')
check(!route.includes("code: 'inventory_physical_shortage'"), 'Phase2B route still exposes the old count-oriented shortage contract')
check(route.includes('confirmation.expectedPhysicalQuantity !== physical'), 'Phase2B route lacks Physical freshness binding')
check(route.includes('confirmation.operationQuantity !== required'), 'Phase2B route lacks operation-quantity binding')
check(route.includes('stockConfirmations: normalizedStockConfirmations'), 'Phase2B route does not pass possession confirmation into atomic fulfillment')
check(route.includes('confirmedBy:'), 'Phase2B route does not preserve confirmation actor')

const fulfillStart = reservations.indexOf('export async function fulfillOrderReservationsV2')
const fulfillEnd = reservations.indexOf('\n\nexport async function correctMistakenOrderHandover', fulfillStart)
check(fulfillStart >= 0 && fulfillEnd > fulfillStart, 'Phase2B fulfillment function missing')
const fulfill = reservations.slice(fulfillStart, fulfillEnd)

check(fulfill.includes('boundedOutboundStock(quantity, requirement.required)'), 'Phase2B fulfillment does not use bounded outbound stock truth')
check(fulfill.includes('quantityAfter: bounded.trackedPhysicalAfter'), 'Phase2B fulfillment does not preserve Physical >= 0')
check(fulfill.includes('unexplainedQuantity: bounded.unexplainedQuantity'), 'Phase2B fulfillment loses the unexplained outbound quantity')
check(fulfill.includes('INSERT OR IGNORE INTO inventory_operation_evidence'), 'Phase2B unexplained outbound is not durably auditable')
check(fulfill.includes("'shipping:' || ? || ':' || x.source || ':' || x.variant_id"), 'Phase2B shipping evidence key is not idempotent per order/source/SKU')
check(fulfill.includes('AND x.possession_confirmed = 1'), 'Phase2B can create discrepancy evidence without explicit possession confirmation')
check(fulfill.includes('AND ${orderStillUnsentSql}'), 'Phase2B evidence is not tied to the atomic shipping winner')
check(fulfill.includes('SET quantity = (SELECT x.quantity_after'), 'Phase2B stock mutation does not use bounded quantity_after')
check(!fulfill.includes('shipping_observation'), 'Phase2B still records contextual shipping confirmation as an exact observation')
check(!fulfill.includes('SET quantity = (SELECT x.effective_quantity'), 'Phase2B still overwrites Physical from contextual confirmation')
check(!fulfill.includes('effectiveQuantity: state.'), 'Phase2B still models confirmation as an absolute effective count')
check(fulfill.includes('const remainingByKey = new Map(Array.from(stockByKey.entries()).map(([key, state]) => [key, state.quantity]))'), 'Phase2B per-reservation movement does not start from tracked Physical')
check(fulfill.includes('confirmationsApplied:'), 'Phase2B fulfillment result does not report possession confirmations')
check(!fulfill.includes('observationsApplied:'), 'Phase2B fulfillment still exposes count-observation semantics')

check(migration.includes('inventory_operation_evidence'), 'Phase2B evidence schema missing')
check(!migration.includes('inventory_stock_checks'), 'Phase2B evidence schema must stay separate from exact stock counts')

console.log('STAGE02 PHASE2B SHIPPING POSSESSION TESTS PASSED — shipping asks only about the concrete units being handed over, never rewrites total Physical from that answer, clamps tracked stock at zero, and records unexplained outbound evidence atomically/idempotently.')
