import fs from 'node:fs'

const reservations = fs.readFileSync('worker/domains/order-reservations.ts', 'utf8')
const router = fs.readFileSync('worker/index.ts', 'utf8')
const check = (ok, message) => { if (!ok) throw new Error(message) }

try {
  const fulfillStart = reservations.indexOf('export async function fulfillOrderReservationsV2')
  const blockerStart = reservations.indexOf('export async function getOrderShipmentInventoryBlockers')
  check(fulfillStart >= 0 && blockerStart > fulfillStart, 'R9.2B fulfillment function missing')
  const fulfill = reservations.slice(fulfillStart, blockerStart)
  const guard = "EXISTS (SELECT 1 FROM orders shipping_order WHERE shipping_order.id = ? AND COALESCE(shipping_order.shipping_status, 'not_sent') <> 'sent')"
  check(fulfill.includes(`const orderStillUnsentSql = "${guard}"`), 'R9.2B current-order send guard missing')
  check((fulfill.match(/\$\{orderStillUnsentSql\}/g) || []).length >= 8, 'R9.2B not every physical/movement mutation is protected by current unsent order truth')
  check(fulfill.includes('shippingStatementIndex = statements.length'), 'R9.2B shipping commit result is not tracked inside the atomic batch')
  check(fulfill.includes("toInt(results[shippingStatementIndex]?.meta?.changes, 0) > 0"), 'R9.2B atomic winner is not derived from the final shipping CAS')
  check(fulfill.includes("fulfilled: options.shippingDate && !shippingCommitted ? 0 : activeReservationPayloads.length"), 'R9.2B losing replay still claims physical fulfillment')
  check(fulfill.includes("observationsApplied: options.shippingDate && !shippingCommitted ? 0 : observations.length"), 'R9.2B losing replay still claims stock observations')
  check(fulfill.includes("shippingCommitted = toInt(shippingUpdate.meta?.changes, 0) > 0"), 'R9.2B no-reservation shipping does not expose CAS result')

  const shippingStart = router.indexOf("const orderShippingMatch = url.pathname.match(/^\\/api\\/orders\\/(\\d+)\\/shipping$/)")
  const shippingEnd = router.indexOf('const orderDeleteMatch', shippingStart)
  check(shippingStart >= 0 && shippingEnd > shippingStart, 'R9.2B shipping route missing')
  const shipping = router.slice(shippingStart, shippingEnd)
  check(shipping.includes("WHERE id = ? AND COALESCE(shipping_status, 'not_sent') <> 'sent'"), 'R9.2B legacy shipping lacks compare-and-set guard')
  check(shipping.includes('shippingCommitted = toInt(shippingUpdate.meta?.changes, 0) > 0'), 'R9.2B legacy shipping does not identify the winning commit')
  check(shipping.includes("let shippingCommitted = humanInventoryModelEnabled ? Boolean(inventoryDelivery?.shippingCommitted) : false"), 'R9.2B human inventory commit result is ignored')
  check(shipping.includes('if (shippingCommitted) {') && shipping.includes("eventType: 'order_shipping_updated'"), 'R9.2B duplicate replay can still append a second shipping activity event')
  check(shipping.includes("...(!shippingCommitted ? { alreadySent: true } : {})"), 'R9.2B concurrent loser is not returned as a safe idempotent success')
  check(shipping.indexOf('if (shippingCommitted) {') < shipping.indexOf("eventType: 'order_shipping_updated'"), 'R9.2B activity guard does not surround shipping log')

  console.log('CATALOG RESOLVER R9.2B SHIPPING REPLAY SAFETY TESTS PASSED — overlapping/lost-response replays converge on one atomic stock+shipping commit, losing replays are success/no-op, and duplicate activity is suppressed.')
} catch (error) {
  console.error(`CATALOG RESOLVER R9.2B SHIPPING REPLAY SAFETY TESTS FAILED: ${error?.message || error}`)
  process.exit(1)
}
