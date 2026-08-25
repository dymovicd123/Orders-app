import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')
const fail = (message) => { throw new Error(message) }
const check = (condition, message) => { if (!condition) fail(message) }

try {
  const finance = read('worker/domains/finance-reports.ts')
  const ui = read('src/features/renderers/FinanceDashboardRenderer.tsx')
  const types = read('src/app/types.ts')

  check(finance.includes('beforeOrderOutsidePeriodRows'), 'Order-period early-payment diagnostic query missing')
  check(finance.includes('WHERE o.order_date BETWEEN ? AND ?') && finance.includes('p.payment_date < o.order_date') && finance.includes('p.payment_date < ?'), 'Early payment outside selected operation period is not queried by selected order period')
  check(finance.includes("traceCode: 'payment_before_order_outside_period'") && finance.includes("traceSeverity: 'review' as const"), 'Out-of-period early payment is not a review-level trace row')
  check(finance.indexOf("if (dateRelation === 'before_order')") < finance.indexOf("if (operationType === 'debt_close')"), 'Before-order date check does not take priority over debt/exchange operation type')
  check(finance.includes("operationType === 'debt_close'\n        ? 'Закрытие долга датировано раньше"), 'Debt close before order is not explicitly treated as a review error')
  check(finance.includes("operationType === 'exchange_extra'\n          ? 'Доплата по обмену датирована раньше"), 'Exchange extra before order is not explicitly treated as a review error')
  check(finance.includes("const paymentTraceReview = [...paymentOperations.filter") && finance.includes('...beforeOrderOutsidePeriod'), 'Early-payment diagnostics are not merged into review rows')
  check(finance.includes('const totalPayments = paymentOperations.reduce'), 'Diagnostic rows leaked into incoming-money total')
  check(finance.includes('traceScope: { startDate, endDate, selectedOperationPeriodOnly: true, includesOrderPeriodBeforePayments: true }'), 'Trace scope contract is ambiguous')
  check(types.includes('selectedOperationPeriodOnly') && types.includes('includesOrderPeriodBeforePayments'), 'Frontend trace scope type was not updated')

  check(ui.includes('Поступило за период') && ui.includes('Внутренняя сверка: без расхождений'), 'Summary still lacks one clear incoming-money total and reconciliation status')
  check(ui.includes('!consistency.ok ? (') && ui.includes('finance-reconciliation-diagnostics'), 'Three technical reconciliation totals are still always visible')
  check(ui.includes('<h3>Требуют проверки</h3>') && ui.includes('<h3>Пояснения по датам</h3>'), 'Review errors and neutral explanations are still mixed in one table')
  check(ui.includes('paymentTraceReview.map') && ui.includes('visiblePaymentTraceInfo.map'), 'Split trace panels do not render their own row sets')
  check(!ui.includes('<h3>Проверка дат и ввода</h3>'), 'Old mixed review/info heading returned')

  console.log('FINANCE F9 SUMMARY FINISH TESTS PASSED — concise reconciliation, split review/info, and order-period early-payment detection are enforced.')
} catch (error) {
  console.error(`FINANCE F9 SUMMARY FINISH TESTS FAILED: ${error?.message || error}`)
  process.exit(1)
}
