import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')
const fail = (message) => { throw new Error(message) }
const check = (condition, message) => { if (!condition) fail(message) }

try {
  const app = read('src/App.tsx')
  const section = read('src/features/sections/FinanceSection.tsx')
  const renderer = read('src/features/renderers/FinanceDashboardRenderer.tsx')

  check(app.includes("dateFrom: getPeriodRange('month').dateFrom") && app.includes("dateTo: getPeriodRange('month').dateTo"), 'Finance must still open on the current month')
  check(section.includes("setFinanceReportFilters(getPeriodRange('year'))") && section.includes('type="date" value={financeReportFilters.dateFrom}'), 'Historical data must remain user-selected through Finance period controls')
  check(renderer.includes('const historicalPeriodSelected = String(financeReport.startDate || \'\') < currentMonthStart'), 'Historical-range visibility gate missing')
  check(renderer.includes("row.traceCode !== 'legacy_baseline' || historicalPeriodSelected"), 'Legacy baseline can leak into the normal current-period view')
  check(renderer.includes('visibleLegacyBaselineCount') && renderer.includes('Вы выбрали старый период:'), 'Explicit historical-range baseline explanation missing')
  check(renderer.includes('paymentTraceReview') && renderer.includes('visiblePaymentTraceInfo'), 'Finance summary is not using F2 trace classifications')
  check(renderer.includes('crossDatePaymentOperations') && renderer.includes('Почему поступления и продажи периода могут отличаться'), 'Cross-date period bridge is not visible')
  check(renderer.includes('Проверка дат и ввода'), 'Honest date/input review heading missing')
  check(!renderer.includes('Даты согласованы'), 'False-green global date claim returned')
  check(!renderer.includes('Даты нормальны'), 'Day table still makes a global date-normal claim')
  check(!renderer.includes("if (row.dateRelation === 'before_order') bucket.anomalyCount += 1"), 'Day review still only detects payments before the order')
  check(renderer.includes("if (row.traceSeverity === 'review') bucket.reviewCount += 1"), 'Day review does not use trace severity')
  check(renderer.includes("row.traceSeverity === 'info' && visibleTraceInfoIds.has"), 'Hidden legacy info can still affect current-period day status')
  check(renderer.includes('По выбранному периоду без замечаний'), 'No neutral selected-period empty state')

  console.log('FINANCE F3 SUMMARY UX TESTS PASSED — current month stays clean, legacy baseline requires an explicitly older period, and date/input review is trace-aware.')
} catch (error) {
  console.error(`FINANCE F3 SUMMARY UX TESTS FAILED: ${error?.message || error}`)
  process.exit(1)
}
