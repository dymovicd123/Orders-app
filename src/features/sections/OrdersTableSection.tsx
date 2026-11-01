// @ts-nocheck -- view extracted from the legacy monolith; typed view-models are the next refactor stage.
import { useState } from 'react'
import { LinkedTableScroll } from '../../components/tables/LinkedTableScroll'
import { projectOrderOperationalState } from '../../app/orderOperationalProjection'
import { projectOrderShipmentDisplay } from '../../app/orderShipmentProjection'
import './OrderShipmentStatus.css'
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
    order:any;mode:'last'|'all';plan:any|null;error:string;loading:boolean;submitting:boolean;progress:string;
  } | null>(null)
  const [linkedAdminEditOrder,setLinkedAdminEditOrder] = useState<any|null>(null)
  const [linkedPaymentDraft,setLinkedPaymentDraft]=useState<{
    order:any;paymentId:number;method:string;error:string;
  }|null>(null)
  const [returnCancelDraft,setReturnCancelDraft]=useState<{
    order:any;choices:any[];selectedId:number;loading:boolean;submitting:boolean;error:string;
  }|null>(null)
  const [dispatchDraft,setDispatchDraft] = useState<{
    order:any;plan:any|null;history:any[];loading:boolean;submitting:boolean;
    error:string;selected:Record<number,number>;requestId:string;
    correctionKey:string;correctionItemId:number;
  }|null>(null)
  const [pendingReservationDraft,setPendingReservationDraft] = useState<{
    order:any;item:any;preview:any|null;error:string;loading:boolean;submitting:boolean;
  }|null>(null)
  const [adminDeleteDraft,setAdminDeleteDraft] = useState<{
    order:any;preview:any|null;error:string;loading:boolean;submitting:boolean;progress?:string;
    physicalAnswer?:'undecided'|'not_issued'|'issued';
  } | null>(null)
  const {
    correctMistakenOrderShipping,
    correctOrderMetadata,
    correctRecordedOrderItemPrice,
    correctRecordedOrderItemPrices,
    correctRecordedPaymentMethod,
    loadRetiredExchangePriceOptions,
    correctRetiredExchangePrice,
    loadExchangeCancellationPreview,
    loadOrderExchangeCancellationPlan,
    cancelOrderExchangeChain,
    loadOrderReturnCancellationChoices,
    cancelOrderReturnChoice,
    loadAdminOrderDeletePreview,
    deleteOrderAsAdmin,
    executeAdminDeleteChain,
    confirmAdminDeletePhysicalBeforeChain,
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
    ManagerBadge,
    markOrderSentToClient,
    markExchangeReplacementSent,
    apiFetch,
    askActionConfirmation,
    onPendingReservationResolved,
    onShipmentChange,
    canResolvePendingReservation,
    setMessage,
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

  const newDispatchRequestId=()=>`order-dispatch:${crypto.randomUUID()}`
  const openDispatchDraft=(order:any)=>{
    setDispatchDraft({order,plan:null,history:[],loading:true,submitting:false,
      error:'',selected:{},requestId:newDispatchRequestId(),correctionKey:'',correctionItemId:0})
    void (async()=>{
      try{
        const [planRes,historyRes]=await Promise.all([
          apiFetch(`/api/orders/${order.id}/shipping/plan`),
          apiFetch(`/api/orders/${order.id}/shipping/dispatches`),
        ])
        const [plan,history]=await Promise.all([planRes.json(),historyRes.json()])
        if(!planRes.ok||!plan.ok)throw new Error(plan.message||'Не удалось загрузить готовые товары.')
        if(!historyRes.ok||!history.ok)throw new Error(history.message||'Не удалось загрузить отправки.')
        const selected=Object.fromEntries((plan.lines||[]).filter((row:any)=>row.selectable)
          .map((row:any)=>[Number(row.orderItemId),Number(row.selectedQuantity)]))
        setDispatchDraft(d=>d?.order.id===order.id?{...d,loading:false,plan,
          history:history.dispatches||[],selected,error:''}:d)
      }catch(e){
        setDispatchDraft(d=>d?.order.id===order.id?{...d,loading:false,
          error:e instanceof Error?e.message:'Не удалось загрузить отправки.'}:d)
      }
    })()
  }
  const submitSelectedDispatch=()=>{
    const d=dispatchDraft
    if(!d||d.loading||d.submitting)return
    const items=(d.plan?.lines||[]).flatMap((row:any)=>{
      const quantity=Number(d.selected[Number(row.orderItemId)]||0)
      return row.selectable&&Number.isSafeInteger(quantity)&&quantity>0
        ? [{orderItemId:Number(row.orderItemId),quantity}] : []
    })
    if(!items.length){setDispatchDraft(v=>v?{...v,error:'Выберите хотя бы одну готовую вещь.'}:v);return}
    setDispatchDraft(v=>v?{...v,submitting:true,error:''}:v)
    void (async()=>{
      try{
        const res=await apiFetch(`/api/orders/${d.order.id}/shipping/dispatches`,{
          method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({requestId:d.requestId,items}),
        })
        const data=await res.json()
        if(!res.ok||!data.ok)throw new Error(data.message||'Не удалось отправить товары.')
        setDispatchDraft(null)
        setMessage(`Заказ ${d.order.external_id}: отправлено ${data.shippedQuantity||items.reduce((n:any,x:any)=>n+x.quantity,0)} шт.`)
        await onShipmentChange()
      }catch(e){
        setDispatchDraft(v=>v?.order.id===d.order.id?{...v,submitting:false,
          error:e instanceof Error?e.message:'Ошибка отправки. Повторите без изменения выбора.'}:v)
      }
    })()
  }
  const cancelDispatchedLine=(line:any)=>{
    const d=dispatchDraft
    if(!d||d.submitting)return
    void (async()=>{
      const yes=await askActionConfirmation(
        `Отменить отправку товара «${line.productName}», ${line.quantity} шт.? Подтверждайте только если клиенту эту вещь фактически не передавали. Если вещь уже у клиента, оформите возврат.`
      )
      if(!yes)return
      const key=d.correctionItemId===Number(line.dispatchItemId)&&d.correctionKey
        ? d.correctionKey : newDispatchRequestId()
      setDispatchDraft(v=>v?{...v,submitting:true,error:'',correctionKey:key,
        correctionItemId:Number(line.dispatchItemId)}:v)
      try{
        const res=await apiFetch(`/api/orders/${d.order.id}/shipping/dispatch-items/${line.dispatchItemId}/correct`,{
          method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({requestId:key,reason:'Исправление ошибочной отправки'}),
        })
        const data=await res.json()
        if(!res.ok||!data.ok)throw new Error(data.message||'Не удалось исправить отправку.')
        setDispatchDraft(null)
        setMessage(data.needsStockCheck
          ? 'Отправка исправлена. После недавнего пересчёта остаток автоматически не увеличен — уточните количество на складе.'
          : 'Отправка исправлена. Остальные товары заказа не изменились.')
        await onShipmentChange()
      }catch(e){
        setDispatchDraft(v=>v?.order.id===d.order.id?{...v,submitting:false,
          error:e instanceof Error?e.message:'Не удалось исправить отправку.'}:v)
      }
    })()
  }

  const openPendingReservation=(order:any,item:any)=>{
    const draft={order,item,preview:null,error:'',loading:true,submitting:false}
    setPendingReservationDraft(draft)
    void (async()=>{
      try{
        const response=await apiFetch(`/api/orders/${order.id}/items/${item.id}/pending-reservation`)
        const result=await response.json()
        if(!response.ok||!result.ok)throw new Error(result.message||'Не удалось проверить резерв.')
        setPendingReservationDraft(current=>current?.order.id===order.id&&current?.item.id===item.id
          ? {...current,preview:result,loading:false,error:''}:current)
      }catch(error){
        setPendingReservationDraft(current=>current?.order.id===order.id&&current?.item.id===item.id
          ? {...current,loading:false,error:error instanceof Error?error.message:'Ошибка проверки резерва'}:current)
      }
    })()
  }
  const submitPendingReservation=(allowShortage:boolean)=>{
    if(!pendingReservationDraft?.preview?.pending||pendingReservationDraft.submitting)return
    const {order,item,preview}=pendingReservationDraft
    setPendingReservationDraft(current=>current?{...current,submitting:true,error:''}:current)
    void (async()=>{
      try{
        const response=await apiFetch(`/api/orders/${order.id}/items/${item.id}/pending-reservation`,{
          method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({snapshot:preview.snapshot,allowShortage}),
        })
        const result=await response.json()
        if(!response.ok||!result.ok)throw new Error(result.message||'Не удалось закрепить резерв.')
        setPendingReservationDraft(null)
        setMessage(`Заказ ${order.external_id}: резерв позиции «${item.productName}» закреплён. Физический остаток не изменялся.`)
        await onPendingReservationResolved()
      }catch(error){
        setPendingReservationDraft(current=>current?{
          ...current,submitting:false,
          error:(error instanceof Error?error.message:'Ошибка сохранения')+' Обновите данные перед повторным решением.',
        }:current)
      }
    })()
  }

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
  // Ask only when the SERVER found recorded handover, not for every unshipped order.
  const physicalQuestionRequired=Boolean(adminDeleteDraft?.preview
    &&!adminDeleteDraft.preview.activeSaga
    &&(adminDeleteDraft.preview.requiresPhysicalFact
      ||(adminDeleteDraft.preview.appliedStockReview?.appliedCount>0
        &&adminDeleteDraft.preview.appliedStockReview?.allowed)))
  const deleteReasons = adminDeleteDraft?.preview
    ? [...new Set<string>(adminDeleteDraft.preview.reasons || [])].filter(reason=>
      !(adminDeleteDraft.preview?.canPreparePhysicalCorrection
        && reason.startsWith('Для цепочки с зафиксированной выдачей товара'))) : []


  const openLinkedPaymentCorrection=(order:any)=>{
    const payment=Array.isArray(order.payments)?order.payments.find((p:any)=>Number(p.id)>0):null
    if(!payment)return
    setLinkedPaymentDraft({order,paymentId:Number(payment.id),method:String(payment.method||''),error:''})
  }
  const openMetadataCorrection=(order:any)=>setMetadataDraft({order,error:'',next:{
    orderDate:String(order.order_date||'').trim(),
    customerPhone:String(order.customer_phone||'').trim(),
    customerName:String(order.customer_name||'').trim(),
    city:String(order.city||'').trim(),
    deliveryType:String(order.delivery_type||'').trim(),
    comment:String(order.comment||'').trim(),
  }})
  const openPriceCorrection=(order:any)=>setPriceDraft({order,error:'',
    prices:Object.fromEntries((order.items||[])
      .filter((item:any)=>Number(item.id)>0&&Number(item.quantity)>0)
      .map((item:any)=>[Number(item.id),String(item.unitPrice??0)])),
  })
  const openExchangeCancellation=(order:any,mode:'last'|'all')=>{
    setExchangeChainDraft({order,mode,plan:null,error:'',loading:true,submitting:false,progress:''})
    void (async()=>{
      try{
        const plan=await loadOrderExchangeCancellationPlan(order,mode)
        setExchangeChainDraft(d=>d&&d.order.id===order.id&&d.mode===mode?{...d,plan,loading:false,error:''}:d)
      }catch(error){
        setExchangeChainDraft(d=>d&&d.order.id===order.id&&d.mode===mode
          ?{...d,plan:null,loading:false,error:error instanceof Error?error.message:'Проверка не удалась.'}:d)
      }
    })()
  }

  const openReturnCancel=(order:any)=>{
    setReturnCancelDraft({order,choices:[],selectedId:0,loading:true,submitting:false,error:''})
    void(async()=>{
      try{
        const choices=await loadOrderReturnCancellationChoices(order)
        setReturnCancelDraft(d=>d&&d.order.id===order.id
          ?{...d,choices,selectedId:choices.find((choice:any)=>!choice.parentExchangeId)?.id||choices[0]?.id||0,
            loading:false,error:''}:d)
      }catch(error){
        setReturnCancelDraft(d=>d&&d.order.id===order.id
          ?{...d,choices:[],loading:false,error:error instanceof Error?error.message:'Не удалось загрузить возвраты.'}:d)
      }
    })()
  }

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
                      const returnTruth = order.return_physical_summary
                      const shipmentDisplay = projectOrderShipmentDisplay(order)
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
                        className={`${selectedOrderId === order.id ? 'row-active' : ''} ${archived ? 'row-archived' : ''}`}
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
                                  <small className={`order-item-shipment-status is-${shipmentDisplay.lines[index]?.state || 'unknown'}`}>
                                    {shipmentDisplay.lines[index]?.label || 'Отправка не уточнена'}
                                  </small>
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
                            <small>{shipmentDisplay.label}{shipmentDisplay.state === 'sent' && order.shipping_date ? ` · ${order.shipping_date}` : ''}</small>
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
                        <td>
                          <div className="order-cell-stack">
                            <strong>{formatMoney(projection.debtAmount)}</strong>
                            {projection.refundAmount > 0 ? (
                              <small>После возвратов к зачёту {formatMoney(projection.netRetainedAmount)}. Следующая операция пересчитает сумму.</small>
                            ) : null}
                          </div>
                        </td>
                        <td>
                          {retainedOnly ? (
                            <div className="order-status-stack">
                              <span className="status-pill status-neutral">Краткая история</span>
                              <small>Без детальных операций</small>
                            </div>
                          ) : (
                            <div className="order-status-stack">
                              <span className={`status-pill ${projection.paymentClass}`}>{projection.paymentLabel}</span>
                              <span className={`status-pill ${shipmentDisplay.state === 'sent' ? 'status-online' : shipmentDisplay.state === 'partial' ? 'status-warning' : 'status-neutral'}`}>{shipmentDisplay.label}</span>
                              {projection.workshopLabel ? <small>{projection.workshopLabel}</small> : null}
                              {returnTruth ? (
                                <div className="order-return-truth" aria-label="Что известно о возвратах">
                                  {returnTruth.moneyOnlyCount > 0 ? <small>Возврат только денег: {returnTruth.moneyOnlyCount}</small> : null}
                                  {returnTruth.moneyAndGoodsCount > 0 ? <small>Возврат товаров и денег: {returnTruth.moneyAndGoodsCount}</small> : null}
                                  {returnTruth.goodsOnlyCount > 0 ? <small>Возврат только товаров: {returnTruth.goodsOnlyCount}</small> : null}
                                  {returnTruth.pendingQuantity > 0 ? <small>Товары ещё едут: {returnTruth.pendingQuantity} шт. — не на остатке</small> : null}
                                  {returnTruth.receivedStockQuantity > 0 ? <small>Физически получили в Склад/Бутик: {returnTruth.receivedStockQuantity} шт.</small> : null}
                                  {returnTruth.receivedNoStockQuantity > 0 ? <small>Получили без добавления в остаток: {returnTruth.receivedNoStockQuantity} шт.</small> : null}
                                  {returnTruth.legacyUnknownQuantity > 0 ? <small>Старая история, получение неизвестно: {returnTruth.legacyUnknownQuantity} шт.</small> : null}
                                  {returnTruth.moneyOnlyCount > 0 && returnTruth.moneyAndGoodsCount === 0 && returnTruth.goodsOnlyCount === 0
                                    ? <small>Физический возврат вещей не зафиксирован</small> : null}
                                </div>
                              ) : null}
                              <small>{waitingDaysLabel(order)}</small>
                              <small>{projection.lifecycleLabel}</small>
                            </div>
                          )}
                        </td>
                        <td>
                          <div className="order-table-actions">
                            {retainedOnly ? <span className="soft-badge">Только история</span> : null}
                            {!retainedOnly && !archived && !projection.deleted ? (order.items || [])
                              .filter((item: any) => Number(item.pendingExchangeDispatchId || 0) > 0 && Number(item.quantity || 0) > 0)
                              .map((item: any) => (
                                <button
                                  key={`exchange-dispatch-${item.pendingExchangeDispatchId}`}
                                  type="button"
                                  className="secondary compact order-exchange-dispatch-button"
                                  disabled={savingOrder}
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    void markExchangeReplacementSent(order, item)
                                  }}
                                >Отправить замену: {item.productName} × {item.quantity}</button>
                              )) : null}
                            {canResolvePendingReservation&&!retainedOnly&&!archived&&!projection.deleted&&order.shipping_status!=='sent'
                              ? (order.items||[]).filter((item:any)=>
                                item.stockWriteoffStatus==='pending_reservation'&&Number(item.id)>0
                              ).map((item:any)=>(
                                <button key={`pending-reservation-${item.id}`}
                                  type="button" className="secondary compact"
                                  disabled={savingOrder}
                                  onClick={event=>{event.stopPropagation();openPendingReservation(order,item)}}>
                                  <span>Резерв не закреплён: {item.productName} × {item.quantity}</span>
                                  <span> · Проверить</span>
                                </button>
                              )):null}
                            {projection.canOpenStockHandover && order.stock_handover_review_needed ? (
                              <button
                                className="secondary compact order-stock-handover-trigger"
                                type="button"
                                disabled={savingOrder}
                                onClick={(event) => {
                                  event.stopPropagation()
                                  void openOrderStockHandover(order)
                                }}
                              >
                                {order.stock_handover_review_needed ? 'Уточнить выдачу после проверки склада' : 'Выдать готовые товары'}
                              </button>
                            ) : null}
                            {!retainedOnly && !archived && !projection.deleted ? (
                              <button className="secondary compact" type="button"
                                disabled={savingOrder} onClick={event=>{event.stopPropagation();openDispatchDraft(order)}}>
                                {order.shipping_status==='sent' ? 'Отправки' : 'Отправить товары'}
                              </button>
                            ) : null}
                            {projection.canCorrectShipping && !(order.items||[]).some((item:any)=>item.shipmentSentQuantity!=null) ? (
                              <button
                                className="secondary compact"
                                type="button"
                                disabled={savingOrder}
                                onClick={(event) => {
                                  event.stopPropagation()
                                  void correctMistakenOrderShipping(order)
                                }}
                              >
                                {projection.hasCommittedItemReturn ? 'Исправить отправку' : 'Снять «Отправлен»'}
                              </button>
                            ) : null}
                            {!kaspiMode && projection.canOpenDebt ? (
                              <button className="secondary compact debt-action-button" type="button"
                                onClick={(event) => { event.stopPropagation(); handleOpenDebt(order) }}>Закрыть долг</button>
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

                            {!retainedOnly && !archived && !projection.deleted ? (
                              <button
                                className="primary compact"
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation()
                                  if(projection.canEdit)handleEditOrder(order, kaspiMode ? 'kaspi' : 'orders')
                                  else setLinkedAdminEditOrder(order)
                                }}
                              >
                                {projection.canEdit ? 'Редактировать' : 'Изменить заказ'}
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
                                      openMetadataCorrection(order)
                                    }}>
                                    Исправить реквизиты
                                  </button>
                            ) : null}
                                {extraActionsOrderId === order.id && order.pricing_mode === 'itemized_v1' && Array.isArray(order.items) && order.items.some((item:any) => Number(item.id)>0 && Number(item.quantity)>0) ? (
                                  <button className="secondary compact" type="button" onClick={(event) => {
                                    event.stopPropagation()
                                    openPriceCorrection(order)
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
                                    openExchangeCancellation(order,'last')
                                  }}>Отменить обмены</button>
                                ) : null}
                                {extraActionsOrderId === order.id && Number(order.committed_return_count||0)>0 ? (
                                  <button className="secondary compact" type="button" onClick={(event)=>{
                                    event.stopPropagation()
                                    openReturnCancel(order)
                                  }}>Отменить возврат</button>
                                ) : null}
                              </div>
                            ) : null}
                            {isAdmin && !retainedOnly && !archived ? (
                              <button
                                className="ghost danger compact"
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation()
                                  setAdminDeleteDraft({order,preview:null,error:'',loading:true,submitting:false,physicalAnswer:'undecided'})
                                  void (async()=>{
                                    try {
                                      const preview=await loadAdminOrderDeletePreview(order)
                                      setAdminDeleteDraft({order,preview,error:'',loading:false,submitting:false,physicalAnswer:'undecided'})
                                    } catch(error) {
                                      setAdminDeleteDraft({order,preview:null,loading:false,submitting:false,physicalAnswer:'undecided',
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
              {dispatchDraft ? (
                <div className="modal-backdrop" role="presentation"
                  onMouseDown={event=>{if(event.target===event.currentTarget&&!dispatchDraft.submitting)setDispatchDraft(null)}}>
                  <div className="modal-card" role="dialog" aria-modal="true" aria-label="Отправка товаров"
                    style={{maxWidth:620,maxHeight:'88vh',overflowY:'auto'}}>
                    <div className="modal-head">
                      <div><div className="card-label">Отправка товаров</div>
                        <h3>{dispatchDraft.order.external_id}</h3></div>
                      <button type="button" className="ghost compact" disabled={dispatchDraft.submitting}
                        onClick={()=>setDispatchDraft(null)}>Закрыть</button>
                    </div>
                    {dispatchDraft.loading ? <p>Загружаю готовые товары…</p> : (
                      <>
                        {(dispatchDraft.plan?.lines||[]).map((line:any)=>{
                          const value=Number(dispatchDraft.selected[Number(line.orderItemId)]||0)
                          return <div key={line.orderItemId} style={{
                            display:'flex',alignItems:'center',gap:10,padding:'10px 0',
                            borderBottom:'1px solid var(--border-color,#e2e8f0)'}}>
                            <input type="checkbox" checked={value>0} disabled={!line.selectable||dispatchDraft.submitting}
                              aria-label={`Выбрать ${line.productName}`}
                              onChange={event=>setDispatchDraft(d=>d?{...d,selected:{...d.selected,
                                [line.orderItemId]:event.target.checked?line.readyQuantity:0},error:''}:d)}/>
                            <div style={{flex:1,minWidth:0}}>
                              <strong>{line.productName}</strong>
                              <small style={{display:'block',opacity:.8}}>
                                {[line.color,line.size,line.material,line.length].filter(Boolean).join(' · ')}
                                {line.color||line.size||line.material||line.length ? ' · ' : ''}
                                {line.sourceType==='workshop'?'Цех':line.sourceType==='boutique'?'Бутик':'Склад'}
                                {' · '}{line.selectable?`Готово ${line.readyQuantity} шт.`:line.reason}
                              </small>
                            </div>
                            {line.selectable ? <input type="number" min={0} max={line.readyQuantity} step={1}
                              aria-label={`Количество ${line.productName}`}
                              disabled={dispatchDraft.submitting} value={value}
                              style={{width:72,padding:6}}
                              onChange={event=>{const num=Number(event.target.value);
                                setDispatchDraft(d=>d?{...d,error:'',selected:{...d.selected,
                                  [line.orderItemId]:Number.isSafeInteger(num)?num:0}}:d)}}/> : null}
                          </div>
                        })}
                        {(dispatchDraft.plan?.lines||[]).length===0 ? <p>В заказе нет товаров для отправки.</p> : null}
                        {dispatchDraft.plan?.selectedCount ? (
                          <div className="toolbar-actions" style={{marginTop:16}}>
                            <button className="primary" type="button"
                              disabled={dispatchDraft.submitting||!(dispatchDraft.plan?.lines||[]).some((x:any)=>
                                Number(dispatchDraft.selected[x.orderItemId]||0)>0)}
                              onClick={submitSelectedDispatch}>
                              {dispatchDraft.submitting?'Сохраняю…':'Подтвердить отправку'}
                            </button>
                          </div>
                        ) : null}
                        {dispatchDraft.history.some((x:any)=>Number(x.cancelledQuantity)<Number(x.quantity)) ? (
                          <div style={{marginTop:24}}>
                            <h4>Ранее отправлено</h4>
                            {dispatchDraft.history.filter((x:any)=>Number(x.cancelledQuantity)<Number(x.quantity))
                              .map((x:any)=><div key={x.dispatchItemId}
                                style={{display:'flex',gap:12,alignItems:'center',padding:'8px 0'}}>
                                <div style={{flex:1,minWidth:0}}>
                                  <strong>{x.productName}</strong>
                                  <small style={{display:'block',opacity:.8}}>
                                    {x.color ? `${x.color} · `:''}{x.size||''} · {x.quantity} шт. · {x.dispatchDate}
                                  </small>
                                </div>
                                {x.hasReturn||x.hasExchange ? (
                                  <small>{x.hasExchange?'Есть обмен':'Есть возврат'}</small>
                                ) : (
                                  <button type="button" className="secondary compact"
                                    disabled={dispatchDraft.submitting}
                                    onClick={()=>cancelDispatchedLine(x)}>Отменить отправку</button>
                                )}
                              </div>)}
                          </div>
                        ) : null}
                        {dispatchDraft.error ? <p className="error" role="alert">{dispatchDraft.error}</p> : null}
                      </>
                    )}
                  </div>
                </div>
              ) : null}
              {pendingReservationDraft ? (
                <div className="modal-backdrop" role="presentation"
                  onMouseDown={event=>{if(event.target===event.currentTarget&&!pendingReservationDraft.submitting)setPendingReservationDraft(null)}}>
                  <div className="modal-card" role="dialog" aria-modal="true"
                    aria-label="Проверить незакреплённый резерв"
                    style={{maxWidth:560,maxHeight:'88vh',overflowY:'auto'}}>
                    <div className="modal-head">
                      <div>
                        <div className="card-label">Резерв ещё не закреплён</div>
                        <h3>{pendingReservationDraft.order.external_id}</h3>
                      </div>
                      <button type="button" className="ghost compact"
                        disabled={pendingReservationDraft.submitting}
                        onClick={()=>setPendingReservationDraft(null)}>Закрыть</button>
                    </div>
                    <p><strong>{pendingReservationDraft.item.productName}</strong> · {pendingReservationDraft.item.quantity} шт.</p>
                    {pendingReservationDraft.loading ? <p>Проверяю актуальный остаток…</p>:null}
                    {pendingReservationDraft.preview?.alreadyResolved ? (
                      <p>Резерв уже закреплён. Обновите список заказов.</p>
                    ):null}
                    {pendingReservationDraft.preview?.pending ? (
                      <>
                        <p>Точка: <strong>{pendingReservationDraft.preview.snapshot.inventorySource==='boutique'?'Бутик':'Склад'}</strong></p>
                        <p>По системе на месте: <strong>{pendingReservationDraft.preview.snapshot.physicalQuantity} шт.</strong></p>
                        <p>Уже зарезервировано: <strong>{pendingReservationDraft.preview.snapshot.reservedQuantity} шт.</strong></p>
                        <p>Нужно этому заказу: <strong>{pendingReservationDraft.preview.snapshot.requestedQuantity} шт.</strong></p>
                        {pendingReservationDraft.preview.shortage>0 ? (
                          <p role="status">Нехватка: <strong>{pendingReservationDraft.preview.shortage} шт.</strong> Подтверждение закрепит резерв сверх свободного остатка, но не добавит товар на полку.</p>
                        ):(
                          <p>Свободного количества достаточно. Можно закрепить резерв без исключения.</p>
                        )}
                      </>
                    ):null}
                    {pendingReservationDraft.error ? <p role="alert" className="error">{pendingReservationDraft.error}</p>:null}
                    <div className="toolbar-actions">
                      <button type="button" className="secondary"
                        disabled={pendingReservationDraft.submitting}
                        onClick={()=>openPendingReservation(pendingReservationDraft.order,pendingReservationDraft.item)}>Обновить данные</button>
                      {pendingReservationDraft.preview?.pending ? (
                        <button type="button" className="primary"
                          disabled={pendingReservationDraft.loading||pendingReservationDraft.submitting}
                          onClick={()=>submitPendingReservation(pendingReservationDraft.preview.shortage>0)}>
                          {pendingReservationDraft.submitting?'Сохраняю…':
                            pendingReservationDraft.preview.shortage>0?'Подтвердить резерв при нехватке':'Закрепить доступный резерв'}
                        </button>
                      ):null}
                    </div>
                    <p className="muted">Решение касается только этой позиции и текущих чисел. При изменении остатка сервер потребует повторную проверку.</p>
                  </div>
                </div>
              ):null}
              {adminDeleteDraft ? (
                <div className="modal-backdrop" role="presentation" onMouseDown={(event)=>{
                  if(event.target===event.currentTarget&&!adminDeleteDraft.submitting)setAdminDeleteDraft(null)
                }}>
                  <div className="modal-card" role="dialog" aria-modal="true"
                    aria-label="Проверка последствий удаления заказа"
                    style={{maxWidth:760,maxHeight:'min(90vh,820px)',overflowY:'auto'}}>
                    <div className="modal-head">
                      <div>
                        <div className="card-label">Только администратор · аннулирование ошибочной записи</div>
                        <h3>Удалить заказ {adminDeleteDraft.order.external_id}</h3>
                      </div>
                      <button className="ghost compact" type="button" disabled={adminDeleteDraft.submitting}
                        onClick={()=>setAdminDeleteDraft(null)}>Закрыть</button>
                    </div>
                    <p className="muted">Проверьте, какие операции будут отменены. Изменения запишутся в историю с защитой от повторного выполнения.</p>
                    {adminDeleteDraft.loading ? <p>Собираю полные последствия…</p> : null}
                    {adminDeleteDraft.error ? <p role="alert" className="error">{adminDeleteDraft.error}</p> : null}
                    {adminDeleteDraft.preview ? (
                      <>
                        <div style={{border:'1px solid var(--border,#dce1e8)',padding:12,borderRadius:10,margin:'12px 0'}}>
                          <strong>{adminDeleteDraft.preview.activeSaga
                            ? 'Есть незавершённое удаление — его можно безопасно продолжить'
                            : adminDeleteDraft.preview.canAttemptDelete
                              ? 'Готово к удалению'
                              : adminDeleteDraft.preview.canStartChain
                                ? 'Связанные операции будут отменены последовательно'
                                : 'Нужно уточнение перед удалением'}</strong>
                          {adminDeleteDraft.progress ? <p role="status">Выполнено: {adminDeleteDraft.progress}</p> : null}
                        </div>
                        {physicalQuestionRequired ? (
                          <section style={{borderTop:'1px solid var(--border,#dce1e8)',paddingTop:14,marginTop:16}}>
                            <h4>Товар действительно передавался клиенту?</h4>
                            <p className="muted">
                              {adminDeleteDraft.preview?.requiresPhysicalFact
                                ||adminDeleteDraft.preview?.appliedStockReview?.appliedCount>0
                                ?'В учёте есть движения товара или отметки выдачи.'
                                :'В учёте нет подтверждённой выдачи.'}
                              {' '}Перед удалением подтвердите, что произошло на самом деле.
                            </p>
                            <div style={{display:'grid',gap:10}}>
                              <label style={{display:'flex',alignItems:'start',gap:9,cursor:'pointer'}}>
                                <input type="radio" name="admin-delete-physical-answer"
                                  checked={adminDeleteDraft.physicalAnswer==='not_issued'}
                                  disabled={adminDeleteDraft.submitting}
                                  onChange={()=>setAdminDeleteDraft(d=>d?{...d,physicalAnswer:'not_issued',error:''}:d)}/>
                                <span><strong>Нет, товар не передавался</strong>
                                  <span className="muted" style={{display:'block'}}>
                                    Проверить и аннулировать ошибочные складские движения, не дублируя уже выполненные корректировки.
                                  </span></span>
                              </label>
                              <label style={{display:'flex',alignItems:'start',gap:9,cursor:'pointer'}}>
                                <input type="radio" name="admin-delete-physical-answer"
                                  checked={adminDeleteDraft.physicalAnswer==='issued'}
                                  disabled={adminDeleteDraft.submitting}
                                  onChange={()=>setAdminDeleteDraft(d=>d?{...d,physicalAnswer:'issued',error:''}:d)}/>
                                <span><strong>Да, товар был передан клиенту</strong></span>
                              </label>
                            </div>
                            {adminDeleteDraft.physicalAnswer==='issued'?(
                              <div role="status" style={{marginTop:12}}>
                                Если клиент действительно получил товар, обычно удалять заказ не нужно.
                                Исправьте ошибочные реквизиты или цену через редактирование заказа.
                                При фактическом возврате товара используйте операцию возврата.
                                <div style={{marginTop:10}}>
                                  <button type="button" className="secondary compact"
                                    onClick={()=>{const order=adminDeleteDraft.order;setAdminDeleteDraft(null);handleEditOrder(order)}}>
                                    Перейти к редактированию заказа
                                  </button>
                                </div>
                              </div>
                            ):null}
                          </section>
                        ):null}
                        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,225px),1fr))',gap:14}}>
                          <section>
                            <h4>Финансы</h4>
                            <p>Стоимость ошибочного заказа: <strong>{formatMoney(adminDeleteDraft.preview.impact?.saleAmount||0)} ₸</strong></p>
                            <p>Долг по заказу будет аннулирован: <strong>{formatMoney(adminDeleteDraft.preview.impact?.debtAmount||0)} ₸</strong></p>
                            <p>Аннулируются оплаты: <strong>{formatMoney(adminDeleteDraft.preview.impact?.paymentReversal||0)} ₸</strong></p>
                            <p>Аннулируются возвраты: <strong>{formatMoney(adminDeleteDraft.preview.impact?.refundReversal||0)} ₸</strong></p>
                            <p>Итог корректировки поступлений: <strong>
                              {(adminDeleteDraft.preview.impact?.netMoneyReversal||0)>0?'+':''}
                              {formatMoney(adminDeleteDraft.preview.impact?.netMoneyReversal||0)} ₸
                            </strong></p>
                          </section>
                          <section>
                            <h4>Склад</h4>
                            <p>Снимутся активные резервы: <strong>
                              {(adminDeleteDraft.preview.impact?.reservations||[])
                                .filter((x:any)=>x.action==='release_reserve')
                                .reduce((sum:number,x:any)=>sum+x.quantity,0)} шт.</strong></p>
                            <p>Учётных отметок выдачи: <strong>{adminDeleteDraft.preview.issuedQuantity} шт.</strong></p>
                            {(adminDeleteDraft.preview.appliedStockReview?.reversals||[]).length ? (
                              <div style={{borderTop:'1px solid var(--border,#dce1e8)',paddingTop:10,marginTop:10}}>
                                <strong>Отмена складских событий обмена</strong>
                                <p className="muted">При нулевом списании отмена снимет ошибочную учётную выдачу, не прибавляя товар к остатку.
                                  Реальные списания и резервы обрабатываются отдельно.</p>
                                <ul style={{paddingLeft:18}}>
                                  {adminDeleteDraft.preview.appliedStockReview.reversals.map((effect:any)=>(
                                    <li key={effect.eventId}>
                                      <strong>{effect.name}</strong> ·
                                      {' '}{effect.source==='warehouse'?'Склад':
                                        effect.source==='boutique'?'Бутик':effect.source} ·
                                      {effect.bookkeepingFulfillmentOnly
                                        ?<> · <strong>Учётная выдача без списания (0 шт.).</strong> Физический остаток не изменится.</>
                                        :effect.alreadyCompensated
                                        ?<> · списание уже компенсировано корректировкой выдачи
                                            #{effect.correctionMovementId}. <strong>Физический остаток не изменится.</strong></>
                                        :<> · отмена списания: <strong>+{effect.physicalRestore} шт.</strong> к остатку</>}
                                      {effect.reserveRelease>0?<span> · освободится резерв: <strong>{effect.reserveRelease} шт.</strong></span>:null}
                                      <div className="muted">Обмен #{effect.exchangeId} · складская операция #{effect.eventId}</div>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            ) : null}
                            <p className="muted">Снятие резерва само по себе не прибавляет товар к физическому остатку.
                              Если по обмену было отдельное физическое списание, его безопасное сторно показано выше.
                              Более поздняя ревизия не будет перезаписана.</p>
                          </section>
                        </div>
                        <section style={{marginTop:14}}>
                          <h4>Оплаты, которые будут аннулированы</h4>
                          {(adminDeleteDraft.preview.impact?.payments||[]).length ? (
                            <ul>{adminDeleteDraft.preview.impact.payments.map((payment:any)=>(
                              <li key={payment.id}>#{payment.id} · {payment.date||'Без даты'} ·
                                {' '}{payment.method}: <strong>{formatMoney(payment.amount)} ₸</strong></li>
                            ))}</ul>
                          ) : <p className="muted">Оплат нет.</p>}
                          <h4>Возвраты денег</h4>
                          {(adminDeleteDraft.preview.impact?.refunds||[]).length ? (
                            <ul>{adminDeleteDraft.preview.impact.refunds.map((refund:any)=>(
                              <li key={refund.id}>Возврат #{refund.id} · {refund.date||'Без даты'} ·
                                {' '}{refund.method}: <strong>{formatMoney(refund.amount)} ₸</strong></li>
                            ))}</ul>
                          ) : <p className="muted">Действующих возвратов денег нет.</p>}
                        </section>
                        <section>
                          <h4>Обмены и возвраты товаров</h4>
                          {adminDeleteDraft.preview.chainPlan?.steps?.length ? (
                            <ol style={{display:'grid',gap:12,paddingLeft:22}}>
                              {adminDeleteDraft.preview.chainPlan.steps.map((step:any)=>{
                                const exchange=step.type==='exchange'
                                  ?(adminDeleteDraft.preview.impact?.exchanges||[]).find((item:any)=>item.id===step.id)
                                  :null
                                const exchangeSource=(source:string)=>source==='not_issued'?'не выдавался'
                                  :source==='warehouse'?'склад':source==='boutique'?'бутик'
                                    :source==='workshop'?'цех':source==='pending'?'ожидает подтверждения'
                                      :source||''
                                const renderExchangeItems=(items:any[],label:string)=>(
                                  <div style={{flex:'1 1 230px',minWidth:0}}>
                                    <div style={{fontWeight:600,marginBottom:6}}>{label}</div>
                                    {items.length ? (
                                      <ul style={{margin:'0 0 0 18px',padding:0,display:'grid',gap:7}}>
                                        {items.map((item:any,i:number)=>{
                                          const attributes=[item.color,item.size,item.material,item.length]
                                            .map((v:unknown)=>String(v||'').trim()).filter(Boolean)
                                          return <li key={item.id||i}>
                                            <strong>{item.quantity} шт. · {item.name}</strong>
                                            {attributes.length?<div className="muted">{attributes.join(' · ')}</div>:null}
                                            {item.source?<div className="muted">Учёт: {exchangeSource(item.source)}</div>:null}
                                          </li>
                                        })}
                                      </ul>
                                    ):<p className="muted" style={{margin:0}}>
                                      В истории нет сохранённых позиций. Проверьте состав обмена.
                                    </p>}
                                  </div>
                                )
                                return <li key={step.type+':'+step.id}>
                                  {step.type==='exchange' ? (
                                    <div style={{border:'1px solid var(--border,#dce1e8)',borderRadius:10,padding:12}}>
                                      <strong>Отменить обмен #{step.id}</strong>
                                      {exchange?.date?<span className="muted"> · {exchange.date}</span>:null}
                                      {step.requiresManualReview?<p className="muted">Требуется проверка истории</p>:null}
                                      {exchange?<>
                                        <div style={{display:'flex',flexWrap:'wrap',gap:16,marginTop:12}}>
                                          {renderExchangeItems(exchange.oldItems||[],'Заменяемые товары')}
                                          {renderExchangeItems(exchange.newItems||[],'Товары взамен')}
                                        </div>
                                        <div style={{marginTop:12}}>
                                          {exchange.financialAction==='extra_payment'&&exchange.financialAmount>0
                                            ?<>Будет аннулирована доплата: <strong>{formatMoney(exchange.financialAmount)} ₸</strong></>
                                            :exchange.financialAction==='refund'&&exchange.financialAmount>0
                                              ?<>Будет аннулирован возврат разницы: <strong>{formatMoney(exchange.financialAmount)} ₸</strong></>
                                              :<span className="muted">Без доплаты или возврата разницы</span>}
                                          {exchange.paymentMethod&&exchange.financialAmount>0
                                            ?<span className="muted"> · {exchange.paymentMethod}</span>:null}
                                        </div>
                                        {exchange.comment?<p className="muted" style={{margin:'8px 0 0'}}>
                                          Комментарий: {exchange.comment}</p>:null}
                                      </>:<p className="muted">Подробности обмена не найдены в истории.</p>}
                                    </div>
                                  ):<>
                                    Отменить возврат #{step.id}
                                    {step.requiresManualReview?' — требуется проверка истории':''}
                                  </>}
                                </li>
                              })}
                            </ol>
                          ) : <p className="muted">Связанных операций для отмены нет.</p>}
                          {(adminDeleteDraft.preview.chainPlan?.generatedExchangeRefundIds||[]).length ? (
                            <p className="muted">Возвраты денег, созданные обменами:
                              {' '}{adminDeleteDraft.preview.chainPlan.generatedExchangeRefundIds.map((id:number)=>'#'+id).join(', ')}.
                              Они отменяются вместе с обменом, без повторного сторно.</p>
                          ) : null}
                        </section>
                        <section>
                          <h4>Резервы и складские движения по позициям</h4>
                          {(adminDeleteDraft.preview.impact?.reservations||[]).length ? (
                            <ul>{adminDeleteDraft.preview.impact.reservations.map((stock:any,i:number)=>(
                              <li key={stock.orderItemId+':'+i}>{stock.name} ·
                                {' '}{stock.source==='boutique'?'Бутик':stock.source==='warehouse'?'Склад':stock.source} ·
                                {' '}{stock.quantity} шт. —
                                {stock.action==='release_reserve'
                                  ? ' снять резерв, физический остаток без изменений'
                                  :stock.action==='requires_physical_review'
                                    ? ' выдача: нужна проверка фактического товара'
                                    : ' уже освобождено/без нового складского движения'}
                              </li>
                            ))}</ul>
                          ) : <p className="muted">Действующих резервов и записанных выдач нет.</p>}
                        </section>
                        {deleteReasons.length ? (
                          <section role="alert" style={{margin:'12px 0'}}>
                            <h4>Что необходимо проверить</h4>
                            <ul>{deleteReasons.map((reason:string,i:number)=><li key={i}>{reason}</li>)}</ul>
                          </section>
                        ) : null}
                        <p className="muted" style={{fontSize:13}}>
                          Это аннулирование учётной записи и связанных проводок. Оно не означает
                          автоматическую физическую передачу денег или товара клиенту.
                          При изменении данных после предпросмотра операция остановится.
                        </p>
                      </>
                    ) : null}
                    <div className="toolbar-actions">
                      <button className="secondary" type="button" disabled={adminDeleteDraft.submitting}
                        onClick={()=>setAdminDeleteDraft(null)}>Закрыть</button>
                      {(adminDeleteDraft.preview?.canAttemptDelete||
                        adminDeleteDraft.preview?.canStartChain||
                        adminDeleteDraft.preview?.canPreparePhysicalCorrection||
                        adminDeleteDraft.preview?.activeSaga)&&
                        adminDeleteDraft.preview?.chainPlan?.snapshotFingerprint
                        &&(!physicalQuestionRequired||adminDeleteDraft.physicalAnswer!=='issued') ? (
                        <button className="ghost danger" type="button"
                          disabled={adminDeleteDraft.loading||adminDeleteDraft.submitting||savingOrder
                            ||(physicalQuestionRequired&&adminDeleteDraft.physicalAnswer!=='not_issued')}
                          onClick={()=>{void(async()=>{
                            const draft=adminDeleteDraft
                            const answer=physicalQuestionRequired ?'not_issued':undefined
                            setAdminDeleteDraft(d=>d?{...d,submitting:true,error:''}:d)
                            try{
                              let preview=draft.preview
                              if(preview.requiresPhysicalFact
                                &&preview.chainPlan?.steps?.length>0
                                &&!preview.activeSaga){
                                // Repair the recorded false handover in this same dialog,
                                // then obtain a new financial and inventory snapshot.
                                preview=await confirmAdminDeletePhysicalBeforeChain(
                                  draft.order,preview.chainPlan.snapshotFingerprint)
                                setAdminDeleteDraft(d=>d?{...d,preview}:d)
                                if(!preview.canStartChain)
                                  throw new Error('Выдача исправлена, но появились другие препятствия удалению. Проверьте обновлённые последствия.')
                              }
                              const useChain=Boolean(preview.activeSaga||preview.canStartChain)
                              const ok=useChain
                                ? await executeAdminDeleteChain(draft.order,preview.chainPlan.snapshotFingerprint,
                                    (done:number,total:number)=>setAdminDeleteDraft(d=>d?{...d,progress:String(done)+' / '+String(total)}:d),
                                    answer)
                                : await deleteOrderAsAdmin(draft.order,true,preview.chainPlan.snapshotFingerprint,answer)
                              if(ok)setAdminDeleteDraft(null)
                              else setAdminDeleteDraft(d=>d?{...d,submitting:false,
                                error:'Удаление не завершено. Повторите действие; уже подтверждённые шаги не выполняются повторно.'}:d)
                            }catch(err){
                              const message=err instanceof Error?err.message:'Не удалось безопасно завершить удаление.'
                              // A timeout may follow a committed physical correction:
                              // refresh the preview rather than replay an old snapshot.
                              try{
                                const preview=await loadAdminOrderDeletePreview(draft.order)
                                setAdminDeleteDraft(d=>d?{...d,submitting:false,preview,error:message}:d)
                              }catch{
                                setAdminDeleteDraft(d=>d?{...d,submitting:false,error:message}:d)
                              }
                            }
                          })()}}>
                          {adminDeleteDraft.submitting?'Проверяю и отменяю…'
                            :adminDeleteDraft.preview?.activeSaga?'Продолжить удаление'
                              :'Подтвердить аннулирование'}
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              ) : null}
              {linkedAdminEditOrder ? (
                <div className="modal-backdrop" role="presentation"
                  onMouseDown={event=>{if(event.target===event.currentTarget)setLinkedAdminEditOrder(null)}}>
                  <div className="modal-card" role="dialog" aria-modal="true" aria-label="Изменить заказ" style={{maxWidth:600}}>
                    <div className="modal-head">
                      <div><div className="card-label">Заказ</div>
                        <h3>Исправить заказ {linkedAdminEditOrder.external_id}</h3></div>
                      <button className="ghost compact" type="button" onClick={()=>setLinkedAdminEditOrder(null)}>Закрыть</button>
                    </div>
                    <p>Выберите, что нужно изменить. Остальные данные заказа останутся как были.</p>
                    <div className="toolbar-actions" style={{flexWrap:'wrap'}}>
                      <button className="secondary" type="button" onClick={()=>{
                        openMetadataCorrection(linkedAdminEditOrder);setLinkedAdminEditOrder(null)
                      }}>Исправить реквизиты</button>
                      {linkedAdminEditOrder.pricing_mode==='itemized_v1'
                        &&Array.isArray(linkedAdminEditOrder.items)
                        &&linkedAdminEditOrder.items.some((item:any)=>Number(item.id)>0&&Number(item.quantity)>0)?(
                        <button className="secondary" type="button" onClick={()=>{
                          openPriceCorrection(linkedAdminEditOrder);setLinkedAdminEditOrder(null)
                        }}>Исправить цены</button>
                      ):null}
                      {isAdmin && Array.isArray(linkedAdminEditOrder.payments)
                        &&linkedAdminEditOrder.payments.some((payment:any)=>Number(payment.id)>0)?(
                        <button className="secondary" type="button" onClick={()=>{
                          openLinkedPaymentCorrection(linkedAdminEditOrder);setLinkedAdminEditOrder(null)
                        }}>Исправить способ оплаты</button>
                      ):null}
                      {isAdmin && Number(linkedAdminEditOrder.committed_exchange_count||0)>0?(
                        <button className="secondary" type="button" onClick={()=>{
                          openExchangeCancellation(linkedAdminEditOrder,'last');setLinkedAdminEditOrder(null)
                        }}>Отменить обмены</button>
                      ):null}
                    </div>
                    <p className="muted">Уже выданные вещи исправляются через действия с конкретными товарами, без отмены всего заказа.</p>
                  </div>
                </div>
              ) : null}
              {linkedPaymentDraft ? (
                <div className="modal-backdrop" role="presentation"
                  onMouseDown={event=>{if(event.target===event.currentTarget&&!savingOrder)setLinkedPaymentDraft(null)}}>
                  <form className="modal-card" role="dialog" aria-modal="true"
                    aria-label="Исправить способ проведённой оплаты"
                    style={{maxWidth:590,maxHeight:'min(88vh,740px)',overflowY:'auto',boxSizing:'border-box'}}
                    onSubmit={event=>{event.preventDefault();void(async()=>{
                      const draft=linkedPaymentDraft
                      if(!draft||savingOrder)return
                      const payment=draft.order.payments.find((p:any)=>Number(p.id)===draft.paymentId)
                      if(!payment){setLinkedPaymentDraft(d=>d?{...d,error:'Оплата не найдена. Обновите заказ.'}:d);return}
                      const result=await correctRecordedPaymentMethod(draft.order,payment,draft.method)
                      if(result.ok)setLinkedPaymentDraft(null)
                      else setLinkedPaymentDraft(d=>d?{...d,error:result.message}:d)
                    })()}}>
                    <div className="modal-head">
                      <div><div className="card-label">Администратор · безопасная коррекция</div>
                        <h3>Способ оплаты — {linkedPaymentDraft.order.external_id}</h3></div>
                      <button className="ghost compact" type="button" disabled={savingOrder}
                        onClick={()=>setLinkedPaymentDraft(null)}>Закрыть</button>
                    </div>
                    <p>Исправляется только способ уже проведённой оплаты. Сумма, дата,
                      товары, обмены и резервы остаются прежними.</p>
                    <div style={{display:'grid',gap:12}}>
                      <label className="form-field" style={{minWidth:0}}>
                        <span>Проведённая оплата</span>
                        <select value={linkedPaymentDraft.paymentId} disabled={savingOrder}
                          style={{width:'100%',boxSizing:'border-box'}}
                          onChange={event=>{
                            const payment=linkedPaymentDraft.order.payments.find((p:any)=>Number(p.id)===Number(event.target.value))
                            if(payment)setLinkedPaymentDraft(d=>d?{...d,paymentId:Number(payment.id),
                              method:String(payment.method||''),error:''}:d)
                          }}>
                          {linkedPaymentDraft.order.payments.filter((p:any)=>Number(p.id)>0).map((p:any)=>(
                            <option key={p.id} value={p.id}>
                              {'#'+p.id+' · '+(p.paymentDate||'Без даты')+' · '+formatMoney(p.amount)+' ₸ · '+(p.method||'Не указан')}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="form-field" style={{minWidth:0}}>
                        <span>Правильный способ оплаты</span>
                        <select value={linkedPaymentDraft.method} disabled={savingOrder}
                          style={{width:'100%',boxSizing:'border-box'}}
                          onChange={event=>setLinkedPaymentDraft(d=>d?{...d,method:event.target.value,error:''}:d)}>
                          <option value="">Выберите способ</option>
                          {[...new Set([
                            ...(Array.isArray(suggestionValues?.paymentMethods)?suggestionValues.paymentMethods:[])
                              .map((value:any)=>String(value||'').trim()).filter(Boolean),
                            ...linkedPaymentDraft.order.payments.map((p:any)=>String(p.method||'').trim()).filter(Boolean),
                          ])].map((value:string)=><option key={value} value={value}>{value}</option>)}
                        </select>
                      </label>
                    </div>
                    {linkedPaymentDraft.error?<p role="alert" className="error">{linkedPaymentDraft.error}</p>:null}
                    <p className="muted">При изменении другой операцией сохранение будет остановлено.
                      Денежная история и касса при необходимости исправляются существующим серверным механизмом.</p>
                    <div className="toolbar-actions">
                      <button type="button" className="secondary" disabled={savingOrder}
                        onClick={()=>setLinkedPaymentDraft(null)}>Отмена</button>
                      <button type="submit" className="primary"
                        disabled={savingOrder||!linkedPaymentDraft.method.trim()
                          ||linkedPaymentDraft.method.trim().toUpperCase()===String(
                            linkedPaymentDraft.order.payments.find((p:any)=>Number(p.id)===linkedPaymentDraft.paymentId)?.method||''
                          ).trim().toUpperCase()}>
                        {savingOrder?'Сохраняю…':'Сохранить способ оплаты'}
                      </button>
                    </div>
                  </form>
                </div>
              ) : null}
              {exchangeChainDraft ? (
                <div className="modal-backdrop" role="presentation" onMouseDown={event=>{
                  if(event.target===event.currentTarget&&!exchangeChainDraft.submitting)setExchangeChainDraft(null)
                }}>
                  <div className="modal-card" role="dialog" aria-modal="true" aria-label="Отмена обменов заказа"
                    style={{maxWidth:680,maxHeight:'min(90vh,820px)',overflowY:'auto'}}>
                    <div className="modal-head">
                      <div><div className="card-label">Отмена с сохранением истории</div>
                        <h3>Обмены — {exchangeChainDraft.order.external_id}</h3></div>
                      <button className="ghost compact" type="button" disabled={exchangeChainDraft.submitting}
                        onClick={()=>setExchangeChainDraft(null)}>Закрыть</button>
                    </div>
                    <p>Что необходимо отменить? Сам заказ останется. Система проверит деньги, резервы
                      и склад до каждой операции.</p>
                    <div className="toolbar-actions" style={{flexWrap:'wrap'}}>
                      {(['last','all'] as const).map(mode=>(
                        <button type="button" key={mode}
                          className={exchangeChainDraft.mode===mode?'primary':'secondary'}
                          disabled={exchangeChainDraft.submitting||exchangeChainDraft.loading}
                          onClick={()=>openExchangeCancellation(exchangeChainDraft.order,mode)}>
                          {mode==='last'?'Последний обмен':'Все обмены'}
                        </button>
                      ))}
                    </div>
                    {exchangeChainDraft.loading?<p>Проверяю зависимости…</p>:null}
                    {exchangeChainDraft.error?<p role="alert" className="error">{exchangeChainDraft.error}</p>:null}
                    {exchangeChainDraft.progress?<p role="status">{exchangeChainDraft.progress}</p>:null}
                    {exchangeChainDraft.plan?(
                      <>
                        <p><strong>Обменов: {exchangeChainDraft.plan.selectedExchangeIds.length}.
                          {' '}Шагов отмены: {exchangeChainDraft.plan.steps.length}.</strong></p>
                        <p className="muted">{exchangeChainDraft.plan.notice}</p>
                        <ol style={{paddingLeft:24,display:'grid',gap:8}}>
                          {exchangeChainDraft.plan.steps.map((step:any)=>(
                            <li key={step.type+':'+step.id}>
                              {step.type==='return'?'Возврат':'Обмен'} #{step.id}
                              {' — '}{step.reason}
                              {step.requiresManualReview?' (нужна ручная проверка)':''}
                            </li>
                          ))}
                        </ol>
                        <p className="muted">Самостоятельные возвраты, не зависящие от обменов,
                          не отменяются. Если отдельный шаг нельзя безопасно выполнить,
                          цепочка остановится. Повторное открытие покажет оставшиеся операции.</p>
                      </>
                    ):!exchangeChainDraft.loading&&!exchangeChainDraft.error?<p>Нет активных обменов.</p>:null}
                    <div className="toolbar-actions">
                      <button className="secondary" type="button" disabled={exchangeChainDraft.submitting}
                        onClick={()=>setExchangeChainDraft(null)}>Закрыть</button>
                      {exchangeChainDraft.plan?.canExecute&&exchangeChainDraft.plan.steps.length>0?(
                        <button className="ghost danger" type="button"
                          disabled={exchangeChainDraft.loading||exchangeChainDraft.submitting||savingOrder}
                          onClick={()=>{void(async()=>{
                            const draft=exchangeChainDraft
                            if(!draft?.plan)return
                            const returns=draft.plan.steps.filter((s:any)=>s.type==='return').length
                            if(!await askActionConfirmation('Отменить '+draft.plan.selectedExchangeIds.length
                              +' обмен(ов) по заказу '+draft.order.external_id+'?\n'
                              +'Шагов: '+draft.plan.steps.length+'. Зависимых возвратов: '+returns
                              +'. Каждая операция отдельно проверит деньги и склад.'))return
                            setExchangeChainDraft(d=>d?{...d,submitting:true,error:'',progress:'Начинаю отмену…'}:d)
                            try{
                              await cancelOrderExchangeChain(draft.order,draft.plan,
                                (done:number,total:number)=>setExchangeChainDraft(d=>d
                                  ?{...d,progress:'Выполнено '+done+' из '+total}:d))
                              setExchangeChainDraft(null)
                            }catch(error){
                              const message=error instanceof Error?error.message:'Отмена остановлена.'
                              try{
                                const plan=await loadOrderExchangeCancellationPlan(draft.order,draft.mode)
                                setExchangeChainDraft(d=>d?{...d,plan,error:message,submitting:false,loading:false}:d)
                              }catch{
                                setExchangeChainDraft(d=>d?{...d,plan:null,error:message,submitting:false,loading:false}:d)
                              }
                            }
                          })()}}>
                          {exchangeChainDraft.submitting?'Отменяю…'
                            :exchangeChainDraft.mode==='last'?'Отменить последний обмен':'Отменить все обмены'}
                        </button>
                      ):null}
                    </div>
                  </div>
                </div>
              ) : null}
              {returnCancelDraft ? (
                <div className="modal-backdrop" role="presentation"
                  onMouseDown={event=>{if(event.target===event.currentTarget&&!returnCancelDraft.submitting)setReturnCancelDraft(null)}}>
                  <div className="modal-card" role="dialog" aria-modal="true" aria-label="Отмена возврата заказа"
                    style={{maxWidth:620,maxHeight:'min(90vh,800px)',overflowY:'auto'}}>
                    <div className="modal-head">
                      <div><div className="card-label">Отмена ошибочного возврата</div>
                        <h3>Возвраты — {returnCancelDraft.order.external_id}</h3></div>
                      <button className="ghost compact" type="button" disabled={returnCancelDraft.submitting}
                        onClick={()=>setReturnCancelDraft(null)}>Закрыть</button>
                    </div>
                    <p>Выберите конкретный возврат для отмены. Сам заказ останется.
                      Сервер проверит деньги и склад перед выполнением. История сохраняется.</p>
                    {returnCancelDraft.loading?<p>Загружаю возвраты…</p>:null}
                    {returnCancelDraft.error?<p role="alert" className="error">{returnCancelDraft.error}</p>:null}
                    {returnCancelDraft.choices.length>0?(
                      <>
                        <label className="form-field">
                          <span>Какой возврат отменить</span>
                          <select value={returnCancelDraft.selectedId}
                            disabled={returnCancelDraft.submitting||returnCancelDraft.loading}
                            onChange={event=>setReturnCancelDraft(d=>d?{...d,selectedId:Number(event.target.value),error:''}:d)}>
                            {returnCancelDraft.choices.map((entry:any)=>(
                              <option key={entry.id} value={entry.id}>
                                {'#'+entry.id+' · '+(entry.date||'Без даты')+' · '+formatMoney(entry.amount)+' ₸'
                                +(entry.parentExchangeId?' · обмен #'+entry.parentExchangeId:'')}
                              </option>
                            ))}
                          </select>
                        </label>
                        {(()=>{const selected=returnCancelDraft.choices.find((x:any)=>x.id===returnCancelDraft.selectedId)
                          if(!selected)return null
                          return <div style={{border:'1px solid var(--border,#dce1e8)',padding:12,borderRadius:10,margin:'12px 0'}}>
                            <p>Возврат денег: <strong>{formatMoney(selected.amount)} ₸</strong>
                              {selected.method?' · '+selected.method:''}</p>
                            <p>Учтено возвращённых товаров: <strong>{selected.itemQuantity} шт.</strong></p>
                            {selected.parentExchangeId?(
                              <p role="status">Этот возврат создан обменом #{selected.parentExchangeId}.
                                Отмените сам обмен через «Отменить обмены»: деньги и товары
                                должны откатываться вместе.</p>
                            ):<p className="muted">Отмена самостоятельно проведённого возврата.
                              Сервер проверит зависимости, финансы, склад и более поздние ревизии.
                              Это учётное сторно, а не фактическая передача денег клиенту.</p>}
                          </div>
                        })()}
                      </>
                    ):!returnCancelDraft.loading&&!returnCancelDraft.error?<p>Активных возвратов нет.</p>:null}
                    <div className="toolbar-actions">
                      <button className="secondary" type="button" disabled={returnCancelDraft.submitting}
                        onClick={()=>setReturnCancelDraft(null)}>Закрыть</button>
                      {(()=>{const selected=returnCancelDraft.choices.find((x:any)=>x.id===returnCancelDraft.selectedId)
                        return selected&&!selected.parentExchangeId?(
                          <button className="ghost danger" type="button"
                            disabled={returnCancelDraft.submitting||returnCancelDraft.loading||savingOrder}
                            onClick={()=>{void(async()=>{
                              const draft=returnCancelDraft
                              const chosen=draft?.choices.find((x:any)=>x.id===draft.selectedId)
                              if(!chosen||chosen.parentExchangeId)return
                              if(!await askActionConfirmation('Отменить возврат #'+chosen.id+' по заказу '+draft.order.external_id+
                                '? Сумма: '+formatMoney(chosen.amount)+' ₸. Склад и деньги будут проверены перед выполнением.'))return
                              setReturnCancelDraft(d=>d?{...d,submitting:true,error:''}:d)
                              try{
                                await cancelOrderReturnChoice(draft.order,chosen)
                                setReturnCancelDraft(null)
                              }catch(error){
                                const message=error instanceof Error?error.message:'Не удалось отменить возврат.'
                                try{
                                  const choices=await loadOrderReturnCancellationChoices(draft.order)
                                  setReturnCancelDraft(d=>d?{...d,choices,
                                    selectedId:choices.find((x:any)=>x.id===chosen.id)?.id||choices[0]?.id||0,
                                    submitting:false,error:message}:d)
                                }catch{
                                  setReturnCancelDraft(d=>d?{...d,submitting:false,error:message}:d)
                                }
                              }
                            })()}}>
                            {returnCancelDraft.submitting?'Отменяю…':'Отменить выбранный возврат'}
                          </button>
                        ):null
                      })()}
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
