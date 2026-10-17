// @ts-nocheck -- view extracted from the legacy monolith; typed view-models are the next refactor stage.
import { useState } from 'react'
import { LinkedTableScroll } from '../../components/tables/LinkedTableScroll'
import { projectOrderOperationalState } from '../../app/orderOperationalProjection'
type SectionContext = Record<string, any>

export function OrdersTableSection({ ctx }: { ctx: SectionContext }) {
  const [expandedOrderPaymentCounts, setExpandedOrderPaymentCounts] = useState<Record<number, number>>({})
  const [extraActionsOrderId, setExtraActionsOrderId] = useState<number | null>(null)
  const [metadataDraft,setMetadataDraft]=useState<{
    order:any;next:Record<string,string>;error:string;
  }|null>(null)
  // Historical old V2 pricing keeps its backend/audit for rare reconciliation,
  // but no longer clutters the everyday order menu.
  const showRetiredExchangePriceActions=false
  const [priceDraft, setPriceDraft] = useState<{order: any; prices: Record<number,string>; error: string} | null>(null)
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
    correctOrderMetadata,
    correctRecordedOrderItemPrice,
    correctRecordedOrderItemPrices,
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
    suggestionValues,
    summarizeOrderItemLines,
    summarizeOrderPaymentLines,
    summary,
    waitingDaysLabel,
    busy,
    changeOrderPage,
    orderPageInfo,
    workspaceSector = 'orders',
  } = ctx

  const priceItems = priceDraft ? (priceDraft.order.items || []).filter(
    (item:any)=>Number(item.id)>0 && Number(item.quantity)>0,
  ) : []
  const priceChanges = priceItems.flatMap((item:any)=>{
    const nextText = priceDraft?.prices[Number(item.id)] ?? ''
    const next = Number(nextText)
    return nextText.trim() !== '' && Number.isSafeInteger(next) && next >= 0
      && next !== Number(item.unitPrice || 0) ? [{item,unitPrice:next}] : []
  })
  const priceDifference = priceChanges.reduce((sum:number,change:any)=>
    sum + Number(change.item.quantity || 0) *
      (change.unitPrice - Number(change.item.unitPrice || 0)),0)
  const priceHasInvalid = priceItems.some((item:any)=>{
    const value = priceDraft?.prices[Number(item.id)] ?? ''
    return value.trim()==='' || !Number.isSafeInteger(Number(value)) || Number(value)<0
  })
  const deleteReasons = adminDeleteDraft?.preview
    ? [...new Set<string>(adminDeleteDraft.preview.reasons || [])] : []

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
                            {!retainedOnly && !archived && !projection.deleted ? (
                              <div className="order-extra-actions">
                                <button className="secondary compact" type="button" aria-expanded={extraActionsOrderId === order.id}
                                  onClick={(event) => { event.stopPropagation(); setExtraActionsOrderId((current) => current === order.id ? null : order.id) }}>
                                  Доп. действия
                                </button>
                                {extraActionsOrderId === order.id ? (
                                  <button className="secondary compact" type="button"
                                    onClick={(event)=>{
                                      event.stopPropagation()
                                      setMetadataDraft({order,error:'',next:{
                                        orderDate:String(order.order_date||'').trim(),
                                        customerPhone:String(order.customer_phone||'').trim(),
                                        customerName:String(order.customer_name||'').trim(),
                                        city:String(order.city||'').trim(),
                                        deliveryType:String(order.delivery_type||'').trim(),
                                        comment:String(order.comment||'').trim(),
                                      }})
                                    }}>
                                    Исправить реквизиты
                                  </button>
                            ) : null}
                                {extraActionsOrderId === order.id && order.pricing_mode === 'itemized_v1' && Array.isArray(order.items) && order.items.some((item:any) => Number(item.id)>0 && Number(item.quantity)>0) ? (
                                  <button className="secondary compact" type="button" onClick={(event) => {
                                    event.stopPropagation()
                                    const first = order.items.find((item) => Number(item.quantity) > 0 && Number(item.id) > 0)
                                    if (!first) return
                                    setPriceDraft({order,
                                      prices: Object.fromEntries(order.items
                                        .filter((item:any)=>Number(item.id)>0 && Number(item.quantity)>0)
                                        .map((item:any)=>[Number(item.id),String(item.unitPrice ?? 0)])),
                                      error: '',
                                    })
                                  }}>
                                    Исправить записанную цену
                                  </button>
                                ) : null}
                                {showRetiredExchangePriceActions && extraActionsOrderId === order.id && Number(order.committed_exchange_count||0)>0 ? (
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
                    aria-label="Проверка последствий удаления заказа" style={{maxWidth:620,maxHeight:"min(86vh,740px)",overflowY:"auto"}}>
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
                        <div role="status" style={{padding:'12px 14px',margin:'12px 0',
                          borderRadius:12,border:'1px solid var(--border, #dce1e8)'}}>
                          <strong>{adminDeleteDraft.preview.canAttemptDelete
                            ?'Заказ можно удалить':'Сейчас удалить заказ нельзя'}</strong>
                          <p className="muted" style={{margin:'6px 0 0'}}>
                            {adminDeleteDraft.preview.canAttemptDelete
                              ?'Подтвердите удаление: действие изменит учётную историю.'
                              :'Сначала проверьте связанные операции. Никакие данные пока не изменены.'}
                          </p>
                        </div>
                        <p className="muted" style={{margin:'8px 0'}}>
                          Обменов: {adminDeleteDraft.preview.activeExchanges.length} ·
                          Возвратов: {adminDeleteDraft.preview.activeReturns.length} ·
                          Оплат: {formatMoney(adminDeleteDraft.preview.registeredPayments)} ₸
                        </p>
                        {!adminDeleteDraft.preview.canAttemptDelete && deleteReasons.length ? (
                          <div>
                            <strong>Что мешает:</strong>
                            <ul>{deleteReasons.slice(0,3).map((reason:string,i:number)=>(
                              <li key={i}>{reason}</li>
                            ))}</ul>
                            {deleteReasons.length>3 ? (
                              <p className="muted">Ещё причин: {deleteReasons.length-3}. Они показаны в подробностях.</p>
                            ) : null}
                          </div>
                        ) : null}
                        {(adminDeleteDraft.preview.chainPlan?.steps?.length||
                          deleteReasons.length>3||adminDeleteDraft.preview.explanations?.length) ? (
                          <details style={{margin:'14px 0'}}>
                            <summary style={{cursor:'pointer',fontWeight:600}}>
                              Подробности проверки и порядок действий
                            </summary>
                            <div style={{marginTop:10}}>
                              {adminDeleteDraft.preview.chainPlan?.steps?.length ? (
                                <>
                                  <p><strong>Порядок, в котором нужно разбирать связанные операции:</strong></p>
                                  <ol>{adminDeleteDraft.preview.chainPlan.steps.map((step:any)=>(
                                    <li key={step.type+':'+step.id}>
                                      {step.type==='return'?'Возврат':'Обмен'} #{step.id}
                                      {step.requiresManualReview?' — нужна ручная проверка':''}
                                    </li>
                                  ))}</ol>
                                </>
                              ) : null}
                              {deleteReasons.length>3 ? (
                                <ul>{deleteReasons.slice(3).map((reason:string,i:number)=>(
                                  <li key={i}>{reason}</li>
                                ))}</ul>
                              ) : null}
                              {adminDeleteDraft.preview.issuedItemCount ? (
                                <p>Выдано: {adminDeleteDraft.preview.issuedQuantity} шт.</p>
                              ) : null}
                              {adminDeleteDraft.preview.recordedRefunds>0 ? (
                                <p>Отражено возвратов денег: {formatMoney(adminDeleteDraft.preview.recordedRefunds)} ₸</p>
                              ) : null}
                              <p className="muted">План отображается только для проверки.
                                Из этого окна обмены и возвраты не отменяются автоматически.</p>
                            </div>
                          </details>
                        ) : null}
                        <p className="muted" style={{fontSize:13}}>
                          Удаление записи не возвращает деньги или товар покупателю.
                          Реальное движение денег и товара нужно проверить отдельно.</p>
                      </>
                    ) : null}
                    <div className="toolbar-actions">
                      <button className="secondary" type="button" disabled={adminDeleteDraft.submitting}
                        onClick={()=>setAdminDeleteDraft(null)}>Закрыть</button>
                      {adminDeleteDraft.preview?.canAttemptDelete &&
                        adminDeleteDraft.preview?.chainPlan?.snapshotFingerprint ? (
                        <button className="ghost danger" type="button"
                          disabled={adminDeleteDraft.loading||adminDeleteDraft.submitting||savingOrder}
                          onClick={()=>{void(async()=>{
                            setAdminDeleteDraft((d)=>d?{...d,submitting:true,error:''}:d)
                            const ok=await deleteOrderAsAdmin(adminDeleteDraft.order,true,adminDeleteDraft.preview.chainPlan.snapshotFingerprint)
                            if(ok)setAdminDeleteDraft(null)
                            else setAdminDeleteDraft((d)=>d?{...d,submitting:false,
                              error:'Удаление не выполнено. Проверьте сообщение об ошибке и обновите проверку.'}:d)
                          })()}}>
                          {adminDeleteDraft.submitting?'Удаляю…':'Подтвердить удаление'}
                        </button>
                      ) : null}
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
                  onMouseDown={(event)=>{if(event.target===event.currentTarget&&!savingOrder)setPriceDraft(null)}}>
                  <form className="modal-card" role="dialog" aria-modal="true"
                    aria-label="Исправить цены в заказе"
                    style={{maxWidth:680,maxHeight:'min(88vh,760px)',overflowY:'auto'}}
                    onSubmit={(event)=>{event.preventDefault();void(async()=>{
                      if(priceHasInvalid||!priceChanges.length){
                        setPriceDraft((current)=>current?{...current,error:priceHasInvalid
                          ?'Для каждой позиции укажите целую цену от 0 ₸.':'Измените цену хотя бы одной позиции.'}:current)
                        return
                      }
                      // A linked V2 line is intentionally NOT bundled with any
                      // other correction. The server checks this independently.
                      const done=priceChanges.length===1
                        ?await correctRecordedOrderItemPrice(priceDraft.order,priceChanges[0].item,priceChanges[0].unitPrice)
                        :await correctRecordedOrderItemPrices(priceDraft.order,priceChanges)
                      if(done){setPriceDraft(null);setExtraActionsOrderId(null)}
                      else setPriceDraft((current)=>current?{...current,
                        error:'Не удалось сохранить. Проверьте сообщение об ошибке и обновите заказ.'}:current)
                    })()}}>
                    <div className="modal-head">
                      <div>
                        <div className="card-label">Исправление записанных цен</div>
                        <h3>{priceDraft.order.external_id}</h3>
                      </div>
                      <button className="ghost compact" type="button" disabled={savingOrder}
                        onClick={()=>setPriceDraft(null)}>Закрыть</button>
                    </div>
                    <p>Измените нужные цены. Неизменённые позиции останутся как были.</p>
                    <div style={{display:'grid',gap:12,margin:'14px 0'}}>
                      {priceItems.map((item:any)=>{
                        const id=Number(item.id)
                        const current=Number(item.unitPrice||0)
                        const changed=priceDraft.prices[id]?.trim()!=='' &&
                          Number(priceDraft.prices[id])!==current
                        return (
                          <div key={id} style={{
                            display:'flex',flexWrap:'wrap',gap:12,alignItems:'center',
                            padding:'12px 14px',border:'1px solid var(--border, #dce1e8)',
                            borderRadius:12,background:changed?'var(--surface-soft, #f2f6ff)':undefined,
                          }}>
                            <div style={{flex:'1 1 240px',minWidth:0}}>
                              <strong style={{overflowWrap:'anywhere'}}>{item.productName||'Товар'}</strong>
                              <div className="muted" style={{fontSize:13}}>
                                {[item.size,item.color].filter(Boolean).join(' · ')||'Без характеристик'} · {Number(item.quantity)} шт.
                              </div>
                              <div className="muted" style={{fontSize:13}}>Было: {formatMoney(current)} ₸ / шт.</div>
                            </div>
                            <label className="form-field" style={{flex:'1 1 170px',minWidth:0,maxWidth:'100%',margin:0,boxSizing:'border-box'}}>
                              <span>Новая цена, ₸ / шт.</span>
                              <input aria-label={`Новая цена: ${item.productName||'Товар'}`}
                                type="number" min="0" step="1" inputMode="numeric" required
                                style={{display:'block',width:'100%',maxWidth:'100%',minWidth:0,boxSizing:'border-box'}}
                                value={priceDraft.prices[id]??''} disabled={savingOrder}
                                onChange={(event)=>setPriceDraft((draft)=>draft?{
                                  ...draft,prices:{...draft.prices,[id]:event.target.value},error:'',
                                }:draft)} />
                            </label>
                          </div>
                        )
                      })}
                    </div>
                    <p className="muted" style={{margin:'4px 0'}}>
                      Изменено позиций: <strong>{priceChanges.length}</strong>
                      {priceChanges.length ? ` · Разница по заказу: ${priceDifference>0?'+':''}${formatMoney(priceDifference)} ₸` : ''}
                    </p>
                    {Number(priceDraft.order.committed_exchange_count||0)>0 ? (
                      <p className="muted">Если цена позиции связана с обменом, исправьте её отдельно.
                        Проверка истории выполняется при сохранении.</p>
                    ) : null}
                    {priceDraft.error ? <p role="alert" className="error">{priceDraft.error}</p> : null}
                    <div className="toolbar-actions">
                      <button className="secondary" type="button" disabled={savingOrder}
                        onClick={()=>setPriceDraft(null)}>Отмена</button>
                      <button className="primary" type="submit"
                        disabled={savingOrder||priceHasInvalid||priceChanges.length===0}>
                        {savingOrder?'Сохраняю…':`Сохранить изменений: ${priceChanges.length}`}
                      </button>
                    </div>
                    <p className="muted" style={{fontSize:12}}>
                      Склад, оплаты и история обменов не меняются. Цены сохраняются только после проверки заказа сервером.</p>
                  </form>
                </div>
              ) : null}
              {metadataDraft ? (
                <div className="modal-backdrop" role="presentation"
                  onMouseDown={(event)=>{if(event.target===event.currentTarget&&!savingOrder)setMetadataDraft(null)}}>
                  <form className="modal-card" role="dialog" aria-modal="true"
                    aria-label="Исправить реквизиты заказа"
                    style={{maxWidth:680,maxHeight:'min(88vh,760px)',overflowY:'auto',boxSizing:'border-box'}}
                    onSubmit={(event)=>{event.preventDefault();void(async()=>{
                      const next=metadataDraft.next as {
                        orderDate:string;customerPhone:string;customerName:string;
                        city:string;deliveryType:string;comment:string;
                      }
                      if(next.orderDate.trim() && !/^\d{4}-\d{2}-\d{2}$/.test(next.orderDate)){
                        setMetadataDraft((d)=>d?{...d,error:'Укажите дату в формате ГГГГ-ММ-ДД.'}:d)
                        return
                      }
                      const ok=await correctOrderMetadata(metadataDraft.order,next)
                      if(ok)setMetadataDraft(null)
                      else setMetadataDraft((d)=>d?{...d,error:'Не удалось сохранить. Проверьте сообщение об ошибке и обновите заказ.'}:d)
                    })()}}>
                    <div className="modal-head">
                      <div>
                        <div className="card-label">Реквизиты заказа</div>
                        <h3>{metadataDraft.order.external_id}</h3>
                      </div>
                      <button className="ghost compact" type="button" disabled={savingOrder}
                        onClick={()=>setMetadataDraft(null)}>Закрыть</button>
                    </div>
                    <p>Можно исправить сведения о заказе без изменения состава, цен, оплат и склада.</p>
                    <p className="muted" style={{fontSize:13,marginTop:0}}>Все поля необязательны. Если оставить дату пустой, прежняя дата заказа сохранится.</p>
                    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,240px),1fr))',
                      gap:12,margin:'12px 0'}}>
                      {([
                        ['orderDate','Дата заказа'],
                        ['customerName','Имя клиента'],
                        ['customerPhone','Телефон клиента'],
                        ['city','Город'],
                        ['deliveryType','Способ доставки'],
                      ] as const).map(([key,name])=>(
                        <label key={key} className="form-field" style={{minWidth:0,margin:0}}>
                          <span>{name}</span>
                          {key==='city'||key==='deliveryType' ? (
                            <select
                              aria-label={name}
                              disabled={savingOrder}
                              value={metadataDraft.next[key]||''}
                              style={{width:'100%',maxWidth:'100%',minWidth:0,boxSizing:'border-box'}}
                              onChange={(event)=>setMetadataDraft((d)=>d?{
                                ...d,next:{...d.next,[key]:event.target.value},error:'',
                              }:d)}>
                              <option value="">Не указано</option>
                              {[...new Set([
                                ...(Array.isArray(key==='city'?suggestionValues?.cities:suggestionValues?.deliveryTypes)
                                  ? (key==='city'?suggestionValues.cities:suggestionValues.deliveryTypes) : [])
                                  .map((value:any)=>String(value||'').trim()).filter(Boolean),
                                String(metadataDraft.next[key]||'').trim(),
                              ].filter(Boolean))].map((value:string)=>(
                                <option key={value} value={value}>{value}</option>
                              ))}
                            </select>
                          ) : (
                            <input type={key==='orderDate'?'date':'text'}
                              disabled={savingOrder||(key==='orderDate'&&!isAdmin)}
                              value={metadataDraft.next[key]||''}
                              style={{width:'100%',maxWidth:'100%',minWidth:0,boxSizing:'border-box'}}
                              onChange={(event)=>setMetadataDraft((d)=>d?{
                                ...d,next:{...d.next,[key]:event.target.value},error:'',
                              }:d)}/>
                          )}
                        </label>
                      ))}
                    </div>
                    <label className="form-field" style={{minWidth:0}}>
                      <span>Комментарий к заказу</span>
                      <textarea rows={3} disabled={savingOrder}
                        style={{width:'100%',maxWidth:'100%',minWidth:0,boxSizing:'border-box'}}
                        value={metadataDraft.next.comment||''}
                        onChange={(event)=>setMetadataDraft((d)=>d?{
                          ...d,next:{...d.next,comment:event.target.value},error:'',
                        }:d)}/>
                    </label>
                    {!isAdmin?<p className="muted">Дата заказа доступна для исправления администратору.</p>:null}
                    {metadataDraft.error?<p className="error" role="alert">{metadataDraft.error}</p>:null}
                    <div className="toolbar-actions">
                      <button className="secondary" type="button" disabled={savingOrder}
                        onClick={()=>setMetadataDraft(null)}>Отмена</button>
                      <button className="primary" type="submit" disabled={savingOrder}>
                        {savingOrder?'Сохраняю…':'Сохранить реквизиты'}
                      </button>
                    </div>
                    <p className="muted" style={{fontSize:12}}>
                      При изменении заказа другим сотрудником сохранение будет остановлено — обновите данные и повторите.</p>
                  </form>
                </div>
              ) : null}
            </article>
  )
}
