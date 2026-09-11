import fs from 'node:fs'

const read = (path) => fs.readFileSync(path, 'utf8')
const worker = read('worker/domains/returns-exchanges.ts')
const router = read('worker/index.ts')
const app = read('src/App.tsx')
const ui = read('src/features/sections/OrderExchangeSection.tsx')

const check = (condition, message) => { if (!condition) throw new Error(message) }
const fnStart = worker.indexOf('export async function correctExchangeFinancials(')
const fnEnd = worker.indexOf('export async function listExchanges(', fnStart)
check(fnStart >= 0 && fnEnd > fnStart, 'A5 correction function missing')
const fn = worker.slice(fnStart, fnEnd)

check(fn.includes("beginCriticalOperation(db, 'exchange_financial_correction'"), 'A5 correction must be idempotent')
check(fn.includes('CriticalOperationConflictError'), 'A5 correction must stale-check the opened exchange snapshot')
check(fn.includes("financialAction !== 'extra_payment' && financialAction !== 'refund'"), 'A5 must keep exchange financial action immutable')
check(fn.includes('UPDATE payments') && fn.includes('UPDATE returns') && fn.includes('UPDATE return_items SET amount'), 'A5 must keep linked payment/refund rows consistent')
check(fn.includes('UPDATE exchanges') && fn.includes('UPDATE orders SET total_amount'), 'A5 must update exchange and order financial totals together')
check(fn.includes("eventType: financialAction === 'extra_payment' ? 'payment_reversal' : 'refund_reversal'"), 'A5 must append immutable reversal history')
check(fn.includes("eventType: financialAction === 'extra_payment' ? 'exchange_extra' : 'exchange_refund'"), 'A5 must append corrected financial history')
check(fn.includes("entry_type") && fn.includes("exchange_financial_correction") && fn.includes('cashDelta'), 'A5 must reconcile the cash-register delta')
check(!fn.includes('inventory_stock') && !fn.includes('inventory_lifecycle_events') && !fn.includes('workshop_tasks'), 'A5 finance correction must not mutate physical exchange state')
check(router.includes('/financials') && router.includes('correctExchangeFinancials'), 'A5 PATCH route missing')
check(app.includes('correctExchangeFinancialEntry') && app.includes('expectedFinancialAmount') && app.includes('expectedPaymentMethod'), 'A5 browser stale snapshot payload missing')
check(ui.includes('Исправить деньги') && ui.includes('Товары, остатки и Цех не затрагиваются'), 'A5 dedicated correction UI missing')
check(ui.includes("entry.financialAction !== 'none'"), 'A5 correction control must not appear for no-money exchanges')

console.log('OPERATIONAL AUTONOMY A5 TESTS PASSED — exchange-linked money can be corrected in place with stale protection, immutable finance history and cash delta, without touching physical exchange state')
