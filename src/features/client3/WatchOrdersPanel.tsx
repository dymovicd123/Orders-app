import { Fragment, useEffect, useState } from 'react'
import {watchReferenceLabel,type WatchBrand} from '../../../shared/client3/watch-domain'
import {WatchReturnForm} from './WatchReturnForm'
import {LinkedTableScroll} from '../../components/tables/LinkedTableScroll'
import {WatchExchangeForm} from './WatchExchangeForm'
import {WatchDebtPaymentForm} from './WatchDebtPaymentForm'
import {WatchOrderCorrections} from './WatchOrderCorrections'
import {WatchAdminOrderActions} from './WatchAdminOrderActions'
import {WatchOrderHandoverPanel} from './WatchOrderHandoverPanel'
import '../../styles/client3-watch-orders.css'

type WatchOrder={
  orderId:number;externalId:string;orderDate:string;managerName:string|null;managerId:number
  recipientName:string;recipientPhone:string;city:string;deliveryMethod:string;
  canonicalCustomerName:string;canonicalCustomerPhone:string;canonicalCity:string;
  canonicalDeliveryType:string;orderComment:string;orderStatus:string;
  deliveryAddress:string;postalCode:string;unresolvedReservations:number
  legacySource:'warehouse'|'boutique';shippingStatus:string;engravingStatus:string
  totalAmount:number;receivedAmount:number;debtAmount:number;returnAmount:number
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
type ItemLine={id:number;productName:string;quantity:number;returnableQuantity:number;unitPrice:number;
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
export function WatchOrdersPanel({allowedBrands,initialBrand,initialFocusedOrder,onOpenLogistics,isAdmin=false}:{
  allowedBrands:readonly WatchBrand[];initialBrand?:WatchBrand;
  initialFocusedOrder?:{orderId:number;externalId:string;orderDate:string};
  onOpenLogistics?:(brand:WatchBrand)=>void;
  isAdmin?:boolean
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
  const [returnOrderId,setReturnOrderId]=useState<number|null>(null)
  const [exchangeOrderId,setExchangeOrderId]=useState<number|null>(null)
  const [debtOrderId,setDebtOrderId]=useState<number|null>(null)
  const [editOrderId,setEditOrderId]=useState<number|null>(null)
  const [handoverOrderId,setHandoverOrderId]=useState<number|null>(
    initialFocusedOrder?.orderDate&&initialFocusedOrder.orderDate<new Date(Date.now()+5*3600*1000).toISOString().slice(0,10)
      ?initialFocusedOrder.orderId:null)
  const [expanded,setExpanded]=useState<number|null>(initialFocusedOrder?.orderId||null)
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
      <div><h2>Список заказов</h2><p>Поиск, статусы, оплата и действия по выбранному бренду.</p></div>
      <button type="button" disabled={busy} onClick={()=>setRefresh(x=>x+1)}>Обновить</button>
    </header>
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
      <p className="watch-orders-note">Суммы и долги взяты из заказов. Неотправленные часы с отсутствующим остатком остаются видимыми в таблице.</p>
      {data.rows.length===0?<p>Заказов за выбранный период нет.</p>:
        <LinkedTableScroll className="watch-main-orders-scroll" ariaLabel="Горизонтальная прокрутка таблицы заказов">
          <table className="data-table orders-table watch-main-orders-table">
            <thead><tr>
              <th>Дата / заказ</th><th>Менеджер</th><th>Клиент</th><th>Город</th>
              <th>Товары</th><th>Доставка / комментарий</th><th>Оплаты</th>
              <th>Сумма</th><th>Получено</th><th>Долг</th><th>Статус</th><th>Действия</th>
            </tr></thead>
            <tbody>{data.rows.map(order=><Fragment key={order.orderId}>
              <tr className={'watch-main-order-row'+(expanded===order.orderId?' is-open':'')}>
                <td><strong>{order.externalId||'#'+order.orderId}</strong>
                  <small>{order.orderDate}</small>
                  {order.urgent===1&&<small className="watch-main-urgent">Срочно</small>}</td>
                <td>{order.managerName||'—'}</td>
                <td><strong>{order.recipientName}</strong><small>{order.recipientPhone}</small></td>
                <td>{order.city||'—'}</td>
                <td className="watch-main-order-sku">
                  {parsedRows<ItemLine>(order.itemLines).slice(0,3).map(line=><div className="watch-main-order-sku-row" key={line.id}>
                    <strong>{line.productName}</strong><small>{line.quantity} шт. ·
                      {line.source==='warehouse'?' Офис':' Витрина'} ·
                      {[watchReferenceLabel('movements',line.movement),watchReferenceLabel('bracelets',line.braceletMaterial),watchReferenceLabel('dials',line.dialColor)].filter(Boolean).join(' / ')}</small>
                  </div>)}
                  {order.lineCount>3&&<small>Ещё {order.lineCount-3} поз.</small>}
                </td>
                <td className="watch-main-order-delivery">
                  <strong>{order.deliveryMethod||'—'}</strong>
                  <small>{order.shippingDeadlineAt?'До '+new Date(order.shippingDeadlineAt).toLocaleString('ru-RU',{timeZone:'Asia/Almaty'}):'Без срока'}</small>
                  {order.urgent===1&&<small className="watch-main-urgent">Срочно</small>}
                  {parsedRows<ItemLine>(order.itemLines).some(x=>x.engravingText)&&
                    <small>Есть текст гравировки</small>}
                </td>
                <td className="watch-main-order-payments">
                  {parsedRows<PaymentLine>(order.paymentLines).slice(0,2).map(x=>
                    <span className="order-payment-chip" key={x.id}>{x.method}: {sum(x.amount)}</span>)}
                  {parsedRows<PaymentLine>(order.paymentLines).length>2&&<small>
                    + ещё {parsedRows<PaymentLine>(order.paymentLines).length-2}</small>}
                  {parsedRows<PaymentLine>(order.paymentLines).length===0&&<small>Не оплачено</small>}
                </td>
                <td className="watch-main-money">{sum(order.totalAmount)}</td>
                <td className="watch-main-money">{sum(order.receivedAmount)}</td>
                <td className={'watch-main-money '+(order.debtAmount>0?'is-debt':'is-paid')}>
                  {order.debtAmount>0?sum(order.debtAmount):'Оплачено'}</td>
                <td><span className={'watch-main-order-status'+(order.pendingReplacement?' is-awaiting':order.shippingStatus==='sent'||physicallyIssued(order)?' is-sent':' is-awaiting')}>
                  {shipLabel(order)}
                  </span>
                  {order.unresolvedReservations>0&&<small className="watch-main-stock-warning">
                    Требует поступления/резерва: {order.unresolvedReservations}</small>}
                </td>
                <td><button type="button" className="watch-main-detail-button"
                  aria-expanded={expanded===order.orderId}
                  onClick={()=>{setExpanded(v=>v===order.orderId?null:order.orderId);setReturnOrderId(null);setExchangeOrderId(null);setDebtOrderId(null);setEditOrderId(null);setHandoverOrderId(null)}}>
                  {expanded===order.orderId?'Скрыть':'Открыть'}
                </button></td>
              </tr>
              {expanded===order.orderId&&<tr className="watch-main-order-expanded"><td colSpan={12}>
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
                      parsedRows<ItemLine>(order.itemLines).some(line=>line.shipped>0&&line.returnableQuantity>0))&&
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
            </Fragment>)}</tbody>
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
