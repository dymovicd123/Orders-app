// @ts-nocheck -- extracted view renderer; controller remains typed in App.tsx.

type RendererContext = Record<string, any>

export function FinanceDashboardRenderer(ctx: RendererContext) {
  const {
    cashMovementDraft,
    cashRegister,
    cashRegisterBusy,
    cashRegisterCycles,
    cashRegisterCyclesBusy,
    cashRegisterCyclesHasMore,
    cashRegisterCyclesOpen,
    cashSetupAmount,
    cashReconcileAmount,
    cashReconcileComment,
    activateCashRegister,
    financeMethodDraft,
    financeMethodsBusy,
    financeMode,
    financePaymentMethods,
    financeReport,
    financeReportBusy,
    moneyHistory,
    moneyHistoryBusy,
    moneyHistoryError,
    moneyHistoryHasMore,
    moneyHistoryQuery,
    moneyHistorySummary,
    moneyHistoryType,
    loadMoneyHistory,
    setMoneyHistoryQuery,
    setMoneyHistoryType,
    formatDateShort,
    formatMoney,
    formatPercent,
    FriendlyNumberInput,
    isAdmin,
    loadCashRegister,
    loadCashRegisterCycles,
    loadFinancePaymentMethods,
    reloadFinanceReports,
    ManagerBadge,
    managerColorFor,
    normalizeSuggestion,
    openOrderFromFinance,
    removeFinancePaymentMethod,
    saveCashRegisterMovement,
    reconcileCashRegister,
    reverseCashRegisterMovement,
    resetCashRegisterCycle,
    saveFinancePaymentMethod,
    setCashMovementDraft,
    setCashRegisterCyclesOpen,
    setCashSetupAmount,
    setCashReconcileAmount,
    setCashReconcileComment,
    setupCashRegister,
    setCashAutoTracking,
    setFinanceMethodDraft,
    setFinanceMode,
  } = ctx

  const financeTabs: Array<{ id: typeof financeMode; label: string; hint: string }> = [
    { id: 'summary', label: 'Сводка', hint: 'Чёткие итоги' },
    { id: 'payments', label: 'Денежный журнал', hint: 'История денег' },
    { id: 'debts', label: 'Долги', hint: 'Текущие и закрытые' },
    { id: 'returns', label: 'Возвраты / обмены', hint: 'По дате операции' },
    { id: 'cash', label: 'Инкассация', hint: 'Наличные в офисе' },
    { id: 'methods', label: 'Способы оплаты', hint: 'Справочник оплат' },
  ]

  const financeTabsNode = (
    <div className="order-panel-tabs finance-tabs" role="tablist" aria-label="Разделы финансов">
      {financeTabs.map((tab) => (
        <button key={`finance-tab-${tab.id}`} className={`secondary compact ${financeMode === tab.id ? 'is-active' : ''}`} type="button" onClick={() => setFinanceMode(tab.id)}>
          <strong>{tab.label}</strong>
          <span>{tab.hint}</span>
        </button>
      ))}
    </div>
  )

  if (financeMode === 'cash') {
    const entryTypeLabel = (entryType: string) => ({
      opening: 'Начальный остаток',
      ledger_reset: 'Новый цикл учёта',
      payment_primary: 'Оплата заказа',
      payment_debt: 'Закрытие долга',
      payment_extra: 'Закрытие долга (старый тип)',
      exchange_extra: 'Доплата по обмену',
      order_refund: 'Возврат клиенту',
      exchange_refund: 'Возврат по обмену',
      payment_reversal: 'Отмена оплаты',
      return_reversal: 'Отмена возврата',
      order_cancel_payment: 'Удаление заказа',
      manual_in: 'Ручное внесение',
      manual_out: 'Выдача / инкассация',
      manual_reversal: 'Отмена ручной операции',
      balance_adjustment_in: 'Сверка остатка',
      balance_adjustment_out: 'Сверка остатка',
    } as Record<string, string>)[entryType] || entryType || 'Движение'

    return (
      <div className="finance-tabs-shell finance-truth-shell">
        {financeTabsNode}
        <div className="finance-tab-content cash-register-content cash-register-v2">
          {cashRegisterBusy && !cashRegister ? (
            <div className="empty-state">Загружаю кассу…</div>
          ) : !cashRegister ? (
            <div className="cash-register-retry">
              <span>Касса ещё не загружена.</span>
              <button className="secondary compact" type="button" onClick={() => void loadCashRegister()}>Повторить</button>
            </div>
          ) : !cashRegister.initialized ? (
            <section className="cash-register-setup-card cash-register-setup-card-v2">
              <div className="cash-register-setup-header">
                <div>
                  <span className="inventory-step-badge">Первичная настройка</span>
                  <h3>Укажите текущий остаток наличных в кассе</h3>
                  <p>Пересчитайте деньги в офисе и введите фактическую сумму. После этого автоучёт включается отдельно.</p>
                </div>
              </div>
              <div className="cash-register-setup-grid">
                <div className="cash-register-setup-form cash-register-setup-form-v2">
                  <label className="cash-register-amount-field">
                    <span>Фактический остаток</span>
                    <div className="cash-register-amount-input-wrap">
                      <FriendlyNumberInput type="number" min="0" value={cashSetupAmount || ''} onChange={(event) => setCashSetupAmount(Math.max(0, Number(event.target.value || 0)))} placeholder="0" />
                      <span>₸</span>
                    </div>
                  </label>
                  <button className="primary cash-register-setup-submit" type="button" disabled={cashRegisterBusy} onClick={() => void setupCashRegister()}>{cashRegisterBusy ? 'Сохраняю…' : 'Зафиксировать остаток'}</button>
                </div>
                <div className="cash-register-start-note"><strong>Перед включением автоучёта:</strong> внесите накопившиеся старые заказы, пересчитайте наличные и только потом зафиксируйте фактический остаток.</div>
              </div>
            </section>
          ) : (
            <>
              <div className="cash-register-status-line cash-register-status-v2">
                <div>
                  <span className="card-label">Инкассация</span>
                  <h3>Касса офиса</h3>
                  <p>Текущий остаток и все движения наличных. Журнал не переписывается задним числом.</p>
                </div>
                <div className={`cash-auto-status ${cashRegister.autoTrackingEnabled ? 'is-enabled' : 'is-paused'}`}>
                  <strong>{cashRegister.autoTrackingEnabled ? 'Автоучёт включён' : 'Автоучёт остановлен'}</strong>
                  <span>{cashRegister.autoTrackingEnabled ? 'Новые наличные оплаты и возвраты учитываются автоматически.' : 'Автоматические движения приостановлены. Ручные операции, сверка и журнал продолжают работать.'}</span>
                  <button className={cashRegister.autoTrackingEnabled ? 'secondary compact danger-outline' : 'primary compact'} type="button" disabled={cashRegisterBusy} onClick={() => void setCashAutoTracking(!cashRegister.autoTrackingEnabled)}>
                    {cashRegister.autoTrackingEnabled ? 'Остановить автоучёт' : 'Включить автоучёт'}
                  </button>
                </div>
              </div>

              <div className="summary-grid cash-register-summary cash-register-summary-v2">
                <div className={`summary-card cash-balance-card ${cashRegister.currentBalance < 0 ? 'danger-card' : ''}`}><span>Сейчас в кассе</span><strong>{formatMoney(cashRegister.currentBalance)}</strong></div>
                <div className="summary-card"><span>Сегодня пришло</span><strong>+ {formatMoney(cashRegister.todayIn)}</strong></div>
                <div className="summary-card"><span>Сегодня ушло</span><strong>− {formatMoney(cashRegister.todayOut)}</strong></div>
                <div className="summary-card"><span>За текущий цикл пришло</span><strong>{formatMoney(cashRegister.totalIn)}</strong></div>
                <div className="summary-card"><span>За текущий цикл ушло</span><strong>{formatMoney(cashRegister.totalOut)}</strong></div>
              </div>

              <div className="cash-register-tools-grid">
                <section className="mini-panel cash-manual-movement-panel">
                  <div className="mini-panel-head"><div><h3>Ручная операция</h3><p className="mini-panel-note">Комментарий обязателен.</p></div></div>
                  <div className="cash-manual-form cash-manual-form-v2">
                    <div className="cash-direction-switch" role="group" aria-label="Направление движения наличных">
                      <button className={`secondary ${cashMovementDraft.direction === 'out' ? 'is-active' : ''}`} type="button" disabled={cashRegisterBusy} onClick={() => setCashMovementDraft((current) => ({ ...current, direction: 'out' }))}>Выдать / забрали</button>
                      <button className={`secondary ${cashMovementDraft.direction === 'in' ? 'is-active' : ''}`} type="button" disabled={cashRegisterBusy} onClick={() => setCashMovementDraft((current) => ({ ...current, direction: 'in' }))}>Внести</button>
                    </div>
                    <label><span>Сумма</span><FriendlyNumberInput type="number" min="0" value={cashMovementDraft.amount || ''} onChange={(event) => setCashMovementDraft((current) => ({ ...current, amount: Math.max(0, Number(event.target.value || 0)) }))} /></label>
                    <label className="wide-field"><span>Комментарий</span><input value={cashMovementDraft.comment} onChange={(event) => setCashMovementDraft((current) => ({ ...current, comment: event.target.value }))} /></label>
                    <button className="primary" type="button" disabled={cashRegisterBusy || !cashMovementDraft.comment.trim() || Number(cashMovementDraft.amount || 0) <= 0} onClick={() => void saveCashRegisterMovement()}>{cashRegisterBusy ? 'Сохраняю…' : cashMovementDraft.direction === 'out' ? 'Записать выдачу' : 'Записать внесение'}</button>
                  </div>
                </section>

                <section className="mini-panel cash-reconcile-panel">
                  <div className="mini-panel-head"><div><h3>Сверка фактического остатка</h3><p className="mini-panel-note">Если пересчёт не совпал с системой, укажите реальную сумму. В журнал попадёт только разница.</p></div></div>
                  <div className="cash-reconcile-form">
                    <label><span>Фактически в кассе</span><FriendlyNumberInput type="number" min="0" value={cashReconcileAmount || ''} onChange={(event) => setCashReconcileAmount(Math.max(0, Number(event.target.value || 0)))} /></label>
                    <label><span>Причина корректировки</span><input value={cashReconcileComment} onChange={(event) => setCashReconcileComment(event.target.value)} placeholder="Например: пересчёт кассы за 12.08" /></label>
                    <button className="secondary" type="button" disabled={cashRegisterBusy || !cashReconcileComment.trim()} onClick={() => void reconcileCashRegister()}>Скорректировать остаток</button>
                  </div>
                </section>
              </div>

              {cashRegister.archivedEntriesCount ? (
                <section className="mini-panel cash-register-cycles-panel">
                  <div className="mini-panel-head">
                    <div><h3>Прошлые циклы</h3><p className="mini-panel-note">Старый журнал не пропал. Здесь показаны закрытые циклы кратко, без смешивания с текущей кассой.</p></div>
                    <button className="secondary compact" type="button" disabled={cashRegisterCyclesBusy} onClick={() => {
                      const next = !cashRegisterCyclesOpen
                      setCashRegisterCyclesOpen(next)
                      if (next && !cashRegisterCycles.length) void loadCashRegisterCycles()
                    }}>{cashRegisterCyclesOpen ? 'Скрыть' : 'Показать прошлые циклы'}</button>
                  </div>
                  {cashRegisterCyclesOpen ? (
                    cashRegisterCyclesBusy && !cashRegisterCycles.length ? <div className="history-load-state"><strong>Загружаю прошлые циклы…</strong></div>
                    : cashRegisterCycles.length ? <div className="cash-cycle-list">{cashRegisterCycles.map((cycle: any) => (
                      <article className="cash-cycle-card" key={`cash-cycle-${cycle.id}`}>
                        <div><strong>{cycle.startedAt ? `${formatDateShort(String(cycle.startedAt).slice(0, 10))} — ` : ''}{formatDateShort(String(cycle.closedAt || '').slice(0, 10))}</strong><span>{cycle.entryCount} записей</span></div>
                        <div><span>Пришло</span><strong>+ {formatMoney(cycle.totalIn)}</strong></div>
                        <div><span>Ушло</span><strong>− {formatMoney(cycle.totalOut)}</strong></div>
                        <div><span>Остаток перед закрытием</span><strong>{formatMoney(cycle.closingBalance)}</strong></div>
                        <div className="cash-cycle-comment"><span>{cycle.closedBy || 'Администратор'}</span><strong>{cycle.closeComment || 'Новый цикл'}</strong></div>
                      </article>
                    ))}
                      {cashRegisterCyclesHasMore ? (
                        <div className="clients-stream-footer">
                          <span>Загружено {cashRegisterCycles.length} циклов</span>
                          <button className="secondary compact" type="button" disabled={cashRegisterCyclesBusy} onClick={() => void loadCashRegisterCycles(true)}>{cashRegisterCyclesBusy ? 'Загрузка...' : 'Показать ещё'}</button>
                        </div>
                      ) : null}
                    </div>
                    : <div className="history-load-state"><strong>Прошлых циклов пока нет.</strong></div>
                  ) : null}
                </section>
              ) : null}

              <section className="mini-panel cash-register-ledger-panel">
                <div className="mini-panel-head">
                  <div><h3>Журнал наличных</h3><p className="mini-panel-note">Ошибочную ручную операцию лучше отменять кнопкой «Отменить», а не создавать встречное внесение вручную.</p></div>
                  <div className="cash-ledger-actions">
                    <button className="secondary compact" type="button" disabled={cashRegisterBusy} onClick={() => void loadCashRegister()}>Обновить</button>
                    {isAdmin ? <button className="secondary compact danger-outline" type="button" disabled={cashRegisterBusy} onClick={() => void resetCashRegisterCycle()}>Начать новый цикл с 0 ₸</button> : null}
                  </div>
                </div>
                <div className="table-shell">
                  <table className="data-table cash-register-ledger">
                    <thead><tr><th>Дата</th><th>Операция</th><th>Заказ / источник</th><th>Комментарий</th><th className="num">Приход</th><th className="num">Расход</th><th className="num">Остаток</th><th>Действия</th></tr></thead>
                    <tbody>
                      {cashRegister.entries.length ? cashRegister.entries.map((entry) => (
                        <tr key={`cash-entry-${entry.id}`} className={entry.direction === 'out' ? 'is-out' : 'is-in'}>
                          <td><strong>{formatDateShort(entry.businessDate)}</strong></td>
                          <td><strong>{entryTypeLabel(entry.entryType)}</strong><span className="cash-entry-meta">{entry.paymentMethod || entry.createdBy || '—'}</span></td>
                          <td>{entry.externalOrderId ? <strong>{entry.externalOrderId}</strong> : entry.sourceType === 'manual' ? 'Ручная операция' : entry.entryType === 'ledger_reset' ? 'Новый цикл' : entry.sourceType === 'opening' ? 'Начальная точка' : '—'}</td>
                          <td>{entry.comment || '—'}</td>
                          <td className="num cash-in">{entry.direction === 'in' ? `+ ${formatMoney(entry.amount)}` : '—'}</td>
                          <td className="num cash-out">{entry.direction === 'out' ? `− ${formatMoney(entry.amount)}` : '—'}</td>
                          <td className="num"><strong>{formatMoney(entry.balanceAfter)}</strong></td>
                          <td>{entry.reversible ? <button className="secondary compact danger-outline" type="button" disabled={cashRegisterBusy} onClick={() => void reverseCashRegisterMovement(entry.id)}>Отменить</button> : entry.reversed ? <span className="cash-entry-meta">Отменено</span> : '—'}</td>
                        </tr>
                      )) : <tr><td colSpan={8} className="empty-state">Журнал пока пуст.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}
        </div>
      </div>
    )
  }

  if (!financeReport) {
    return (
      <div className="finance-tabs-shell finance-truth-shell">
        {financeTabsNode}
        <div className="finance-tab-content finance-report-loading-state">
          <div className="empty-state">
            <strong>{financeReportBusy ? 'Загружаю финансовую сводку…' : 'Финансовая сводка пока не загрузилась.'}</strong>
            <span>{financeReportBusy ? 'Данные появятся здесь после загрузки.' : 'Разделы финансов не скрыты. Можно повторить загрузку без обновления всей страницы.'}</span>
            {!financeReportBusy ? <button className="secondary compact" type="button" onClick={() => void reloadFinanceReports()}>Повторить загрузку</button> : null}
          </div>
        </div>
      </div>
    )
  }

  const activeReturns = financeReport.reports.returns.filter((row) => row.status !== 'cancelled')
  const activeExchanges = financeReport.reports.exchanges.filter((row) => row.status !== 'cancelled')
  const closedDebtTotal = financeReport.reports.closedDebts.reduce((sum, row) => sum + Number(row.amount || 0), 0)
  const paymentOperations = financeReport.reports.paymentOperations || []
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
  const formatFinanceDateTime = (value: unknown) => {
    const text = String(value || '').trim()
    if (!text) return '—'
    const date = new Date(text)
    return Number.isNaN(date.getTime()) ? text : date.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  }
  const openMoneyHistoryForOrder = (row: any) => {
    const externalId = String(row?.externalId || row?.externalOrderId || '').trim()
    if (!externalId) return
    setMoneyHistoryQuery(externalId)
    setMoneyHistoryType({ flow: 'all', operation: 'all', trace: 'all' })
    setFinanceMode('payments')
  }
  const visibleMoneyHistoryTrace = historicalPeriodSelected
    ? moneyHistoryType.trace
    : moneyHistoryType.trace === 'legacy' ? 'all' : moneyHistoryType.trace
  const consistency = financeReport.reports.consistency || {
    ledgerTotal: financeReport.overview.totalReceived || 0,
    methodsTotal: financeReport.overview.totalReceived || 0,
    kindsTotal: financeReport.overview.totalReceived || 0,
    difference: 0,
    ok: true,
  }
  const paymentTotal = Number(financeReport.overview.grossReceived ?? financeReport.overview.totalReceived ?? 0)
  const orderPaymentsTotal = Number(financeReport.overview.orderPaymentsTotal || 0)
  const debtPaymentsTotal = Number(financeReport.overview.debtPaymentsTotal || closedDebtTotal)
  const exchangeExtraPaymentsTotal = Number(financeReport.overview.exchangeExtraPaymentsTotal || 0)
  const regularReturnsTotal = Number(financeReport.overview.regularReturnsTotal ?? financeReport.overview.totalReturns ?? 0)
  const exchangeRefundsTotal = Number(financeReport.overview.exchangeRefundsTotal || 0)
  const totalReturned = Number(financeReport.overview.totalReturned ?? financeReport.overview.totalReturns ?? 0)
  const netCash = paymentTotal - totalReturned
  const paymentMethodsByDay = financeReport.reports.paymentMethodsByDay || []
  const paymentMethodNames = financeReport.reports.paymentMethods.map((row) => row.method || '—')
  const refundExchangeTotal = activeExchanges
    .filter((row) => row.financial_action === 'refund')
    .reduce((sum, row) => sum + Number(row.financial_amount || 0), 0)
  const extraExchangeTotal = activeExchanges
    .filter((row) => row.financial_action === 'extra_payment')
    .reduce((sum, row) => sum + Number(row.financial_amount || 0), 0)

  const cashDayMap = new Map<string, any>()
  const ensureCashDay = (date: string) => {
    if (!cashDayMap.has(date)) cashDayMap.set(date, {
      date,
      orderCount: 0,
      sales: 0,
      orderPayments: 0,
      debtPayments: 0,
      exchangeExtras: 0,
      received: 0,
      regularReturns: 0,
      exchangeRefunds: 0,
      returned: 0,
      net: 0,
      reviewCount: 0,
      infoCount: 0,
    })
    return cashDayMap.get(date)
  }
  ;(financeReport.reports.days || []).forEach((row) => {
    const bucket = ensureCashDay(row.date)
    bucket.orderCount = Number(row.order_count || 0)
    bucket.sales = Number(row.total_sales || 0)
  })
  paymentOperations.forEach((row) => {
    const bucket = ensureCashDay(row.paymentDate)
    if (row.operationType === 'debt_close' || row.operationType === 'order_extra') bucket.debtPayments += Number(row.amount || 0)
    else if (row.operationType === 'exchange_extra') bucket.exchangeExtras += Number(row.amount || 0)
    else bucket.orderPayments += Number(row.amount || 0)
    bucket.received += Number(row.amount || 0)
    if (row.traceSeverity === 'review') bucket.reviewCount += 1
    else if (row.traceSeverity === 'info' && visibleTraceInfoIds.has(Number(row.id || 0))) bucket.infoCount += 1
  })
  activeReturns.forEach((row) => {
    const bucket = ensureCashDay(row.return_date)
    if (row.return_type === 'exchange_refund' || row.returnType === 'exchange_refund') bucket.exchangeRefunds += Number(row.amount || 0)
    else bucket.regularReturns += Number(row.amount || 0)
    bucket.returned += Number(row.amount || 0)
  })
  const cashDays = Array.from(cashDayMap.values())
    .map((row) => ({ ...row, net: row.received - row.returned }))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))

  return (
    <div className="finance-tabs-shell finance-truth-shell">
      {financeTabsNode}

      {financeMode === 'summary' ? (
        <div className="finance-truth-content">
          <section className="mini-panel finance-overview-panel finance-truth-overview">
            <div className="mini-panel-head">
              <div>
                <h3>Финансовая сводка без смешивания дат</h3>
                <p className="mini-panel-note">Продажи считаются по дате заказа. Деньги — только по фактической дате оплаты или возврата.</p>
              </div>
              <span className="status-pill status-online">{formatDateShort(financeReport.startDate)} — {formatDateShort(financeReport.endDate)}</span>
            </div>

            <div className="finance-truth-grid">
              <article className="finance-truth-card is-sales">
                <div className="finance-truth-card-head"><span>Продажи</span><small>по дате заказа</small></div>
                <div className="finance-truth-main">{formatMoney(financeReport.overview.totalSales)}</div>
                <div className="finance-truth-lines">
                  <div><span>Заказов</span><strong>{financeReport.overview.orderCount}</strong></div>
                  <div><span>Средний чек</span><strong>{formatMoney(financeReport.overview.avgCheck)}</strong></div>
                </div>
              </article>

              <article className="finance-truth-card is-income">
                <div className="finance-truth-card-head"><span>Поступило</span><small>по дате оплаты</small></div>
                <div className="finance-truth-main">{formatMoney(paymentTotal)}</div>
                <div className="finance-truth-lines">
                  <div><span>Оплаты заказов</span><strong>{formatMoney(orderPaymentsTotal)}</strong></div>
                  <div><span>Закрытие долгов</span><strong>{formatMoney(debtPaymentsTotal)}</strong></div>
                  <div><span>Доплаты по обменам</span><strong>{formatMoney(exchangeExtraPaymentsTotal)}</strong></div>
                </div>
              </article>

              <article className="finance-truth-card is-outflow">
                <div className="finance-truth-card-head"><span>Вернули клиентам</span><small>по дате возврата</small></div>
                <div className="finance-truth-main">{formatMoney(totalReturned)}</div>
                <div className="finance-truth-lines">
                  <div><span>Обычные возвраты</span><strong>{formatMoney(regularReturnsTotal)}</strong></div>
                  <div><span>Возвраты при обменах</span><strong>{formatMoney(exchangeRefundsTotal)}</strong></div>
                </div>
              </article>

              <article className="finance-truth-card is-net">
                <div className="finance-truth-card-head"><span>Чистое движение</span><small>поступило минус возвращено</small></div>
                <div className="finance-truth-main">{formatMoney(netCash)}</div>
                <div className="finance-truth-lines">
                  <div><span>Открытый долг сейчас</span><strong>{formatMoney(financeReport.overview.currentDebt)}</strong></div>
                  <div><span>Заказов с долгом</span><strong>{financeReport.overview.currentDebtOrders}</strong></div>
                </div>
              </article>
            </div>
          </section>

          <section className={`finance-reconciliation finance-reconciliation-v2 ${consistency.ok ? 'is-ok' : 'is-error'}`}>
            <div className="finance-reconciliation-head">
              <div>
                <strong>Финансовая сверка</strong>
                <span>Поступления считаются по дате денежной операции. Внутренняя сверка проверяет, что один и тот же набор оплат одинаково складывается по видам операций и способам оплаты.</span>
              </div>
              <div className="finance-reconciliation-badges">
                <span className={`status-pill ${consistency.ok ? 'status-online' : 'status-offline'}`}>{consistency.ok ? 'Внутренняя сверка: без расхождений' : `Внутреннее расхождение: ${formatMoney(consistency.difference)}`}</span>
                {crossDatePaymentOperations.length ? <span className="soft-badge finance-info-badge">Заказы другой даты: {crossDatePaymentOperations.length} · {formatMoney(crossDatePaymentOperations.reduce((sum, row) => sum + Number(row.amount || 0), 0))}</span> : <span className="soft-badge">Заказов другой даты нет</span>}
                {paymentTraceReview.length ? <span className="soft-badge warning-soft">Требуют проверки: {paymentTraceReview.length}</span> : <span className="soft-badge">Ошибок дат не найдено</span>}
              </div>
            </div>
            <div className="finance-reconciliation-primary-total">
              <span>Поступило за период</span>
              <strong>{formatMoney(consistency.ledgerTotal)}</strong>
            </div>
            {!consistency.ok ? (
              <div className="finance-reconciliation-values finance-reconciliation-diagnostics">
                <span>По операциям: <strong>{formatMoney(consistency.ledgerTotal)}</strong></span>
                <span>По видам: <strong>{formatMoney(consistency.kindsTotal)}</strong></span>
                <span>По способам: <strong>{formatMoney(consistency.methodsTotal)}</strong></span>
              </div>
            ) : null}

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
                      <tr key={`finance-cross-date-${row.id}`}>
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

          {paymentTraceReview.length ? (
            <section className="mini-panel finance-review-panel has-review">
              <div className="mini-panel-head">
                <div>
                  <h3>Требуют проверки</h3>
                  <p className="mini-panel-note">Здесь только реальные несоответствия дат или происхождения оплаты. Для заказов выбранного периода система также ищет оплаты, которые ошибочно датированы ещё раньше и поэтому лежат за границей периода денежных операций.</p>
                </div>
                <span className="soft-badge warning-soft">Проверить: {paymentTraceReview.length}</span>
              </div>
              <div className="table-shell">
                <table className="data-table finance-anomaly-table">
                  <thead><tr><th>Дата оплаты</th><th>Дата заказа</th><th>Заказ</th><th>Заказ введён</th><th>Менеджер</th><th>Вид</th><th className="num">Сумма</th><th>Что означает</th><th>Действие</th></tr></thead>
                  <tbody>{paymentTraceReview.map((row) => (
                    <tr key={`finance-review-${row.id}`}>
                      <td><strong>{formatDateShort(row.paymentDate)}</strong></td>
                      <td>{formatDateShort(row.orderDate)}</td>
                      <td>{row.externalId}</td>
                      <td>{row.orderCreatedAt ? formatDateShort(String(row.orderCreatedAt).slice(0, 10)) : '—'}</td>
                      <td><ManagerBadge name={row.manager} colorKey={row.managerColor || managerColorFor(row.manager)} compact /></td>
                      <td>{row.operationLabel}</td>
                      <td className="num">{formatMoney(row.amount)}</td>
                      <td><strong>{row.traceTitle}</strong><div className="mini-panel-note">{row.traceExplanation}</div></td>
                      <td><div className="finance-row-actions"><button className="secondary compact finance-order-link" type="button" onClick={() => void openOrderFromFinance(row)}>К заказу</button><button className="secondary compact finance-money-link" type="button" onClick={() => openMoneyHistoryForOrder(row)}>Денежная история</button></div></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </section>
          ) : null}

          {visiblePaymentTraceInfo.length ? (
            <section className="mini-panel finance-review-panel is-info">
              <div className="mini-panel-head">
                <div>
                  <h3>Пояснения по датам</h3>
                  <p className="mini-panel-note">Это объяснимые различия дат, а не ошибки. Они нужны, чтобы можно было проследить происхождение суммы без тревожного статуса.</p>
                  {historicalPeriodSelected && visibleLegacyBaselineCount ? <p className="mini-panel-note">Вы выбрали старый период: {visibleLegacyBaselineCount} исторических записей показаны как baseline. Их текущее состояние известно, но первоначальное действие пользователя по ним не всегда можно доказать.</p> : null}
                </div>
                <span className="soft-badge finance-info-badge">Пояснений: {visiblePaymentTraceInfo.length}</span>
              </div>
              <div className="table-shell">
                <table className="data-table finance-anomaly-table">
                  <thead><tr><th>Дата оплаты</th><th>Дата заказа</th><th>Заказ</th><th>Заказ введён</th><th>Менеджер</th><th>Вид</th><th className="num">Сумма</th><th>Что означает</th><th>Действие</th></tr></thead>
                  <tbody>{visiblePaymentTraceInfo.map((row) => (
                    <tr key={`finance-info-${row.id}`}>
                      <td><strong>{formatDateShort(row.paymentDate)}</strong></td>
                      <td>{formatDateShort(row.orderDate)}</td>
                      <td>{row.externalId}</td>
                      <td>{row.orderCreatedAt ? formatDateShort(String(row.orderCreatedAt).slice(0, 10)) : '—'}</td>
                      <td><ManagerBadge name={row.manager} colorKey={row.managerColor || managerColorFor(row.manager)} compact /></td>
                      <td>{row.operationLabel}</td>
                      <td className="num">{formatMoney(row.amount)}</td>
                      <td><strong>{row.traceTitle}</strong><div className="mini-panel-note">{row.traceExplanation}</div></td>
                      <td><div className="finance-row-actions"><button className="secondary compact finance-order-link" type="button" onClick={() => void openOrderFromFinance(row)}>К заказу</button><button className="secondary compact finance-money-link" type="button" onClick={() => openMoneyHistoryForOrder(row)}>Денежная история</button></div></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </section>
          ) : null}

          {!paymentTraceReview.length && !visiblePaymentTraceInfo.length ? (
            <section className="finance-no-anomalies"><span className="status-pill">По датам без замечаний</span><span>В выбранном периоде не найдено операций, которые требуют проверки или отдельного пояснения.</span></section>
          ) : null}

          <section className="mini-panel finance-days-truth-panel">
            <div className="mini-panel-head">
              <div>
                <h3>Деньги по дням</h3>
                <p className="mini-panel-note">Каждая строка отвечает на вопрос: сколько реально поступило и сколько реально вернули в этот день.</p>
              </div>
            </div>
            <div className="table-shell">
              <table className="data-table finance-days-truth-table">
                <thead><tr><th>Дата</th><th className="num">Заказов<br /><small>по дате заказа</small></th><th className="num">Продажи<br /><small>по дате заказа</small></th><th className="num">Оплаты заказов<br /><small>по дате оплаты</small></th><th className="num">Закрытие долгов</th><th className="num">Доплаты обмена</th><th className="num">Всего поступило</th><th className="num">Возвращено</th><th className="num">Чистыми</th><th>Проверка дат</th></tr></thead>
                <tbody>
                  {cashDays.map((row) => <tr key={`finance-cash-day-${row.date}`}>
                    <td><strong>{formatDateShort(row.date)}</strong></td>
                    <td className="num">{row.orderCount}</td>
                    <td className="num">{formatMoney(row.sales)}</td>
                    <td className="num">{formatMoney(row.orderPayments)}</td>
                    <td className="num">{formatMoney(row.debtPayments)}</td>
                    <td className="num">{formatMoney(row.exchangeExtras)}</td>
                    <td className="num"><strong>{formatMoney(row.received)}</strong></td>
                    <td className="num">{formatMoney(row.returned)}</td>
                    <td className="num"><strong>{formatMoney(row.net)}</strong></td>
                    <td>{row.reviewCount ? <span className="soft-badge warning-soft">Проверить: {row.reviewCount}</span> : row.infoCount ? <span className="soft-badge">Пояснение: {row.infoCount}</span> : <span className="soft-badge">Без замечаний</span>}</td>
                  </tr>)}
                  {!cashDays.length ? <tr><td colSpan={10} className="empty-state">За выбранный период нет заказов и денежных операций.</td></tr> : null}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      ) : null}

      {financeMode === 'payments' ? (
        <div className="finance-payment-ledger finance-tab-content finance-truth-content">
          <div className="report-grid two-columns finance-payment-classification">
            <section className="report-block">
              <div className="strict-section-head"><h3>По видам операций</h3><span className="soft-badge">что именно принесло деньги</span></div>
              <div className="table-shell"><table className="data-table"><thead><tr><th>Вид операции</th><th className="num">Операций</th><th className="num">Сумма</th></tr></thead><tbody>
                {paymentKinds.map((row) => <tr key={`finance-kind-${row.operationType}`}><td>{row.label}</td><td className="num">{row.count}</td><td className="num"><strong>{formatMoney(row.total)}</strong></td></tr>)}
                <tr className="total-row"><td>ВСЕГО ПОСТУПИЛО</td><td className="num">{paymentOperations.length}</td><td className="num">{formatMoney(paymentTotal)}</td></tr>
              </tbody></table></div>
            </section>
            <section className="report-block">
              <div className="strict-section-head"><h3>По способам оплаты</h3><span className="soft-badge">куда поступили деньги</span></div>
              <div className="table-shell"><table className="data-table"><thead><tr><th>Способ оплаты</th><th className="num">Операций</th><th className="num">Сумма</th><th className="num">Доля</th></tr></thead><tbody>
                {financeReport.reports.paymentMethods.map((row) => <tr key={`finance-pay-${row.method}`}><td>{row.method || '—'}</td><td className="num">{row.count}</td><td className="num">{formatMoney(row.total)}</td><td className="num">{formatPercent(paymentTotal ? Number(row.total || 0) / paymentTotal : 0)}</td></tr>)}
                {!financeReport.reports.paymentMethods.length ? <tr><td colSpan={4} className="empty-state">Оплат за выбранный период нет.</td></tr> : null}
                {financeReport.reports.paymentMethods.length ? <tr className="total-row"><td>ИТОГО</td><td className="num">{paymentOperations.length}</td><td className="num">{formatMoney(paymentTotal)}</td><td className="num">100%</td></tr> : null}
              </tbody></table></div>
            </section>
          </div>

          <section className="report-block finance-money-history-block">
            <div className="strict-section-head finance-money-history-head">
              <div>
                <h3>История денег</h3>
                <p className="mini-panel-note">Здесь видно, как менялись деньги в системе. Оплата, возврат и последующее исправление остаются отдельными строками.</p>
              </div>
              <div className="finance-money-history-summary">
                <span className="money-summary"><span>Записей</span><strong>{moneyHistorySummary.count}</strong></span>
                <span className="money-summary"><span>Итог изменений</span><strong>{moneyHistorySummary.net >= 0 ? '+ ' : '− '}{formatMoney(Math.abs(moneyHistorySummary.net))}</strong></span>
              </div>
            </div>

            <div className="finance-money-history-filters finance-money-history-filters-f4">
              <label className="finance-money-search"><span>Найти операцию</span><input value={moneyHistoryQuery} onChange={(event) => setMoneyHistoryQuery(event.target.value)} placeholder="Номер заказа, способ оплаты или комментарий" /></label>
              <label><span>Движение</span><select value={moneyHistoryType.flow} onChange={(event) => setMoneyHistoryType((current) => ({ ...current, flow: event.target.value }))}>
                <option value="all">Все</option>
                <option value="in">Поступления</option>
                <option value="out">Списания и возвраты</option>
              </select></label>
              <label><span>Вид операции</span><select value={moneyHistoryType.operation} onChange={(event) => setMoneyHistoryType((current) => ({ ...current, operation: event.target.value }))}>
                <option value="all">Все виды</option>
                <option value="order_payment">Оплата заказа</option>
                <option value="debt_close">Закрытие долга</option>
                <option value="exchange_extra">Доплата по обмену</option>
                <option value="refund">Возвраты</option>
                <option value="correction">Исправления и отмены</option>
              </select></label>
              <label><span>Проверка</span><select value={visibleMoneyHistoryTrace} onChange={(event) => setMoneyHistoryType((current) => ({ ...current, trace: event.target.value }))}>
                <option value="all">Все состояния</option>
                <option value="normal">Обычные операции</option>
                <option value="info">С пояснением</option>
                <option value="review">Нужно проверить</option>
                <option value="legacy" disabled={!historicalPeriodSelected}>Исторический baseline{historicalPeriodSelected ? '' : ' — выберите старый период'}</option>
              </select></label>
            </div>
            {historicalPeriodSelected ? <div className="finance-history-scope-note">Выбран старый период. Исторические baseline-записи разрешены и помечаются отдельно; их первоначальный пользовательский ввод может быть недоказуем.</div> : null}

            {moneyHistoryBusy && !moneyHistory.length ? <div className="finance-money-history-state"><strong>Загружаю историю денег…</strong></div>
            : moneyHistoryError && !moneyHistory.length ? <div className="finance-money-history-state"><strong>Не удалось загрузить историю денег.</strong><span>{moneyHistoryError}</span><button className="secondary compact" type="button" onClick={() => void loadMoneyHistory()}>Повторить</button></div>
            : moneyHistory.length ? <div className="finance-money-history-list">{moneyHistory.map((row) => (
              <article className={`finance-money-history-row finance-money-history-row-f4 trace-${row.traceSeverity || 'normal'}`} key={`money-history-${row.id}`}>
                <div className="finance-money-history-date">
                  <strong>{formatDateShort(row.eventDate)}</strong>
                  <small>Операция записана: {formatFinanceDateTime(row.eventAt)}</small>
                </div>
                <div className="finance-money-history-order">
                  <strong>{row.externalOrderId || 'Без номера заказа'}</strong>
                  {row.orderDate ? <small>Дата заказа: {formatDateShort(row.orderDate)}</small> : <small>Подробная карточка заказа недоступна</small>}
                  {row.orderCreatedAt ? <small>Заказ введён: {formatFinanceDateTime(row.orderCreatedAt)}</small> : null}
                  {row.manager ? <ManagerBadge name={row.manager} colorKey={row.managerColor || managerColorFor(row.manager)} compact /> : null}
                </div>
                <div className="finance-money-history-operation">
                  <strong>{row.operationLabel}</strong>
                  <span className={`soft-badge ${row.traceSeverity === 'review' ? 'warning-soft' : ''}`}>{row.traceSeverity === 'review' ? 'Нужно проверить' : row.traceCode === 'legacy_baseline' ? 'Историческая запись' : row.traceSeverity === 'info' ? 'Пояснение' : 'Обычная операция'}</span>
                  {row.traceTitle ? <span className="finance-money-history-trace-title">{row.traceTitle}</span> : null}
                  {row.traceExplanation ? <span className="finance-money-history-note">{row.traceExplanation}</span> : null}
                  {row.comment ? <span className="finance-money-history-note">Комментарий: {row.comment}</span> : null}
                </div>
                <div className="finance-money-history-method">{row.paymentMethod || 'Способ не указан'}</div>
                <div className={`finance-money-history-amount ${row.amountDelta >= 0 ? 'is-in' : 'is-out'}`}>{row.amountDelta >= 0 ? '+ ' : '− '}{formatMoney(Math.abs(row.amountDelta))}</div>
                <div className="finance-money-history-actions">
                  {row.orderId || row.externalOrderId ? <button className="secondary compact finance-order-link" type="button" onClick={() => void openOrderFromFinance({ orderId: row.orderId || undefined, externalId: row.externalOrderId, orderDate: row.orderDate || undefined })}>К заказу</button> : null}
                </div>
              </article>
            ))}</div>
            : <div className="finance-money-history-state"><strong>За выбранный период денежных операций нет.</strong></div>}

            {moneyHistoryError && moneyHistory.length ? <div className="finance-money-history-state"><strong>Не удалось загрузить продолжение истории.</strong><button className="secondary compact" type="button" onClick={() => void loadMoneyHistory({ append: true })}>Повторить</button></div> : null}
            {moneyHistoryHasMore ? <div className="finance-money-history-more"><button className="secondary compact" type="button" disabled={moneyHistoryBusy} onClick={() => void loadMoneyHistory({ append: true })}>{moneyHistoryBusy ? 'Загружаю…' : 'Показать ещё'}</button></div> : null}
          </section>

          <section className="report-block finance-payment-days-table">
            <div className="strict-section-head"><h3>По способам оплаты и дням</h3><span className="soft-badge">контроль банковских и кассовых итогов</span></div>
            <div className="table-shell"><table className="data-table finance-ledger-table finance-ledger-days"><thead><tr><th>Дата оплаты</th>{paymentMethodNames.map((method) => <th className="num" key={`finance-method-head-${method}`}>{method}</th>)}<th className="num">Итого</th></tr></thead><tbody>
              {paymentMethodsByDay.map((row) => <tr key={`finance-pay-day-${row.date}`}><td>{formatDateShort(row.date)}</td>{paymentMethodNames.map((method) => <td className="num" key={`finance-pay-day-${row.date}-${method}`}>{formatMoney(row.methods?.[method] || 0)}</td>)}<td className="num"><strong>{formatMoney(row.total)}</strong></td></tr>)}
              {!paymentMethodsByDay.length ? <tr><td colSpan={paymentMethodNames.length + 2} className="empty-state">Оплат за выбранный период нет.</td></tr> : null}
            </tbody></table></div>
          </section>
        </div>
      ) : null}

      {financeMode === 'debts' ? (
        <div className="report-grid two-columns finance-tab-content">
          <section className="report-block">
            <h3>Открытые долги сейчас</h3>
            <p className="muted-note">Закрытие долга остаётся во вкладке «Заказы». Здесь только контроль.</p>
            <div className="summary-grid compact-summary">
              <div className="summary-card warning-card"><span>Общий долг</span><strong>{formatMoney(financeReport.overview.currentDebt)}</strong></div>
              <div className="summary-card"><span>Заказов с долгом</span><strong>{financeReport.overview.currentDebtOrders}</strong></div>
              <div className="summary-card"><span>Закрыто за период</span><strong>{formatMoney(debtPaymentsTotal)}</strong></div>
            </div>
            <div className="table-shell"><table className="data-table"><thead><tr><th>Заказ</th><th>Клиент</th><th>Дата</th><th>Долг</th></tr></thead><tbody>
              {financeReport.reports.currentDebtTop.map((row) => <tr key={`finance-debt-${row.id}`}><td>{row.external_id}</td><td>{row.customer || '—'}</td><td>{formatDateShort(row.order_date)}</td><td>{formatMoney(row.debt_amount)}</td></tr>)}
              {!financeReport.reports.currentDebtTop.length ? <tr><td colSpan={4} className="empty-state">Открытых долгов нет.</td></tr> : null}
            </tbody></table></div>
          </section>
          <section className="report-block">
            <h3>Закрытия долгов за период</h3>
            <div className="table-shell"><table className="data-table"><thead><tr><th>Дата заказа</th><th>Заказ</th><th>Дата оплаты</th><th>Способ</th><th>Сумма</th></tr></thead><tbody>
              {financeReport.reports.closedDebts.map((row) => <tr key={`finance-closed-${row.id}`}><td>{formatDateShort(row.order_date)}</td><td>{row.external_id}</td><td>{formatDateShort(row.payment_date)}</td><td>{row.method}</td><td>{formatMoney(row.amount)}</td></tr>)}
              {!financeReport.reports.closedDebts.length ? <tr><td colSpan={5} className="empty-state">За выбранный период закрытий долга нет.</td></tr> : null}
            </tbody></table></div>
          </section>
        </div>
      ) : null}

      {financeMode === 'returns' ? (
        <div className="report-grid two-columns finance-tab-content">
          <section className="report-block">
            <h3>Возвраты за период</h3>
            <div className="summary-grid compact-summary"><div className="summary-card danger-card"><span>Возвратов</span><strong>{activeReturns.length}</strong></div><div className="summary-card danger-card"><span>Сумма</span><strong>{formatMoney(totalReturned)}</strong></div></div>
            <div className="table-shell"><table className="data-table"><thead><tr><th>Дата заказа</th><th>Заказ</th><th>Дата возврата</th><th>Менеджер</th><th>Вид</th><th>Сумма</th></tr></thead><tbody>
              {financeReport.reports.returns.map((row) => <tr key={`finance-return-${row.id}`}><td>{formatDateShort(row.order_date)}</td><td>{row.external_id}</td><td>{formatDateShort(row.return_date)}</td><td><ManagerBadge name={row.manager || '—'} colorKey={row.manager_color || managerColorFor(row.manager)} compact /></td><td>{row.return_type === 'exchange_refund' ? 'Возврат при обмене' : 'Обычный возврат'}</td><td>{formatMoney(row.amount)}</td></tr>)}
              {!financeReport.reports.returns.length ? <tr><td colSpan={6} className="empty-state">За выбранный период возвратов нет.</td></tr> : null}
            </tbody></table></div>
          </section>
          <section className="report-block">
            <h3>Обмены за период</h3>
            <div className="summary-grid compact-summary"><div className="summary-card"><span>Обменов</span><strong>{activeExchanges.length}</strong></div><div className="summary-card"><span>Доплаты</span><strong>{formatMoney(extraExchangeTotal)}</strong></div><div className="summary-card danger-card"><span>Возврат по обменам</span><strong>{formatMoney(refundExchangeTotal)}</strong></div></div>
            <div className="table-shell"><table className="data-table"><thead><tr><th>Дата заказа</th><th>Заказ</th><th>Дата обмена</th><th>Действие</th><th>Сумма</th></tr></thead><tbody>
              {financeReport.reports.exchanges.map((row) => <tr key={`finance-exchange-${row.id}`}><td>{formatDateShort(row.order_date)}</td><td>{row.external_id}</td><td>{formatDateShort(row.exchange_date)}</td><td>{row.financial_action === 'extra_payment' ? 'Доплата' : row.financial_action === 'refund' ? 'Возврат' : 'Без денег'}</td><td>{row.financial_action === 'extra_payment' ? `+${formatMoney(row.financial_amount)}` : row.financial_action === 'refund' ? `-${formatMoney(row.financial_amount)}` : '—'}</td></tr>)}
              {!financeReport.reports.exchanges.length ? <tr><td colSpan={5} className="empty-state">За выбранный период обменов нет.</td></tr> : null}
            </tbody></table></div>
          </section>
        </div>
      ) : null}

      {financeMode === 'methods' ? (
        <section className="mini-panel finance-methods-panel finance-tab-content">
          <div className="mini-panel-head">
            <div>
              <h3>Способы оплаты</h3>
              <p className="mini-panel-note">Отсюда берутся списки оплат в заказе, закрытии долга и обмене. Изменять список может только админ.</p>
            </div>
            <button className="secondary compact" type="button" onClick={() => void loadFinancePaymentMethods(true)}>{financeMethodsBusy ? 'Загружаю...' : 'Обновить'}</button>
          </div>
          <div className="subgrid reference-form-grid">
            <label className="wide-field"><span>Способ оплаты</span><input value={financeMethodDraft.value} disabled={!isAdmin} onChange={(event) => setFinanceMethodDraft((current) => ({ ...current, value: normalizeSuggestion(event.target.value) }))} placeholder="Например: KASPI PAY" /></label>
            <label><span>Порядок</span><FriendlyNumberInput type="number" disabled={!isAdmin} value={financeMethodDraft.sortOrder} onChange={(event) => setFinanceMethodDraft((current) => ({ ...current, sortOrder: event.target.value }))} /></label>
          </div>
          <div className="actions"><button className="primary" type="button" disabled={!isAdmin} onClick={() => void saveFinancePaymentMethod()}>{financeMethodDraft.id ? 'Сохранить' : 'Добавить'}</button><button className="secondary" type="button" onClick={() => setFinanceMethodDraft({ id: 0, value: '', sortOrder: '0', isActive: true })}>Сбросить</button></div>
          <div className="reference-list finance-method-list">
            {financePaymentMethods.map((item) => <div key={item.id} className={`reference-row ${financeMethodDraft.id === item.id ? 'is-selected' : ''}`}><div className="reference-row-main"><div className="reference-row-title"><strong>{item.value}</strong></div><span>Порядок: {item.sortOrder ?? 0}</span></div>{isAdmin ? <div className="reference-row-actions"><button className="secondary compact" type="button" onClick={() => setFinanceMethodDraft({ id: item.id, value: item.value, sortOrder: String(item.sortOrder ?? 0), isActive: true })}>Править</button><button className="ghost danger compact" type="button" onClick={() => void removeFinancePaymentMethod(item.id)}>Удалить</button></div> : null}</div>)}
            {!financePaymentMethods.length ? <div className="empty-state">Способы оплаты ещё не загружены.</div> : null}
          </div>
        </section>
      ) : null}
    </div>
  )
}
