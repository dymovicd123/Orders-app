import fs from 'node:fs'

function check(condition, message) {
  if (!condition) throw new Error(message)
}

const lifecycle = fs.readFileSync('worker/domains/lifecycle.ts', 'utf8')
const worker = fs.readFileSync('worker/index.ts', 'utf8')
const app = fs.readFileSync('src/App.tsx', 'utf8')
const returnsSection = fs.readFileSync('src/features/sections/OrderReturnsSection.tsx', 'utf8')
const exchangeSection = fs.readFileSync('src/features/sections/OrderExchangeSection.tsx', 'utf8')

check(lifecycle.includes('inventoryLifecycleCancellationDisposition'), 'cancellation disposition helper missing')
check(lifecycle.includes("status = 'active'"), 'active stocktake safety gate missing')
check(lifecycle.includes('inventory_stock_checks'), 'later physical check safety gate missing')
check(lifecycle.includes("reason: 'insufficient_current_physical'"), 'negative physical protection missing')
check(lifecycle.includes('physicalReversalSkipped: true'), 'non-mutating cancellation outcome missing')
check(lifecycle.includes('protectedPhysicalTruth: true'), 'freshness protection result missing')
const returnRoute = worker.match(/const returnCancelMatch[\s\S]*?const exchangeCancelMatch/)?.[0] || ''
const exchangeStart = worker.indexOf('const exchangeCancelMatch')
const exchangeRoute = exchangeStart >= 0 ? worker.slice(exchangeStart, exchangeStart + 1600) : ''
check(returnRoute && !returnRoute.includes('requireAdminAccess(request)'), 'return cancellation is still admin-only')
check(exchangeRoute && !exchangeRoute.includes('requireAdminAccess(request)'), 'exchange cancellation is still admin-only')
check(worker.includes("returnExchangeCancelAutonomy: '192b2a5'"), 'health marker missing')
check(!app.includes('Отмена возврата доступна только администратору.'), 'frontend still blocks manager return cancellation')
check(!app.includes('Отмена обмена доступна только администратору.'), 'frontend still blocks manager exchange cancellation')
check(returnsSection.includes('>Отменить возврат</button>}'), 'return cancel action is not available in ordinary mode')
check(exchangeSection.includes("entry.status !== 'cancelled' ? <button"), 'exchange cancel action is not available in ordinary mode')
console.log('RETURN/EXCHANGE CANCEL AUTONOMY PASSED')
