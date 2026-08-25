// @ts-nocheck -- extracted view renderer; controller remains typed in App.tsx.

type RendererContext = Record<string, any>

export function FinanceReportContentRenderer(ctx: RendererContext) {
  const {
    exportSelectedFinanceReportWord,
    financeReport,
    financeReportOptions,
    financeReportType,
    formatDateShort,
    formatMoney,
    formatPercent,
    ManagerBadge,
    managerColorFor,
    printSelectedFinanceReportPdf,
  } = ctx

    if (!financeReport) {
      return <div className="empty-state">Выберите тип отчёта и нажмите «Показать отчёт».</div>
    }

    const option = financeReportOptions.find((entry) => entry.value === financeReportType)
    const periodText = `${formatDateShort(financeReport.startDate)} — ${formatDateShort(financeReport.endDate)}`
    const activeReturns = financeReport.reports.returns.filter((row) => row.status !== 'cancelled')
    const closedDebtTotal = financeReport.reports.closedDebts.reduce((sum, row) => sum + Number(row.amount || 0), 0)
    const activeReturnTotal = activeReturns.reduce((sum, row) => sum + Number(row.amount || 0), 0)
    const paymentTotal = financeReport.reports.paymentMethods.reduce((sum, row) => sum + Number(row.total || 0), 0)
    const paymentMethodsByDay = financeReport.reports.paymentMethodsByDay || []
    const managerDays = financeReport.reports.managerDays || []
    const productDays = financeReport.reports.productDays || []
    const cityDays = financeReport.reports.cityDays || []
    const returnDays = financeReport.reports.returnDays || []
    const closedDebtDays = financeReport.reports.closedDebtDays || []
    const paymentMethodNames = financeReport.reports.paymentMethods.map((row) => row.method || '—')

    const renderStatsTable = (stats: { label: string; value: string | number }[], title = 'Общая статистика за период') => (
      <section className="report-stat-section">
        <h3>{title}</h3>
        <div className="table-shell">
          <table className="data-table strict-report-table report-stat-table">
            <thead><tr>{stats.map((stat) => <th key={`stat-head-${stat.label}`}>{stat.label}</th>)}</tr></thead>
            <tbody><tr>{stats.map((stat) => <td key={`stat-value-${stat.label}`}>{stat.value}</td>)}</tr></tbody>
          </table>
        </div>
      </section>
    )

    const renderHeader = (subtitle?: string) => (
      <div className="strict-report-header">
        <div className="strict-report-title-row">
          <div>
            <h2>{option?.label || 'Отчёт'}</h2>
            <p className="strict-report-note">{subtitle || option?.note || 'Строгий табличный отчёт за выбранный период.'}</p>
          </div>
          <span className="strict-report-period">{periodText}</span>
        </div>
      </div>
    )

    const renderActions = () => (
      <div className="report-export-actions">
        <button className="secondary compact" type="button" onClick={exportSelectedFinanceReportWord}>Скачать Word</button>
        <button className="secondary compact" type="button" onClick={printSelectedFinanceReportPdf}>PDF / печать</button>
      </div>
    )

    const renderPaymentReport = () => (
      <>
        {renderHeader('Фактически поступившие оплаты за выбранный период. Каждая сумма стоит в своей дате оплаты.')}
        {renderStatsTable([
          { label: 'Поступило денег', value: formatMoney(paymentTotal) },
          { label: 'Способов оплаты', value: financeReport.reports.paymentMethods.length },
          { label: 'Дней с оплатами', value: paymentMethodsByDay.length },
          { label: 'Возвраты за период', value: formatMoney(activeReturnTotal) },
        ])}
        <section className="report-table-card">
          <div className="strict-section-head"><h3>Итог по способам оплаты</h3><span className="soft-badge">таблица за период</span></div>
          <div className="table-shell"><table className="data-table strict-report-table"><thead><tr><th>Способ оплаты</th><th className="num">Сумма</th><th className="num">Доля</th></tr></thead><tbody>
            {financeReport.reports.paymentMethods.map((row) => <tr key={`payment-report-${row.method}`}><td>{row.method || '—'}</td><td className="num">{formatMoney(row.total)}</td><td className="num">{formatPercent(paymentTotal ? Number(row.total || 0) / paymentTotal : 0)}</td></tr>)}
            {!financeReport.reports.paymentMethods.length ? <tr><td colSpan={3} className="empty-state">Нет оплат по выбранным заказам.</td></tr> : null}
            {financeReport.reports.paymentMethods.length ? <tr className="total-row"><td>ИТОГО</td><td className="num">{formatMoney(paymentTotal)}</td><td className="num">100%</td></tr> : null}
          </tbody></table></div>
        </section>
        <section className="report-table-card">
          <div className="strict-section-head"><h3>Оплаты по дням</h3><span className="soft-badge">фактическая дата оплаты</span></div>
          <div className="table-shell"><table className="data-table strict-report-table"><thead><tr><th>Дата оплаты</th>{paymentMethodNames.map((method) => <th className="num" key={`method-head-${method}`}>{method}</th>)}<th className="num">Итого</th></tr></thead><tbody>
            {paymentMethodsByDay.map((row) => <tr key={`payment-day-${row.date}`}><td>{formatDateShort(row.date)}</td>{paymentMethodNames.map((method) => <td className="num" key={`${row.date}-${method}`}>{formatMoney(row.methods?.[method] || 0)}</td>)}<td className="num"><strong>{formatMoney(row.total)}</strong></td></tr>)}
            {!paymentMethodsByDay.length ? <tr><td colSpan={paymentMethodNames.length + 2} className="empty-state">Нет оплат по выбранным заказам.</td></tr> : null}
          </tbody></table></div>
        </section>
      </>
    )

    const renderManagerReport = () => (
      <>
        {renderHeader('Продажи считаются по дате заказа, а поступления и возвраты — по фактическим датам операций.')}
        {renderStatsTable([
          { label: 'Продажи', value: formatMoney(financeReport.overview.totalSales) },
          { label: 'Получено', value: formatMoney(financeReport.overview.totalReceived) },
          { label: 'Заказов', value: financeReport.overview.orderCount },
          { label: 'Долг заказов периода', value: formatMoney(financeReport.overview.periodDebt) },
          { label: 'Возвраты по заказам', value: formatMoney(activeReturnTotal) },
        ])}
        <section className="report-table-card"><div className="strict-section-head"><h3>Итог по менеджерам</h3><span className="soft-badge">таблица за период</span></div><div className="table-shell"><table className="data-table strict-report-table"><thead><tr><th>Менеджер</th><th className="num">Заказов</th><th className="num">Продажи</th><th className="num">Поступило</th><th className="num">Возвраты</th><th className="num">Долг</th><th className="num">Средний чек</th></tr></thead><tbody>
          {financeReport.reports.managers.map((row) => <tr key={`manager-total-${row.manager_id || row.manager}`}><td><ManagerBadge name={row.manager} colorKey={row.color_key} compact /></td><td className="num">{row.order_count}</td><td className="num">{formatMoney(row.total_sales)}</td><td className="num">{formatMoney(row.total_received)}</td><td className="num">{formatMoney(row.total_returns)}</td><td className="num">{formatMoney(row.total_debt)}</td><td className="num">{formatMoney(row.avg_check)}</td></tr>)}
          {!financeReport.reports.managers.length ? <tr><td colSpan={7} className="empty-state">Нет заказов за период.</td></tr> : null}
        </tbody></table></div></section>
        <section className="strict-report-section"><div className="strict-section-head"><h3>Детализация по дням</h3><span className="soft-badge">день → менеджеры</span></div>
          {managerDays.map((day) => <article className="strict-day-card" key={`manager-day-${day.date}`}><div className="strict-day-head"><strong>{formatDateShort(day.date)}</strong><span>{`продажи ${formatMoney(day.totalSales)} · поступило ${formatMoney(day.totalReceived)}`}</span></div><div className="table-shell"><table className="data-table strict-report-table"><thead><tr><th>Менеджер</th><th className="num">Заказов</th><th className="num">Продажи</th><th className="num">Поступило</th><th className="num">Оплаты заказов</th><th className="num">Закрытие долгов</th><th className="num">Доплаты обмена</th><th className="num">Возвраты</th><th className="num">Долг</th></tr></thead><tbody>{day.managers.map((row) => <tr key={`${day.date}-${row.managerId || row.manager}`}><td><ManagerBadge name={row.manager} colorKey={row.colorKey} compact /></td><td className="num">{row.order_count}</td><td className="num">{formatMoney(row.total_sales)}</td><td className="num">{formatMoney(row.total_received)}</td><td className="num">{formatMoney(row.primary_received)}</td><td className="num">{formatMoney(Number(row.debt_closed || 0) + Number(row.order_extra_received || 0))}</td><td className="num">{formatMoney(row.extra_received || 0)}</td><td className="num">{formatMoney(row.total_returns)}</td><td className="num">{formatMoney(row.total_debt)}</td></tr>)}</tbody></table></div></article>)}
          {!managerDays.length ? <div className="empty-state">Детализации по дням нет.</div> : null}
        </section>
      </>
    )

    const renderProductReport = () => (
      <>
        {renderHeader('Товары из заказов, созданных в выбранный период.')}
        {renderStatsTable([
          { label: 'Всего единиц', value: financeReport.reports.products.reduce((sum, row) => sum + Number(row.quantity || 0), 0) },
          { label: 'Товаров', value: financeReport.reports.products.length },
          { label: 'Заказов', value: financeReport.overview.orderCount },
          { label: 'Лидер продаж', value: financeReport.reports.products[0]?.product || '—' },
          { label: 'Возвраты по заказам', value: formatMoney(activeReturnTotal) },
        ])}
        <section className="report-table-card"><div className="strict-section-head"><h3>Проданные товары</h3><span className="soft-badge">итог за период</span></div><div className="table-shell"><table className="data-table strict-report-table"><thead><tr><th>Товар</th><th className="num">Количество</th><th className="num">Заказов</th></tr></thead><tbody>
          {financeReport.reports.products.map((row) => <tr key={`product-total-${row.product}`}><td>{row.product}</td><td className="num">{row.quantity}</td><td className="num">{row.order_count}</td></tr>)}
          {!financeReport.reports.products.length ? <tr><td colSpan={3} className="empty-state">Нет товаров за период.</td></tr> : null}
        </tbody></table></div></section>
        <section className="strict-report-section"><div className="strict-section-head"><h3>По датам заказов</h3><span className="soft-badge">дата заказа → товары</span></div>
          {productDays.map((day) => <article className="strict-day-card" key={`product-day-${day.date}`}><div className="strict-day-head"><strong>{formatDateShort(day.date)}</strong><span>{`${day.quantity} шт. · заказов ${day.orderCount}`}</span></div><div className="table-shell"><table className="data-table strict-report-table"><thead><tr><th>Товар</th><th className="num">Количество</th><th className="num">Заказов</th></tr></thead><tbody>{day.products.map((row) => <tr key={`${day.date}-${row.product}`}><td>{row.product}</td><td className="num">{row.quantity}</td><td className="num">{row.order_count}</td></tr>)}</tbody></table></div></article>)}
          {!productDays.length ? <div className="empty-state">Данных по датам заказов нет.</div> : null}
        </section>
      </>
    )

    const renderCityReport = () => (
      <>
        {renderHeader('Продажи по городам считаются по дате заказа, поступления — по фактической дате оплаты.')}
        {renderStatsTable([
          { label: 'Заказов', value: financeReport.overview.orderCount },
          { label: 'Городов', value: financeReport.reports.cities.length },
          { label: 'Сумма заказов', value: formatMoney(financeReport.overview.totalSales) },
          { label: 'Получено', value: formatMoney(financeReport.overview.totalReceived) },
          { label: 'Долг', value: formatMoney(financeReport.overview.periodDebt) },
          { label: 'Лидер', value: financeReport.reports.cities[0]?.city || '—' },
        ])}
        <section className="report-table-card"><div className="strict-section-head"><h3>Все города</h3><span className="soft-badge">итог за период</span></div><div className="table-shell"><table className="data-table strict-report-table"><thead><tr><th>Город</th><th className="num">Заказов</th><th className="num">Сумма</th><th className="num">Получено</th><th className="num">Долг</th><th className="num">Клиентов</th><th className="num">Менеджеров</th><th className="num">Средний чек</th></tr></thead><tbody>
          {financeReport.reports.cities.map((row) => <tr key={`city-total-${row.city}`}><td>{row.city}</td><td className="num">{row.order_count}</td><td className="num">{formatMoney(row.total_sales)}</td><td className="num">{formatMoney(row.total_received)}</td><td className="num">{formatMoney(row.total_debt)}</td><td className="num">—</td><td className="num">—</td><td className="num">{formatMoney(row.order_count ? Number(row.total_sales || 0) / Number(row.order_count || 1) : 0)}</td></tr>)}
          {!financeReport.reports.cities.length ? <tr><td colSpan={8} className="empty-state">Нет городов за период.</td></tr> : null}
        </tbody></table></div></section>
        <section className="strict-report-section"><div className="strict-section-head"><h3>По дням</h3><span className="soft-badge">продажи по дате заказа · деньги по дате операции</span></div>
          {cityDays.map((day) => <article className="strict-day-card" key={`city-day-${day.date}`}><div className="strict-day-head"><strong>{formatDateShort(day.date)}</strong><span>{`заказов ${day.orderCount} · сумма ${formatMoney(day.totalSales)}`}</span></div><div className="table-shell"><table className="data-table strict-report-table"><thead><tr><th>Город</th><th className="num">Заказов</th><th className="num">Сумма</th><th className="num">Получено</th><th className="num">Долг</th><th className="num">Клиентов</th><th className="num">Менеджеров</th><th className="num">Средний чек</th></tr></thead><tbody>{day.cities.map((row) => <tr key={`${day.date}-${row.city}`}><td>{row.city}</td><td className="num">{row.order_count}</td><td className="num">{formatMoney(row.total_sales)}</td><td className="num">{formatMoney(row.total_received)}</td><td className="num">{formatMoney(row.total_debt)}</td><td className="num">{row.clients}</td><td className="num">{row.managers}</td><td className="num">{formatMoney(row.avg_check)}</td></tr>)}</tbody></table></div></article>)}
          {!cityDays.length ? <div className="empty-state">Данных по датам заказов нет.</div> : null}
        </section>
      </>
    )

    const renderReturnsReport = () => (
      <>
        {renderHeader('Возвраты за выбранный период по фактической дате возврата.')}
        {renderStatsTable([
          { label: 'Количество возвратов', value: activeReturns.length },
          { label: 'Сумма возвратов', value: formatMoney(activeReturnTotal) },
          { label: 'Менеджеров', value: new Set(activeReturns.map((row) => row.manager || '—')).size },
        ])}
        <section className="report-table-card"><div className="strict-section-head"><h3>По менеджерам</h3><span className="soft-badge">итог за период</span></div><div className="table-shell"><table className="data-table strict-report-table"><thead><tr><th>Менеджер</th><th className="num">Сумма возвратов</th></tr></thead><tbody>
          {Object.entries(activeReturns.reduce<Record<string, number>>((acc, row) => { acc[row.manager || '—'] = (acc[row.manager || '—'] || 0) + Number(row.amount || 0); return acc }, {})).map(([manager, total]) => <tr key={`return-manager-${manager}`}><td><ManagerBadge name={manager} colorKey={managerColorFor(manager)} compact /></td><td className="num">{formatMoney(total)}</td></tr>)}
          {!activeReturns.length ? <tr><td colSpan={2} className="empty-state">За выбранный период возвратов нет.</td></tr> : null}
        </tbody></table></div></section>
        <section className="strict-report-section"><div className="strict-section-head"><h3>Возвраты по дням</h3><span className="soft-badge">фактическая дата возврата</span></div>
          {returnDays.map((day) => <article className="strict-day-card" key={`return-day-${day.date}`}><div className="strict-day-head"><strong>{formatDateShort(day.date)}</strong><span>{`${day.count} возвратов · ${formatMoney(day.total)}`}</span></div><div className="table-shell"><table className="data-table strict-report-table"><thead><tr><th>ID</th><th>Дата заказа</th><th>Дата возврата</th><th>Менеджер</th><th>Клиент</th><th className="num">Сумма</th><th>Товары</th><th>Комментарий</th></tr></thead><tbody>{day.returns.map((row) => <tr key={`return-row-${row.id}`}><td>{row.external_id}</td><td>{formatDateShort(row.order_date)}</td><td>{formatDateShort(row.operation_date || row.order_date)}</td><td><ManagerBadge name={row.manager} colorKey={managerColorFor(row.manager)} compact /></td><td>{row.customer}</td><td className="num">{formatMoney(row.amount)}</td><td>{row.items || '—'}</td><td>{row.comment || '—'}</td></tr>)}</tbody></table></div></article>)}
          {!returnDays.length ? <div className="empty-state">Детализации по возвратам нет.</div> : null}
        </section>
      </>
    )

    const renderDebtReport = () => (
      <>
        {renderHeader('Закрытия долгов за выбранный период по фактической дате оплаты.')}
        {renderStatsTable([
          { label: 'Количество закрытий', value: financeReport.reports.closedDebts.length },
          { label: 'Сумма закрытий', value: formatMoney(closedDebtTotal) },
          { label: 'Заказов', value: new Set(financeReport.reports.closedDebts.map((row) => row.order_id)).size },
          { label: 'Менеджеров', value: closedDebtDays.reduce((set, day) => { day.rows.forEach((row) => set.add(row.manager)); return set }, new Set<string>()).size },
        ])}
        <section className="report-table-card"><div className="strict-section-head"><h3>По менеджерам</h3><span className="soft-badge">итог за период</span></div><div className="table-shell"><table className="data-table strict-report-table"><thead><tr><th>Менеджер</th><th className="num">Сумма закрытий</th></tr></thead><tbody>
          {Object.entries(closedDebtDays.flatMap((day) => day.rows).reduce<Record<string, number>>((acc, row) => { acc[row.manager || '—'] = (acc[row.manager || '—'] || 0) + Number(row.amount || 0); return acc }, {})).map(([manager, total]) => <tr key={`debt-manager-${manager}`}><td><ManagerBadge name={manager} colorKey={managerColorFor(manager)} compact /></td><td className="num">{formatMoney(total)}</td></tr>)}
          {!financeReport.reports.closedDebts.length ? <tr><td colSpan={2} className="empty-state">За выбранный период закрытий долга нет.</td></tr> : null}
        </tbody></table></div></section>
        <section className="strict-report-section"><div className="strict-section-head"><h3>Закрытия по дням</h3><span className="soft-badge">фактическая дата оплаты</span></div>
          {closedDebtDays.map((day) => <article className="strict-day-card" key={`debt-day-${day.date}`}><div className="strict-day-head"><strong>{formatDateShort(day.date)}</strong><span>{`${day.count} закрытий · ${formatMoney(day.total)}`}</span></div><div className="table-shell"><table className="data-table strict-report-table"><thead><tr><th>Заказ</th><th>Дата заказа</th><th>Дата оплаты</th><th>Менеджер</th><th>Клиент</th><th>Город</th><th className="num">Сумма</th><th>Способ</th><th>Комментарий</th></tr></thead><tbody>{day.rows.map((row) => <tr key={`debt-row-${row.id}`}><td>{row.external_id}</td><td>{formatDateShort(row.order_date)}</td><td>{formatDateShort(row.operation_date || row.order_date)}</td><td><ManagerBadge name={row.manager} colorKey={managerColorFor(row.manager)} compact /></td><td>{row.customer}</td><td>{row.city || '—'}</td><td className="num">{formatMoney(row.amount)}</td><td>{row.method || '—'}</td><td>{row.comment || '—'}</td></tr>)}</tbody></table></div></article>)}
          {!closedDebtDays.length ? <div className="empty-state">Детализации по закрытым долгам нет.</div> : null}
        </section>
      </>
    )

    const renderLeadReport = () => {
      const totals = financeReport.reports.leadsTotals
      return <>{renderHeader('Лиды за период: принятые, неквал, квал, продажи и конверсия.')}
        {renderStatsTable([
          { label: 'Принято', value: totals?.acceptedCount || 0 },
          { label: 'Неквал', value: totals?.badCount || 0 },
          { label: 'Квал', value: totals?.qualifiedCount || 0 },
          { label: 'Продажи', value: totals?.salesCount || 0 },
        ])}
        <section className="report-table-card"><div className="strict-section-head"><h3>Лиды по менеджерам</h3><span className="soft-badge">таблица за период</span></div><div className="table-shell"><table className="data-table strict-report-table"><thead><tr><th>Дата</th><th>Менеджер</th><th className="num">Принято</th><th className="num">Неквал</th><th className="num">Квал</th><th className="num">Продажи</th><th className="num">Конверсия</th></tr></thead><tbody>{(financeReport.reports.leads || []).map((row) => <tr key={`lead-report-row-${row.id}`}><td>{formatDateShort(row.date)}</td><td><ManagerBadge name={row.manager} colorKey={managerColorFor(row.manager, row.managerId, row.managerColor)} compact /></td><td className="num">{row.acceptedCount}</td><td className="num">{row.badCount}</td><td className="num">{row.qualifiedCount}</td><td className="num">{row.salesCount}</td><td className="num">{formatPercent(row.conversionRate)}</td></tr>)}{!(financeReport.reports.leads || []).length ? <tr><td colSpan={8} className="empty-state">Лидов за период нет.</td></tr> : null}</tbody></table></div></section></>
    }

    const renderCallCentreReport = () => {
      const totals = financeReport.reports.callCentreTotals
      return <>{renderHeader('Call Centre: звонки, фейки, отказники, потенциалы и процент дозвона.')}
        {renderStatsTable([
          { label: 'Лиды', value: totals?.acceptedLeads || 0 },
          { label: 'Звонки', value: totals?.callsMade || 0 },
          { label: 'Принято', value: totals?.callsAccepted || 0 },
          { label: 'Потенциалы', value: totals?.potentialCount || 0 },
        ])}
        <section className="report-table-card"><div className="strict-section-head"><h3>Call Centre по менеджерам</h3><span className="soft-badge">таблица за период</span></div><div className="table-shell"><table className="data-table strict-report-table"><thead><tr><th>Дата</th><th>Менеджер</th><th className="num">Лиды</th><th className="num">Звонки</th><th className="num">Принято</th><th className="num">Фейки</th><th className="num">Отказники</th><th className="num">Потенциалы</th><th className="num">% дозвона</th></tr></thead><tbody>{(financeReport.reports.callCentre || []).map((row) => <tr key={`cc-report-row-${row.id}`}><td>{formatDateShort(row.date)}</td><td><ManagerBadge name={row.manager} colorKey={managerColorFor(row.manager, row.managerId, row.managerColor)} compact /></td><td className="num">{row.acceptedLeads}</td><td className="num">{row.callsMade}</td><td className="num">{row.callsAccepted}</td><td className="num">{row.fakeCount}</td><td className="num">{row.refusalCount}</td><td className="num">{row.potentialCount}</td><td className="num">{formatPercent(row.callAcceptanceRate)}</td></tr>)}{!(financeReport.reports.callCentre || []).length ? <tr><td colSpan={9} className="empty-state">Call Centre за период нет.</td></tr> : null}</tbody></table></div></section></>
    }

    return (
      <div id="selectedFinanceReportExport" className="finance-report-shell selected-report-shell strict-report-shell">
        {renderActions()}
        {financeReportType === 'payments' ? renderPaymentReport() : null}
        {financeReportType === 'managers' ? renderManagerReport() : null}
        {financeReportType === 'products' ? renderProductReport() : null}
        {financeReportType === 'cities' ? renderCityReport() : null}
        {financeReportType === 'returns' ? renderReturnsReport() : null}
        {financeReportType === 'debts' ? renderDebtReport() : null}
        {financeReportType === 'leads' ? renderLeadReport() : null}
        {financeReportType === 'callCentre' ? renderCallCentreReport() : null}
      </div>
    )
  
}
