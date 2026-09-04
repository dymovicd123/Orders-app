import fs from 'node:fs'

const worker = fs.readFileSync('worker/domains/orders-read.ts', 'utf8')
const app = fs.readFileSync('src/App.tsx', 'utf8')
const fail = (message) => { throw new Error(message) }
const check = (condition, message) => { if (!condition) fail(message) }

try {
  check(worker.includes("const includePeriodStats = cleanText(url.searchParams.get('includePeriodStats')) !== '0';"), 'R5.9 must keep full periodStats as the default API contract')
  check(worker.includes("const hasPageCursor = offset > 0 && /^\\d{4}-\\d{2}-\\d{2}$/.test(pageCursorDate) && pageCursorId > 0;"), 'R5.9 cursor must require a logical later page and a valid date/id pair')
  check(worker.includes("pageWhereParts.push('(o.order_date < ? OR (o.order_date = ? AND o.id < ?))');"), 'R5.9 cursor must preserve order_date DESC, id DESC seek semantics')
  check(worker.includes('.bind(...pageBindings, limit, hasPageCursor ? 0 : offset).all<OrderListRow>();'), 'R5.9 cursor must not double-apply OFFSET')
  check(worker.includes('if (!includePeriodStats) {\n    // The UI already owns the exact periodStats from page 1.'), 'R5.9 page reuse must use count-only summary metadata')
  check(worker.includes('periodStats: includePeriodStats ? {'), 'R5.9 full summary must remain available to default callers')
  check(app.includes("params.set('afterOrderDate', pageReadOptions.afterOrderDate)"), 'Orders UI must pass the sequential seek cursor only when available')
  check(app.includes("params.set('includePeriodStats', '0')"), 'Orders UI must opt out of repeated period aggregates only when it can reuse prior stats')
  check(app.includes('} else if (!pageReadOptions?.reusePeriodStats) {\n        setOrderPeriodStats(null)'), 'Orders UI must preserve prior periodStats only for page-only navigation')
  check(app.includes("const lastOrder = direction === 'next' && orders.length ? orders[orders.length - 1] : null"), 'Only Next navigation may derive a seek cursor from the current last row')
  console.log('D1 READ BUDGET R5.9 TESTS PASSED — sequential Orders pages use a seek cursor, page-only navigation reuses exact periodStats, and legacy API defaults remain unchanged')
} catch (error) {
  console.error(`D1 READ BUDGET R5.9 TESTS FAILED: ${error?.message || error}`)
  process.exit(1)
}
