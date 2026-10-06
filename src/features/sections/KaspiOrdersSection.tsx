// @ts-nocheck -- workspace view follows the existing extracted section pattern.
import { projectOrderOperationalState } from '../../app/orderOperationalProjection'
type SectionContext = Record<string, any>

export function KaspiOrdersSection({ ctx }: { ctx: SectionContext }) {
  const {
    busy,
    changeOrderPage,
    confirmKaspiPayment,
    filters,
    formatDateShort,
    formatMoney,
    handleEditOrder,
    handleOpenExchange,
    handleOpenReturn,
    kaspiPaymentBusyOrderId,
    kaspiPaymentState,
    ManagerBadge,
    managerColorFor,
    openKaspiCreate,
    orderPageInfo,
    orders,
    setFilters,
    setKaspiPaymentState,
    shippingStatusLabel,
    sectorStyle,
  } = ctx

  return (
    <article className="card wide sector-kaspi kaspi-workspace" id="kaspi-orders" style={sectorStyle('kaspi')}>
      <div className="kaspi-workspace-head">
        <div>
          <div className="card-label">Kaspi Магазин</div>
          <div className="card-meta">Здесь только заказы, у которых способ оплаты заказа — КАСПИ МАГАЗИН. Доставка учитывается отдельно и не определяет принадлежность к Kaspi.</div>
        </div>
        <button className="primary" type="button" onClick={openKaspiCreate}>+ Новый Kaspi-заказ</button>
      </div>

      <div className="kaspi-state-tabs" role="tablist" aria-label="Состояние оплаты Kaspi">
        <button className={`secondary compact ${kaspiPaymentState === 'awaiting' ? 'is-active' : ''}`} type="button" onClick={() => setKaspiPaymentState('awaiting')}>Ожидают оплату</button>
        <button className={`secondary compact ${kaspiPaymentState === 'paid' ? 'is-active' : ''}`} type="button" onClick={() => setKaspiPaymentState('paid')}>Оплачены</button>
        <button className={`secondary compact ${kaspiPaymentState === 'all' ? 'is-active' : ''}`} type="button" onClick={() => setKaspiPaymentState('all')}>Все Kaspi</button>
      </div>

      <div className="kaspi-filter-row">
        <label>
          <span>Поиск</span>
          <input
            value={filters.q}
            onChange={(event) => setFilters((current: any) => ({ ...current, q: event.target.value }))}
            placeholder="Номер заказа, клиент, телефон"
          />
        </label>
        <label>
          <span>С даты</span>
          <input type="date" value={filters.dateFrom} onChange={(event) => setFilters((current: any) => ({ ...current, dateFrom: event.target.value }))} />
        </label>
        <label>
          <span>По дату</span>
          <input type="date" value={filters.dateTo} onChange={(event) => setFilters((current: any) => ({ ...current, dateTo: event.target.value }))} />
        </label>
      </div>

      <div className="kaspi-list-summary">
        <span>Найдено: <strong>{orderPageInfo.totalCount}</strong></span>
        {busy ? <span>Обновляю…</span> : null}
      </div>

      <div className="table-scroll">
        <table className="data-table kaspi-orders-table">
          <thead>
            <tr>
              <th>Заказ</th>
              <th>Менеджер / клиент</th>
              <th>Доставка</th>
              <th>Сумма</th>
              <th>Получено</th>
              <th>Осталось</th>
              <th>Действия</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order: any) => {
              const projection = projectOrderOperationalState(order, { isAdmin: true })
              const debt = Math.max(0, Number(order.debt_amount || 0))
              const isPaying = Number(kaspiPaymentBusyOrderId || 0) === Number(order.id || 0)
              return (
                <tr key={order.id} data-order-id={order.id}>
                  <td>
                    <strong>{order.external_id}</strong>
                    <small>{formatDateShort(order.order_date)}</small>
                  </td>
                  <td>
                    <ManagerBadge name={order.manager_name || '—'} color={managerColorFor(order.manager_name, order.manager_id, order.manager_color)} />
                    <small>{order.customer_name || order.customer_phone || 'Клиент не указан'}</small>
                  </td>
                  <td>
                    <strong>{order.delivery_type || '—'}</strong>
                    <small>{shippingStatusLabel(order)}</small>
                  </td>
                  <td>{formatMoney(order.total_amount)}</td>
                  <td>{formatMoney(order.received_amount)}</td>
                  <td><strong>{formatMoney(debt)}</strong></td>
                  <td>
                    <div className="kaspi-row-actions">
                      {debt > 0 && projection.canOpenDebt ? (
                        <button className="primary compact" type="button" disabled={isPaying} onClick={() => void confirmKaspiPayment(order)}>
                          {isPaying ? 'Сохраняю…' : 'Оплата получена'}
                        </button>
                      ) : null}
                      {projection.canEdit ? <button className="secondary compact" type="button" onClick={() => void handleEditOrder(order, 'kaspi')}>Редактировать</button> : null}
                      {projection.canOpenReturn ? <button className="secondary compact" type="button" onClick={() => void handleOpenReturn(order)}>Возврат</button> : null}
                      {projection.canOpenExchange ? <button className="secondary compact" type="button" onClick={() => void handleOpenExchange(order)}>Обмен</button> : null}
                    </div>
                  </td>
                </tr>
              )
            })}
            {!orders.length ? (
              <tr><td colSpan={7} className="empty-state">{busy ? 'Загружаю Kaspi-заказы…' : 'По выбранному состоянию Kaspi-заказов нет.'}</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="actions kaspi-pagination">
        <button className="secondary compact" type="button" disabled={busy || !orderPageInfo.hasPrevious} onClick={() => void changeOrderPage('previous')}>Назад</button>
        <span>{orderPageInfo.totalCount ? `${orderPageInfo.offset + 1}–${Math.min(orderPageInfo.offset + orderPageInfo.limit, orderPageInfo.totalCount)} из ${orderPageInfo.totalCount}` : '0 заказов'}</span>
        <button className="secondary compact" type="button" disabled={busy || !orderPageInfo.hasMore} onClick={() => void changeOrderPage('next')}>Дальше</button>
      </div>
    </article>
  )
}
