import fs from 'node:fs'

const app = fs.readFileSync('src/App.tsx', 'utf8')
const router = fs.readFileSync('worker/index.ts', 'utf8')
const reservations = fs.readFileSync('worker/domains/order-reservations.ts', 'utf8')
const check = (ok, message) => { if (!ok) throw new Error(message) }

try {
  const clientStart = app.indexOf('async function runOrderStockHandoverAction')
  const clientEnd = app.indexOf('\n\n  async function markOrderSentToClient', clientStart)
  check(clientStart >= 0 && clientEnd > clientStart, 'Phase2C early handover client function missing')
  const client = app.slice(clientStart, clientEnd)

  check(client.includes("action === 'issue_now'"), 'Phase2C issue_now branch missing')
  check(client.includes("result.code === 'stock_resolution_required'"), 'Phase2C client does not consume stock_resolution_required')
  check(client.includes("result.operationType === 'handover'"), 'Phase2C client does not scope resolver to handover')
  check(client.includes('эти конкретные вещи сейчас физически у вас') && client.includes('Это не пересчёт всего остатка.'), 'Phase2C possession wording missing')
  check(client.includes('stockConfirmations') && client.includes('expectedQuantity') && client.includes('operationQuantity'), 'Phase2C confirmation replay payload missing')
  check(client.includes('submitHandoverAction(stockConfirmations)'), 'Phase2C does not resume the same early handover action after confirmation')
  check(!client.includes('window.prompt('), 'Phase2C early handover asks for an invented total stock count')
  check(!client.includes('countedQuantity'), 'Phase2C early handover submits a fake exact count')

  const routeStart = router.indexOf("const orderStockHandoverMatch = url.pathname.match(/^\\/api\\/orders\\/(\\d+)\\/stock-handover$/)")
  const routeEnd = router.indexOf('const orderShippingCorrectionMatch', routeStart)
  check(routeStart >= 0 && routeEnd > routeStart, 'Phase2C stock-handover route missing')
  const route = router.slice(routeStart, routeEnd)

  check(route.includes('stockConfirmations?: unknown'), 'Phase2C handover route does not accept bounded possession confirmation')
  check(route.includes('normalizeShipmentStockConfirmations(input.stockConfirmations)'), 'Phase2C handover confirmation normalization missing')
  check(route.includes('trackedPhysicalQuantity < operationQuantity && !matchingConfirmation'), 'Phase2C shortage gate missing')
  check(route.includes("buildStockResolutionRequired('handover'"), 'Phase2C route does not return shared handover resolver contract')
  check(route.includes('candidate.expectedQuantity === trackedPhysicalQuantity') && route.includes('candidate.operationQuantity === operationQuantity'), 'Phase2C stale/quantity confirmation guard missing')
  check(route.includes("stockConfirmationOperation: 'handover'"), 'Phase2C fulfillment is not marked as handover evidence')
  check(route.indexOf("if (item.reviewNeeded)") < route.indexOf("buildStockResolutionRequired('handover'"), 'Phase2C mixed physical shortage with historical checkpoint lineage')
  check(route.includes("if (action === 'issued_before_checkpoint')") && route.includes("if (action === 'still_here')"), 'Phase2C damaged historical checkpoint decisions')

  const typeStart = reservations.indexOf('export type OrderStockHandoverItem')
  const fulfillStart = reservations.indexOf('export async function fulfillOrderReservationsV2')
  const blockerStart = reservations.indexOf('export async function getOrderShipmentInventoryBlockers')
  check(typeStart >= 0 && fulfillStart > typeStart && blockerStart > fulfillStart, 'Phase2C reservation source boundaries missing')
  const handoverTypes = reservations.slice(typeStart, fulfillStart)
  const fulfill = reservations.slice(fulfillStart, blockerStart)

  check(handoverTypes.includes('variantId: number;'), 'Phase2C handover state does not expose exact variant identity')
  check(fulfill.includes("stockConfirmationOperation = options.stockConfirmationOperation === 'handover' ? 'handover' : 'shipping'"), 'Phase2C fulfillment operation context missing')
  check(fulfill.includes("stockConfirmationOperation === 'handover' && scopedOrderItemIds.length !== 1"), 'Phase2C handover evidence is not pinned to exactly one order item')
  check(fulfill.includes("SELECT 'handover:' || ? || ':' || ? || ':' || x.source || ':' || x.variant_id"), 'Phase2C handover evidence key is not item/SKU scoped')
  check(fulfill.includes("x.source, x.variant_id, 'handover'"), 'Phase2C evidence is not classified as handover')
  check(fulfill.includes('${externalId}:item:${handoverOrderItemId}'), 'Phase2C evidence reference does not preserve order-item identity')
  check(fulfill.includes("SELECT 'shipping:' || ? || ':' || x.source || ':' || x.variant_id"), 'Phase2C broke Phase2B shipping evidence path')
  check(fulfill.includes('SET quantity = MAX(0, (SELECT x.effective_quantity - x.required'), 'Phase2C tracked Physical can go below zero')
  check(!/stockConfirmationOperation === 'handover'[\s\S]{0,1800}inventory_stock_checks/.test(fulfill), 'Phase2C handover possession confirmation is being stored as an exact stock check')

  console.log('STAGE02 PHASE2C EARLY HANDOVER POSSESSION RESOLVER TESTS PASSED')
} catch (error) {
  console.error('STAGE02 PHASE2C EARLY HANDOVER POSSESSION RESOLVER TESTS FAILED:', error instanceof Error ? error.message : error)
  process.exit(1)
}
