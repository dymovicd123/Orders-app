import fs from 'node:fs'

const source = fs.readFileSync('worker/domains/returns-exchanges.ts', 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }
const fn = (name, next) => {
  const start = source.indexOf('export async function ' + name + '(')
  const end = source.indexOf('export async function ' + next + '(', start)
  check(start >= 0 && end > start, name + ' block missing')
  return source.slice(start, end)
}

const createReturn = fn('createReturn', 'receiveReturnedItem')
const createExchange = fn('createExchange', 'correctExchangeFinancials')
const cancelReturn = fn('cancelReturn', 'cancelExchange')
const cancelExchangeStart = source.indexOf('export async function cancelExchange(')
check(cancelExchangeStart >= 0, 'cancelExchange block missing')
const cancelExchange = source.slice(cancelExchangeStart)

check(createReturn.includes("console.warn('Workshop order status cache refresh failed after committed return'"), 'createReturn can still false-fail because the coarse Workshop cache refresh failed')
check(createReturn.indexOf("console.warn('Workshop order status cache refresh failed after committed return'") < createReturn.indexOf('await completeCriticalOperation(db, criticalOperation, completedResponse)'), 'createReturn cache isolation moved after completion unexpectedly')

for (const [name, block, marker] of [
  ['createExchange', createExchange, 'Workshop order status cache refresh failed after committed exchange'],
  ['cancelReturn', cancelReturn, 'Workshop order status cache refresh failed after committed return cancellation'],
  ['cancelExchange', cancelExchange, 'Workshop order status cache refresh failed after committed exchange cancellation'],
]) {
  const refresh = block.indexOf('await refreshOrderWorkshopStatusFromTasks')
  const warning = block.indexOf("console.warn('" + marker + "'")
  const complete = block.indexOf('await completeCriticalOperation(db, criticalOperation, completedResponse)', warning)
  check(refresh >= 0 && warning > refresh, name + ' Workshop cache refresh is not protected by best-effort isolation')
  check(complete > warning, name + ' no longer completes after the best-effort coarse cache refresh')
}

check(createReturn.includes('UPDATE workshop_tasks SET quantity = ?, status = ?, updated_at = ?'), 'createReturn lost concrete Workshop task mutation')
check(cancelReturn.includes('UPDATE workshop_tasks') && cancelReturn.includes('SET status = ?, quantity = ?, updated_at = ?'), 'cancelReturn lost concrete Workshop task restoration')
check(createExchange.includes('refreshRequired: true'), 'createExchange lost successful refresh fallback')
check(cancelExchange.includes('refreshRequired: true'), 'cancelExchange lost successful refresh fallback')

console.log('STAGE01 RETURN/EXCHANGE WORKSHOP CACHE R5 PASSED — concrete lifecycle mutations remain authoritative and coarse Workshop cache refresh cannot false-fail committed Return/Exchange work')
