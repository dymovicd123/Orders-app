import fs from 'node:fs'

const ordersRead = fs.readFileSync('worker/domains/orders-read.ts', 'utf8')
const app = fs.readFileSync('src/App.tsx', 'utf8')
const types = fs.readFileSync('src/app/types.ts', 'utf8')
const fail = (message) => { throw new Error(message) }
const check = (condition, message) => { if (!condition) fail(message) }

try {
  check(ordersRead.includes("const includePaymentCount = cleanText(url.searchParams.get('includePaymentCount')) !== '0';"), 'R5.7 opt-out must remain backward-compatible by default')
  check(ordersRead.includes('WHERE oi.order_id = o.id AND oi.is_workshop = 1'), 'R5.7 Workshop aggregate must use the indexed correlated lookup')
  check(!ordersRead.includes('LEFT JOIN (\n        SELECT order_id, COALESCE(SUM(quantity), 0) AS workshop_units'), 'R5.7 old materialized Workshop aggregate returned')
  check(ordersRead.includes('COALESCE(SUM(o.received_amount), 0) AS payment_amount'), 'R5.7 order aggregate must expose canonical received amount')
  check(ordersRead.includes("archiveMode === 'active'\n      && (status === 'all' || status === 'active')\n      && !dateFrom\n      && !dateTo"), 'R5.7 payment fast path lost its active/no-date safety boundary')
  check(ordersRead.includes('payment_count: null, payment_amount: toInt(orderStats?.payment_amount, 0)'), 'R5.7 fast path must explicitly mark paymentCount as not requested')
  check(ordersRead.includes('const returnStatsPromise = db.prepare(`'), 'R5.7 return aggregate must stay exact in both paths')
  check(ordersRead.includes('SELECT COUNT(p.id) AS payment_count, COALESCE(SUM(p.amount), 0) AS payment_amount'), 'R5.7 legacy exact payment aggregate must remain for default/date/archive callers')
  check(app.includes("includePaymentCount: activeFilters.archiveMode === 'active' && !activeFilters.dateFrom && !activeFilters.dateTo ? '0' : '1'"), 'Orders UI must opt out only for active no-date views')
  check(types.includes('paymentCount: number | null'), 'OrderPeriodStats must represent a deliberately omitted payment count')
  console.log('D1 READ BUDGET R5.7 TESTS PASSED — measured Orders Summary fallback uses indexed Workshop lookup and skips the payments scan only inside the proven active/no-date boundary')
} catch (error) {
  console.error(`D1 READ BUDGET R5.7 TESTS FAILED: ${error?.message || error}`)
  process.exit(1)
}
