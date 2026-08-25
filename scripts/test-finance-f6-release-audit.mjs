import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

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

function sumRows(rows, key) {
  return rows.reduce((sum, row) => sum + Number(row[key] || 0), 0)
}

try {
  const app = read('src/App.tsx')
  const finance = read('worker/domains/finance-reports.ts')
  const cash = read('worker/domains/cash.ts')
  const money = read('worker/domains/money.ts')
  const returnsExchanges = read('worker/domains/returns-exchanges.ts')
  const orderWrite = read('worker/domains/orders-write.ts')
  const financeUi = read('src/features/renderers/FinanceDashboardRenderer.tsx')
  const reportUi = read('src/features/renderers/FinanceReportContentRenderer.tsx')
  const financeSection = read('src/features/sections/FinanceSection.tsx')
  const editor = read('src/features/sections/OrderEditorSection.tsx')
  const journalCss = read('src/styles/finance-f4-money-journal.css')
  const cashMigration = read('migrations/0046_v72_cash_register_and_inventory_revision.sql')

  // F2/F3: every headline cash contributor is bounded by the selected operation date,
  // while cross-date order context remains visible instead of being forced into order-date totals.
  const report = finance.slice(finance.indexOf('export async function listFinanceReports('))
  check(report.includes('WHERE p.payment_date BETWEEN ? AND ?'), 'Selected-period payments are not bounded by payment date')
  check(report.includes('WHERE r.return_date BETWEEN ? AND ?'), 'Selected-period returns are not bounded by return date')
  check(report.includes('crossDatePaymentOperations = paymentOperations.filter'), 'Cross-date payment bridge disappeared')
  check(report.includes('traceScope: { startDate, endDate, selectedPeriodOnly: true }'), 'Finance contract no longer declares selected-period trace scope')
  check(app.includes("dateFrom: getPeriodRange('month').dateFrom") && app.includes("dateTo: getPeriodRange('month').dateTo"), 'Finance no longer opens on current month')
  check(financeSection.includes("setFinanceReportFilters(getPeriodRange('year'))"), 'User can no longer explicitly select historical period')
  check(financeUi.includes("row.traceCode !== 'legacy_baseline' || historicalPeriodSelected"), 'Legacy baseline can leak into normal current-period summary')
  check(cash.includes("const includeLegacy = cleanText(url.searchParams.get('includeLegacy')) === '1'") && cash.includes('dateFrom < currentMonthStart'), 'Money journal legacy gate is not tied to explicitly historical period')

  // F5: current business model has only primary/debt-close for ordinary orders.
  check(!editor.includes("addEditorPayment('extra')") && !editor.includes('<option value="extra">'), 'Ordinary order editor exposes generic extra')
  check(!financeUi.includes('Доплаты по заказам') && !financeUi.includes('Доплаты заказов') && !reportUi.includes('Доплаты заказов'), 'Current Finance UI still exposes ordinary extra')
  check(financeUi.includes('Доплаты по обменам') && reportUi.includes('Доплаты обмена'), 'Exchange extra is no longer visibly distinct')
  check(money.includes("paymentKind === 'extra'") && money.includes('Обычной доплаты по заказу нет'), 'Server can accept stale ordinary-extra write')
  check(money.includes("paymentKind === 'primary' ? normalizeDate(existing.order_date) : requestedPaymentDate"), 'Manual primary is no longer anchored to order date')

  // Legacy ordinary extra is preserved but folded exactly once into debt-close semantics.
  check(finance.includes("operationType === 'order_extra'") && finance.includes("? 'Закрытие долга (старый тип)'"), 'Legacy ordinary extra is not labelled as old debt-close semantics')
  check(finance.includes("operationType === 'debt_close' || row.operationType === 'order_extra'"), 'Backend debt total does not include legacy ordinary extra')
  check(!financeUi.includes('legacyOrderExtraPaymentsTotal') && !financeUi.includes('orderExtras'), 'Finance UI still has a second legacy-extra accumulator')
  check(financeUi.includes("row.operationType === 'debt_close' || row.operationType === 'order_extra'"), 'Daily Finance bucket does not fold legacy extra into debt close')
  check(reportUi.includes('Number(row.debt_closed || 0) + Number(row.order_extra_received || 0)'), 'Strict manager report drops legacy extra from debt-close column')

  // Arithmetic contract: gross received has one canonical source (paymentOperations), and all
  // alternate views reconcile back to it rather than using order.received_amount snapshots.
  check(report.includes('const totalPayments = paymentOperations.reduce'), 'Gross received is not derived from selected payment operations')
  check(report.includes('const received = totalPayments;'), 'Finance overview does not use canonical selected-period payment total')
  check(report.includes('netCash: received - periodReturns'), 'Net cash formula diverged from received minus completed returns')
  check(report.includes('methodsTotal: paymentRows.reduce') && report.includes('Number(row.total || 0)'), 'Payment-method reconciliation total missing')
  check(report.includes('kindsTotal: paymentKinds.reduce') && report.includes('Number(row.total || 0)'), 'Payment-kind reconciliation total missing')
  check(financeUi.includes('consistency.difference') && financeUi.includes('0 разницы'), 'Finance UI no longer surfaces arithmetic reconciliation')

  // Manager/day views must classify the same selected payment exactly once.
  check(report.includes('const actualReceived = Number(paymentInfo.primary_received || 0) + Number(paymentInfo.order_extra_received || 0) + Number(paymentInfo.debt_closed || 0) + Number(paymentInfo.extra_received || 0)'), 'Manager-day received total is not a complete disjoint operation sum')
  check(report.includes("WHEN p.payment_kind NOT IN ('debt_close', 'extra')") && report.includes('AS primary_received'), 'Primary manager bucket can overlap debt/extra')
  check(report.includes("WHEN p.payment_kind = 'debt_close' THEN p.amount") && report.includes('AS debt_closed'), 'Debt-close manager bucket missing')
  check(report.includes("WHEN p.payment_kind = 'extra'\n                  AND NOT EXISTS") && report.includes('AS order_extra_received'), 'Legacy ordinary-extra manager bucket is not isolated from exchange extras')
  check(report.includes('AS extra_received'), 'Exchange-extra manager bucket missing')

  // Returns/exchanges and reversals retain explicit dates and append-only evidence.
  check(returnsExchanges.includes("throw new Error('Укажите дату возврата.')") && returnsExchanges.includes("throw new Error('Укажите дату обмена.')"), 'Return/exchange can invent a missing business date')
  check(returnsExchanges.includes("eventType: 'exchange_extra'"), 'Immutable exchange-extra evidence missing')
check(returnsExchanges.includes("eventType: 'exchange_refund'"), 'Immutable exchange-refund evidence missing')
check(`${returnsExchanges}\n${money}`.includes("'refund_reversal'"), 'Immutable refund-reversal evidence missing')
check(`${money}\n${orderWrite}`.includes("'payment_reversal'"), 'Immutable payment-reversal evidence missing')
  check(report.includes("completedReturns = returns.filter") && report.includes("cleanText(row.status) !== 'cancelled'"), 'Cancelled returns can enter current Finance totals')

  // Both debt-close entry points share one append-only/idempotent backend.
  const editorPayment = between(app, 'async function saveEditorPayment(index: number)', 'function addEditorItem()')
  const dedicatedDebt = between(app, 'async function saveDebtClose()', 'async function saveReturn()')
  check(editorPayment.includes("apiFetch('/api/payments'") && dedicatedDebt.includes("apiFetch('/api/payments'"), 'Debt-close entry paths diverged from /api/payments')
  check(editorPayment.includes('prepareCriticalRequest') && dedicatedDebt.includes('prepareCriticalRequest'), 'One debt-close entry path lost browser retry protection')
  check(money.includes("beginCriticalOperation(db, 'order_payment_create'"), 'Server payment write lost critical-operation idempotency')
  check(!between(app, 'async function persistOrder(', 'async function saveSelectedOrder()').includes('payments: nextDraft.payments.map'), 'Generic order edit can rewrite complete payment history')
  check(orderWrite.includes('removeOrderPaymentsWithMoneyEvents'), 'Explicit legacy/full-rewrite reversal primitive disappeared; review correction history semantics')
  const updateOrder = between(orderWrite, 'export async function updateOrderCritical(', '\n\nexport async function getOrder(')
  const removePayments = between(money, 'export async function removeOrderPaymentsWithMoneyEvents(', '\n\nexport async function removeSinglePaymentWithMoneyEvent(')
  check(updateOrder.includes('const rewritePayments = !deletingOrder && Boolean('), 'Deleting an order can still reinterpret a stale-client payment collection as a payment edit')
  check(updateOrder.includes('const nextPayments = deletingOrder ? existingPaymentsForEdit'), 'Delete does not pin totals to the persisted payment facts')
  check(updateOrder.includes("reason: 'order_delete'") && updateOrder.includes('preservePayments: true'), 'Order delete does not append explicit money reversals while preserving payment history')
  check(removePayments.includes('preservePayments?: boolean') && removePayments.includes('if (!input.preservePayments) statements.push'), 'Money reversal helper cannot preserve payment rows for logical deletion')
  check(removePayments.includes("'189c:payment:' || p.id || ':reversal:' || ?"), 'Order-delete reversal key is not stable/idempotent per payment')
  check(cashMigration.includes("'order-cancel:' || NEW.id || ':payment:' || p.id"), 'Cash delete path lost its separate idempotent order-cancel key')
  check(cash.includes("if (reason === 'order_delete') return 'Оплата снята при удалении заказа'"), 'Money journal does not explain an order-delete payment reversal')

  // Cash ledger is source-keyed and reversal-safe. Current Finance audit must not mutate it.
  for (const marker of ["'payment:' || NEW.id", "'payment-reversal:' || OLD.id", "'return:' || NEW.id", "'return-reversal:' || NEW.id"]) {
    check(cashMigration.includes(marker), `Cash source/reversal key missing: ${marker}`)
  }
  check(cashMigration.includes('source_key TEXT NOT NULL UNIQUE'), 'Cash source-key idempotency constraint missing')
  check(cash.includes("COALESCE(NULLIF(TRIM(activated_at), ''), '') = ''"), 'Cash resume can overwrite the first activation boundary')

  // Mobile/read-through audit information must remain available.
  check(journalCss.includes('@media (max-width: 760px)') && journalCss.includes('.finance-money-history-row-f4'), 'Money journal mobile layout protection missing')
  check(financeUi.includes('Операция записана:') && financeUi.includes('Заказ введён:'), 'Audit timestamps are hidden from Finance drilldown')
  check(financeUi.includes('openMoneyHistoryForOrder') && financeUi.includes('openOrderFromFinance'), 'Finance drilldown actions disappeared')


  // Adjacent strict-report semantics: do not mix business-order cohorts with operation-date totals
  // or show placeholder aggregate columns as if they were implemented.
  check(report.includes('COUNT(DISTINCT o.customer_id) AS clients') && report.includes('COUNT(DISTINCT o.manager_id) AS managers'), 'City aggregate still lacks real distinct client/manager counts')
  check(reportUi.includes('Товары из заказов с бизнес-датой заказа в выбранном периоде.'), 'Product report confuses business order date with system creation time')
  const productReportBlock = between(reportUi, 'const renderProductReport = () => (', 'const renderCityReport = () => (')
  check(!productReportBlock.includes('Возвраты по заказам') && !productReportBlock.includes('activeReturnTotal'), 'Product report mixes operation-date returns into the order-date product cohort')
  check(reportUi.includes("{ label: 'Возвраты по дате операции', value: formatMoney(activeReturnTotal) }"), 'Manager report does not label return-period semantics honestly')
  check(!reportUi.includes('Нет оплат по выбранным заказам.'), 'Payment report empty state incorrectly claims an order-date cohort')
  check(reportUi.includes('Нет оплат за выбранный период.'), 'Payment report has no operation-period empty wording')
  check(reportUi.includes('<td className="num">{row.clients}</td><td className="num">{row.managers}</td>'), 'City aggregate still renders fake client/manager placeholders')
  check(!finance.includes('collectionRate:') && !finance.includes('returnRate:'), 'Mixed-cohort dead rate fields returned to Finance API')
  check(!read('src/app/types.ts').includes('collectionRate:') && !read('src/app/types.ts').includes('returnRate:'), 'Mixed-cohort dead rate fields returned to frontend contract')

  // Synthetic cross-layer accounting fixture. It deliberately includes one legacy ordinary extra
  // and one exchange extra encoded with payment_kind=extra, reproducing the exact ambiguity F5 fixed.
  const db = new DatabaseSync(':memory:')
  db.exec(`
    CREATE TABLE payments (id INTEGER PRIMARY KEY, payment_date TEXT, amount INTEGER, payment_kind TEXT, method TEXT);
    CREATE TABLE exchanges (id INTEGER PRIMARY KEY, payment_id INTEGER, financial_action TEXT, status TEXT);
    CREATE TABLE returns (id INTEGER PRIMARY KEY, return_date TEXT, amount INTEGER, status TEXT, exchange_refund INTEGER DEFAULT 0);
  `)
  const payments = [
    [1, '2026-08-25', 100, 'primary', 'Kaspi'],
    [2, '2026-08-25', 20, 'debt_close', 'Kaspi'],
    [3, '2026-08-25', 10, 'extra', 'НАЛИЧКА'],
    [4, '2026-08-25', 5, 'extra', 'Kaspi'],
  ]
  for (const row of payments) db.prepare('INSERT INTO payments VALUES (?, ?, ?, ?, ?)').run(...row)
  db.prepare("INSERT INTO exchanges VALUES (1, 4, 'extra_payment', 'completed')").run()
  db.prepare("INSERT INTO returns VALUES (1, '2026-08-25', 15, 'completed', 0)").run()
  db.prepare("INSERT INTO returns VALUES (2, '2026-08-25', 4, 'completed', 1)").run()
  db.prepare("INSERT INTO returns VALUES (3, '2026-08-25', 999, 'cancelled', 0)").run()

  const operationRows = db.prepare(`
    SELECT p.id, p.amount,
      CASE
        WHEN EXISTS (SELECT 1 FROM exchanges e WHERE e.payment_id=p.id AND COALESCE(e.status,'completed') <> 'cancelled' AND e.financial_action='extra_payment') THEN 'exchange_extra'
        WHEN p.payment_kind='debt_close' THEN 'debt_close'
        WHEN p.payment_kind='extra' THEN 'order_extra'
        ELSE 'order_payment'
      END AS operation_type
    FROM payments p WHERE p.payment_date BETWEEN '2026-08-25' AND '2026-08-25'
  `).all()
  const gross = sumRows(operationRows, 'amount')
  const primary = operationRows.filter((row) => row.operation_type === 'order_payment').reduce((s, row) => s + Number(row.amount), 0)
  const debt = operationRows.filter((row) => row.operation_type === 'debt_close' || row.operation_type === 'order_extra').reduce((s, row) => s + Number(row.amount), 0)
  const exchangeExtra = operationRows.filter((row) => row.operation_type === 'exchange_extra').reduce((s, row) => s + Number(row.amount), 0)
  const methodTotal = Number(db.prepare("SELECT COALESCE(SUM(amount),0) AS total FROM payments WHERE payment_date='2026-08-25'").get().total || 0)
  const returned = Number(db.prepare("SELECT COALESCE(SUM(amount),0) AS total FROM returns WHERE return_date='2026-08-25' AND COALESCE(status,'completed') <> 'cancelled'").get().total || 0)

  check(gross === 135, `Synthetic gross mismatch: ${gross}`)
  check(primary === 100 && debt === 30 && exchangeExtra === 5, `Synthetic operation split mismatch: primary=${primary}, debt=${debt}, exchange=${exchangeExtra}`)
  check(primary + debt + exchangeExtra === gross, 'Payment-kind buckets do not reconcile to gross without overlap')
  check(methodTotal === gross, 'Payment-method total does not reconcile to gross')
  check(returned === 19 && gross - returned === 116, 'Return/net-cash fixture does not exclude cancelled return correctly')

  console.log('FINANCE F6 RELEASE AUDIT PASSED — selected-period traceability, current/legacy operation semantics, payment-kind/method/manager arithmetic, returns/reversals, cash idempotency, shared debt-close path and mobile audit drilldowns reconcile.')
} catch (error) {
  console.error(`FINANCE F6 RELEASE AUDIT FAILED: ${error?.message || error}`)
  process.exit(1)
}
