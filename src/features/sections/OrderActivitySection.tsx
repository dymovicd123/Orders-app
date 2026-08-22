// @ts-nocheck -- view extracted from the legacy monolith; typed view-models are the next refactor stage.
type SectionContext = Record<string, any>

export function OrderActivitySection({ ctx }: { ctx: SectionContext }) {
  const {
    activityBusy,
    activityFilters,
    activityLog,
    formatDateShort,
    formatMoney,
    loadActivityLog,
    ManagerBadge,
    managerColorFor,
    orderPanelStyle,
    sectorStyle,
    setActivityFilters,
  } = ctx

  return (
    <article className="card wide sector-orders" id="order-activity" style={{ ...sectorStyle('orders'), ...orderPanelStyle('activity') }}>
              <div className="card-label">Журнал действий по заказам</div>
              <div className="card-meta">
                Вспомогательная история действий по заказам. Точные деньги, возвраты, обмены и склад смотрите в соответствующих разделах.
              </div>
              <div className="orders-filter-panel">
                <div className="orders-filter-grid">
                  <label>
                    Поиск
                    <input
                      value={activityFilters.q}
                      onChange={(event) => setActivityFilters((current) => ({ ...current, q: event.target.value }))}
                      placeholder="Номер заказа, менеджер или комментарий"
                    />
                  </label>
                  <label>
                    Тип действия
                    <select
                      value={activityFilters.eventType}
                      onChange={(event) => setActivityFilters((current) => ({ ...current, eventType: event.target.value }))}
                    >
                      <option value="all">Все</option>
                      <option value="order_created">Создание заказа</option>
                      <option value="order_updated">Редактирование заказа</option>
                      <option value="payment_added">Оплата</option>
                      <option value="return_created">Возврат</option>
                      <option value="return_cancelled">Отмена возврата</option>
                      <option value="exchange_created">Обмен</option>
                      <option value="exchange_cancelled">Отмена обмена</option>
                    </select>
                  </label>
                </div>
                <div className="actions orders-filter-actions">
                  <button className="primary" type="button" disabled={activityBusy} onClick={() => void loadActivityLog()}>
                    {activityBusy ? 'Загружаю...' : 'Показать'}
                  </button>
                </div>
              </div>
              <div className="table-shell">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Дата</th>
                      <th>Заказ</th>
                      <th>Действие</th>
                      <th>Детали</th>
                      <th>Сумма</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activityLog.length ? activityLog.map((entry) => (
                      <tr key={entry.id}>
                        <td>{formatDateShort(entry.createdAt)}</td>
                        <td>
                          <div className="order-cell-stack">
                            <strong>{entry.externalOrderId || '—'}</strong>
                            {entry.managerName ? <ManagerBadge name={entry.managerName} colorKey={entry.managerColor || managerColorFor(entry.managerName)} compact /> : <span>Менеджер не указан</span>}
                          </div>
                        </td>
                        <td>
                          <div className="order-cell-stack">
                            <strong>{entry.title}</strong>
                          </div>
                        </td>
                        <td>{entry.details || '—'}</td>
                        <td>{entry.amount ? formatMoney(entry.amount) : '—'}</td>
                      </tr>
                    )) : (
                      <tr><td colSpan={5}>По выбранным условиям действий по заказам нет.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </article>
  )
}
