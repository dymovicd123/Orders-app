// @ts-nocheck -- view extracted from the legacy monolith; typed view-models are the next refactor stage.
type SectionContext = Record<string, any>

export function OrderFiltersSection({ ctx }: { ctx: SectionContext }) {
  const {
    applyOrderPeriodPreset,
    busy,
    ChoicePills,
    filters,
    ManagerPicker,
    orderPanelStyle,
    orderPeriodPreset,
    references,
    resetOrderFilters,
    sectorStyle,
    setFilters,
  } = ctx

  return (
    <article className="card wide sector-orders order-filter-card" id="filters" style={{ ...sectorStyle('orders'), ...orderPanelStyle('list') }}>
      <div className="orders-filter-panel">
        <div className="orders-period-row">
          <span className="orders-filter-title">Период:</span>
          <ChoicePills
            value={orderPeriodPreset}
            onChange={(value) => applyOrderPeriodPreset(value as OrderPeriodPreset)}
            options={[
              { value: 'yesterday', label: 'Вчера' },
              { value: 'today', label: 'Сегодня' },
              { value: 'month', label: 'Этот месяц' },
              { value: 'year', label: 'Год' },
              { value: 'custom', label: 'Свой период' },
            ]}
          />
          {orderPeriodPreset === 'custom' ? (
            <div className="orders-date-range">
              <label>
                <span>Начало периода</span>
                <input
                  type="date"
                  value={filters.dateFrom}
                  onChange={(event) => setFilters((current) => ({ ...current, dateFrom: event.target.value }))}
                />
              </label>
              <label>
                <span>Конец периода</span>
                <input
                  type="date"
                  value={filters.dateTo}
                  onChange={(event) => setFilters((current) => ({ ...current, dateTo: event.target.value }))}
                />
              </label>
            </div>
          ) : null}
        </div>

        <div className="orders-filter-grid orders-filter-grid-simple">
          <label className="order-filter-manager">
            <span>Менеджер</span>
            <ManagerPicker
              valueId={filters.managerId}
              valueName={filters.manager}
              options={references?.managerOptions || []}
              placeholder="Все менеджеры"
              onChange={(manager) => setFilters((current) => ({ ...current, managerId: manager?.id || 0, manager: manager?.name || '' }))}
            />
          </label>

          <label className="order-filter-shipping">
            <span>Отправка</span>
            <select
              value={filters.shippingStatus}
              onChange={(event) => setFilters((current) => ({ ...current, shippingStatus: event.target.value }))}
            >
              <option value="all">Все</option>
              <option value="not_sent">Не отправлено</option>
              <option value="sent">Отправлено</option>
            </select>
          </label>

          <label className="wide-field order-search-main">
            <span>Поиск</span>
            <input
              value={filters.q}
              onChange={(event) => setFilters((current) => ({ ...current, q: event.target.value }))}
              placeholder="Заказ, клиент, менеджер, город, товар или комментарий"
            />
          </label>
        </div>

        <div className="actions orders-filter-actions">
          <button className="secondary" type="button" onClick={resetOrderFilters} disabled={busy}>
            Сбросить фильтр
          </button>
        </div>
      </div>
    </article>
  )
}
