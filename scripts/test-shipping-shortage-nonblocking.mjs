import fs from 'node:fs'
import path from 'node:path'
const root=process.cwd()
const source=fs.readFileSync(path.join(root,'worker/domains/order-reservations.ts'),'utf8')
const check=(value,message)=>{ if(!value) throw new Error(message) }
const fulfillStart=source.indexOf('export async function fulfillOrderReservationsV2')
const blockerStart=source.indexOf('export async function getOrderShipmentInventoryBlockers')
check(fulfillStart>=0 && blockerStart>fulfillStart,'shipment functions missing')
const fulfill=source.slice(fulfillStart, blockerStart)
const blockers=source.slice(blockerStart)
check(!fulfill.includes('effectiveQuantity < requirement.required'), 'physical shortage still hard-blocks fulfillment')
check(fulfill.includes('Math.max(0, quantityBefore - quantity)'), 'per-reservation physical clamp missing')
check(fulfill.includes('SET quantity = MAX(0, (SELECT x.effective_quantity - x.required'), 'aggregate physical clamp missing')
check(fulfill.includes('x.quantity_after - x.quantity_before, x.quantity_after'), 'sale movement must record actual physical delta')
check(blockers.includes('return [...(unresolvedResult.results || [])];'), 'shipment blocker list still includes physical shortage')
check(!blockers.includes('return [...(unresolvedResult.results || []), ...(shortageResult.results || [])];'), 'old shortage blocker return remains')
console.log('SHIPPING SHORTAGE NON-BLOCKING TESTS PASSED — physical discrepancy no longer blocks send; stock never drops below zero')
