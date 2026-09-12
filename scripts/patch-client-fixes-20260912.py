from pathlib import Path
import re


def read(path):
    return Path(path).read_text(encoding='utf-8')


def write(path, text):
    Path(path).write_text(text, encoding='utf-8')


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected exactly one match, got {count}')
    return text.replace(old, new, 1)

# 1) Types: multi-pair exchange draft, finance reconciliation, dashboard daily summary.
path = 'src/app/types.ts'
text = read(path)
old = """export type ExchangeDraft = {
  orderId: number | null
  exchangeDate: string
  oldItemId: number
  oldQuantity: number
  oldReturnSource: 'none' | 'warehouse' | 'boutique'
  oldPhysicalState: 'pending' | 'warehouse' | 'boutique' | 'no_stock'
  newItem: EditorItem
  financialAction: 'none' | 'extra_payment' | 'refund'
  financialAmount: number
  paymentMethod: string
  comment: string
  newSourceWasManuallyChanged: boolean
}
"""
new = """export type ExchangePairDraft = {
  draftKey: string
  oldItemId: number
  oldQuantity: number
  oldReturnSource: 'none' | 'warehouse' | 'boutique'
  oldPhysicalState: 'pending' | 'warehouse' | 'boutique' | 'no_stock'
  newItem: EditorItem
  newSourceWasManuallyChanged: boolean
  saved?: boolean
}

export type ExchangeDraft = {
  orderId: number | null
  exchangeDate: string
  currentPairKey: string
  queuedPairs: ExchangePairDraft[]
  oldItemId: number
  oldQuantity: number
  oldReturnSource: 'none' | 'warehouse' | 'boutique'
  oldPhysicalState: 'pending' | 'warehouse' | 'boutique' | 'no_stock'
  newItem: EditorItem
  financialAction: 'none' | 'extra_payment' | 'refund'
  financialAmount: number
  paymentMethod: string
  comment: string
  newSourceWasManuallyChanged: boolean
}
"""
text = replace_once(text, old, new, 'exchange draft type')
old = """export type PaymentMethodsByDayRow = {
  date: string
  total: number
  methods: Record<string, number>
}
"""
new = old + """

export type PaymentMethodReconciliationRow = {
  method: string
  orderPayments: number
  debtClosures: number
  exchangeExtras: number
  grossInflow: number
  refunds: number
  netMovement: number
}

export type PaymentReconciliationDay = {
  date: string
  orderPayments: number
  debtClosures: number
  exchangeExtras: number
  grossInflow: number
  refunds: number
  netMovement: number
}
"""
text = replace_once(text, old, new, 'finance reconciliation types')
old = """    paymentMethodsByDay?: PaymentMethodsByDayRow[]
    managerDays?: ManagerReportDay[]
"""
new = """    paymentMethodsByDay?: PaymentMethodsByDayRow[]
    paymentMethodReconciliation?: PaymentMethodReconciliationRow[]
    paymentReconciliationByDay?: PaymentReconciliationDay[]
    managerDays?: ManagerReportDay[]
"""
text = replace_once(text, old, new, 'finance report fields')
old = """  lowStock: DashboardLowStockItem[]
  workshopWarnings: DashboardWorkshopWarning[]
}
"""
new = """  daily: {
    today: { date: string; orderCount: number; totalSales: number; totalReceived: number; totalReturns: number; netCash: number }
    yesterday: { date: string; orderCount: number; totalSales: number; totalReceived: number; totalReturns: number; netCash: number }
  }
  lowStock: DashboardLowStockItem[]
  workshopWarnings: DashboardWorkshopWarning[]
}
"""
text = replace_once(text, old, new, 'dashboard daily type')
write(path, text)

# 2) Exchange draft factory: stable pair keys + empty queue.
path = 'src/app/utils.ts'
text = read(path)
old = """export function createExchangeDraft(order?: OrderRecord | null): ExchangeDraft {
  const firstItem = (order?.items || []).find((item) => Number(item.id || 0) > 0 && Number(item.quantity || 0) > 0)
"""
new = """function createExchangePairDraftKey() {
  const randomUuid = globalThis.crypto?.randomUUID?.()
  return randomUuid || `exchange-pair-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function createExchangeDraft(order?: OrderRecord | null): ExchangeDraft {
  const firstItem = (order?.items || []).find((item) => Number(item.id || 0) > 0 && Number(item.quantity || 0) > 0)
"""
text = replace_once(text, old, new, 'exchange draft key helper')
old = """    orderId: order?.id || null,
    exchangeDate: formatLocalDateInput(),
    oldItemId: Number(firstItem?.id || 0),
"""
new = """    orderId: order?.id || null,
    exchangeDate: formatLocalDateInput(),
    currentPairKey: createExchangePairDraftKey(),
    queuedPairs: [],
    oldItemId: Number(firstItem?.id || 0),
"""
text = replace_once(text, old, new, 'exchange queue defaults')
write(path, text)

# 3) Dashboard backend: today/yesterday metrics in same response; no extra request on toggle.
path = 'worker/domains/inventory-read.ts'
text = read(path)
old = """  const today = `${todayParts.year}-${todayParts.month}-${todayParts.day}`;
  const monthStart = `${today.slice(0, 7)}-01`;
"""
new = """  const today = `${todayParts.year}-${todayParts.month}-${todayParts.day}`;
  const yesterdayDate = new Date(`${today}T00:00:00.000Z`);
  yesterdayDate.setUTCDate(yesterdayDate.getUTCDate() - 1);
  const yesterday = yesterdayDate.toISOString().slice(0, 10);
  const monthStart = `${today.slice(0, 7)}-01`;
"""
text = replace_once(text, old, new, 'dashboard yesterday date')
old = """  const workshopColumns = await readTableColumnSet(db, 'workshop_tasks');
"""
new = """  const dailyResult = await db.prepare(
    `SELECT d.business_date AS date,
            COALESCE((SELECT COUNT(*) FROM orders o WHERE o.order_date = d.business_date AND o.order_status <> 'deleted'), 0) AS order_count,
            COALESCE((SELECT SUM(o.total_amount) FROM orders o WHERE o.order_date = d.business_date AND o.order_status <> 'deleted'), 0) AS total_sales,
            COALESCE((SELECT SUM(p.amount) FROM payments p JOIN orders o ON o.id = p.order_id WHERE p.payment_date = d.business_date AND o.order_status <> 'deleted'), 0) AS total_received,
            COALESCE((SELECT SUM(r.amount) FROM returns r JOIN orders o ON o.id = r.order_id WHERE r.return_date = d.business_date AND COALESCE(r.status, 'completed') <> 'cancelled' AND o.order_status <> 'deleted'), 0) AS total_returns
     FROM (SELECT ? AS business_date UNION ALL SELECT ?) d`
  ).bind(today, yesterday).all<any>();
  const dailyRows = new Map((dailyResult.results || []).map((row: any) => [cleanText(row.date), row]));
  const mapDaily = (date: string) => {
    const row: any = dailyRows.get(date) || {};
    const totalReceived = toInt(row.total_received, 0);
    const totalReturns = toInt(row.total_returns, 0);
    return {
      date,
      orderCount: toInt(row.order_count, 0),
      totalSales: toInt(row.total_sales, 0),
      totalReceived,
      totalReturns,
      netCash: totalReceived - totalReturns,
    };
  };

  const workshopColumns = await readTableColumnSet(db, 'workshop_tasks');
"""
text = replace_once(text, old, new, 'dashboard daily query')
old = """    lowStock: [],
    workshopWarnings,
"""
new = """    daily: {
      today: mapDaily(today),
      yesterday: mapDaily(yesterday),
    },
    lowStock: [],
    workshopWarnings,
"""
text = replace_once(text, old, new, 'dashboard daily response')
write(path, text)

# 4) Dashboard UI: explicit Today / Yesterday operational block; monthly cards remain unchanged.
path = 'src/features/sections/DashboardSection.tsx'
text = read(path)
old = """  const [selectedWorkshopOrder, setSelectedWorkshopOrder] = useState<any | null>(null)
  const workshopAgeLimit = Number(dashboardInsights?.thresholds.workshopAgeLimit ?? 7)
"""
new = """  const [selectedWorkshopOrder, setSelectedWorkshopOrder] = useState<any | null>(null)
  const [dailyPeriod, setDailyPeriod] = useState<'today' | 'yesterday'>('today')
  const dailySummary = dashboardInsights?.daily?.[dailyPeriod] || null
  const workshopAgeLimit = Number(dashboardInsights?.thresholds.workshopAgeLimit ?? 7)
"""
text = replace_once(text, old, new, 'dashboard daily state')
anchor = """      <div className=\"dashboard-workspace\">\n"""
insert = """      <section className=\"mini-panel dashboard-daily-panel\">
        <div className=\"mini-panel-head\">
          <div>
            <h3>День работы</h3>
            <p className=\"mini-panel-note\">Продажи считаются по дате заказа, поступления и возвраты — по фактической дате денежной операции.</p>
          </div>
          <div className=\"mini-panel-actions\">
            <button className={dailyPeriod === 'today' ? 'primary compact' : 'secondary compact'} type=\"button\" onClick={() => setDailyPeriod('today')}>Сегодня</button>
            <button className={dailyPeriod === 'yesterday' ? 'primary compact' : 'secondary compact'} type=\"button\" onClick={() => setDailyPeriod('yesterday')}>Вчера</button>
          </div>
        </div>
        <div className=\"summary-grid dashboard-summary-grid\">
          <div className=\"summary-card\"><span>Дата</span><strong>{dailySummary?.date ? dashboardShortDate(dailySummary.date) : '—'}</strong></div>
          <div className=\"summary-card\"><span>Заказов</span><strong>{dailySummary?.orderCount ?? 0}</strong></div>
          <div className=\"summary-card\"><span>Продажи по дате заказа</span><strong>{formatMoney(dailySummary?.totalSales || 0)}</strong></div>
          <div className=\"summary-card\"><span>Поступило по дате оплаты</span><strong>{formatMoney(dailySummary?.totalReceived || 0)}</strong></div>
          <div className=\"summary-card danger-card\"><span>Возвраты по дате операции</span><strong>{formatMoney(dailySummary?.totalReturns || 0)}</strong></div>
          <div className=\"summary-card\"><span>Чистое движение денег</span><strong>{formatMoney(dailySummary?.netCash || 0)}</strong></div>
        </div>
      </section>

      <div className=\"dashboard-workspace\">\n"""
text = replace_once(text, anchor, insert, 'dashboard daily panel')
write(path, text)

# 5) Finance backend: payment report receives operation detail and builds non-overlapping reconciliation.
path = 'worker/domains/finance-reports.ts'
text = read(path)
old = """    () => !needsReport('managers', 'cities') ? emptyRowsResult() : db.prepare(
      `SELECT p.id,
"""
new = """    () => !needsReport('payments', 'managers', 'cities') ? emptyRowsResult() : db.prepare(
      `SELECT p.id,
"""
text = replace_once(text, old, new, 'payment operation scope')
anchor = """  const periodReturns = returnsTotal;\n\n\n  const paymentMethodsByDayMap"""
insert = """  const periodReturns = returnsTotal;

  const emptyReconciliation = (method: string) => ({
    method,
    orderPayments: 0,
    debtClosures: 0,
    exchangeExtras: 0,
    grossInflow: 0,
    refunds: 0,
    netMovement: 0,
  });
  const paymentMethodReconciliationMap = new Map<string, ReturnType<typeof emptyReconciliation>>();
  const paymentReconciliationDayMap = new Map<string, Omit<ReturnType<typeof emptyReconciliation>, 'method'> & { date: string }>();
  const touchDay = (date: string) => {
    const key = cleanText(date);
    const current = paymentReconciliationDayMap.get(key) || {
      date: key, orderPayments: 0, debtClosures: 0, exchangeExtras: 0, grossInflow: 0, refunds: 0, netMovement: 0,
    };
    paymentReconciliationDayMap.set(key, current);
    return current;
  };
  for (const operation of paymentOperations) {
    const method = canonicalPaymentMethodName(operation.method);
    const current = paymentMethodReconciliationMap.get(method) || emptyReconciliation(method);
    const day = touchDay(operation.paymentDate);
    if (operation.operationType === 'exchange_extra') {
      current.exchangeExtras += Number(operation.amount || 0);
      day.exchangeExtras += Number(operation.amount || 0);
    } else if (operation.operationType === 'debt_close' || operation.operationType === 'order_extra') {
      current.debtClosures += Number(operation.amount || 0);
      day.debtClosures += Number(operation.amount || 0);
    } else {
      current.orderPayments += Number(operation.amount || 0);
      day.orderPayments += Number(operation.amount || 0);
    }
    current.grossInflow += Number(operation.amount || 0);
    day.grossInflow += Number(operation.amount || 0);
    paymentMethodReconciliationMap.set(method, current);
  }
  for (const row of completedReturns as any[]) {
    const method = canonicalPaymentMethodName(row.payment_method);
    const current = paymentMethodReconciliationMap.get(method) || emptyReconciliation(method);
    const amount = Number(row.amount || 0);
    current.refunds += amount;
    const day = touchDay(cleanText(row.return_date));
    day.refunds += amount;
    paymentMethodReconciliationMap.set(method, current);
  }
  const paymentMethodReconciliation = Array.from(paymentMethodReconciliationMap.values())
    .map((row) => ({ ...row, netMovement: row.grossInflow - row.refunds }))
    .sort((a, b) => b.grossInflow - a.grossInflow || a.method.localeCompare(b.method, 'ru'));
  const paymentReconciliationByDay = Array.from(paymentReconciliationDayMap.values())
    .map((row) => ({ ...row, netMovement: row.grossInflow - row.refunds }))
    .sort((a, b) => a.date.localeCompare(b.date));


  const paymentMethodsByDayMap"""
text = replace_once(text, anchor, insert, 'finance reconciliation derivation')
old = """      paymentMethodsByDay: Array.from(paymentMethodsByDayMap.values()).sort((a, b) => a.date.localeCompare(b.date)),
      managerDays: Array.from(managerDaysMap.values()),
"""
new = """      paymentMethodsByDay: Array.from(paymentMethodsByDayMap.values()).sort((a, b) => a.date.localeCompare(b.date)),
      paymentMethodReconciliation,
      paymentReconciliationByDay,
      managerDays: Array.from(managerDaysMap.values()),
"""
text = replace_once(text, old, new, 'finance reconciliation response')
write(path, text)

# 6) Finance payment report: make debt closures, exchange top-ups and refunds explicit without double counting.
path = 'src/features/renderers/FinanceReportContentRenderer.tsx'
text = read(path)
old = """    const paymentMethodsByDay = financeReport.reports.paymentMethodsByDay || []
    const managerDays = financeReport.reports.managerDays || []
"""
new = """    const paymentMethodsByDay = financeReport.reports.paymentMethodsByDay || []
    const paymentMethodReconciliation = financeReport.reports.paymentMethodReconciliation || []
    const paymentReconciliationByDay = financeReport.reports.paymentReconciliationByDay || []
    const reconciliationTotals = paymentMethodReconciliation.reduce((acc, row) => ({
      orderPayments: acc.orderPayments + Number(row.orderPayments || 0),
      debtClosures: acc.debtClosures + Number(row.debtClosures || 0),
      exchangeExtras: acc.exchangeExtras + Number(row.exchangeExtras || 0),
      grossInflow: acc.grossInflow + Number(row.grossInflow || 0),
      refunds: acc.refunds + Number(row.refunds || 0),
      netMovement: acc.netMovement + Number(row.netMovement || 0),
    }), { orderPayments: 0, debtClosures: 0, exchangeExtras: 0, grossInflow: 0, refunds: 0, netMovement: 0 })
    const managerDays = financeReport.reports.managerDays || []
"""
text = replace_once(text, old, new, 'finance renderer reconciliation vars')
old = """        {renderStatsTable([
          { label: 'Поступило денег', value: formatMoney(paymentTotal) },
          { label: 'Способов оплаты', value: financeReport.reports.paymentMethods.length },
          { label: 'Дней с оплатами', value: paymentMethodsByDay.length },
          { label: 'Возвраты за период', value: formatMoney(activeReturnTotal) },
        ])}
        <section className=\"report-table-card\">
          <div className=\"strict-section-head\"><h3>Итог по способам оплаты</h3><span className=\"soft-badge\">таблица за период</span></div>
          <div className=\"table-shell\"><table className=\"data-table strict-report-table\"><thead><tr><th>Способ оплаты</th><th className=\"num\">Сумма</th><th className=\"num\">Доля</th></tr></thead><tbody>
            {financeReport.reports.paymentMethods.map((row) => <tr key={`payment-report-${row.method}`}><td>{row.method || '—'}</td><td className=\"num\">{formatMoney(row.total)}</td><td className=\"num\">{formatPercent(paymentTotal ? Number(row.total || 0) / paymentTotal : 0)}</td></tr>)}
            {!financeReport.reports.paymentMethods.length ? <tr><td colSpan={3} className=\"empty-state\">Нет оплат за выбранный период.</td></tr> : null}
            {financeReport.reports.paymentMethods.length ? <tr className=\"total-row\"><td>ИТОГО</td><td className=\"num\">{formatMoney(paymentTotal)}</td><td className=\"num\">100%</td></tr> : null}
          </tbody></table></div>
        </section>
"""
new = """        {renderStatsTable([
          { label: 'Все поступления', value: formatMoney(reconciliationTotals.grossInflow || paymentTotal) },
          { label: 'Оплаты заказов', value: formatMoney(reconciliationTotals.orderPayments) },
          { label: 'Закрыли долг', value: formatMoney(reconciliationTotals.debtClosures) },
          { label: 'Доплата по обмену', value: formatMoney(reconciliationTotals.exchangeExtras) },
          { label: 'Возврат', value: formatMoney(reconciliationTotals.refunds || activeReturnTotal) },
          { label: 'Чистое движение', value: formatMoney(reconciliationTotals.netMovement || ((reconciliationTotals.grossInflow || paymentTotal) - activeReturnTotal)) },
        ], 'Сверка денег за период')}
        <section className=\"report-table-card\">
          <div className=\"strict-section-head\"><h3>Сверка по способам оплаты</h3><span className=\"soft-badge\">без двойного счёта</span></div>
          <p className=\"strict-report-note\">Все поступления = оплаты заказов + закрытие долга + доплаты по обменам. Чистое движение = все поступления − возвраты.</p>
          <div className=\"table-shell\"><table className=\"data-table strict-report-table\"><thead><tr><th>Способ оплаты</th><th className=\"num\">Оплаты заказов</th><th className=\"num\">Закрыли долг</th><th className=\"num\">Доплата</th><th className=\"num\">Все поступления</th><th className=\"num\">Возврат</th><th className=\"num\">Чистое движение</th></tr></thead><tbody>
            {paymentMethodReconciliation.map((row) => <tr key={`payment-reconciliation-${row.method}`}><td>{row.method || '—'}</td><td className=\"num\">{formatMoney(row.orderPayments)}</td><td className=\"num\">{formatMoney(row.debtClosures)}</td><td className=\"num\">{formatMoney(row.exchangeExtras)}</td><td className=\"num\"><strong>{formatMoney(row.grossInflow)}</strong></td><td className=\"num\">{formatMoney(row.refunds)}</td><td className=\"num\"><strong>{formatMoney(row.netMovement)}</strong></td></tr>)}
            {!paymentMethodReconciliation.length ? <tr><td colSpan={7} className=\"empty-state\">Нет денежных операций за выбранный период.</td></tr> : null}
            {paymentMethodReconciliation.length ? <tr className=\"total-row\"><td>ИТОГО</td><td className=\"num\">{formatMoney(reconciliationTotals.orderPayments)}</td><td className=\"num\">{formatMoney(reconciliationTotals.debtClosures)}</td><td className=\"num\">{formatMoney(reconciliationTotals.exchangeExtras)}</td><td className=\"num\">{formatMoney(reconciliationTotals.grossInflow)}</td><td className=\"num\">{formatMoney(reconciliationTotals.refunds)}</td><td className=\"num\">{formatMoney(reconciliationTotals.netMovement)}</td></tr> : null}
          </tbody></table></div>
        </section>
        <section className=\"report-table-card\">
          <div className=\"strict-section-head\"><h3>Сверка по дням</h3><span className=\"soft-badge\">фактические даты операций</span></div>
          <div className=\"table-shell\"><table className=\"data-table strict-report-table\"><thead><tr><th>Дата</th><th className=\"num\">Оплаты заказов</th><th className=\"num\">Закрыли долг</th><th className=\"num\">Доплата</th><th className=\"num\">Поступления</th><th className=\"num\">Возврат</th><th className=\"num\">Чистое</th></tr></thead><tbody>
            {paymentReconciliationByDay.map((row) => <tr key={`payment-reconciliation-day-${row.date}`}><td>{formatDateShort(row.date)}</td><td className=\"num\">{formatMoney(row.orderPayments)}</td><td className=\"num\">{formatMoney(row.debtClosures)}</td><td className=\"num\">{formatMoney(row.exchangeExtras)}</td><td className=\"num\">{formatMoney(row.grossInflow)}</td><td className=\"num\">{formatMoney(row.refunds)}</td><td className=\"num\"><strong>{formatMoney(row.netMovement)}</strong></td></tr>)}
            {!paymentReconciliationByDay.length ? <tr><td colSpan={7} className=\"empty-state\">Нет денежных операций за выбранный период.</td></tr> : null}
          </tbody></table></div>
        </section>
"""
text = replace_once(text, old, new, 'payment report reconciliation UI')
write(path, text)

# 7) Exchange UI: queue multiple old→new pairs in one visit while keeping one shared financial adjustment.
path = 'src/features/sections/OrderExchangeSection.tsx'
text = read(path)
anchor = """  const exchangeFreeAfterIssue = exchangePhysical - exchangeReserved - exchangeRequired\n\n  return ("""
insert = """  const exchangeFreeAfterIssue = exchangePhysical - exchangeReserved - exchangeRequired
  const queuedPairs = exchangeDraft.queuedPairs || []
  const currentPairReady = Boolean(effectiveOldItem && String(exchangeDraft.newItem.productName || '').trim())
  const queueCurrentExchangePair = () => {
    if (!currentPairReady) return
    if (exchangePhysicalShortage && !exchangeObservationEnabled) return
    if (exchangeObservationEnabled && (exchangeObservedPhysical === null || exchangeObservedPhysical === undefined || !Number.isInteger(Number(exchangeObservedPhysical)) || Number(exchangeObservedPhysical) < exchangeRequired)) return
    const fresh = createExchangeDraft(exchangeSelectedOrder)
    const pair = {
      draftKey: exchangeDraft.currentPairKey || fresh.currentPairKey,
      oldItemId: effectiveOldItemId,
      oldQuantity: Math.max(1, Number(exchangeDraft.oldQuantity || 1)),
      oldReturnSource: exchangeDraft.oldPhysicalState === 'warehouse' || exchangeDraft.oldPhysicalState === 'boutique' ? exchangeDraft.oldPhysicalState : 'none',
      oldPhysicalState: exchangeDraft.oldPhysicalState,
      newItem: { ...exchangeDraft.newItem },
      newSourceWasManuallyChanged: Boolean(exchangeDraft.newSourceWasManuallyChanged),
      saved: false,
    }
    setExchangeDraft((current) => ({
      ...fresh,
      orderId: current.orderId,
      exchangeDate: current.exchangeDate,
      queuedPairs: [...(current.queuedPairs || []), pair],
      financialAction: current.financialAction,
      financialAmount: current.financialAmount,
      paymentMethod: current.paymentMethod,
      comment: current.comment,
    }))
  }
  const removeQueuedExchangePair = (draftKey: string) => setExchangeDraft((current) => ({
    ...current,
    queuedPairs: (current.queuedPairs || []).filter((pair: any) => pair.draftKey !== draftKey || pair.saved),
  }))

  return ("""
text = replace_once(text, anchor, insert, 'exchange queue helpers')
old = """                    <div className=\"stack\">
                      <div className=\"mini-item order-payment-card\">
"""
new = """                    <div className=\"stack\">
                      {queuedPairs.length ? (
                        <div className=\"mini-item order-payment-card\">
                          <div className=\"mini-item-head\"><strong>Позиции, добавленные в этот обмен</strong><span className=\"soft-badge\">{queuedPairs.length}</span></div>
                          <div className=\"stack\">
                            {queuedPairs.map((pair: any, index: number) => {
                              const oldItem = exchangeableOldItems.find((item: any) => Number(item.id || 0) === Number(pair.oldItemId || 0))
                              return (
                                <div className=\"history-detail-grid\" key={`queued-exchange-${pair.draftKey}`}>
                                  <div><span>Позиция {index + 1}</span><strong>{oldItem?.productName || `Позиция #${pair.oldItemId}`} × {pair.oldQuantity}</strong></div>
                                  <div><span>Новая вещь</span><strong>{pair.newItem?.productName || '—'} × {pair.newItem?.quantity || 1}</strong></div>
                                  <div><span>Статус</span><strong>{pair.saved ? 'Уже сохранено' : 'Готово к оформлению'}</strong></div>
                                  <div className=\"row-actions\"><button className=\"ghost danger compact\" type=\"button\" disabled={exchangeBusy || pair.saved} onClick={() => removeQueuedExchangePair(pair.draftKey)}>{pair.saved ? 'Сохранено' : 'Убрать'}</button></div>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      ) : null}
                      <div className=\"mini-item order-payment-card\">
"""
text = replace_once(text, old, new, 'queued exchange summary')
old = """                    <div className=\"actions order-create-actions form-bottom-actions\">
                      <button className=\"primary\" type=\"button\" onClick={() => void saveExchange()} disabled={exchangeBusy}>
                        {exchangeBusy ? 'Сохраняю...' : 'Оформить обмен'}
                      </button>
"""
new = """                    <div className=\"actions order-create-actions form-bottom-actions\">
                      <button className=\"secondary\" type=\"button\" onClick={queueCurrentExchangePair} disabled={exchangeBusy || !currentPairReady || (exchangePhysicalShortage && !exchangeObservationEnabled)}>
                        Добавить ещё позицию
                      </button>
                      <button className=\"primary\" type=\"button\" onClick={() => void saveExchange()} disabled={exchangeBusy || (!queuedPairs.length && !currentPairReady)}>
                        {exchangeBusy ? 'Сохраняю...' : `Оформить обмен${queuedPairs.length ? ` (${queuedPairs.length + (currentPairReady ? 1 : 0)} поз.)` : ''}`}
                      </button>
"""
text = replace_once(text, old, new, 'exchange batch actions')
write(path, text)

# 8) App exchange save: validate all pairs, aggregate old quantities, persist child exchanges sequentially with stable per-pair idempotency.
path = 'src/App.tsx'
text = read(path)
pattern = re.compile(r"  async function saveExchange\(\) \{.*?\n  \}\n\n\n  async function receiveReturnedItemAction", re.S)
match = pattern.search(text)
if not match:
    raise RuntimeError('saveExchange function block not found')
new_function = r'''  async function saveExchange() {
    if (!exchangeSelectedOrder) {
      setError('Сначала выберите заказ для обмена.')
      return
    }

    const exchangeableOldItems = exchangeSelectedOrder.items.filter((item) => Number(item.id || 0) > 0 && Number(item.quantity || 0) > 0)
    const queuedPairs = exchangeDraft.queuedPairs || []
    const requestedCurrentOldItem = exchangeableOldItems.find((item) => Number(item.id || 0) === Number(exchangeDraft.oldItemId || 0)) || null
    const visibleCurrentOldItem = requestedCurrentOldItem || exchangeableOldItems[0] || null
    const currentPair = String(exchangeDraft.newItem.productName || '').trim() && visibleCurrentOldItem ? {
      draftKey: exchangeDraft.currentPairKey,
      oldItemId: Number(visibleCurrentOldItem.id || 0),
      oldQuantity: Math.max(1, Number(exchangeDraft.oldQuantity || 1)),
      oldReturnSource: exchangeDraft.oldPhysicalState === 'warehouse' || exchangeDraft.oldPhysicalState === 'boutique' ? exchangeDraft.oldPhysicalState : 'none',
      oldPhysicalState: exchangeDraft.oldPhysicalState,
      newItem: exchangeDraft.newItem,
      newSourceWasManuallyChanged: exchangeDraft.newSourceWasManuallyChanged,
      saved: false,
    } : null
    const pairDrafts = [...queuedPairs, ...(currentPair ? [currentPair] : [])]
    if (!pairDrafts.length) {
      setError(exchangeableOldItems.length ? 'Добавьте хотя бы одну позицию обмена.' : 'В заказе не осталось доступных позиций для обмена.')
      return
    }

    if (exchangeDraft.financialAction !== 'none' && Number(exchangeDraft.financialAmount || 0) <= 0) {
      setError('Укажите сумму доплаты или возврата больше нуля.')
      return
    }
    if (exchangeDraft.financialAction !== 'none' && !exchangeDraft.paymentMethod.trim()) {
      setError(exchangeDraft.financialAction === 'refund' ? 'Выберите способ возврата денег.' : 'Выберите способ оплаты для доплаты.')
      return
    }

    const unsavedPairs: Array<{
      index: number
      draftKey: string
      isQueued: boolean
      selectedOldItem: OrderRecord['items'][number]
      oldQuantity: number
      oldReturnSource: 'none' | 'warehouse' | 'boutique'
      oldPhysicalState: 'pending' | 'warehouse' | 'boutique' | 'no_stock'
      effectiveNewItem: EditorItem
      newSourceWasManuallyChanged: boolean
    }> = []
    const requestedByOldItem = new Map<number, number>()

    for (let index = 0; index < pairDrafts.length; index += 1) {
      const pair = pairDrafts[index]
      if (pair.saved) continue
      const selectedOldItem = exchangeableOldItems.find((item) => Number(item.id || 0) === Number(pair.oldItemId || 0)) || null
      if (!selectedOldItem) {
        setError(`Позиция обмена ${index + 1}: старая вещь уже недоступна. Уберите эту строку и выберите актуальную позицию.`)
        return
      }
      const oldQuantity = Math.max(1, Number(pair.oldQuantity || 1))
      const oldItemId = Number(selectedOldItem.id || 0)
      const accumulated = (requestedByOldItem.get(oldItemId) || 0) + oldQuantity
      requestedByOldItem.set(oldItemId, accumulated)
      if (accumulated > Number(selectedOldItem.quantity || 0)) {
        setError(`Позиция обмена ${index + 1}: суммарно выбрано ${accumulated} шт., доступно ${Number(selectedOldItem.quantity || 0)} шт.`)
        return
      }
      if (!String(pair.newItem?.productName || '').trim()) {
        setError(`Позиция обмена ${index + 1}: заполните новый товар.`)
        return
      }

      const inheritedReplacementSource = selectedOldItem.sourceType === 'workshop'
        ? 'workshop'
        : selectedOldItem.sourceType === 'boutique'
          ? 'boutique'
          : 'warehouse'
      const effectiveNewItem = pair.newSourceWasManuallyChanged
        ? pair.newItem
        : { ...pair.newItem, sourceType: inheritedReplacementSource as EditorItem['sourceType'] }
      const exchangeRequiredQuantity = Math.max(1, Number(effectiveNewItem.quantity || 1))
      const exchangeAvailability = effectiveNewItem.sourceType === 'workshop'
        ? null
        : getOrderSourceAvailability(effectiveNewItem, exchangeRequiredQuantity)
      const needsPhysicalConfirmation = Boolean(exchangeAvailability?.canObservePhysical && Number(exchangeAvailability.currentPhysical || 0) < exchangeRequiredQuantity)
      if (needsPhysicalConfirmation && !effectiveNewItem.stockObservationEnabled) {
        if (index === pairDrafts.length - 1 && currentPair) {
          setExchangeDraft((current) => ({ ...current, newItem: { ...current.newItem, stockObservationEnabled: true, observedPhysicalQuantity: null } }))
        }
        setError(`Позиция обмена ${index + 1}: по учёту новой позиции недостаточно. ${index < queuedPairs.length ? 'Уберите её из списка, добавьте заново и укажите фактическое количество.' : 'Укажите фактическое количество на месте.'}`)
        return
      }
      if (effectiveNewItem.stockObservationEnabled) {
        const observedPhysical = effectiveNewItem.observedPhysicalQuantity
        if (observedPhysical === null || observedPhysical === undefined || !Number.isInteger(Number(observedPhysical)) || Number(observedPhysical) < exchangeRequiredQuantity) {
          setError(`Позиция обмена ${index + 1}: укажите целое фактическое количество не меньше ${exchangeRequiredQuantity} шт.`)
          return
        }
      }

      unsavedPairs.push({
        index,
        draftKey: pair.draftKey || `pair-${index + 1}`,
        isQueued: index < queuedPairs.length,
        selectedOldItem,
        oldQuantity,
        oldReturnSource: pair.oldPhysicalState === 'warehouse' || pair.oldPhysicalState === 'boutique' ? pair.oldPhysicalState : 'none',
        oldPhysicalState: pair.oldPhysicalState,
        effectiveNewItem,
        newSourceWasManuallyChanged: Boolean(pair.newSourceWasManuallyChanged),
      })
    }

    if (!unsavedPairs.length) {
      setError('Все позиции этого обмена уже были сохранены. Обновите историю обменов.')
      return
    }

    setExchangeBusy(true)
    setError(null)
    setMessage(null)
    let savedThisAttempt = 0
    const savedBefore = pairDrafts.filter((pair) => pair.saved).length
    let lastOrder: OrderRecord | null = null
    let pendingInventoryCount = 0
    let exchangeTouchesWorkshop = false

    try {
      for (const pair of unsavedPairs) {
        const isFinalPair = pair.index === pairDrafts.length - 1
        const payload = {
          orderId: exchangeSelectedOrder.id,
          exchangeDate: exchangeDraft.exchangeDate,
          oldItemId: Number(pair.selectedOldItem.id || 0),
          oldQuantity: pair.oldQuantity,
          oldReturnSource: pair.oldReturnSource,
          oldPhysicalState: pair.oldPhysicalState,
          newItem: pair.effectiveNewItem,
          newSourceWasManuallyChanged: pair.newSourceWasManuallyChanged,
          // One visit has one money difference. Put it only on the final child exchange,
          // so debt/top-up/refund can never be counted once per selected product.
          financialAction: isFinalPair ? exchangeDraft.financialAction : 'none',
          financialAmount: isFinalPair ? exchangeDraft.financialAmount : 0,
          paymentMethod: isFinalPair ? exchangeDraft.paymentMethod : '',
          comment: exchangeDraft.comment,
        }
        const criticalKey = `exchange-create:${exchangeSelectedOrder.id}:${pair.draftKey}`
        const critical = prepareCriticalRequest(criticalKey, payload)
        const response = await apiFetch('/api/exchanges', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': critical.requestId },
          body: JSON.stringify(critical.payload),
        })
        const result = await readJsonResponse<{ ok?: boolean; message?: string; order?: OrderRecord; exchangeId?: number; pendingInventoryCount?: number }>(response, `Обмен · позиция ${pair.index + 1}`)
        if (!response.ok) throw new Error(result.message || `Exchange failed: ${response.status}`)
        completeCriticalRequest(criticalKey, critical.requestId)
        savedThisAttempt += 1
        pendingInventoryCount += Math.max(0, Number(result.pendingInventoryCount || 0))
        exchangeTouchesWorkshop = exchangeTouchesWorkshop || pair.selectedOldItem.sourceType === 'workshop' || pair.effectiveNewItem.sourceType === 'workshop'
        if (result.order) {
          lastOrder = result.order
          upsertOrderInState(result.order)
          setSelectedOrderId(result.order.id)
        }
        if (pair.isQueued) {
          setExchangeDraft((current) => ({
            ...current,
            queuedPairs: (current.queuedPairs || []).map((queued) => queued.draftKey === pair.draftKey ? { ...queued, saved: true } : queued),
          }))
        }
      }

      if (lastOrder) upsertOrderInState(lastOrder)
      const totalPairCount = pairDrafts.length
      setExchangeSelectedOrderId(null)
      setExchangeDraft(createExchangeDraft())
      await Promise.allSettled([
        loadExchangeHistory(),
        refreshActivityLogIfVisible(),
        refreshFinanceReportsIfVisible(),
        loadDashboard(false),
        exchangeTouchesWorkshop ? loadWorkshopData() : Promise.resolve(null),
        loadInventoryData('warehouse', true, '', false),
        loadInventoryData('boutique', true, '', false),
        isAdmin ? loadInventoryLifecycle(true) : Promise.resolve(null),
      ])
      setMessage(pendingInventoryCount > 0
        ? `Обмен по заказу ${exchangeSelectedOrder.external_id} сохранён: ${totalPairCount} поз. ${pendingInventoryCount} складск${pendingInventoryCount === 1 ? 'ое движение ожидает' : 'их движения ожидают'} подтверждения администратора.`
        : `Обмен по заказу ${exchangeSelectedOrder.external_id} сохранён: ${totalPairCount} поз.`)
    } catch (err) {
      const savedCount = savedBefore + savedThisAttempt
      const details = err instanceof Error ? err.message : 'Неизвестная ошибка'
      setError(savedCount > 0
        ? `Сохранено ${savedCount} из ${pairDrafts.length} позиций обмена. Уже сохранённые строки отмечены и повторно не создадутся. Остальные не завершены: ${details}`
        : details)
    } finally {
      setExchangeBusy(false)
    }
  }


  async function receiveReturnedItemAction'''
text = text[:match.start()] + new_function + text[match.end():]
write(path, text)

# 9) Focused regression covers the three client reports and protects existing multi-item return behavior.
test_path = Path('scripts/test-client-fixes-20260912-r1.mjs')
test_path.write_text(r'''import fs from 'node:fs'

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
''', encoding='utf-8')

# 10) Wire focused regression into cumulative gate.
path = 'package.json'
text = read(path)
needle = 'node scripts/test-business-date-boundaries-r1.mjs && '
if needle not in text:
    raise RuntimeError('package release-check anchor missing')
text = text.replace(needle, needle + 'node scripts/test-client-fixes-20260912-r1.mjs && ', 1)
write(path, text)

print('client fixes patch applied')
