import fs from 'node:fs'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
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
  check(renderer.includes('Требуют проверки') && renderer.includes('Пояснения по датам'), 'Review-required rows and neutral date explanations are not separated')
  check(renderer.includes('finance-reconciliation-v2') && renderer.includes('Данные согласованы') && renderer.includes('Есть расхождение в финансовой сверке'), 'Human reconciliation status missing')
  check(renderer.includes("!consistency.ok ? <div className=\"finance-reconciliation-primary-total\">") && renderer.includes('finance-reconciliation-diagnostics'), 'Technical reconciliation details must only be prominent on mismatch')
  check(renderer.includes('finance-secondary-details') && renderer.includes('Оплаты по заказам другой даты'), 'Cross-date diagnostics must remain available as secondary detail')
  check(!renderer.includes('Почему поступления и продажи периода могут отличаться'), 'Old warning-like cross-date panel returned')
  check(renderer.includes('finance-review-panel has-review') && renderer.includes('finance-review-panel is-info'), 'Date explanations and real review warnings are not rendered as separate panels')
  const financeCss = read('src/styles/140-finance-truth.css')
  check(financeCss.includes('.finance-reconciliation.finance-reconciliation-v2.is-ok') && financeCss.includes('background: #f8fafc'), 'Successful reconciliation still uses a global all-clear green surface')
  check(financeCss.includes('.finance-review-panel.is-info') && financeCss.includes('.finance-review-panel.has-review'), 'Neutral explanation and warning review styles are not separated')
  check(financeCss.includes('.finance-operation-type.type-debt_close') && financeCss.includes('background: #e2e8f0') && financeCss.includes('color: #334155'), 'Debt closure still uses warning-like coloring')
  check(financeCss.includes('.finance-days-truth-panel { order: 2; }'), 'Daily business chronology is not placed before diagnostics')
  check(!renderer.includes('Даты согласованы'), 'False-green global date claim returned')
  check(!renderer.includes('Даты нормальны'), 'Day table still makes a global date-normal claim')
  check(!renderer.includes("if (row.dateRelation === 'before_order') bucket.anomalyCount += 1"), 'Day review still only detects payments before the order')
  check(renderer.includes("if (row.traceSeverity === 'review') bucket.reviewCount += 1"), 'Day review does not use trace severity')
  check(renderer.includes("row.traceSeverity === 'info' && visibleTraceInfoIds.has"), 'Hidden legacy info can still affect current-period day status')
  check(renderer.includes('По датам без замечаний'), 'No neutral date-review empty state')


  // Execute the moved shared report printer without a browser or file download.
  const compiled = await build({
    entryPoints: ['src/features/export/reportExportActions.ts'], bundle: true,
    platform: 'node', format: 'esm', target: 'es2022', write: false, logLevel: 'silent',
  })
  const { createReportExportActions } = await import(
    'data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64')
  )
  const exports = []
  const printed = []
  let exportError = null
  const htmlDoc = {
    open: () => {},
    write: (html) => { printed.push(html) },
    close: () => {},
  }
  globalThis.document = {
    getElementById: (id) => id === 'selectedFinanceReportExport' || id === 'planReportExport' || id === 'teamPlanReportExport' || id === 'inventoryStocktakePrint'
      ? { innerHTML: '<p>Сводка</p>' } : null,
    createElement: (tag) => {
      assert.equal(tag, 'iframe')
      const iframe = {
        title: '', style: {}, contentWindow: {
          document: htmlDoc, focus: () => {}, print: () => { exports.push('printed') },
        },
        remove: () => { exports.push('removed') },
      }
      exports.push(iframe)
      return iframe
    },
    body: { appendChild: () => {} },
  }
  globalThis.window = { setTimeout: (fn) => { fn(); return 1 } }
  const newExports = (financeReportType) => createReportExportActions({
    planDateFrom: '2026-11-01', planDateTo: '2026-11-30',
    financeReportType, financeDateFrom: '2026-11-01', financeDateTo: '2026-11-30',
    setError: (value) => { exportError = value },
  })
  for (const [type,title] of [
    ['payments','Отчёт по способам оплаты'],
    ['managers','Отчёт менеджеров'],
    ['products','Отчёт по товарам'],
    ['cities','Отчёт по городам'],
    ['returns','Отчёт по возвратам'],
    ['debts','Отчёт по закрытым долгам'],
    ['leads','Отчёт по лидам'],
    ['callCentre','Отчёт Call Centre'],
  ]) {
    assert.equal(newExports(type).getSelectedFinanceReportExportTitle(), title)
  }
  newExports('payments').printSelectedFinanceReportPdf()
  assert(printed.at(-1).includes('Отчёт по способам оплаты'))
  assert(printed.at(-1).includes('<p>Сводка</p>'))
  assert(exports.includes('printed'))
  newExports('payments').printPlanReportPdf()
  assert(printed.at(-1).includes('План и зарплата'))
  newExports('payments').printInventoryStocktakePdf()
  assert(printed.at(-1).includes('Ревизия остатков'))
  newExports('payments').printTeamPlanReportPdf()
  assert(printed.at(-1).includes('Выполнение плана команды'))
  const beforeMissing = printed.length
  newExports('payments').printSelectedFinanceReportPdf()
  assert(printed.length > beforeMissing)
  globalThis.document.getElementById = () => null
  const beforeEmpty = printed.length
  newExports('payments').printSelectedFinanceReportPdf()
  assert.equal(printed.length,beforeEmpty)
  assert.match(exportError,/Сначала сформируй отчёт/)

  console.log('FINANCE F3 SUMMARY UX TESTS PASSED — business chronology is primary, reconciliation is compact on success, and review details stay available without dominating the page.')
} catch (error) {
  console.error(`FINANCE F3 SUMMARY UX TESTS FAILED: ${error?.message || error}`)
  process.exit(1)
}
