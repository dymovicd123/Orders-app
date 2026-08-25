import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')
const fail = (message) => { throw new Error(message) }
const check = (condition, message) => { if (!condition) fail(message) }
const between = (source, start, end) => {
  const a = source.indexOf(start)
  check(a >= 0, `Marker missing: ${start}`)
  const b = source.indexOf(end, a + start.length)
  check(b > a, `End marker missing after: ${start}`)
  return source.slice(a, b)
}

try {
  const app = read('src/App.tsx')
  const reads = read('src/features/finance/useFinanceReportReads.ts')
  const finance = read('worker/domains/finance-reports.ts')
  const returns = read('worker/domains/returns-exchanges.ts')
  const cash = read('worker/domains/cash.ts')
  const types = read('src/app/types.ts')

  check(app.includes("dateFrom: getPeriodRange('month').dateFrom") && app.includes("dateTo: getPeriodRange('month').dateTo"), 'Finance default must stay on the current month, not all history')
  check(reads.includes("new URLSearchParams({ startDate: range.dateFrom, endDate: range.dateTo })"), 'Finance reads must send the selected period to the server')

  const reportStart = finance.indexOf('export async function listFinanceReports(')
  check(reportStart >= 0, 'Finance report function missing')
  const report = finance.slice(reportStart)
  check(report.includes('WHERE p.payment_date BETWEEN ? AND ?'), 'Payment operations are not bounded by the selected payment period')
  const historyQuery = between(report, '`SELECT id, order_id, external_order_id, event_date, event_at, event_type', 'ORDER BY event_at DESC, id DESC`')
  check(historyQuery.includes('FROM financial_events'), 'Finance trace does not read immutable money events')
  check(historyQuery.includes('WHERE event_date BETWEEN ? AND ?'), 'Immutable money history is loaded outside the selected user period')
  check(historyQuery.includes("event_type IN ('order_payment', 'debt_close', 'order_extra', 'exchange_extra')"), 'Trace query is not limited to relevant incoming-money events')
  check(report.includes('crossDatePaymentOperations = paymentOperations.filter'), 'Selected-period cash contributors from orders outside the period are not exposed')
  check(report.includes('traceScope: { startDate, endDate, selectedPeriodOnly: true }'), 'API does not state that trace rows are selected-period only')
  for (const marker of ['legacy_baseline', 'backdated_order_entry', 'primary_before_order', 'primary_future_dated', 'primary_recorded_later', 'lineage_ambiguous', 'lineage_missing']) {
    check(report.includes(marker), `Finance trace class missing: ${marker}`)
  }
  check(report.includes("eventLineageStatus = 'source_id'") && report.includes("eventLineageStatus = 'exact_fingerprint'"), 'Finance trace does not distinguish exact lineage strategies')
  check(report.includes('eventIsBackfill'), 'Historical baseline flag is not preserved in the trace contract')

  const createReturn = between(returns, 'export async function createReturn(', 'export const noStandaloneReturnSql')
  check(createReturn.includes("if (!rawReturnDate) throw new Error('Укажите дату возврата.')"), 'Return can still invent an operation date when omitted')
  check(!createReturn.includes('input.returnDate || existing.order_date'), 'Return still silently falls back to order date')
  const createExchange = between(returns, 'export async function createExchange(', 'export async function listExchanges')
  check(createExchange.includes("if (!rawExchangeDate) throw new Error('Укажите дату обмена.')"), 'Exchange can still invent an operation date when omitted')
  check(!createExchange.includes('input.exchangeDate || (existing as any).order_date'), 'Exchange still silently falls back to order date')

  const tracking = between(cash, 'export async function setCashAutoTracking(', 'export async function activateCashRegister')
  check(tracking.includes("COALESCE(NULLIF(TRIM(activated_at), ''), '') = ''"), 'Cash resume can still overwrite original activation boundary')
  check(!tracking.includes('CASE WHEN ? = 1 THEN ? ELSE activated_at END'), 'Old cash activation overwrite expression remains')

  for (const marker of ['orderCreatedAt', 'eventLineageStatus', 'eventIsBackfill', 'traceSeverity', 'crossDatePaymentOperations', 'selectedPeriodOnly']) {
    check(types.includes(marker), `Finance frontend contract missing: ${marker}`)
  }

  console.log('FINANCE F2 TRACEABILITY TESTS PASSED — selected-period-only lineage, cross-date bridge, explicit return/exchange dates and immutable cash activation are enforced.')
} catch (error) {
  console.error(`FINANCE F2 TRACEABILITY TESTS FAILED: ${error?.message || error}`)
  process.exit(1)
}
