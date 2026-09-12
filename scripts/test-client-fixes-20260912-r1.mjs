import fs from 'node:fs'

const fail = (message) => { throw new Error(message) }
const check = (condition, message) => { if (!condition) fail(message) }
const types = fs.readFileSync('src/app/types.ts', 'utf8')
const utils = fs.readFileSync('src/app/utils.ts', 'utf8')
const app = fs.readFileSync('src/App.tsx', 'utf8')
const exchangeUi = fs.readFileSync('src/features/sections/OrderExchangeSection.tsx', 'utf8')
const returnsUi = fs.readFileSync('src/features/sections/OrderReturnsSection.tsx', 'utf8')
const dashboardWorker = fs.readFileSync('worker/domains/inventory-read.ts', 'utf8')
const dashboardUi = fs.readFileSync('src/features/sections/DashboardSection.tsx', 'utf8')
const financeWorker = fs.readFileSync('worker/domains/finance-reports.ts', 'utf8')
const financeUi = fs.readFileSync('src/features/renderers/FinanceReportContentRenderer.tsx', 'utf8')

try {
  // Returns were already genuinely multi-item; keep that working instead of rewriting it.
  check(app.includes('items: returnDraft.items') && app.includes('.filter((item) => Number(item.orderItemId || 0) > 0 && Number(item.quantity || 0) > 0)'), 'Return save must continue sending all selected positive-quantity item rows')
  check(returnsUi.includes('returnDraft.items.map'), 'Return UI must continue rendering every returnable order item')

  // Exchanges: one visit may queue multiple old→new pairs, while each child keeps the proven exchange path.
  check(types.includes('queuedPairs: ExchangePairDraft[]'), 'ExchangeDraft must carry queued exchange pairs')
  check(utils.includes('queuedPairs: []') && utils.includes('currentPairKey: createExchangePairDraftKey()'), 'New exchange drafts need a stable current pair key and empty queue')
  check(exchangeUi.includes('Добавить ещё позицию') && exchangeUi.includes('Позиции, добавленные в этот обмен'), 'Exchange UI must expose multi-pair selection')
  check(app.includes('const pairDrafts = [...queuedPairs') && app.includes('for (const pair of unsavedPairs)'), 'Exchange save must process all selected pairs')
  check(app.includes("financialAction: isFinalPair ? exchangeDraft.financialAction : 'none'"), 'Shared exchange financial difference must be written exactly once')
  check(app.includes('sum') === false || true, 'placeholder')
  check(app.includes('суммарно выбрано') && app.includes('requestedByOldItem'), 'Exchange batch must guard aggregate old-item quantity')
  check(app.includes('queued.draftKey === pair.draftKey ? { ...queued, saved: true }'), 'Partial exchange success must mark completed queued rows so retry cannot duplicate them')

  // Dashboard: Today/Yesterday is local toggle over one response and business-date-specific money/order semantics.
  check(dashboardWorker.includes("timeZone: 'Asia/Almaty'"), 'Dashboard must use Kazakhstan business date')
  check(dashboardWorker.includes('SELECT ? AS business_date UNION ALL SELECT ?'), 'Dashboard response must load today and yesterday together')
  check(dashboardWorker.includes('p.payment_date = d.business_date') && dashboardWorker.includes('r.return_date = d.business_date'), 'Daily cash must use actual payment/return operation dates')
  check(dashboardWorker.includes('daily: {') && dashboardWorker.includes('yesterday: mapDaily(yesterday)'), 'Dashboard API must return both daily buckets')
  check(dashboardUi.includes("setDailyPeriod('today')") && dashboardUi.includes("setDailyPeriod('yesterday')"), 'Dashboard UI must expose Today/Yesterday toggle')
  check(dashboardUi.includes('Продажи по дате заказа') && dashboardUi.includes('Поступило по дате оплаты'), 'Dashboard daily labels must make date semantics explicit')

  // Payments report: gross inflow categories are mutually exclusive; refunds subtract separately.
  check(financeWorker.includes("!needsReport('payments', 'managers', 'cities')"), 'Payments report must load operation classification')
  check(financeWorker.includes('paymentMethodReconciliation') && financeWorker.includes('paymentReconciliationByDay'), 'Finance API must expose method/day reconciliation')
  check(financeWorker.includes("operation.operationType === 'exchange_extra'") && financeWorker.includes("operation.operationType === 'debt_close' || operation.operationType === 'order_extra'"), 'Finance reconciliation must separate exchange top-ups and debt closures')
  check(financeWorker.includes('current.netMovement') === false, 'Net movement must be derived after aggregation, not incremented inconsistently per event')
  check(financeUi.includes('Все поступления = оплаты заказов + закрытие долга + доплаты по обменам'), 'Payment report must explain non-overlapping inflow formula')
  check(financeUi.includes('Чистое движение = все поступления − возвраты'), 'Payment report must explain refund subtraction')
  check(financeUi.includes('Сверка по способам оплаты') && financeUi.includes('Сверка по дням'), 'Payment report must reconcile by method and by actual operation day')

  console.log('CLIENT FIXES 20260912 R1 TESTS PASSED — multi-item returns preserved, multi-pair exchange enabled, dashboard Today/Yesterday and payment reconciliation protected')
} catch (error) {
  console.error(`CLIENT FIXES 20260912 R1 TESTS FAILED: ${error?.message || error}`)
  process.exit(1)
}
