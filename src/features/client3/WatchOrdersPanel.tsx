import { Fragment, useEffect, useState } from 'react'
import {projectWatchOrderLikeMain} from './watchMainOrderProjection'
import {watchReferenceLabel,type WatchBrand} from '../../../shared/client3/watch-domain'
import {WatchReturnForm} from './WatchReturnForm'
import {LinkedTableScroll} from '../../components/tables/LinkedTableScroll'
import {WatchExchangeForm} from './WatchExchangeForm'
import {WatchDebtPaymentForm} from './WatchDebtPaymentForm'
import {WatchOrderCorrections} from './WatchOrderCorrections'
import {WatchAdminOrderActions} from './WatchAdminOrderActions'
import {WatchOrderHandoverPanel} from './WatchOrderHandoverPanel'
import '../../styles/client3-watch-orders.css'
import '../../styles/client3-main-orders-copied.css'

type WatchOrder={
  orderId:number;externalId:string;orderDate:string;managerName:string|null;managerId:number
  recipientName:string;recipientPhone:string;city:string;deliveryMethod:string;
  canonicalCustomerName:string;canonicalCustomerPhone:string;canonicalCity:string;
  canonicalDeliveryType:string;orderComment:string;orderStatus:string;
  deliveryAddress:string;postalCode:string;unresolvedReservations:number
  legacySource:'warehouse'|'boutique';shippingStatus:string;engravingStatus:string
  totalAmount:number;receivedAmount:number;debtAmount:number;returnAmount:number
  committedReturnCount:number;committedExchangeCount:number;committedItemReturnQuantity:number
  latestReturnDate:string|null;latestExchangeDate:string|null
  lineCount:number;shippedLineCount:number;engravedLines:number;urgent:number;shippingDeadlineAt:string
  firstItemId:number|null;returnableQuantity:number;watchDescription:string|null
  activeWatchVariantId:number|null;pendingReplacement:number
  paymentLines:string;itemLines:string
}
type Totals={orderCount:number;totalAmount:number;receivedAmount:number;debtAmount:number;returnAmount:number}
type OrdersResponse={ok:boolean;rows:WatchOrder[];totals:Totals;hasMore:boolean;message?:string}
const sum=(value:number)=>Number(value||0).toLocaleString('ru-RU')+' ₸'
const physicallyIssued=(order:WatchOrder)=>{
  const lines=parsedRows<ItemLine>(order.itemLines)
  return lines.length>0&&lines.every(line=>Boolean(line.shipped)||line.stockWriteoffStatus==='fulfilled')
}
const shipLabel=(order:WatchOrder)=>order.pendingReplacement?'Замена ожидает отправки':
  order.shippingStatus==='sent'||order.shippingStatus==='Отправлено'?'Отправлено':
  physicallyIssued(order)?'Выдано до ревизии · подтверждено':
  order.shippedLineCount>0?'Частично отправлено':'Не отправлено'
type PaymentLine={id:number;method:string;amount:number;date:string;kind:string}
type ItemLine={id:number;productName:string;quantity:number;returnableQuantity:number;returnedQuantity?:number;unitPrice:number;
  lineTotal:number;catalogPriceSnapshot:number|null;source:string;shipped:number;
  stockWriteoffStatus:string;
  engravingText:string;gender:string;movement:string;braceletMaterial:string;
  dialColor:string;braceletColor:string}
function parsedRows<T>(raw:string|undefined):T[]{
  try{const rows=JSON.parse(raw||'[]') as unknown;return Array.isArray(rows)?rows as T[]:[]}catch{return []}
}
const initialMonth=()=>{
  const date=new Date(Date.now()+5*60*60*1000).toISOString()
  return date.slice(0,7)
}
export function WatchOrdersPanel({allowedBrands,initialBrand,initialFocusedOrder,onOpenLogistics,onOpenWorkflow,isAdmin=false,workflow='orders'}:{
  allowedBrands:readonly WatchBrand[];initialBrand?:WatchBrand;
  initialFocusedOrder?:{orderId:number;externalId:string;orderDate:string};
  onOpenLogistics?:(brand:WatchBrand)=>void;
  onOpenWorkflow?:(kind:'returns'|'exchange',order:{
    brand:WatchBrand;orderId:number;externalId:string;orderDate:string
  })=>void;
  isAdmin?:boolean
  workflow?:'orders'|'returns'|'exchange'
}) {
  const [brand,setBrand]=useState<WatchBrand>(initialBrand&&allowedBrands.includes(initialBrand)?initialBrand:allowedBrands[0]||'TAUWACH')
  const [month,setMonth]=useState(initialFocusedOrder?.orderDate.slice(0,7)||initialMonth)
  const [search,setSearch]=useState(initialFocusedOrder?.externalId||'')
  const [shipping,setShipping]=useState<'all'|'sent'|'not_sent'>('all')
  const [payment,setPayment]=useState<'all'|'debt'|'paid'>('all')
  const [query,setQuery]=useState(initialFocusedOrder?.externalId||'')
  const [page,setPage]=useState(0)
  const [refresh,setRefresh]=useState(0)
  const [data,setData]=useState<OrdersResponse|null>(null)
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const [returnOrderId,setReturnOrderId]=useState<number|null>(
    workflow==='returns'?initialFocusedOrder?.orderId||null:null)
  const [exchangeOrderId,setExchangeOrderId]=useState<number|null>(
    workflow==='exchange'?initialFocusedOrder?.orderId||null:null)
  const [debtOrderId,setDebtOrderId]=useState<number|null>(null)
  const [editOrderId,setEditOrderId]=useState<number|null>(null)
  const [handoverOrderId,setHandoverOrderId]=useState<number|null>(
    initialFocusedOrder?.orderDate&&initialFocusedOrder.orderDate<new Date(Date.now()+5*3600*1000).toISOString().slice(0,10)
      ?initialFocusedOrder.orderId:null)
  // Keep Main's dense orders table collapsed by default; detail opens only on request.
  const [expanded,setExpanded]=useState<number|null>(null)
  const [extraActionsOrderId,setExtraActionsOrderId]=useState<number|null>(null)
  const [expandedItemCounts,setExpandedItemCounts]=useState<Record<number,number>>({})
  const [expandedPaymentCounts,setExpandedPaymentCounts]=useState<Record<number,number>>({})
  useEffect(()=>{
    const controller=new AbortController()
    setBusy(true);setError('');setData(null)
    const params=new URLSearchParams({brand,limit:'50',offset:String(page*50),shipping,payment})
    if(month) {
      const [year,m]=month.split('-').map(Number)
      if(year>2000&&m>=1&&m<=12){
        params.set('from',month+'-01')
        const lastDay=new Date(Date.UTC(year,m,0)).getUTCDate()
        params.set('to',month+'-'+String(lastDay).padStart(2,'0'))
      }
    }
    if(query)params.set('q',query)
    void fetch('/api/client3/watches/orders?'+params,{
      credentials:'include',cache:'no-store',signal:controller.signal,
    }).then(async response=>{
      const result=await response.json() as OrdersResponse
      if(!response.ok||!result.ok)throw new Error(result.message||'Не удалось загрузить заказы')
      if(!controller.signal.aborted)setData(result)
    }).catch(cause=>{
      if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'Ошибка загрузки')
    }).finally(()=>{if(!controller.signal.aborted)setBusy(false)})
    return ()=>controller.abort()
  },[brand,month,query,page,refresh,shipping,payment])
  return <section className="watch-orders">
    <header className="watch-orders-header">
      <div><h2>{workflow==='returns'?'Оформление возвратов':workflow==='exchange'?'Обмены часов':'Список заказов'}</h2>
        <p>{workflow==='orders'?'Поиск, статусы, оплата и действия по выбранному бренду.':
          'Выберите заказ в компактной таблице. Форма откроется отдельно от списка, как в Main.'}</p></div>
      <button type="button" disabled={busy} onClick={()=>setRefresh(x=>x+1)}>Обновить</button>
    </header>
    {workflow!=='orders'&&data&&(
      (workflow==='returns'&&returnOrderId!==null)||
      (workflow==='exchange'&&exchangeOrderId!==null))&&
      <section className="watch-main-flow-workspace" aria-label={workflow==='returns'?'Оформить возврат':'Оформить обмен'}>
        <div className="watch-main-flow-head"><h3>{workflow==='returns'?'Возврат товара':'Обмен товара'}</h3>
          <button className="secondary compact" type="button"
            onClick={()=>{setReturnOrderId(null);setExchangeOrderId(null)}}>Закрыть форму</button></div>
        {data.rows.filter(o=>o.orderId===(workflow==='returns'?returnOrderId:exchangeOrderId)).map(o=>
          workflow==='returns'?<WatchReturnForm key={o.orderId} brand={brand} order={o}
            onCancel={()=>setReturnOrderId(null)}
            onDone={()=>{setReturnOrderId(null);setRefresh(v=>v+1)}}/>:
          <WatchExchangeForm key={o.orderId} brand={brand} order={o}
            onCancel={()=>setExchangeOrderId(null)}
            onDone={()=>{setExchangeOrderId(null);setRefresh(v=>v+1)}}/>)}
      </section>}
    <div className="watch-orders-filters">
      <label>Бренд<select value={brand} onChange={e=>{setBrand(e.target.value as WatchBrand);setPage(0)}}>
        {allowedBrands.map(code=><option key={code} value={code}>{code}</option>)}
      </select></label>
      <label>Месяц<input type="month" value={month} onChange={e=>{setMonth(e.target.value);setPage(0)}}/></label>
      <label>Отправка
        <select value={shipping} onChange={e=>{setShipping(e.target.value as typeof shipping);setPage(0)}}>
          <option value="all">Все</option><option value="not_sent">Не отправлены</option>
          <option value="sent">Отправлены</option>
        </select>
      </label>
      <label>Оплата
        <select value={payment} onChange={e=>{setPayment(e.target.value as typeof payment);setPage(0)}}>
          <option value="all">Все</option><option value="debt">С долгом</option>
          <option value="paid">Без долга</option>
        </select>
      </label>
      <form onSubmit={e=>{e.preventDefault();setPage(0);setQuery(search.trim())}}>
        <label>Поиск по заказу, ФИО или телефону
          <input value={search} maxLength={100} onChange={e=>setSearch(e.target.value)} placeholder="Номер заказа или клиент"/>
        </label>
        <button type="submit">Найти</button>
      </form>
    </div>
    {error&&<p role="alert" className="watch-orders-error">{error}</p>}
    {busy&&<p role="status">Загрузка заказов…</p>}
    {data&&<>
      <div className="watch-orders-summary">
        <div><small>Заказов</small><strong>{data.totals.orderCount}</strong></div>
        <div><small>Сумма заказов</small><strong>{sum(data.totals.totalAmount)}</strong></div>
        <div><small>Получено</small><strong>{sum(data.totals.receivedAmount)}</strong></div>
        <div><small>Остаток долга</small><strong>{sum(data.totals.debtAmount)}</strong></div>
        <div><small>Учтено возвратов</small><strong>{sum(data.totals.returnAmount)}</strong></div>
      </div>
      <p className="watch-orders-note">Возвраты, обмены, оплаты и отправки отображаются раздельно, как в Main. Нехватка свободного резерва не скрывает заказ и не закрывает кнопку отправки.</p>
      {data.rows.length===0?<p>Заказов за выбранный период нет.</p>:
        <LinkedTableScroll className="watch-main-orders-scroll" ariaLabel="Горизонтальная прокрутка таблицы заказов">
          <table className="data-table orders-table watch-main-orders-table">
            <thead><tr>
              <th>Дата / заказ</th><th>Менеджер</th><th>Клиент</th><th>Город</th>
              <th>Товары</th><th>Доставка / комментарий</th><th>Оплаты</th>
              <th>Сумма</th><th>Получено</th><th>Долг</th><th>Статус</th><th>Действия</th>
            </tr></thead>
            <tbody>{data.rows.map(order=>{
              const {operational,shipment}=projectWatchOrderLikeMain(order,isAdmin)
              const lines=parsedRows<ItemLine>(order.itemLines)
              const payments=parsedRows<PaymentLine>(order.paymentLines)
              const visibleItems=Math.max(3,expandedItemCounts[order.orderId]||3)
              const visiblePayments=Math.max(2,expandedPaymentCounts[order.orderId]||2)
              const openFlow=(type:'returns'|'exchange')=>{
                if(onOpenWorkflow){onOpenWorkflow(type,{
                  brand,orderId:order.orderId,externalId:order.externalId,orderDate:order.orderDate
                });return}
                setExpanded(order.orderId)
                if(type==='returns'){setReturnOrderId(order.orderId);setExchangeOrderId(null)}
                else{setExchangeOrderId(order.orderId);setReturnOrderId(null)}
              }
              const showDetailAction=(type:'debt'|'edit'|'handover')=>{
                setExpanded(order.orderId);setExtraActionsOrderId(null)
                if(type==='debt'){setDebtOrderId(order.orderId);setEditOrderId(null);setHandoverOrderId(null)}
                if(type==='edit'){setEditOrderId(order.orderId);setDebtOrderId(null);setHandoverOrderId(null)}
                if(type==='handover'){setHandoverOrderId(order.orderId);setDebtOrderId(null);setEditOrderId(null)}
              }
              return <Fragment key={order.orderId}>
              <tr data-order-id={order.orderId} className={'watch-main-order-row'+
                (expanded===order.orderId?' is-open':'')+
                (operational.hasCommittedDownstreamOperation?' row-returned':'')}>
                <td><div className="order-cell-stack">
                  <strong>{order.orderDate}</strong>
                  <span>{order.externalId||'#'+order.orderId}</span>
                  </div>
                  {order.urgent===1&&<small className="watch-main-urgent">Срочно</small>}</td>
                <td>{order.managerName||'—'}</td>
                <td><strong>{order.recipientName}</strong><small>{order.recipientPhone}</small></td>
                <td>{order.city||'—'}</td>
                <td className="watch-main-order-sku">
                  <div className="order-items-inline">
                    {lines.slice(0,visibleItems).map((line,index)=>
                      <div className="order-item-chip order-item-card" key={line.id}>
                        <div className="order-item-card-head">
                          <strong>{line.productName}</strong>
                          <span className="order-item-quantity-badge">× {line.quantity}</span>
                        </div>
                        <span className="order-item-card-details">{[
                          line.gender==='male'?'Мужские':line.gender==='female'?'Женские':'',
                          watchReferenceLabel('movements',line.movement),
                          watchReferenceLabel('bracelets',line.braceletMaterial),
                          watchReferenceLabel('dials',line.dialColor),
                          line.braceletColor?'Ремешок: '+watchReferenceLabel('leatherColors',line.braceletColor):'',
                        ].filter(Boolean).join(' · ')}</span>
                        <small className={'order-item-shipment-status is-'+(shipment.lines[index]?.state||'not_sent')}>
                          {shipment.lines[index]?.label||'Отправка не уточнена'}
                        </small>
                        {Number(line.returnedQuantity||0)>0&&
                          <span className="soft-badge watch-item-returned">
                            Возвращено {line.returnedQuantity} шт.
                          </span>}
                        {line.engravingText&&<small>Гравировка: {line.engravingText}</small>}
                        <div className="order-item-chip-meta">
                          <span className={'order-item-source-badge source-'+
                            (line.source==='boutique'?'boutique':'warehouse')}>
                            {line.source==='boutique'?'Витрина':'Офис'}
                          </span>
                        </div>
                      </div>)}
                    {lines.length>visibleItems&&
                      <button className="order-item-chip order-item-chip-more is-clickable" type="button"
                        onClick={()=>setExpandedItemCounts(current=>({...current,
                          [order.orderId]:Math.min(lines.length,visibleItems+5)}))}>
                        + ещё {lines.length-visibleItems}
                      </button>}
                    {visibleItems>3&&lines.length>3&&
                      <button className="order-item-chip order-item-chip-collapse is-clickable" type="button"
                        onClick={()=>setExpandedItemCounts(current=>{
                          const next={...current};delete next[order.orderId];return next
                        })}>Скрыть</button>}
                  </div>
                </td>
                <td className="watch-main-order-delivery">
                  <strong>{order.deliveryMethod||'—'}</strong>
                  <small>{order.shippingDeadlineAt?'До '+new Date(order.shippingDeadlineAt).toLocaleString('ru-RU',{timeZone:'Asia/Almaty'}):'Без срока'}</small>
                  {order.urgent===1&&<small className="watch-main-urgent">Срочно</small>}
                  {parsedRows<ItemLine>(order.itemLines).some(x=>x.engravingText)&&
                    <small>Есть текст гравировки</small>}
                </td>
                <td className="watch-main-order-payments">
                  <div className="order-payments-inline">
                    {payments.slice(0,visiblePayments).map(line=>
                      <div className="order-payment-chip" key={line.id}>
                        <strong>{line.method} · {sum(line.amount)}</strong>
                        <span>{line.date||'Дата не указана'}</span>
                      </div>)}
                    {payments.length>visiblePayments&&
                      <button className="order-payment-chip order-payment-chip-more is-clickable"
                        type="button" onClick={()=>setExpandedPaymentCounts(current=>({
                          ...current,[order.orderId]:Math.min(payments.length,visiblePayments+5)
                        }))}>+ ещё {payments.length-visiblePayments}</button>}
                    {visiblePayments>2&&payments.length>2&&
                      <button className="order-payment-chip order-payment-chip-more is-clickable"
                        type="button" onClick={()=>setExpandedPaymentCounts(current=>{
                          const next={...current};delete next[order.orderId];return next
                        })}>Скрыть оплаты</button>}
                    {!payments.length&&<small>Оплат нет</small>}
                  </div>
                </td>
                <td className="watch-main-money">{sum(order.totalAmount)}</td>
                <td className="watch-main-money">
                  <div className="order-cell-stack">
                    <strong>{sum(order.receivedAmount)}</strong>
                    {order.returnAmount>0&&<small className="watch-main-refund-line">
                      Возвращено {sum(order.returnAmount)} · осталось {sum(Math.max(0,order.receivedAmount-order.returnAmount))}
                    </small>}
                  </div>
                </td>
                <td className={'watch-main-money '+(order.debtAmount>0?'is-debt':'is-paid')}>
                  {order.debtAmount>0?sum(order.debtAmount):'Оплачено'}</td>
                <td>
                  <div className="order-status-stack">
                    <span className={'status-pill '+operational.paymentClass}>
                      {operational.paymentLabel}
                    </span>
                    <span className={'status-pill '+(shipment.state==='sent'?'status-online':
                      shipment.state==='partial'?'status-warning':'status-neutral')}>
                      {shipment.label}
                    </span>
                    {operational.hasCommittedDownstreamOperation&&<span className="soft-badge">
                      {operational.hasCommittedReturn&&operational.hasCommittedExchange
                        ?'Есть проведённые возврат и обмен':
                        operational.hasCommittedExchange?'Есть проведённый обмен':
                        operational.hasCommittedPhysicalDownstreamOperation?'Есть проведённый возврат':
                        'Есть возврат денег'}
                    </span>}
                    {operational.committedReturnCount>0&&
                      <small>Возвратов: {operational.committedReturnCount}
                        {order.latestReturnDate?' · '+order.latestReturnDate:''}</small>}
                    {operational.committedExchangeCount>0&&
                      <small>Обменов: {operational.committedExchangeCount}
                        {order.latestExchangeDate?' · '+order.latestExchangeDate:''}</small>}
                  </div>
                </td>
                <td>
                  <div className="order-table-actions watch-main-row-actions">
                    {workflow==='orders'&&onOpenLogistics&&
                      <button type="button" className="secondary compact"
                        onClick={()=>onOpenLogistics(brand)}>
                        {shipment.state==='sent'?'Отправки':'Отправить товары'}
                      </button>}
                    {order.debtAmount>0&&workflow==='orders'&&
                      <button type="button" className="secondary compact debt-action-button"
                        onClick={()=>showDetailAction('debt')}>Закрыть долг</button>}
                    {(workflow==='orders'||workflow==='returns')&&operational.canOpenReturn&&
                      <button type="button" className="secondary compact"
                        onClick={()=>openFlow('returns')}>Возврат</button>}
                    {(workflow==='orders'||workflow==='exchange')&&operational.canOpenExchange&&
                      <button type="button" className="secondary compact"
                        onClick={()=>openFlow('exchange')}>Обмен</button>}
                    {workflow==='orders'&&
                      <button type="button" className={isAdmin?'primary compact':'secondary compact'}
                        onClick={()=>showDetailAction('edit')}>
                        {isAdmin&&operational.canEdit?'Редактировать':
                          isAdmin?'Исправить заказ':'Исправить реквизиты'}
                      </button>}
                    {workflow==='orders'&&
                      <div className="order-extra-actions watch-order-extra-actions">
                        <button type="button" className="secondary compact"
                          aria-expanded={extraActionsOrderId===order.orderId}
                          onClick={()=>setExtraActionsOrderId(old=>old===order.orderId?null:order.orderId)}>
                          Доп. действия
                        </button>
                        {extraActionsOrderId===order.orderId&&<>
                          {order.committedReturnCount>0&&
                            <button type="button" className="secondary compact"
                              onClick={()=>openFlow('returns')}>История / отмена возврата</button>}
                          {order.committedExchangeCount>0&&
                            <button type="button" className="secondary compact"
                              onClick={()=>openFlow('exchange')}>История / отмена обмена</button>}
                          {shipment.state!=='sent'&&
                            <button type="button" className="secondary compact"
                              onClick={()=>showDetailAction('handover')}>Уточнить выдачу</button>}
                          {isAdmin&&
                            <button type="button" className="secondary compact"
                              onClick={()=>showDetailAction('edit')}>Цены, состав, удалить заказ</button>}
                        </>}
                      </div>}
                    <button type="button" className="secondary compact watch-main-detail-button"
                      aria-expanded={expanded===order.orderId}
                      onClick={()=>{
                        if(workflow==='returns'){openFlow('returns');return}
                        if(workflow==='exchange'){openFlow('exchange');return}
                        setExpanded(value=>value===order.orderId?null:order.orderId)
                        setReturnOrderId(null);setExchangeOrderId(null)
                        setDebtOrderId(null);setEditOrderId(null);setHandoverOrderId(null)
                      }}>
                      {expanded===order.orderId?'Скрыть':'Подробнее'}
                    </button>
                  </div>
                </td>
              </tr>
              {workflow==='orders'&&expanded===order.orderId&&<tr className="watch-main-order-expanded"><td colSpan={12}>
                <section className="watch-main-order-detail" aria-label={'Детали заказа '+order.externalId}>
                  <div className="watch-main-order-detail-grid">
                    <div><small>Покупатель</small><strong>{order.recipientName}</strong>
                      <span>{order.recipientPhone} · {order.city}</span>
                      <span>{order.deliveryMethod} · {order.postalCode||''}</span>
                      {order.deliveryAddress&&<span>{order.deliveryAddress}</span>}</div>
                    <div><small>Менеджер</small><strong>{order.managerName||'Не указан'}</strong>
                      <span>{order.lineCount} позиций</span></div>
                    <div><small>Оплата</small><strong>{sum(order.receivedAmount)} из {sum(order.totalAmount)}</strong>
                      <span>Долг: {sum(order.debtAmount)} · Возвраты: {sum(order.returnAmount)}</span></div>
                    <div><small>Доставка и гравировка</small>
                      <strong>{shipLabel(order)}</strong>
                      <span>Гравировка: {order.engravingStatus==='ready'?'Готово':order.engravingStatus==='engraving'?'В работе':'Ожидает'}</span></div>
                  </div>
                  <div className="watch-main-order-ledger-details">
                    <section className="mini-panel">
                      <h3>Товары заказа</h3>
                      {parsedRows<ItemLine>(order.itemLines).map(line=><div className="watch-main-ledger-line" key={line.id}>
                        <div><strong>{line.productName}</strong>
                          <small>{[
                            line.gender==='male'?'Мужские':line.gender==='female'?'Женские':'',
                            watchReferenceLabel('movements',line.movement),
                            watchReferenceLabel('bracelets',line.braceletMaterial),
                            watchReferenceLabel('dials',line.dialColor),
                            line.braceletColor?'Ремешок: '+watchReferenceLabel('leatherColors',line.braceletColor):'',
                          ].filter(Boolean).join(' · ')}</small>
                          {line.engravingText&&<small>Гравировка: {line.engravingText}</small>}
                          <small>{line.source==='warehouse'?'Офис':'Витрина'} · {line.shipped?'Отправлен':
                            line.stockWriteoffStatus==='fulfilled'?'Ранее выдан · подтверждено':'Не отправлен'}</small></div>
                        <strong>{line.quantity} × {sum(line.unitPrice)}</strong>
                      </div>)}
                      {parsedRows<ItemLine>(order.itemLines).length===0&&
                        <p>Состав заказа пока недоступен.</p>}
                    </section>
                    <section className="mini-panel">
                      <h3>Оплаты по заказу</h3>
                      {parsedRows<PaymentLine>(order.paymentLines).map(line=>
                        <div className="watch-main-ledger-line" key={line.id}>
                          <div><strong>{line.method}</strong>
                            <small>{line.date} · {line.kind==='debt_close'?'Закрытие долга':
                              line.kind==='extra'?'Дополнительная оплата':'Основная оплата'}</small>
                          </div><strong>{sum(line.amount)}</strong>
                        </div>)}
                      {parsedRows<PaymentLine>(order.paymentLines).length===0&&
                        <p>Зафиксированных оплат пока нет.</p>}
                      <div className="watch-main-ledger-total">
                        <span>Получено: <strong>{sum(order.receivedAmount)}</strong></span>
                        <span>Долг: <strong>{sum(order.debtAmount)}</strong></span>
                      </div>
                    </section>
                  </div>
                  <div className="watch-main-order-actions">
                    {editOrderId!==order.orderId&&<button type="button" className="secondary compact"
                      onClick={()=>{setEditOrderId(order.orderId);setDebtOrderId(null);setReturnOrderId(null);setExchangeOrderId(null)}}>
                      {isAdmin?'Редактировать / исправить':'Доп. действия · исправить'}
                    </button>}
                    {order.debtAmount>0&&debtOrderId!==order.orderId&&
                      <button type="button" className="secondary compact"
                        onClick={()=>{setDebtOrderId(order.orderId);setReturnOrderId(null);setExchangeOrderId(null)}}>
                        Закрыть долг
                      </button>}
                    {order.shippingStatus!=='sent'&&order.shippingStatus!=='Отправлено'&&!physicallyIssued(order)&&
                      <button type="button" className="secondary compact"
                        aria-expanded={handoverOrderId===order.orderId}
                        onClick={()=>{setHandoverOrderId(v=>v===order.orderId?null:order.orderId);
                          setEditOrderId(null);setDebtOrderId(null);setExchangeOrderId(null);setReturnOrderId(null)}}>
                        Уточнить выдачу после ревизии
                      </button>}
                    {(order.shippingStatus!=='sent'&&order.shippingStatus!=='Отправлено'&&!physicallyIssued(order)||
                      Boolean(order.pendingReplacement))&&
                      (onOpenLogistics?<button type="button"
                        onClick={()=>onOpenLogistics(brand)}>Подготовить / отправить в логистике</button>:
                        <small>Подготовка и отправка находятся в разделе «Логистика».</small>)}
                    {parsedRows<ItemLine>(order.itemLines).some(line=>line.returnableQuantity>0)&&
                      exchangeOrderId!==order.orderId&&
                      <button type="button" onClick={()=>{setExchangeOrderId(order.orderId);setReturnOrderId(null)}}>
                        Обменять часы</button>}
                    {(Math.max(0,order.receivedAmount-order.returnAmount)>0||
                      parsedRows<ItemLine>(order.itemLines).some(line=>(line.shipped>0||line.stockWriteoffStatus==='fulfilled')&&line.returnableQuantity>0))&&
                      returnOrderId!==order.orderId&&
                      <button type="button" onClick={()=>{setReturnOrderId(order.orderId);setExchangeOrderId(null)}}>
                        Оформить возврат</button>}
                  </div>

                  {handoverOrderId===order.orderId&&<WatchOrderHandoverPanel
                    brand={brand} orderId={order.orderId}
                    lines={parsedRows<ItemLine>(order.itemLines)}
                    onDone={()=>setRefresh(v=>v+1)}
                    onClose={()=>setHandoverOrderId(null)}/>}
                  {isAdmin&&<WatchAdminOrderActions
                    brand={brand} orderId={order.orderId} externalId={order.externalId||'#'+order.orderId}
                    managerId={Number(order.managerId||0)} paymentLines={order.paymentLines}
                    onDone={()=>{setEditOrderId(null);setRefresh(v=>v+1)}}/>}
                  {editOrderId===order.orderId&&<WatchOrderCorrections
                    brand={brand} order={order} isAdmin={isAdmin}
                    onCancel={()=>setEditOrderId(null)}
                    onDone={()=>{setEditOrderId(null);setRefresh(v=>v+1)}}/>}
                  {debtOrderId===order.orderId&&<WatchDebtPaymentForm
                    brand={brand} orderId={order.orderId} externalId={order.externalId||'#'+order.orderId}
                    debt={order.debtAmount} onCancel={()=>setDebtOrderId(null)}
                    onDone={()=>{setDebtOrderId(null);setRefresh(v=>v+1)}}/>}
                  {exchangeOrderId===order.orderId&&<WatchExchangeForm brand={brand} order={order}
                    onCancel={()=>setExchangeOrderId(null)}
                    onDone={()=>{setExchangeOrderId(null);setRefresh(v=>v+1)}}/>}
                  {returnOrderId===order.orderId&&<WatchReturnForm brand={brand} order={order}
                    onCancel={()=>setReturnOrderId(null)}
                    onDone={()=>{setReturnOrderId(null);setRefresh(v=>v+1)}}/>}
                </section>
              </td></tr>}
              </Fragment>})}</tbody>
          </table>
        </LinkedTableScroll>}
      <div className="watch-orders-pages">
        <button type="button" disabled={busy||page===0} onClick={()=>setPage(x=>x-1)}>Назад</button>
        <span>Страница {page+1}</span>
        <button type="button" disabled={busy||!data.hasMore} onClick={()=>setPage(x=>x+1)}>Дальше</button>
      </div>
    </>}
  </section>
}
