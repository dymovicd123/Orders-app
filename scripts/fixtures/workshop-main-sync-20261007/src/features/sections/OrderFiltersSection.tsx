// @ts-nocheck -- view extracted from the legacy monolith; typed view-models are the next refactor stage.
type SectionContext = Record<string, any>

export function OrderFiltersSection({ ctx }: { ctx: SectionContext }) {
  const {
    applyOrderPeriodPreset,
    busy,
    ChoicePills,
    filters,
    kaspiMode = false,
    kaspiPaymentState = 'all',
    ManagerPicker,
    orderPanel,
    orderPanelStyle,
    orderPeriodPreset,
    references,
    resetOrderFilters,
    sectorStyle,
    setFilters,
    setKaspiPaymentState,
    workspaceSector = 'orders',
  } = ctx

  const periodOptions = [
    ...(kaspiMode ? [{ value: 'all', label: 'Весь период' }] : []),
    { value: 'yesterday', label: 'Вчера' },
    { value: 'today', label: 'Сегодня' },
    { value: 'month', label: 'Этот месяц' },
    { value: 'year', label: 'Год' },
    { value: 'custom', label: 'Свой период' },
  ]

  return (
    <article className={`card wide sector-${workspaceSector} order-filter-card`} id={kaspiMode ? 'kaspi-filters' : 'filters'} style={{ ...sectorStyle(workspaceSector), ...(kaspiMode ? { display: orderPanel === 'list' ? undefined : 'none' } : orderPanelStyle('list')) }}>
      <div className="orders-filter-panel">
        <div className="orders-period-row">
          <span className="orders-filter-title">Период:</span>
          <ChoicePills value={orderPeriodPreset} onChange={(value) => applyOrderPeriodPreset(value)} options={periodOptions} />
          {orderPeriodPreset === 'custom' ? (
            <div className="orders-date-range">
              <label><span>Начало периода</span><input type="date" value={filters.dateFrom} onChange={(event) => setFilters((current) => ({ ...current, dateFrom: event.target.value }))} /></label>
              <label><span>Конец периода</span><input type="date" value={filters.dateTo} onChange={(event) => setFilters((current) => ({ ...current, dateTo: event.target.value }))} /></label>
            </div>
          ) : null}
        </div>
        {kaspiMode ? (
          <div className="orders-period-row">
            <span className="orders-filter-title">Оплата:</span>
            <ChoicePills value={kaspiPaymentState} onChange={(value) => setKaspiPaymentState(value)} options={[
              { value: 'all', label: 'Все' },
              { value: 'awaiting', label: 'Ожидают оплату' },
              { value: 'paid', label: 'Оплачены' },
            ]} />
          </div>
        ) : null}
        <div className="orders-filter-grid orders-filter-grid-simple">
          <label className="order-filter-manager">
            <span>Менеджер</span>
            <ManagerPicker valueId={filters.managerId} valueName={filters.manager} options={references?.managerOptions || []} placeholder="Все менеджеры" onChange={(manager) => setFilters((current) => ({ ...current, managerId: manager?.id || 0, manager: manager?.name || '' }))} />
          </label>
          <label className="order-filter-shipping">
            <span>Отправка</span>
            <select value={filters.shippingStatus} onChange={(event) => setFilters((current) => ({ ...current, shippingStatus: event.target.value }))}>
              <option value="all">Все</option><option value="not_sent">Не отправлено</option><option value="sent">Отправлено</option>
            </select>
          </label>
          <label className="wide-field order-search-main">
            <span>Поиск</span>
            <input value={filters.q} onChange={(event) => setFilters((current) => ({ ...current, q: event.target.value }))} placeholder="Заказ, клиент, менеджер, город, товар или комментарий" />
          </label>
        </div>
        <div className="actions orders-filter-actions">
          {kaspiMode ? (
            <button className={`secondary ${filters.deliveryType === 'zammler' ? 'is-active' : ''}`} type="button" aria-pressed={filters.deliveryType === 'zammler'} onClick={() => setFilters((current) => ({ ...current, deliveryType: current.deliveryType === 'zammler' ? 'all' : 'zammler' }))} disabled={busy}>Доставка: ЗАММЛЕР</button>
          ) : null}
          <button className="secondary" type="button" onClick={resetOrderFilters} disabled={busy}>Сбросить фильтр</button>
        </div>
      </div>
    </article>
  )
}
