import fs from 'node:fs'

const read = (path) => fs.readFileSync(path, 'utf8')
const check = (condition, reason) => { if (!condition) throw new Error(reason) }
const deletion = read('worker/domains/order-delete.ts')
const critical = read('worker/domains/critical.ts')
const app = read('src/App.tsx')

// Read-only evidence must be taken from the SAME order and SAME fulfilled reservations
// that block deletion. An overall "not_sent" flag does not rule out per-item fulfilment.
check(deletion.includes('oi.product_name_snapshot, oi.color_snapshot, oi.material_snapshot, oi.size_snapshot'), 'missing precise issued SKU snapshot')
check(deletion.includes('WHERE r.order_id = ? AND r.status = \'fulfilled\''), 'issued evidence must be scoped to the order')
check(deletion.includes('confirmationRequired.details = {'), 'read-only blocker details are absent')
check(deletion.includes('issuedItemsTotal: fulfilledReservations.length'), 'missing issued item count')
check(deletion.includes('activeExchangeCount:'), 'active exchange impact missing')
check(deletion.includes('activeReturnCount:'), 'active return impact missing')
check(deletion.indexOf('confirmationRequired.details = {') < deletion.indexOf('const activeExchangeRows ='), 'read-only blocker must precede downstream operations')
check(critical.includes("error.code === 'order_delete_physical_confirmation_required' ? error.details"), 'blocker details are not transmitted narrowly')

// Frontend must display evidence before asking to reverse physical movements.
const begin = app.indexOf("if (!attempt.response.ok && attempt.result.code === 'order_delete_physical_confirmation_required')")
const end = app.indexOf("attempt = await sendDelete('not_issued')", begin)
check(begin > 0 && end > begin, 'no narrow deletion confirmation block')
const confirmation = app.slice(begin, end)
check(confirmation.includes("details?.shippingStatus === 'not_sent'"), 'not-sent orders still can have issued items')
check(confirmation.includes('item.productName') && confirmation.includes('item.quantity') && confirmation.includes('item.source'), 'exact issued item and location absent from UI')
check(confirmation.includes('Проведённых обменов:') && confirmation.includes('Проведённых возвратов:'), 'existing operations impact is not explained')
check(confirmation.includes('if (!notIssued) {') && confirmation.includes('setMessage(') && confirmation.includes('return'), 'declining confirmation should exit without posting delete')
check(!confirmation.includes("throw new Error('Удаление остановлено"), 'operator decline is still shown as a red app error')
check(end < app.indexOf("if (!attempt.response.ok) throw new Error", end), 'deletion attempts are not safely sequenced')

console.log('ORDER DELETE PHYSICAL GUIDANCE PASSED — exact source/SKU evidence, exchange impact, separate shipping status and normal cancellation')
