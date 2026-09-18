import fs from 'node:fs'

const source = fs.readFileSync('worker/domains/workshop.ts', 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

const start = source.indexOf('export async function bulkUpdateWorkshopTasks(')
check(start >= 0, 'bulkUpdateWorkshopTasks missing')
const fn = source.slice(start)

const concreteCommit = fn.indexOf('await db.batch(statements)')
const orderIds = fn.indexOf('const orderIds = Array.from(new Set(updates.map(row => row.orderId)')
const cacheWarning = fn.indexOf("console.warn('Workshop order status cache refresh failed after committed bulk task mutation'")
check(concreteCommit >= 0 && orderIds > concreteCommit && cacheWarning > orderIds, 'Bulk Workshop cache refresh is not secondary to concrete task commit')

const beforeCommit = fn.slice(0, concreteCommit)
check(beforeCommit.includes('UPDATE workshop_tasks'), 'Bulk Workshop task mutation disappeared')
check(beforeCommit.includes('UPDATE order_items'), 'Bulk Workshop item repair disappeared')
check(!beforeCommit.includes('UPDATE orders\n         SET workshop_status'), 'Coarse Workshop order cache is still transaction-coupled to concrete bulk task mutation')

const afterCommit = fn.slice(concreteCommit)
check(afterCommit.includes('WITH affected_orders(order_id) AS'), 'Bulk Workshop cache refresh lost bounded affected-order scope')
check(afterCommit.includes('FROM json_each(?)'), 'Bulk Workshop cache refresh no longer uses one bounded order-id bind')
check(afterCommit.includes('UPDATE orders\n         SET workshop_status'), 'Bulk Workshop cache refresh disappeared')
check(afterCommit.includes('try {') && afterCommit.includes('} catch (error) {'), 'Bulk Workshop cache refresh is not best-effort')
check(afterCommit.includes(".bind(JSON.stringify(orderIds), timestamp).run()"), 'Bulk Workshop cache refresh does not use unique affected order ids')
check(fn.indexOf('return {', cacheWarning) > cacheWarning, 'Bulk Workshop route result is returned before secondary cache handling completes')

console.log('STAGE01 WORKSHOP BULK CACHE R7 PASSED — concrete bulk task/item truth commits atomically before the coarse order cache refresh, which is bounded and best-effort')
