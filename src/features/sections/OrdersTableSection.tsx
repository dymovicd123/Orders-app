// @ts-nocheck -- view extracted from the legacy monolith; typed view-models are the next refactor stage.
import { useState } from 'react'
import { LinkedTableScroll } from '../../components/tables/LinkedTableScroll'
type SectionContext = Record<string, any>

export function OrdersTableSection({ ctx }: { ctx: SectionContext }) {
  const [expandedOrderPaymentCounts, setExpandedOrderPaymentCounts] = useState<Record<number, number>>({})
  const {
    deleteOrderAsAdmin,
    expandedOrderItemCounts,
    filters,
    formatDateShort,
    formatMoney,
    handleEditOrder,
    handleOpenDebt,
    handleOpenExchange,
    handleOpenReturn,
    isAdmin,
    isArchivedOrderRecord,
    isReturnedOrderRecord,
    ManagerBadge,
    markOrderSentToClient,
    openOrderStockHandover,
    normalizeSuggestion,
    orderFinanceBusy,
    orderFinanceReport,
    orderLifecycleLabel,
    orderPanelStyle,
    orders,
    paymentStatusClass,
    paymentStatusLabel,
    restoreArchivedOrder,
    savingOrder,
    sectorStyle,
    selectedOrderId,
    setExpandedOrderItemCounts,
    shippingStatusLabel,
    summarizeOrderItemLines,
    summarizeOrderPaymentLines,
    summary,
    waitingDaysLabel,
    busy,
    changeOrderPage,
    orderPageInfo,
  } = ctx

  return (
    <article className="card wide sector-orders" id="orders" style={{ ...sectorStyle('orders'), ...orderPanelStyle('list') }}>
              <div className="card-label">Таблица заказов</div>
              <div className="card-meta">Строки таблицы меняются по поиску и менеджеру. Финансовая сводка ниже синхронизирована с разделом «Финансы» по выбранному периоду.</div>
              {orderFinanceReport && orderFinanceReport.startDate === filters.dateFrom && orderFinanceReport.endDate === filters.dateTo ? (() => {
                const grossReceived = Number(orderFinanceReport.overview.grossReceived ?? orderFinanceReport.overview.totalReceived ?? 0)
                const totalReturned = Number(orderFinanceReport.overview.totalReturned ?? orderFinanceReport.overview.totalReturns ?? 0)
                const netReceived = grossReceived - totalReturned
                return (
                  <div className="orders-finance-summary-shell">
                    <div className="orders-finance-summary-head">
                      <div>
                        <strong>Понятная сводка</strong>
                        <span>{formatDateShort(orderFinanceReport.startDate)} — {formatDateShort(orderFinanceReport.endDate)}</span>
                      </div>
                      {orderFinanceBusy ? <span className="soft-badge">Обновляю...</span> : <span className="soft-badge success-soft">Синхронизировано с финансами</span>}
                    </div>
                    <div className="orders-finance-summary-grid">
                      <article className="orders-finance-summary-card is-sales">
                        <div className="orders-finance-summary-card-head"><span>Продажи за период</span><small>по дате заказа</small></div>
                        <div className="orders-finance-summary-main">{formatMoney(orderFinanceReport.overview.totalSales)}</div>
                        <div className="orders-finance-summary-lines">
                          <div><span>Заказов</span><strong>{orderFinanceReport.overview.orderCount}</strong></div>
                          <div><span>Средний чек</span><strong>{formatMoney(orderFinanceReport.overview.avgCheck)}</strong></div>
                        </div>
                      </article>
                      <article className="orders-finance-summary-card is-money">
                        <div className="orders-finance-summary-card-head"><span>Деньги за период</span><small>по фактической дате операции</small></div>
                        <div className="orders-finance-summary-main">{formatMoney(netReceived)}</div>
                        <div className="orders-finance-summary-lines">
                          <div><span>Поступило</span><strong>{formatMoney(grossReceived)}</strong></div>
                          <div><span>Возвращено</span><strong>{formatMoney(totalReturned)}</strong></div>
                        </div>
                      </article>
                      <article className="orders-finance-summary-card is-current">
                        <div className="orders-finance-summary-card-head"><span>Состояние сейчас</span><small>не зависит от периода</small></div>
                        <div className="orders-finance-summary-main">{formatMoney(orderFinanceReport.overview.currentDebt)}</div>
                        <div className="orders-finance-summary-lines">
                          <div><span>Заказов с долгом</span><strong>{orderFinanceReport.overview.currentDebtOrders}</strong></div>
                          <div><span>Позиций в цехе по таблице</span><strong>{summary.workshop}</strong></div>
                        </div>
                      </article>
                    </div>
                    <div className="orders-current-filter-note">
                      По текущим фильтрам в таблице: <strong>{summary.count}</strong> заказов · <strong>{formatMoney(summary.total)}</strong>.
                    </div>
                  </div>
                )
              })() : (
                <div className="orders-finance-summary-loading">
                  <strong>{orderFinanceBusy ? 'Обновляю финансовую сводку...' : 'Финансовая сводка пока не загрузилась'}</strong>
                  <span>Таблица заказов остаётся доступной; сводка появится автоматически.</span>
                </div>
              )}
              <LinkedTableScroll className="orders-table-shell" ariaLabel="Горизонтальная прокрутка таблицы заказов">
                <table className="data-table order-list-table">
                  <thead>
                    <tr>
                      <th>Дата / заказ</th>
                      <th>Менеджер</th>
                      <th>Клиент</th>
                      <th>Город</th>
                      <th>Товары</th>
                      <th>Доставка / комментарий</th>
                      <th>Оплаты</th>
                      <th>Сумма</th>
                      <th>Получено</th>
                      <th>Долг</th>
                      <th>Статус</th>
                      <th>Действия</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.length ? orders.map((order) => {
                      const visibleItemCount = Math.max(3, expandedOrderItemCounts[order.id] || 3)
                      const itemSummary = summarizeOrderItemLines(order.items, visibleItemCount, order.workshop_status)
                      const visiblePaymentCount = Math.max(2, expandedOrderPaymentCounts[order.id] || 2)
                      const paymentSummary = summarizeOrderPaymentLines(order.payments, visiblePaymentCount)
                      const retainedOnly = Boolean(order.retained_only)
                      const archived = retainedOnly || isArchivedOrderRecord(order)
                      const hasWorkshopItems = Array.isArray(order.items) && order.items.some((item) => Boolean(item?.isWorkshop))
                      const hasStockItems = Array.isArray(order.items) && order.items.some((item) => !item?.isWorkshop)
                      const workshopPending = hasWorkshopItems && (
                        String(order.workshop_status || '').toLowerCase() === 'in_workshop'
                        || order.items.some((item) => Boolean(item?.isWorkshop) && String(item?.workshopTaskStatus || '').toLowerCase() === 'active')
                      )
                      const mixedOrder = hasWorkshopItems && hasStockItems
                      return (
                      <tr
                        key={order.id}
                        data-order-id={order.id}
                        className={`${selectedOrderId === order.id ? 'row-active' : ''} ${archived ? 'row-archived' : ''} ${isReturnedOrderRecord(order) ? 'row-returned' : ''}`}
                      >
                        <td>
                          <div className="order-cell-stack">
                            <strong>{order.order_date}</strong>
                            <span>{order.external_id}</span>
                            {retainedOnly
                              ? <small>Краткая история{order.archived_at ? ` · ${formatDateShort(order.archived_at)}` : ''}</small>
                              : archived ? <small>Архив{order.archived_at ? ` · ${formatDateShort(order.archived_at)}` : ''}</small> : null}
                          </div>
                        </td>
                        <td><ManagerBadge name={order.manager_name} colorKey={order.manager_color} compact /></td>
                        <td>
                          <div className="order-cell-stack">
                            <strong>{order.customer_name || order.customer_phone || '—'}</strong>
                            <span>{order.customer_phone || '—'}</span>
                          </div>
                        </td>
                        <td>{order.city || '—'}</td>
                        <td>
                          {retainedOnly ? (
                            <div className="order-cell-stack">
                              <span className="soft-badge">Краткая история</span>
                              <small>{order.retained_summary_text || 'Детальные строки заказа очищены после сохранения сводки.'}</small>
                            </div>
                          ) : (
                            <div className="order-items-inline">
                              {itemSummary.lines.map((line, index) => (
                                <div className="order-item-chip order-item-card" key={`${order.id}-summary-item-${index}`}>
                                  <div className="order-item-card-head">
                                    <strong>{line.productName}</strong>
                                    <span className="order-item-quantity-badge">× {line.quantity}</span>
                                  </div>
                                  {line.details ? <span className="order-item-card-details">{line.details}</span> : null}
                                  <div className="order-item-chip-meta">
                                    <span className={`order-item-source-badge source-${normalizeSuggestion(line.source) === 'ЦЕХ' ? 'workshop' : normalizeSuggestion(line.source) === 'БУТИК' ? 'boutique' : 'warehouse'}`}>{line.source}</span>
                                    {line.isWorkshop ? (
                                      <span className={`workshop-readiness-pill ${line.workshopReady ? 'is-ready' : 'is-pending'}`}>
                                        {line.workshopReady ? 'Готово' : 'Не готово'}
                                      </span>
                                    ) : null}
                                  </div>
                                </div>
                              ))}
                              {itemSummary.rest > 0 ? (
                                <button
                                  className="order-item-chip order-item-chip-more is-clickable"
                                  type="button"
                                  onClick={() => setExpandedOrderItemCounts((current) => ({ ...current, [order.id]: Math.min(order.items.length, visibleItemCount + 5) }))}
                                >
                                  + ещё {itemSummary.rest}
                                </button>
                              ) : null}
                              {visibleItemCount > 3 && order.items.length > 3 ? (
                                <button
                                  className="order-item-chip order-item-chip-collapse is-clickable"
                                  type="button"
                                  onClick={() => setExpandedOrderItemCounts((current) => { const next = { ...current }; delete next[order.id]; return next })}
                                >
                                  Скрыть
                                </button>
                              ) : null}
                            </div>
                          )}
                        </td>
                        <td>
                          <div className="order-cell-stack">
                            <strong>{order.delivery_type || '—'}</strong>
                            <small>{order.shipping_status === 'sent' ? `Отправлено${order.shipping_date ? ` · ${order.shipping_date}` : ''}` : 'Не отправлено'}</small>
                            <small>{order.comment || '—'}</small>
                          </div>
                        </td>
                        <td>
                          {retainedOnly ? (
                            <div className="order-cell-stack">
                              <small>Детали очищены</small>
                              <span>Оплат: {order.retained_payment_count || 0}</span>
                            </div>
                          ) : (
                            <div className="order-payments-inline">
                              {paymentSummary.lines.map((line, index) => (
                                <div className="order-payment-chip" key={`${order.id}-payment-summary-${index}`}>
                                  <strong>{line.title}</strong>
                                  <span>{line.meta}</span>
                                </div>
                              ))}
                              {paymentSummary.rest > 0 ? (
                                <button
                                  className="order-payment-chip order-payment-chip-more is-clickable"
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    setExpandedOrderPaymentCounts((current) => ({ ...current, [order.id]: Math.min(order.payments.length, visiblePaymentCount + 5) }))
                                  }}
                                >
                                  + ещё {paymentSummary.rest}
                                </button>
                              ) : null}
                              {visiblePaymentCount > 2 && order.payments.length > 2 ? (
                                <button
                                  className="order-payment-chip order-payment-chip-more is-clickable"
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    setExpandedOrderPaymentCounts((current) => { const next = { ...current }; delete next[order.id]; return next })
                                  }}
                                >
                                  Скрыть оплаты
                                </button>
                              ) : null}
                            </div>
                          )}
                        </td>
                        <td>{formatMoney(order.total_amount)}</td>
                        <td>{formatMoney(order.received_amount)}</td>
                        <td>{formatMoney(order.debt_amount)}</td>
                        <td>
                          {retainedOnly ? (
                            <div className="order-status-stack">
                              <span className="status-pill status-neutral">Краткая история</span>
                              <small>Без детальных операций</small>
                            </div>
                          ) : (
                            <div className="order-status-stack">
                              <span className={`status-pill ${paymentStatusClass(order)}`}>{paymentStatusLabel(order)}</span>
                              <span className={`status-pill ${order.shipping_status === 'sent' ? 'status-online' : 'status-warning'}`}>{shippingStatusLabel(order)}</span>
                              <small>{waitingDaysLabel(order)}</small>
                              <small>{orderLifecycleLabel(order)}</small>
                            </div>
                          )}
                        </td>
                        <td>
                          <div className="order-table-actions">
                            {retainedOnly ? <span className="soft-badge">Только история</span> : null}
                            {!retainedOnly && !archived && !isReturnedOrderRecord(order) && order.shipping_status !== 'sent' && (order.stock_handover_review_needed || (mixedOrder && workshopPending && order.stock_handover_has_active_items)) ? (
                              <button
                                className="secondary compact order-stock-handover-trigger"
                                type="button"
                                disabled={savingOrder}
                                onClick={(event) => {
                                  event.stopPropagation()
                                  void openOrderStockHandover(order)
                                }}
                              >
                                {order.stock_handover_review_needed ? 'Уточнить выдачу' : 'Выдать готовые товары'}
                              </button>
                            ) : null}
                            {!retainedOnly && !archived && !isReturnedOrderRecord(order) && order.shipping_status !== 'sent' && !workshopPending ? (
                              <button
                                className="secondary compact"
                                type="button"
                                disabled={savingOrder}
                                onClick={(event) => {
                                  event.stopPropagation()
                                  void markOrderSentToClient(order)
                                }}
                              >
                                Отправить клиенту
                              </button>
                            ) : null}
                            {!retainedOnly && !archived && !isReturnedOrderRecord(order) && order.shipping_status !== 'sent' && workshopPending ? (
                              <span className="order-stock-handover-wait-note">Отправить весь заказ можно после готовности Цеха</span>
                            ) : null}
                            {!retainedOnly && !archived && !isReturnedOrderRecord(order) ? (
                              <>
                                {Number(order.debt_amount || 0) > 0 ? (
                                  <button
                                    className="secondary compact debt-action-button"
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation()
                                      handleOpenDebt(order)
                                    }}
                                  >
                                    Закрыть долг
                                  </button>
                                ) : null}
                                <button
                                  className="secondary compact"
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    handleOpenReturn(order)
                                  }}
                                >
                                  Возврат
                                </button>
                                <button
                                  className="secondary compact"
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    handleOpenExchange(order)
                                  }}
                                >
                                  Обмен
                                </button>
                              </>
                            ) : isReturnedOrderRecord(order) ? (
                              <span className="return-locked-note">Возвращён</span>
                            ) : null}
                            {!retainedOnly && !archived && !isReturnedOrderRecord(order)
                              && (isAdmin || (!['deleted', 'archived'].includes(order.order_status) && order.shipping_status !== 'sent')) ? (
                              <button
                                className="primary compact"
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation()
                                  handleEditOrder(order)
                                }}
                              >
                                Редактировать
                              </button>
                            ) : null}
                            {!retainedOnly && !archived ? (
                              <button
                                className="ghost danger compact"
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation()
                                  void deleteOrderAsAdmin(order)
                                }}
                              >
                                Удалить
                              </button>
                            ) : null}
                            {isAdmin && archived && !retainedOnly ? (
                              <button
                                className="secondary compact"
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation()
                                  void restoreArchivedOrder(order)
                                }}
                              >
                                Вернуть
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    )}) : (
                      <tr>
                        <td colSpan={12} className="empty-state">
                          Заказы не найдены. Попробуйте очистить фильтры или создать новый заказ.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </LinkedTableScroll>
              <div className="clients-stream-footer orders-pagination-footer">
                <span>
                  {orderPageInfo?.totalCount
                    ? `Показано ${orderPageInfo.offset + 1}–${Math.min(orderPageInfo.offset + orders.length, orderPageInfo.totalCount)} из ${orderPageInfo.totalCount}`
                    : 'Подходящих заказов нет'}
                </span>
                <div className="toolbar-actions">
                  <button className="secondary compact" type="button" disabled={busy || !orderPageInfo?.hasPrevious} onClick={() => void changeOrderPage('previous')}>Назад</button>
                  <button className="secondary compact" type="button" disabled={busy || !orderPageInfo?.hasMore} onClick={() => void changeOrderPage('next')}>Дальше</button>
                </div>
              </div>
            </article>
  )
}
