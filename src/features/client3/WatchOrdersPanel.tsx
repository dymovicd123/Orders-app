import { useEffect, useRef, useState } from 'react'
import type { WatchBrand } from '../../../shared/client3/watch-domain'
import '../../styles/client3-watch-orders.css'

type WatchOrder={
  orderId:number;externalId:string;orderDate:string;managerName:string|null
  recipientName:string;recipientPhone:string;city:string;deliveryMethod:string
  legacySource:'warehouse'|'boutique';shippingStatus:string;engravingStatus:string
  totalAmount:number;receivedAmount:number;debtAmount:number;returnAmount:number
  lineCount:number;engravedLines:number;urgent:number;shippingDeadlineAt:string
}
type Totals={orderCount:number;totalAmount:number;receivedAmount:number;debtAmount:number;returnAmount:number}
type OrdersResponse={ok:boolean;rows:WatchOrder[];totals:Totals;hasMore:boolean;message?:string}
const sum=(value:number)=>Number(value||0).toLocaleString('ru-RU')+' ₸'
const initialMonth=()=>{
  const date=new Date(Date.now()+5*60*60*1000).toISOString()
  return date.slice(0,7)
}
export function WatchOrdersPanel({allowedBrands,initialBrand}:{allowedBrands:readonly WatchBrand[];initialBrand?:WatchBrand}) {
  const [brand,setBrand]=useState<WatchBrand>(initialBrand&&allowedBrands.includes(initialBrand)?initialBrand:allowedBrands[0]||'TAUWACH')
  const [month,setMonth]=useState(initialMonth)
  const [search,setSearch]=useState('')
  const [query,setQuery]=useState('')
  const [page,setPage]=useState(0)
  const [refresh,setRefresh]=useState(0)
  const [data,setData]=useState<OrdersResponse|null>(null)
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const [sendConfirm,setSendConfirm]=useState<number|null>(null)
  const [sendingId,setSendingId]=useState<number|null>(null)
  const shipRequests=useRef<Record<number,string>>({})
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
  const sendOrder=async(orderId:number)=>{
    if(sendingId!==null||sendConfirm!==orderId)return
    setSendingId(orderId);setError('')
    if(!shipRequests.current[orderId])shipRequests.current[orderId]='watch-send-'+crypto.randomUUID()
    try{
      const response=await fetch('/api/client3/watches/orders/'+orderId+'/send',{
        method:'POST',credentials:'include',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({brand,requestId:shipRequests.current[orderId]}),
      })
      const result=await response.json() as {ok:boolean;message?:string}
      if(!response.ok||!result.ok)throw new Error(result.message||'Не удалось отправить часы')
      delete shipRequests.current[orderId]
      setSendConfirm(null)
      setRefresh(x=>x+1)
    }catch(cause){setError(cause instanceof Error?cause.message:'Ошибка отправки')}
    finally{setSendingId(null)}
  }
  return <section className="watch-orders">
    <header className="watch-orders-header">
      <div><h2>Заказы часов</h2><p>Заказы, оплаты и задолженности отображаются отдельно по брендам.</p></div>
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
        <div className="watch-orders-list">
          {data.rows.map(order=><article key={order.orderId}>
            <div className="watch-orders-row-heading">
              <strong>{order.externalId||'#'+order.orderId}</strong>
              <span>{order.orderDate}</span>
              <span>{order.legacySource==='warehouse'?'Офис':'Витрина'}</span>
            </div>
            <div className="watch-orders-row-details">
              <div><small>Получатель</small><strong>{order.recipientName}</strong>
                <span>{order.city} · {order.recipientPhone}</span></div>
              <div><small>Менеджер</small><strong>{order.managerName||'Не указан'}</strong>
                <span>{order.lineCount} позиций · {order.deliveryMethod}</span></div>
              <div><small>Оплата</small><strong>{sum(order.receivedAmount)} / {sum(order.totalAmount)}</strong>
                <span>Долг: {sum(order.debtAmount)}</span></div>
              <div><small>Состояние</small>
                <strong>{order.shippingStatus==='sent'||order.shippingStatus==='Отправлено'?'Отправлено':'Не отправлено'}</strong>
                <span>Гравировка: {order.engravingStatus==='ready'?'Готово':order.engravingStatus==='engraving'?'В работе':'Ожидает'}</span>
                {order.shippingStatus!=='sent'&&order.shippingStatus!=='Отправлено'&&order.lineCount===1&&
                  (order.engravedLines===0||order.engravingStatus==='ready')&&
                  <div className="watch-orders-shipping">
                    {sendConfirm===order.orderId?<>
                      <small>Подтверждаете фактическую отправку? Товар будет списан со склада.</small>
                      <button type="button" disabled={sendingId!==null} onClick={()=>void sendOrder(order.orderId)}>
                        {sendingId===order.orderId?'Сохраняю…':'Подтвердить отправку'}
                      </button>
                      <button type="button" disabled={sendingId!==null} onClick={()=>setSendConfirm(null)}>Отмена</button>
                    </>:<button type="button" disabled={sendingId!==null}
                      onClick={()=>setSendConfirm(order.orderId)}>Отправить клиенту</button>}
                  </div>}
                {order.shippingStatus!=='sent'&&order.engravedLines>0&&order.engravingStatus!=='ready'&&
                  <small>Сначала завершите гравировку в логистике.</small>}
              </div>
            </div>
          </article>)}
        </div>}
      <div className="watch-orders-pages">
        <button type="button" disabled={busy||page===0} onClick={()=>setPage(x=>x-1)}>Назад</button>
        <span>Страница {page+1}</span>
        <button type="button" disabled={busy||!data.hasMore} onClick={()=>setPage(x=>x+1)}>Дальше</button>
      </div>
    </>}
  </section>
}
