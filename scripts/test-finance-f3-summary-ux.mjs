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
  check(renderer.includes('crossDatePaymentOperations') && renderer.includes('Операции по заказам другой даты'), 'Cross-date period bridge is not visible inside reconciliation')
  check(renderer.includes('Проверка дат и ввода'), 'Honest date/input review heading missing')
  check(renderer.includes('finance-reconciliation-v2') && renderer.includes('Финансовая сверка') && renderer.includes('Суммы сошлись'), 'Unified reconciliation header/status missing')
  check(!renderer.includes('Почему поступления и продажи периода могут отличаться'), 'Old warning-like cross-date panel returned')
  check(renderer.includes('finance-review-panel ') && renderer.includes("'has-review' : 'is-info'"), 'Date/input explanations are not visually separated from real review warnings')
  const financeCss = read('src/styles/140-finance-truth.css')
  check(financeCss.includes('.finance-reconciliation.finance-reconciliation-v2.is-ok') && financeCss.includes('background: #f8fafc'), 'Successful reconciliation still uses a global all-clear green surface')
  check(financeCss.includes('.finance-review-panel.is-info') && financeCss.includes('.finance-review-panel.has-review'), 'Neutral explanation and warning review styles are not separated')
  check(financeCss.includes('.finance-operation-type.type-debt_close') && financeCss.includes('background: #e2e8f0') && financeCss.includes('color: #334155'), 'Debt closure still uses warning-like coloring')
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
