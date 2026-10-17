// @ts-nocheck -- view extracted from the legacy monolith; typed view-models are the next refactor stage.
import { useState } from 'react'
import { LinkedTableScroll } from '../../components/tables/LinkedTableScroll'
import { projectOrderOperationalState } from '../../app/orderOperationalProjection'
type SectionContext = Record<string, any>

export function OrdersTableSection({ ctx }: { ctx: SectionContext }) {
  const [expandedOrderPaymentCounts, setExpandedOrderPaymentCounts] = useState<Record<number, number>>({})
  const [extraActionsOrderId, setExtraActionsOrderId] = useState<number | null>(null)
  const [priceDraft, setPriceDraft] = useState<{order: any; itemId: number; price: string; error: string} | null>(null)
  const [oldExchangePriceDraft,setOldExchangePriceDraft] = useState<{
    order:any; items:any[]; itemId:number; price:string; error:string; loading:boolean;
  } | null>(null)
  const [exchangeChainDraft,setExchangeChainDraft] = useState<{
    order:any;selected:number;available:number[];preview:any|null;error:string;loading:boolean;
  } | null>(null)
  const [adminDeleteDraft,setAdminDeleteDraft] = useState<{
    order:any;preview:any|null;error:string;loading:boolean;submitting:boolean;
  } | null>(null)
  const {
    correctMistakenOrderShipping,
    correctRecordedOrderItemPrice,
    loadRetiredExchangePriceOptions,
    correctRetiredExchangePrice,
    loadExchangeCancellationPreview,
    loadAdminOrderDeletePreview,
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
    kaspiMode = false,
    kaspiPaymentBusyOrderId,
    confirmKaspiPayment,
    ManagerBadge,
    markOrderSentToClient,
    openOrderStockHandover,
    normalizeSuggestion,
    ordinaryOrdersSeparated = false,
    orderFinanceBusy,
    orderFinanceReport,
    orderPanel,
    orderPanelStyle,
    orders,
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
    workspaceSector = 'orders',
  } = ctx

  const kaspiAverageCheck = summary.count > 0 ? Math.round(summary.total / summary.count) : 0

  return (
    <article className={`card wide sector-${workspaceSector}`} id={kaspiMode ? 'kaspi-orders' : 'orders'} style={{ ...sectorStyle(workspaceSector), ...(kaspiMode ? (orderPanel === 'list' ? {} : { display: 'none' }) : orderPanelStyle('list')) }}>
              <div className="card-label">{kaspiMode ? 'Kaspi-заказы' : 'Таблица заказов'}</div>
              <div className="card-meta">{kaspiMode ? 'Заказы Kaspi по выбранным фильтрам.' : 'Заказы по выбранному периоду и фильтрам.'}</div>
              {kaspiMode ? (
                <div className="orders-finance-summary-shell">
                  <div className="orders-finance-summary-head">
                    <div><strong>Kaspi · сводка</strong><span>{filters.dateFrom || filters.dateTo ? `${filters.dateFrom ? formatDateShort(filters.dateFrom) : 'начало'} — ${filters.dateTo ? formatDateShort(filters.dateTo) : 'сегодня'}` : 'Весь период'}</span></div>
                    <span className="soft-badge success-soft">Только КАСПИ МАГАЗИН</span>
                  </div>
                  <div className="orders-finance-summary-grid">
                    <article className="orders-finance-summary-card is-sales">
                      <div className="orders-finance-summary-card-head"><span>Продажи</span><small>по текущим фильтрам</small></div><div className="orders-finance-summary-main">{formatMoney(summary.total)}</div>
                      <div className="orders-finance-summary-lines"><div><span>Заказов</span><strong>{summary.count}</strong></div><div><span>Средний чек</span><strong>{formatMoney(kaspiAverageCheck)}</strong></div></div>
                    </article>
                    <article className="orders-finance-summary-card is-money">
                      <div className="orders-finance-summary-card-head"><span>Получено</span><small>подтверждённые оплаты</small></div><div className="orders-finance-summary-main">{formatMoney(summary.received)}</div>
                      <div className="orders-finance-summary-lines"><div><span>Возвращено</span><strong>{formatMoney(summary.returns)}</strong></div><div><span>Оплата</span><strong>КАСПИ МАГАЗИН</strong></div></div>
                    </article>
                    <article className="orders-finance-summary-card is-current">
                      <div className="orders-finance-summary-card-head"><span>Ожидаем оплату</span><small>текущий долг</small></div><div className="orders-finance-summary-main">{formatMoney(summary.debt)}</div>
                      <div className="orders-finance-summary-lines"><div><span>Заказов с долгом</span><strong>{summary.debtOrders}</strong></div><div><span>Доставка</span><strong>считается отдельно</strong></div></div>
                    </article>
                  </div>
                </div>
              ) : ordinaryOrdersSeparated ? (
                <div className="orders-current-filter-note">
                  Найдено <strong>{summary.count}</strong> · сумма <strong>{formatMoney(summary.total)}</strong> · долг <strong>{formatMoney(summary.debt)}</strong>
                </div>
              ) : orderFinanceReport && orderFinanceReport.startDate === filters.dateFrom && orderFinanceReport.endDate === filters.dateTo ? (() => {
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
                      {orderFinanceBusy ? <span className="soft-badge">Обновляю...</span> : <span className="soft-badge success-soft">Актуальные данные</span>}
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
                      const projection = projectOrderOperationalState(order, { isAdmin })
                      const visibleItemCount = Math.max(3, expandedOrderItemCounts[order.id] || 3)
                      const itemSummary = summarizeOrderItemLines(
                        order.items,
                        visibleItemCount,
                        projection.workshopPending ? 'in_workshop' : 'ready',
                      )
                      const visiblePaymentCount = Math.max(2, expandedOrderPaymentCounts[order.id] || 2)
                      const paymentSummary = summarizeOrderPaymentLines(order.payments, visiblePaymentCount)
                      const retainedOnly = projection.retainedOnly
                      const archived = projection.archived
                      return (
                      <tr
                        key={order.id}
                        data-order-id={order.id}
                        className={`${selectedOrderId === order.id ? 'row-active' : ''} ${archived ? 'row-archived' : ''} ${projection.hasCommittedDownstreamOperation ? 'row-returned' : ''}`}
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
                        <td>
                          <div className="order-cell-stack">
                            <strong>{formatMoney(projection.receivedAmount)}</strong>
                            {projection.refundAmount > 0 ? (
                              <small>Возвращено {formatMoney(projection.refundAmount)} · осталось {formatMoney(projection.netRetainedAmount)}</small>
                            ) : null}
                          </div>
                        </td>
                        <td>{formatMoney(projection.debtAmount)}</td>
                        <td>
                          {retainedOnly ? (
                            <div className="order-status-stack">
                              <span className="status-pill status-neutral">Краткая история</span>
                              <small>Без детальных операций</small>
                            </div>
                          ) : (
                            <div className="order-status-stack">
                              <span className={`status-pill ${projection.paymentClass}`}>{projection.paymentLabel}</span>
                              <span className={`status-pill ${order.shipping_status === 'sent' ? 'status-online' : 'status-warning'}`}>{shippingStatusLabel(order)}</span>
                              {projection.workshopLabel ? <small>{projection.workshopLabel}</small> : null}
                              <small>{waitingDaysLabel(order)}</small>
                              <small>{projection.lifecycleLabel}</small>
                            </div>
                          )}
                        </td>
                        <td>
                          <div className="order-table-actions">
                            {retainedOnly ? <span className="soft-badge">Только история</span> : null}
                            {projection.canOpenStockHandover ? (
                              <button
                                className="secondary compact order-stock-handover-trigger"
                                type="button"
                                disabled={savingOrder}
                                onClick={(event) => {
                                  event.stopPropagation()
                                  void openOrderStockHandover(order)
                                }}
                              >
                                {order.stock_handover_review_needed ? 'Проверить выдачу после ревизии' : 'Выдать готовые товары'}
                              </button>
                            ) : null}
                            {projection.canShip && !order.stock_handover_review_needed ? (
                              <button
                                className="secondary compact"
                                type="button"
                                disabled={savingOrder}
                                onClick={(event) => {
                                  event.stopPropagation()
                                  void markOrderSentToClient(order)
                                }}
                              >
                                {projection.needsCatalogClarification ? 'Уточнить товар' : 'Отправить клиенту'}
                              </button>
                            ) : null}
                            {projection.canShip && order.stock_handover_review_needed ? (
                              <span className="order-stock-handover-wait-note">Сначала проверьте выдачу после ревизии. После подтверждения появится «Отправить клиенту».</span>
                            ) : null}
                            {!retainedOnly && !archived && !projection.hasCommittedPhysicalDownstreamOperation && order.shipping_status !== 'sent' && projection.workshopPending ? (
                              <span className="order-stock-handover-wait-note">Отправить весь заказ можно после готовности Цеха</span>
                            ) : null}
                            {projection.canCorrectShipping ? (
                              <button
                                className="secondary compact"
                                type="button"
                                disabled={savingOrder}
                                onClick={(event) => {
                                  event.stopPropagation()
                                  void correctMistakenOrderShipping(order)
                                }}
                              >
                                Снять «Отправлен»
                              </button>
                            ) : !retainedOnly && !archived && order.shipping_status === 'sent' && projection.hasCommittedItemReturn ? (
                              <div className="order-correction-blocked">
                                <button
                                  className="secondary compact"
                                  type="button"
                                  disabled
                                  title="Сначала исправьте возврат товара."
                                >
                                  Снять «Отправлен»
                                </button>
                                <small>Сначала исправьте возврат товара</small>
                              </div>
                            ) : null}
                            {projection.canOpenDebt ? (
                              kaspiMode ? (
                                <button className="primary compact debt-action-button" type="button" disabled={Number(kaspiPaymentBusyOrderId || 0) === Number(order.id || 0)} onClick={(event) => { event.stopPropagation(); void confirmKaspiPayment(order) }}>
                                  {Number(kaspiPaymentBusyOrderId || 0) === Number(order.id || 0) ? 'Сохраняю…' : 'Подтвердить оплату'}
                                </button>
                              ) : (
                                <button className="secondary compact debt-action-button" type="button" onClick={(event) => { event.stopPropagation(); handleOpenDebt(order) }}>Закрыть долг</button>
                              )
                            ) : null}
                            {projection.canOpenReturn ? (
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
                            ) : null}
                            {projection.canOpenExchange ? (
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
                            ) : null}
                            {projection.hasCommittedDownstreamOperation ? (
                              <span className="soft-badge">
                                {projection.hasCommittedReturn && projection.hasCommittedExchange
                                  ? 'Есть проведённые возврат и обмен'
                                  : projection.hasCommittedExchange
                                    ? 'Есть проведённый обмен'
                                    : projection.hasCommittedItemReturn
                                      ? 'Есть проведённый возврат'
                                      : 'Есть возврат денег'}
                              </span>
                            ) : null}
                            {projection.canEdit ? (
                              <button
                                className="primary compact"
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation()
                                  handleEditOrder(order, kaspiMode ? 'kaspi' : 'orders')
                                }}
                              >
                                Редактировать
                              </button>
                            ) : null}
                            {!retainedOnly && !archived && !projection.deleted && order.pricing_mode === 'itemized_v1' && Array.isArray(order.items) && order.items.some((item) => Number(item.quantity) > 0 && Number(item.id) > 0) ? (
                              <div className="order-extra-actions">
                                <button className="secondary compact" type="button" aria-expanded={extraActionsOrderId === order.id}
                                  onClick={(event) => { event.stopPropagation(); setExtraActionsOrderId((current) => current === order.id ? null : order.id) }}>
                                  Доп. действия
                                </button>
                                {extraActionsOrderId === order.id ? (
                                  <button className="secondary compact" type="button" onClick={(event) => {
                                    event.stopPropagation()
                                    const first = order.items.find((item) => Number(item.quantity) > 0 && Number(item.id) > 0)
                                    if (!first) return
                                    setPriceDraft({order, itemId: Number(first.id), price: String(first.unitPrice ?? 0), error: ''})
                                  }}>
                                    Исправить записанную цену
                                  </button>
                                ) : null}
                                {extraActionsOrderId === order.id && Number(order.committed_exchange_count||0)>0 ? (
                                  <button className="secondary compact" type="button" onClick={(event) => {
                                    event.stopPropagation()
                                    setOldExchangePriceDraft({order,items:[],itemId:0,price:'',error:'',loading:true})
                                    void (async()=>{
                                      try {
                                        const items=await loadRetiredExchangePriceOptions(order)
                                        if(!items.length) {
                                          setOldExchangePriceDraft({order,items:[],itemId:0,price:'',loading:false,
                                            error:'В этом заказе нет полностью выведенных старых позиций обмена, которые можно исправить без проверки цепочки.'})
                                          return
                                        }
                                        setOldExchangePriceDraft({order,items,itemId:items[0].orderItemId,
                                          price:String(items[0].currentRecordedUnitPrice),error:'',loading:false})
                                      } catch(error) {
                                        setOldExchangePriceDraft({order,items:[],itemId:0,price:'',loading:false,
                                          error:error instanceof Error?error.message:'Не удалось загрузить историю обмена.'})
                                      }
                                    })()
                                  }}>
                                    Исправить цену товара до обмена
                                  </button>
                                ) : null}
                                {extraActionsOrderId === order.id && Number(order.committed_exchange_count||0)>0 ? (
                                  <button className="secondary compact" type="button" onClick={(event)=>{
                                    event.stopPropagation()
                                    setExchangeChainDraft({order,selected:0,available:[],preview:null,error:'',loading:true})
                                    void (async()=>{
                                      try {
                                        const result=await loadExchangeCancellationPreview(order)
                                        setExchangeChainDraft({order,selected:result.preview?.exchangeId||0,
                                          available:result.availableExchangeIds,preview:result.preview,error:'',loading:false})
                                      } catch(error) {
                                        setExchangeChainDraft({order,selected:0,available:[],preview:null,loading:false,
                                          error:error instanceof Error?error.message:'Не удалось загрузить зависимости обмена.'})
                                      }
                                    })()
                                  }}>Порядок отмены обменов</button>
                                ) : null}
                              </div>
                            ) : null}
                            {isAdmin && !retainedOnly && !archived ? (
                              <button
                                className="ghost danger compact"
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation()
                                  setAdminDeleteDraft({order,preview:null,error:'',loading:true,submitting:false})
                                  void (async()=>{
                                    try {
                                      const preview=await loadAdminOrderDeletePreview(order)
                                      setAdminDeleteDraft({order,preview,error:'',loading:false,submitting:false})
                                    } catch(error) {
                                      setAdminDeleteDraft({order,preview:null,loading:false,submitting:false,
                                        error:error instanceof Error?error.message:'Не удалось проверить заказ.'})
                                    }
                                  })()
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
                          Заказы не найдены. Попробуйте очистить фильтры.
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
              {adminDeleteDraft ? (
                <div className="modal-backdrop" role="presentation" onMouseDown={(event)=>{
                  if(event.target===event.currentTarget&&!adminDeleteDraft.submitting)setAdminDeleteDraft(null)
                }}>
                  <div className="modal-card" role="dialog" aria-modal="true"
                    aria-label="Проверка последствий удаления заказа" style={{maxWidth:620}}>
                    <div className="modal-head">
                      <div>
                        <div className="card-label">Только администратор</div>
                        <h3>Удаление заказа {adminDeleteDraft.order.external_id}</h3>
                      </div>
                      <button className="ghost compact" type="button" disabled={adminDeleteDraft.submitting}
                        onClick={()=>setAdminDeleteDraft(null)}>Закрыть</button>
                    </div>
                    {adminDeleteDraft.loading ? <p>Проверяю обмены, возвраты, оплаты и выдачи…</p> : null}
                    {adminDeleteDraft.error ? <p role="alert" className="error">{adminDeleteDraft.error}</p> : null}
                    {adminDeleteDraft.preview ? (
                      <>
                        <p><strong>{adminDeleteDraft.preview.canAttemptDelete ?
                          'Проверка пройдена: удаление можно запросить.' :
                          'Удаление заблокировано до исправления связанных операций.'}</strong></p>
                        <p>Обменов: {adminDeleteDraft.preview.activeExchanges.length} · Возвратов: {adminDeleteDraft.preview.activeReturns.length} ·
                          Оплат: {adminDeleteDraft.preview.paymentCount} ({formatMoney(adminDeleteDraft.preview.registeredPayments)} ₸) ·
                          Возвращено по активным возвратам: {formatMoney(adminDeleteDraft.preview.recordedRefunds)} ₸</p>
                        {adminDeleteDraft.preview.issuedItemCount ? (
                          <p>Отмечена выдача {adminDeleteDraft.preview.issuedQuantity} шт. по
                            {adminDeleteDraft.preview.issuedItemCount} складским записям.</p>
                        ) : null}
                        {adminDeleteDraft.preview.activeExchanges.length ? (
                          <p>Связанные обмены: #{adminDeleteDraft.preview.activeExchanges.join(', #')}</p>
                        ) : null}
                        {adminDeleteDraft.preview.activeReturns.length ? (
                          <p>Связанные возвраты: #{adminDeleteDraft.preview.activeReturns.join(', #')}</p>
                        ) : null}
                        {adminDeleteDraft.preview.reasons.length ? (
                          <ul>{adminDeleteDraft.preview.reasons.map((reason:string,i:number)=>
                            <li key={i}>{reason}</li>
                          )}</ul>
                        ) : null}
                        {adminDeleteDraft.preview.explanations.length ? (
                          <ul>{adminDeleteDraft.preview.explanations.map((reason:string,i:number)=>
                            <li key={i}>{reason}</li>
                          )}</ul>
                        ) : null}
                        <p className="muted">Удаление меняет учётную историю, но не возвращает деньги физически.
                          Если покупатель уже получил товар или деньги, сначала оформите фактическое движение.
                          При выдаче товара система отдельно потребует подтвердить физический факт.</p>
                      </>
                    ) : null}
                    <div className="toolbar-actions">
                      <button className="secondary" type="button" disabled={adminDeleteDraft.submitting}
                        onClick={()=>setAdminDeleteDraft(null)}>Отмена</button>
                      <button className="ghost danger" type="button"
                        disabled={adminDeleteDraft.loading||adminDeleteDraft.submitting||savingOrder||!adminDeleteDraft.preview?.canAttemptDelete}
                        onClick={()=>{void(async()=>{
                          setAdminDeleteDraft((d)=>d?{...d,submitting:true,error:''}:d)
                          const ok=await deleteOrderAsAdmin(adminDeleteDraft.order,true)
                          if(ok)setAdminDeleteDraft(null)
                          else setAdminDeleteDraft((d)=>d?{...d,submitting:false,
                            error:'Удаление не выполнено. Проверьте сообщение об ошибке и обновите проверку.'}:d)
                        })()}}>
                        {adminDeleteDraft.submitting?'Удаляю…':'Подтвердить удаление'}
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}
              {exchangeChainDraft ? (
                <div className="modal-backdrop" role="presentation" onMouseDown={(event)=>{
                  if(event.target===event.currentTarget)setExchangeChainDraft(null)
                }}>
                  <div className="modal-card" role="dialog" aria-modal="true" aria-label="Порядок отмены обменов" style={{maxWidth:580}}>
                    <div className="modal-head">
                      <div><div className="card-label">Только проверка зависимостей</div>
                        <h3>Порядок отмены — {exchangeChainDraft.order.external_id}</h3></div>
                      <button className="ghost compact" type="button" onClick={()=>setExchangeChainDraft(null)}>Закрыть</button>
                    </div>
                    {exchangeChainDraft.loading ? <p>Проверяю последовательность обменов и возвратов…</p> : null}
                    {exchangeChainDraft.error ? <p role="alert" className="error">{exchangeChainDraft.error}</p> : null}
                    {exchangeChainDraft.available.length>0 ? (
                      <label className="form-field"><span>Какой обмен нужно отменить?</span>
                        <select value={exchangeChainDraft.selected} disabled={exchangeChainDraft.loading}
                          onChange={(event)=>{
                            const exchangeId=Number(event.target.value)
                            setExchangeChainDraft((d)=>d?{...d,selected:exchangeId,loading:true,error:''}:d)
                            void (async()=>{
                              try {
                                const result=await loadExchangeCancellationPreview(exchangeChainDraft.order,exchangeId)
                                setExchangeChainDraft((d)=>d?{...d,loading:false,selected:exchangeId,
                                  preview:result.preview,available:result.availableExchangeIds,error:''}:d)
                              } catch(error) {
                                setExchangeChainDraft((d)=>d?{...d,loading:false,preview:null,
                                  error:error instanceof Error?error.message:'Не удалось обновить проверку.'}:d)
                              }
                            })()
                          }}>
                          {exchangeChainDraft.available.map((id:number)=><option key={id} value={id}>Обмен #{id}</option>)}
                        </select>
                      </label>
                    ) : null}
                    {exchangeChainDraft.preview ? (
                      <>
                        <p>{exchangeChainDraft.preview.notice}</p>
                        <ol>
                          {exchangeChainDraft.preview.steps.map((step:any)=>(
                            <li key={step.type+':'+step.id}>
                              {step.type==='return'?'Возврат':'Обмен'} #{step.id}
                              {' — '}{step.reason}{step.requiresManualReview?' (нужна ручная проверка)':''}
                            </li>
                          ))}
                        </ol>
                        <p className="muted">Это только рекомендуемый порядок. Отмены здесь не выполняются. Перед каждым действием система отдельно проверит финансы, склад и актуальность данных.</p>
                      </>
                    ) : !exchangeChainDraft.loading && !exchangeChainDraft.error ?
                      <p>У этого заказа нет активных обменов.</p> : null}
                    <div className="toolbar-actions">
                      <button type="button" className="secondary" onClick={()=>setExchangeChainDraft(null)}>Понятно</button>
                    </div>
                  </div>
                </div>
              ) : null}
              {oldExchangePriceDraft ? (
                <div className="modal-backdrop" role="presentation"
                  onMouseDown={(event)=>{if(event.target===event.currentTarget&&!savingOrder)setOldExchangePriceDraft(null)}}>
                  <form className="modal-card" role="dialog" aria-modal="true"
                    aria-label="Исправление цены до обмена" style={{maxWidth:560}}
                    onSubmit={(event)=>{event.preventDefault();void (async()=>{
                      if(!oldExchangePriceDraft||oldExchangePriceDraft.loading)return
                      const item=oldExchangePriceDraft.items.find((x:any)=>x.orderItemId===oldExchangePriceDraft.itemId)
                      const next=Number(oldExchangePriceDraft.price)
                      if(!item||!Number.isSafeInteger(next)||next<0){
                        setOldExchangePriceDraft((d)=>d?{...d,error:'Укажите целую корректную цену.'}:d);return
                      }
                      const ok=await correctRetiredExchangePrice(oldExchangePriceDraft.order,item,next)
                      if(ok){setOldExchangePriceDraft(null);setExtraActionsOrderId(null)}
                    })()}}>
                    <div className="modal-head">
                      <div>
                        <div className="card-label">Исправление исторической записи</div>
                        <h3>{oldExchangePriceDraft.order.external_id}</h3>
                      </div>
                      <button type="button" className="ghost compact" disabled={savingOrder}
                        onClick={()=>setOldExchangePriceDraft(null)}>Закрыть</button>
                    </div>
                    {oldExchangePriceDraft.loading?<p>Загружаю связанные позиции обмена…</p>:null}
                    {oldExchangePriceDraft.error?<p role="alert" className="error">{oldExchangePriceDraft.error}</p>:null}
                    {oldExchangePriceDraft.items.length>0?(
                      <>
                        <label className="form-field">
                          <span>Старая позиция обмена</span>
                          <select value={oldExchangePriceDraft.itemId} disabled={savingOrder}
                            onChange={(event)=>{
                              const itemId=Number(event.target.value)
                              const item=oldExchangePriceDraft.items.find((x:any)=>x.orderItemId===itemId)
                              setOldExchangePriceDraft((d)=>d?{...d,itemId,
                                price:String(item?.currentRecordedUnitPrice??0),error:''}:d)
                            }}>
                            {oldExchangePriceDraft.items.map((item:any)=>
                              <option key={item.exchangeId+':'+item.orderItemId} value={item.orderItemId}>
                                {item.productName} · {item.size||'—'} · {item.color||'—'} (обмен #{item.exchangeId})
                              </option>
                            )}
                          </select>
                        </label>
                        <p className="muted">Исправленная цена относится к старой позиции обмена, которая сейчас отсутствует в заказе. Деньги, склад и сам обмен не меняются.</p>
                        <label className="form-field">
                          <span>Правильная цена за 1 шт. (₸)</span>
                          <input type="number" min="0" step="1" required
                            disabled={savingOrder} value={oldExchangePriceDraft.price}
                            onChange={(event)=>setOldExchangePriceDraft((d)=>d?{...d,price:event.target.value,error:''}:d)}/>
                        </label>
                        <p className="muted">При последующей отмене обмена система проверит, допустимо ли восстановить товар по этой цене без несоответствия оплат и возвратов.</p>
                      </>
                    ):null}
                    <div className="toolbar-actions">
                      <button type="button" className="secondary" disabled={savingOrder}
                        onClick={()=>setOldExchangePriceDraft(null)}>Отмена</button>
                      <button className="primary" type="submit" disabled={savingOrder||oldExchangePriceDraft.loading||!oldExchangePriceDraft.items.length}>
                        {savingOrder?'Сохраняю…':'Сохранить исправление'}
                      </button>
                    </div>
                  </form>
                </div>
              ) : null}
              {priceDraft ? (
                <div className="modal-backdrop" role="presentation"
                  onMouseDown={(event) => { if (event.target === event.currentTarget && !savingOrder) setPriceDraft(null) }}>
                  <form className="modal-card" role="dialog" aria-modal="true" aria-label="Исправить записанную цену" style={{maxWidth: 560}}
                    onSubmit={(event) => { event.preventDefault(); void (async () => {
                      const item = priceDraft.order.items.find((entry: any) => Number(entry.id) === priceDraft.itemId)
                      const next = Number(priceDraft.price)
                      if (!item || !Number.isSafeInteger(next) || next < 0) {
                        setPriceDraft((current) => current ? {...current, error: 'Укажите целую цену от 0 ₸.'} : current)
                        return
                      }
                      const done = await correctRecordedOrderItemPrice(priceDraft.order, item, next)
                      if (done) { setPriceDraft(null); setExtraActionsOrderId(null) }
                    })() }}>
                    <div className="modal-head">
                      <div>
                        <div className="card-label">Исправление ошибки записи</div>
                        <h3>{priceDraft.order.external_id}</h3>
                      </div>
                      <button className="ghost compact" type="button" disabled={savingOrder} onClick={() => setPriceDraft(null)}>Закрыть</button>
                    </div>
                    <p>Исправляется только цена продажи в заказе. Склад, оплата, обмен и возврат не меняются.</p>
                    <label className="form-field">
                      <span>Товар</span>
                      <select value={priceDraft.itemId} disabled={savingOrder} onChange={(event) => {
                        const itemId = Number(event.target.value)
                        const selected = priceDraft.order.items.find((entry: any) => Number(entry.id) === itemId)
                        setPriceDraft((current) => current ? { ...current, itemId, price: String(selected?.unitPrice ?? 0), error: '' } : current)
                      }}>
                        {priceDraft.order.items.filter((item: any) => Number(item.quantity) > 0 && Number(item.id) > 0).map((item: any) => (
                          <option key={item.id} value={item.id}>{item.productName || 'Товар'} · {item.size || '—'} · {item.color || '—'} · ×{item.quantity}</option>
                        ))}
                      </select>
                    </label>
                    <label className="form-field">
                      <span>Правильная цена за 1 шт. (₸)</span>
                      <input type="number" min="0" step="1" inputMode="numeric" required value={priceDraft.price}
                        disabled={savingOrder} onChange={(event) => setPriceDraft((current) => current ? {...current, price: event.target.value, error: ''} : current)} />
                    </label>
                    {priceDraft.error ? <p role="alert" className="error">{priceDraft.error}</p> : null}
                    <p className="muted">Самостоятельный возврат не нужно отменять. Для товара из обмена V2 исправление разрешается только при однозначной связи и без последующих зависимых операций. Деньги, склад и исходная история обмена не изменяются.</p>
                    <div className="toolbar-actions">
                      <button className="secondary" type="button" disabled={savingOrder} onClick={() => setPriceDraft(null)}>Отмена</button>
                      <button className="primary" type="submit" disabled={savingOrder}>{savingOrder ? 'Сохраняю…' : 'Исправить цену'}</button>
                    </div>
                  </form>
                </div>
              ) : null}
            </article>
  )
}
