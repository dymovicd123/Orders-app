import { Fragment, useEffect, useState } from 'react'
import type { WatchBrand } from '../../../shared/client3/watch-domain'
import {WatchReturnForm} from './WatchReturnForm'
import {LinkedTableScroll} from '../../components/tables/LinkedTableScroll'
import {WatchExchangeForm} from './WatchExchangeForm'
import '../../styles/client3-watch-orders.css'

type WatchOrder={
  orderId:number;externalId:string;orderDate:string;managerName:string|null
  recipientName:string;recipientPhone:string;city:string;deliveryMethod:string
  legacySource:'warehouse'|'boutique';shippingStatus:string;engravingStatus:string
  totalAmount:number;receivedAmount:number;debtAmount:number;returnAmount:number
  lineCount:number;engravedLines:number;urgent:number;shippingDeadlineAt:string
  firstItemId:number|null;returnableQuantity:number;watchDescription:string|null
  activeWatchVariantId:number|null;pendingReplacement:number
  paymentLines:string;itemLines:string
}
type Totals={orderCount:number;totalAmount:number;receivedAmount:number;debtAmount:number;returnAmount:number}
type OrdersResponse={ok:boolean;rows:WatchOrder[];totals:Totals;hasMore:boolean;message?:string}
const sum=(value:number)=>Number(value||0).toLocaleString('ru-RU')+' ₸'
type PaymentLine={id:number;method:string;amount:number;date:string;kind:string}
type ItemLine={id:number;productName:string;quantity:number;unitPrice:number;source:string;
  engravingText:string;gender:string;movement:string;braceletMaterial:string;
  dialColor:string;braceletColor:string}
function parsedRows<T>(raw:string|undefined):T[]{
  try{const rows=JSON.parse(raw||'[]') as unknown;return Array.isArray(rows)?rows as T[]:[]}catch{return []}
}
const initialMonth=()=>{
  const date=new Date(Date.now()+5*60*60*1000).toISOString()
  return date.slice(0,7)
}
export function WatchOrdersPanel({allowedBrands,initialBrand,onOpenLogistics}:{
  allowedBrands:readonly WatchBrand[];initialBrand?:WatchBrand;onOpenLogistics?:(brand:WatchBrand)=>void
}) {
  const [brand,setBrand]=useState<WatchBrand>(initialBrand&&allowedBrands.includes(initialBrand)?initialBrand:allowedBrands[0]||'TAUWACH')
  const [month,setMonth]=useState(initialMonth)
  const [search,setSearch]=useState('')
  const [query,setQuery]=useState('')
  const [page,setPage]=useState(0)
  const [refresh,setRefresh]=useState(0)
  const [data,setData]=useState<OrdersResponse|null>(null)
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const [returnOrderId,setReturnOrderId]=useState<number|null>(null)
  const [exchangeOrderId,setExchangeOrderId]=useState<number|null>(null)
  const [expanded,setExpanded]=useState<number|null>(null)
  useEffect(()=>{
    const controller=new AbortController()
    setBusy(true);setError('');setData(null)
    const params=new URLSearchParams({brand,limit:'50',offset:String(page*50)})
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
  },[brand,month,query,page,refresh])
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
      <p className="watch-orders-note">Суммы взяты из текущих записей заказов. Это не отчёт о движениях кассы или чистой прибыли.</p>
      {data.rows.length===0?<p>Заказов за выбранный период нет.</p>:
        <LinkedTableScroll className="watch-main-orders-scroll" ariaLabel="Горизонтальная прокрутка таблицы заказов">
          <table className="data-table orders-table watch-main-orders-table">
            <thead><tr>
              <th>Заказ</th><th>Дата</th><th>Клиент</th><th>Товар</th><th>Источник</th>
              <th>Сумма</th><th>Оплачено</th><th>Состояние</th><th aria-label="Действия"/>
            </tr></thead>
            <tbody>{data.rows.map(order=><Fragment key={order.orderId}>
              <tr className={'watch-main-order-row'+(expanded===order.orderId?' is-open':'')}>
                <td><strong>{order.externalId||'#'+order.orderId}</strong>{order.urgent===1&&<small className="watch-main-urgent">Срочно</small>}</td>
                <td>{order.orderDate}</td>
                <td><strong>{order.recipientName}</strong><small>{order.recipientPhone}</small><small>{order.city}</small></td>
                <td className="watch-main-order-sku">{order.watchDescription||'—'}</td>
                <td>{order.legacySource==='warehouse'?'Офис':'Витрина'}</td>
                <td className="watch-main-money">{sum(order.totalAmount)}</td>
                <td className="watch-main-money">{sum(order.receivedAmount)}<small>Долг: {sum(order.debtAmount)}</small></td>
                <td><span className={'watch-main-order-status'+(order.pendingReplacement?' is-awaiting':order.shippingStatus==='sent'?' is-sent':' is-awaiting')}>
                  {order.pendingReplacement?'Замена ожидает отправки':order.shippingStatus==='sent'||order.shippingStatus==='Отправлено'?'Отправлено':'Не отправлено'}
                  </span></td>
                <td><button type="button" className="watch-main-detail-button"
                  aria-expanded={expanded===order.orderId}
                  onClick={()=>{setExpanded(v=>v===order.orderId?null:order.orderId);setReturnOrderId(null);setExchangeOrderId(null)}}>
                  {expanded===order.orderId?'Скрыть':'Открыть'}
                </button></td>
              </tr>
              {expanded===order.orderId&&<tr className="watch-main-order-expanded"><td colSpan={9}>
                <section className="watch-main-order-detail" aria-label={'Детали заказа '+order.externalId}>
                  <div className="watch-main-order-detail-grid">
                    <div><small>Покупатель</small><strong>{order.recipientName}</strong>
                      <span>{order.recipientPhone} · {order.city}</span><span>{order.deliveryMethod}</span></div>
                    <div><small>Менеджер</small><strong>{order.managerName||'Не указан'}</strong>
                      <span>{order.lineCount} позиций · {order.legacySource==='warehouse'?'Офис':'Витрина'}</span></div>
                    <div><small>Оплата</small><strong>{sum(order.receivedAmount)} из {sum(order.totalAmount)}</strong>
                      <span>Долг: {sum(order.debtAmount)} · Возвраты: {sum(order.returnAmount)}</span></div>
                    <div><small>Доставка и гравировка</small>
                      <strong>{order.pendingReplacement?'Замена ожидает отправки':order.shippingStatus==='sent'||order.shippingStatus==='Отправлено'?'Отправлено':'Не отправлено'}</strong>
                      <span>Гравировка: {order.engravingStatus==='ready'?'Готово':order.engravingStatus==='engraving'?'В работе':'Ожидает'}</span></div>
                  </div>
                  <div className="watch-main-order-ledger-details">
                    <section className="mini-panel">
                      <h3>Товары заказа</h3>
                      {parsedRows<ItemLine>(order.itemLines).map(line=><div className="watch-main-ledger-line" key={line.id}>
                        <div><strong>{line.productName}</strong>
                          <small>{[
                            line.gender==='male'?'Мужские':line.gender==='female'?'Женские':'',
                            line.movement,line.braceletMaterial,line.dialColor,line.braceletColor,
                          ].filter(Boolean).join(' · ')}</small>
                          {line.engravingText&&<small>Гравировка: {line.engravingText}</small>}
                          <small>{line.source==='warehouse'?'Офис':'Витрина'}</small></div>
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
                    {order.shippingStatus!=='sent'&&order.shippingStatus!=='Отправлено'&&
                      (onOpenLogistics?<button type="button"
                        onClick={()=>onOpenLogistics(brand)}>Подготовить / отправить в логистике</button>:
                        <small>Подготовка и отправка находятся в разделе «Логистика».</small>)}
                    {(order.shippingStatus==='sent'||order.shippingStatus==='Отправлено')&&
                      !order.pendingReplacement&&order.lineCount===1&&order.returnableQuantity===1&&
                      exchangeOrderId!==order.orderId&&
                      <button type="button" onClick={()=>{setExchangeOrderId(order.orderId);setReturnOrderId(null)}}>
                        Обменять часы</button>}
                    {order.lineCount===1&&(Math.max(0,order.receivedAmount-order.returnAmount)>0||
                      ((order.shippingStatus==='sent'||order.shippingStatus==='Отправлено')&&order.returnableQuantity>0))&&
                      returnOrderId!==order.orderId&&
                      <button type="button" onClick={()=>{setReturnOrderId(order.orderId);setExchangeOrderId(null)}}>
                        Оформить возврат</button>}
                  </div>
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
