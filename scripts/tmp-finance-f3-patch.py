from pathlib import Path


def replace_once(path, old, new, label):
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    if new in text:
        print(f'{label}: already patched')
        return
    if old not in text:
        raise SystemExit(f'{label}: marker not found')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')
    print(f'{label}: patched')


p = Path('src/features/renderers/FinanceDashboardRenderer.tsx')
text = p.read_text(encoding='utf-8')

old = """  const paymentOperations = financeReport.reports.paymentOperations || []
  const paymentKinds = financeReport.reports.paymentKinds || []
  const paymentDateAnomalies = financeReport.reports.paymentDateAnomalies || []
  const consistency = financeReport.reports.consistency || {"""
new = """  const paymentOperations = financeReport.reports.paymentOperations || []
  const paymentKinds = financeReport.reports.paymentKinds || []
  const paymentDateAnomalies = financeReport.reports.paymentDateAnomalies || []
  const paymentTraceReview = financeReport.reports.paymentTraceReview || []
  const paymentTraceInfo = financeReport.reports.paymentTraceInfo || []
  const crossDatePaymentOperations = financeReport.reports.crossDatePaymentOperations || []
  const currentMonthStart = (() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
  })()
  const historicalPeriodSelected = String(financeReport.startDate || '') < currentMonthStart
  const visiblePaymentTraceInfo = paymentTraceInfo.filter((row) => row.traceCode !== 'legacy_baseline' || historicalPeriodSelected)
  const visibleTraceInfoIds = new Set(visiblePaymentTraceInfo.map((row) => Number(row.id || 0)))
  const paymentTraceRows = [...paymentTraceReview, ...visiblePaymentTraceInfo]
    .sort((a, b) => String(b.paymentDate).localeCompare(String(a.paymentDate)) || Number(b.id || 0) - Number(a.id || 0))
  const visibleLegacyBaselineCount = visiblePaymentTraceInfo.filter((row) => row.traceCode === 'legacy_baseline').length
  const consistency = financeReport.reports.consistency || {"""
if new not in text:
    if old not in text: raise SystemExit('finance trace variables marker not found')
    text = text.replace(old, new, 1)

old = """      anomalyCount: 0,
    })"""
new = """      reviewCount: 0,
      infoCount: 0,
    })"""
if new not in text:
    if old not in text: raise SystemExit('cash day counters marker not found')
    text = text.replace(old, new, 1)

old = """    bucket.received += Number(row.amount || 0)
    if (row.dateRelation === 'before_order') bucket.anomalyCount += 1
  })"""
new = """    bucket.received += Number(row.amount || 0)
    if (row.traceSeverity === 'review') bucket.reviewCount += 1
    else if (row.traceSeverity === 'info' && visibleTraceInfoIds.has(Number(row.id || 0))) bucket.infoCount += 1
  })"""
if new not in text:
    if old not in text: raise SystemExit('cash day trace status marker not found')
    text = text.replace(old, new, 1)

start_marker = """          {paymentDateAnomalies.length ? (
            <section className=\"mini-panel finance-anomaly-panel\">"""
end_marker = """          <section className=\"mini-panel finance-days-truth-panel\">"""
start = text.find(start_marker)
end = text.find(end_marker, start)
if start < 0 or end < 0:
    raise SystemExit('finance date review block markers not found')
new_block = '''          {crossDatePaymentOperations.length ? (
            <section className="mini-panel finance-anomaly-panel">
              <div className="mini-panel-head">
                <div>
                  <h3>Почему поступления и продажи периода могут отличаться</h3>
                  <p className="mini-panel-note">Эти деньги поступили в выбранном периоде, но сами заказы относятся к другой дате. В итог поступлений они входят правильно — по дате денежной операции.</p>
                </div>
                <span className="soft-badge">{crossDatePaymentOperations.length} операций · {formatMoney(crossDatePaymentOperations.reduce((sum, row) => sum + Number(row.amount || 0), 0))}</span>
              </div>
              <div className="table-shell">
                <table className="data-table finance-anomaly-table">
                  <thead><tr><th>Дата оплаты</th><th>Дата заказа</th><th>Заказ</th><th>Вид</th><th className="num">Сумма</th><th>Действие</th></tr></thead>
                  <tbody>{crossDatePaymentOperations.map((row) => (
                    <tr key={`finance-cross-date-${row.id}`}>
                      <td><strong>{formatDateShort(row.paymentDate)}</strong></td>
                      <td>{formatDateShort(row.orderDate)}</td>
                      <td>{row.externalId}</td>
                      <td>{row.operationLabel}</td>
                      <td className="num"><strong>{formatMoney(row.amount)}</strong></td>
                      <td><button className="secondary compact finance-order-link" type="button" onClick={() => void openOrderFromFinance(row)}>К заказу</button></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </section>
          ) : null}

          {paymentTraceRows.length ? (
            <section className="mini-panel finance-anomaly-panel">
              <div className="mini-panel-head">
                <div>
                  <h3>Проверка дат и ввода</h3>
                  <p className="mini-panel-note">Здесь только операции выбранного периода. Красным смыслом отмечается то, что требует проверки; обычные пояснения не считаются ошибками.</p>
                  {historicalPeriodSelected && visibleLegacyBaselineCount ? <p className="mini-panel-note">Вы выбрали старый период: {visibleLegacyBaselineCount} исторических записей показаны как baseline. Их текущее состояние известно, но первоначальное действие пользователя по ним не всегда можно доказать.</p> : null}
                </div>
                <span className={`soft-badge ${paymentTraceReview.length ? 'warning-soft' : ''}`}>{paymentTraceReview.length ? `Проверить: ${paymentTraceReview.length}` : 'Без операций, требующих проверки'}{visiblePaymentTraceInfo.length ? ` · Пояснений: ${visiblePaymentTraceInfo.length}` : ''}</span>
              </div>
              <div className="table-shell">
                <table className="data-table finance-anomaly-table">
                  <thead><tr><th>Дата оплаты</th><th>Дата заказа</th><th>Заказ</th><th>Заказ введён</th><th>Менеджер</th><th>Вид</th><th className="num">Сумма</th><th>Что означает</th><th>Действие</th></tr></thead>
                  <tbody>{paymentTraceRows.map((row) => (
                    <tr key={`finance-trace-${row.id}`}>
                      <td><strong>{formatDateShort(row.paymentDate)}</strong></td>
                      <td>{formatDateShort(row.orderDate)}</td>
                      <td>{row.externalId}</td>
                      <td>{row.orderCreatedAt ? formatDateShort(String(row.orderCreatedAt).slice(0, 10)) : '—'}</td>
                      <td><ManagerBadge name={row.manager} colorKey={row.managerColor || managerColorFor(row.manager)} compact /></td>
                      <td>{row.operationLabel}</td>
                      <td className="num">{formatMoney(row.amount)}</td>
                      <td>
                        <strong>{row.traceTitle}</strong>
                        <div className="mini-panel-note">{row.traceExplanation}</div>
                        <span className={`soft-badge ${row.traceSeverity === 'review' ? 'warning-soft' : ''}`}>{row.traceSeverity === 'review' ? 'Нужно проверить' : 'Пояснение'}</span>
                      </td>
                      <td><button className="secondary compact finance-order-link" type="button" onClick={() => void openOrderFromFinance(row)}>К заказу</button></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </section>
          ) : (
            <section className="finance-no-anomalies"><span className="status-pill">По выбранному периоду без замечаний</span><span>Нет денежных операций, которые требуют проверки или отдельного пояснения.</span></section>
          )}

'''
text = text[:start] + new_block + text[end:]

old = """                    <td>{row.anomalyCount ? <span className=\"soft-badge warning-soft\">Проверить: {row.anomalyCount}</span> : <span className=\"soft-badge success-soft\">Даты нормальны</span>}</td>"""
new = """                    <td>{row.reviewCount ? <span className=\"soft-badge warning-soft\">Проверить: {row.reviewCount}</span> : row.infoCount ? <span className=\"soft-badge\">Пояснение: {row.infoCount}</span> : <span className=\"soft-badge\">Без замечаний</span>}</td>"""
if new not in text:
    if old not in text: raise SystemExit('finance day status marker not found')
    text = text.replace(old, new, 1)

p.write_text(text, encoding='utf-8')
print('Finance F3 summary/day UX: patched')

# Permanent source regression gate.
test = r'''import fs from 'node:fs'
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
'''
Path('scripts/test-finance-f3-summary-ux.mjs').write_text(test, encoding='utf-8')
print('Finance F3 regression test: created')

# Wire permanent regression test into release check.
p = Path('scripts/release-check.mjs')
text = p.read_text(encoding='utf-8')
old = "    'scripts/test-finance-f2-trace.mjs',\n    'scripts/finance-f2-trace-worker-manifest.json',"
new = "    'scripts/test-finance-f2-trace.mjs',\n    'scripts/test-finance-f3-summary-ux.mjs',\n    'scripts/finance-f2-trace-worker-manifest.json',"
if new not in text:
    if old not in text: raise SystemExit('release F3 required-file marker not found')
    text = text.replace(old, new, 1)
old = "  run('Finance F2 selected-period traceability tests', process.execPath, [path.join(root, 'scripts/test-finance-f2-trace.mjs')])\n"
new = "  run('Finance F2 selected-period traceability tests', process.execPath, [path.join(root, 'scripts/test-finance-f2-trace.mjs')])\n  run('Finance F3 summary/day UX tests', process.execPath, [path.join(root, 'scripts/test-finance-f3-summary-ux.mjs')])\n"
if new not in text:
    if old not in text: raise SystemExit('release F3 run marker not found')
    text = text.replace(old, new, 1)
p.write_text(text, encoding='utf-8')
print('release gate: Finance F3 wired')
