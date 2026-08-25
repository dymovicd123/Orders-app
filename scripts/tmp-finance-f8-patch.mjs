import fs from 'node:fs'

const rendererPath = 'src/features/renderers/FinanceDashboardRenderer.tsx'
let renderer = fs.readFileSync(rendererPath, 'utf8')

if (!renderer.includes('finance-reconciliation-v2')) {
  const startMarker = "          <section className={`finance-reconciliation ${consistency.ok ? 'is-ok' : 'is-error'}`}>"
  const endMarker = '          {paymentTraceRows.length ? ('
  const start = renderer.indexOf(startMarker)
  const end = renderer.indexOf(endMarker, start)
  if (start < 0 || end < 0) throw new Error('F8: reconciliation/cross-date block markers not found')

  const replacement = `          <section className={\`finance-reconciliation finance-reconciliation-v2 \${consistency.ok ? 'is-ok' : 'is-error'}\`}>
            <div className="finance-reconciliation-head">
              <div>
                <strong>Финансовая сверка</strong>
                <span>Суммы сверяются независимо по денежному журналу, видам операций и способам оплаты. Даты заказов и денежных операций проверяются здесь же.</span>
              </div>
              <div className="finance-reconciliation-badges">
                <span className={\`status-pill \${consistency.ok ? 'status-online' : 'status-offline'}\`}>{consistency.ok ? 'Суммы сошлись' : \`Расхождение \${formatMoney(consistency.difference)}\`}</span>
                {crossDatePaymentOperations.length ? <span className="soft-badge finance-info-badge">По датам: {crossDatePaymentOperations.length} операций · {formatMoney(crossDatePaymentOperations.reduce((sum, row) => sum + Number(row.amount || 0), 0))}</span> : <span className="soft-badge">Междатных операций нет</span>}
                {paymentTraceReview.length ? <span className="soft-badge warning-soft">Нужно проверить: {paymentTraceReview.length}</span> : visiblePaymentTraceInfo.length ? <span className="soft-badge finance-info-badge">Пояснений: {visiblePaymentTraceInfo.length}</span> : <span className="soft-badge">По датам без замечаний</span>}
              </div>
            </div>
            <div className="finance-reconciliation-values">
              <span>Денежный журнал: <strong>{formatMoney(consistency.ledgerTotal)}</strong></span>
              <span>По видам операций: <strong>{formatMoney(consistency.kindsTotal)}</strong></span>
              <span>По способам оплаты: <strong>{formatMoney(consistency.methodsTotal)}</strong></span>
            </div>

            {crossDatePaymentOperations.length ? (
              <div className="finance-reconciliation-cross-date">
                <div className="mini-panel-head">
                  <div>
                    <h3>Операции по заказам другой даты</h3>
                    <p className="mini-panel-note">Это не расхождение само по себе: деньги входят в выбранный период по дате операции, а продажа — по дате заказа. Закрытие долга здесь является обычной операцией; необычные случаи отдельно объясняются в проверке дат.</p>
                  </div>
                  <span className="soft-badge finance-info-badge">{crossDatePaymentOperations.length} операций · {formatMoney(crossDatePaymentOperations.reduce((sum, row) => sum + Number(row.amount || 0), 0))}</span>
                </div>
                <div className="table-shell">
                  <table className="data-table finance-anomaly-table finance-cross-date-table">
                    <thead><tr><th>Дата оплаты</th><th>Дата заказа</th><th>Заказ</th><th>Вид</th><th className="num">Сумма</th><th>Действие</th></tr></thead>
                    <tbody>{crossDatePaymentOperations.map((row) => (
                      <tr key={\`finance-cross-date-\${row.id}\`}>
                        <td><strong>{formatDateShort(row.paymentDate)}</strong></td>
                        <td>{formatDateShort(row.orderDate)}</td>
                        <td>{row.externalId}</td>
                        <td>{row.operationLabel}</td>
                        <td className="num"><strong>{formatMoney(row.amount)}</strong></td>
                        <td><div className="finance-row-actions"><button className="secondary compact finance-order-link" type="button" onClick={() => void openOrderFromFinance(row)}>К заказу</button><button className="secondary compact finance-money-link" type="button" onClick={() => openMoneyHistoryForOrder(row)}>Денежная история</button></div></td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              </div>
            ) : null}
          </section>

`
  renderer = renderer.slice(0, start) + replacement + renderer.slice(end)

  const oldReview = `            <section className="mini-panel finance-anomaly-panel">
              <div className="mini-panel-head">
                <div>
                  <h3>Проверка дат и ввода</h3>
                  <p className="mini-panel-note">Здесь только операции выбранного периода. Красным смыслом отмечается то, что требует проверки; обычные пояснения не считаются ошибками.</p>`
  const newReview = `            <section className={\`mini-panel finance-review-panel \${paymentTraceReview.length ? 'has-review' : 'is-info'}\`}>
              <div className="mini-panel-head">
                <div>
                  <h3>Проверка дат и ввода</h3>
                  <p className="mini-panel-note">Здесь только операции выбранного периода. Предупреждение появляется только там, где действительно нужна проверка; обычные пояснения показываются нейтрально.</p>`
  if (!renderer.includes(oldReview)) throw new Error('F8: date review block marker not found')
  renderer = renderer.replace(oldReview, newReview)
  fs.writeFileSync(rendererPath, renderer)
}

const cssPath = 'src/styles/140-finance-truth.css'
let css = fs.readFileSync(cssPath, 'utf8')
const cssMarker = '/* Finance F8: unified reconciliation + neutral cross-date semantics. */'
if (!css.includes(cssMarker)) {
  css += `

/* Finance F8: unified reconciliation + neutral cross-date semantics. */
.finance-reconciliation.finance-reconciliation-v2 {
  display: grid;
  align-items: stretch;
  gap: 12px;
  border-color: #cbd5e1;
  background: #f8fafc;
}

.finance-reconciliation.finance-reconciliation-v2.is-ok {
  border-color: #cbd5e1;
  background: #f8fafc;
}

.finance-reconciliation-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.finance-reconciliation-head > div:first-child {
  display: grid;
  gap: 4px;
}

.finance-reconciliation-head > div:first-child > span {
  color: #475569;
  font-size: 12px;
}

.finance-reconciliation-badges {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

.finance-info-badge {
  background: #eaf2ff;
  color: #2456a6;
}

.finance-reconciliation-values {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 18px;
  padding-top: 10px;
  border-top: 1px solid #e2e8f0;
  color: #475569;
  font-size: 12px;
}

.finance-reconciliation-values strong { color: #0f172a; }

.finance-reconciliation-cross-date {
  display: grid;
  gap: 10px;
  padding-top: 14px;
  border-top: 1px solid #dbeafe;
}

.finance-reconciliation-cross-date .table-shell {
  overflow-x: auto;
  overscroll-behavior-x: contain;
}

.finance-review-panel.is-info {
  border-color: #bfdbfe;
  background: linear-gradient(180deg, #f5f9ff 0%, #fff 100%);
}

.finance-review-panel.has-review {
  border-color: #fbbf24;
  background: linear-gradient(180deg, #fffbeb 0%, #fff 100%);
}

.finance-operation-type.type-debt_close {
  background: #e2e8f0;
  color: #334155;
}

@media (max-width: 820px) {
  .finance-reconciliation-head { flex-direction: column; }
  .finance-reconciliation-badges { justify-content: flex-start; }
}
`
  fs.writeFileSync(cssPath, css)
}

const testPath = 'scripts/test-finance-f3-summary-ux.mjs'
let test = fs.readFileSync(testPath, 'utf8')
const oldCrossDate = "  check(renderer.includes('crossDatePaymentOperations') && renderer.includes('Почему поступления и продажи периода могут отличаться'), 'Cross-date period bridge is not visible')"
const newCrossDate = "  check(renderer.includes('crossDatePaymentOperations') && renderer.includes('Операции по заказам другой даты'), 'Cross-date period bridge is not visible inside reconciliation')"
if (test.includes(oldCrossDate)) test = test.replace(oldCrossDate, newCrossDate)
if (!test.includes('Unified reconciliation header/status missing')) {
  const anchor = "  check(renderer.includes('Проверка дат и ввода'), 'Honest date/input review heading missing')\n"
  if (!test.includes(anchor)) throw new Error('F8: F3 test insertion marker not found')
  const addition = `  check(renderer.includes('finance-reconciliation-v2') && renderer.includes('Финансовая сверка') && renderer.includes('Суммы сошлись'), 'Unified reconciliation header/status missing')
  check(!renderer.includes('Почему поступления и продажи периода могут отличаться'), 'Old warning-like cross-date panel returned')
  check(renderer.includes("finance-review-panel \\${paymentTraceReview.length ? 'has-review' : 'is-info'}"), 'Date/input explanations are not visually separated from real review warnings')
  const financeCss = read('src/styles/140-finance-truth.css')
  check(financeCss.includes('.finance-reconciliation.finance-reconciliation-v2.is-ok') && financeCss.includes('background: #f8fafc'), 'Successful reconciliation still uses a global all-clear green surface')
  check(financeCss.includes('.finance-review-panel.is-info') && financeCss.includes('.finance-review-panel.has-review'), 'Neutral explanation and warning review styles are not separated')
  check(financeCss.includes('.finance-operation-type.type-debt_close') && financeCss.includes('background: #e2e8f0') && financeCss.includes('color: #334155'), 'Debt closure still uses warning-like coloring')
`
  test = test.replace(anchor, anchor + addition)
}
fs.writeFileSync(testPath, test)

console.log('Finance F8 patch applied or already present.')
