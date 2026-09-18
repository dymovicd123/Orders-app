import fs from 'node:fs'

const source = fs.readFileSync('worker/domains/orders-read.ts', 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

const start = source.indexOf('export async function listOrders(')
const end = source.indexOf('export async function listOpenDebtOrders(', start)
check(start >= 0 && end > start, 'listOrders block missing')
const listOrders = source.slice(start, end)

const shippingStart = listOrders.indexOf("if (shippingStatus === 'sent')")
const shippingEnd = listOrders.indexOf("if (status === 'active')", shippingStart)
check(shippingStart >= 0 && shippingEnd > shippingStart, 'Orders shipping-filter block missing')
const shippingBlock = listOrders.slice(shippingStart, shippingEnd)

check(shippingBlock.includes("shippingStatus === 'not_sent'"), 'not_sent Orders filter missing')
check(shippingBlock.includes("COALESCE(o.shipping_status, '') <> 'sent'"), 'not_sent Orders filter no longer follows shipping truth')
check(!shippingBlock.includes("COALESCE(o.return_amount, 0) <= 0"), 'historical refund still hides an unshipped working order')
check(!shippingBlock.includes("status !== 'returned'"), 'shipping filter still depends on the legacy returned-money pseudo-status')

// Legacy explicit returned filtering remains a separate API concern in this slice.
// R6 only fixes the ordinary visible “Не отправлено” queue.
check(listOrders.includes("} else if (status === 'returned') {\n    baseWhereParts.push('COALESCE(o.return_amount, 0) > 0');"), 'R6 unexpectedly widened into legacy returned-filter semantics')

console.log('STAGE01 UNSHIPPED REFUND DECOUPLING R6 PASSED — shipping filter follows shipping truth and partial/historical refunds no longer hide active unshipped orders')
