import {useEffect,useState,type FormEvent} from 'react'
import type {WatchBrand} from '../../../shared/client3/watch-domain'
import {LinkedTableScroll} from '../../components/tables/LinkedTableScroll'
import {watchMoney} from './useWatchAnalytics'

type Client={phoneKey:string;name:string;phone:string;city:string;lastDate:string;
 orderCount:number;sales:number;received:number;returned:number;debt:number}
type Order={orderId:number;externalId:string;orderDate:string;recipientName:string;city:string;
 totalAmount:number;receivedAmount:number;returnAmount:number;debtAmount:number;shippingStatus:string}
type Response<T>={ok:boolean;message?:string;rows?:T[];total?:number;hasMore?:boolean}
export function WatchClientsPanel({brands,onOpenOrder}:{
 brands:readonly WatchBrand[];
 onOpenOrder?:(order:{brand:WatchBrand;orderId:number;externalId:string;orderDate:string})=>void
}){
 const [brand,setBrand]=useState<WatchBrand>(brands[0]||'TAUWACH')
 const [search,setSearch]=useState('')
 const [query,setQuery]=useState('')
 const [page,setPage]=useState(0)
 const [revision,setRevision]=useState(0)
 const [rows,setRows]=useState<Client[]>([])
 const [total,setTotal]=useState(0)
 const [hasMore,setHasMore]=useState(false)
 const [busy,setBusy]=useState(false)
 const [error,setError]=useState('')
 const [selected,setSelected]=useState<Client|null>(null)
 const [orders,setOrders]=useState<Order[]>([])
 const [orderMore,setOrderMore]=useState(false)
 const [orderBusy,setOrderBusy]=useState(false)
 const [orderError,setOrderError]=useState('')
 const read=async<T,>(url:string,signal?:AbortSignal):Promise<Response<T>>=>{
   const r=await fetch(url,{credentials:'include',cache:'no-store',signal})
   const value=await r.json() as Response<T>
   if(!r.ok||!value.ok)throw Error(value.message||'Данные недоступны.')
   return value
 }
 useEffect(()=>{
   const controller=new AbortController()
   setSelected(null);setOrders([]);setBusy(true);setError('')
   const p=new URLSearchParams({brand,q:query,limit:'50',offset:String(page*50)})
   void read<Client>('/api/client3/watches/clients?'+p,controller.signal).then(value=>{
     if(!controller.signal.aborted){
       setRows(value.rows||[]);setTotal(Number(value.total||0))
       setHasMore(Boolean(value.hasMore))
     }
   }).catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Ошибка клиентов.')})
     .finally(()=>{if(!controller.signal.aborted)setBusy(false)})
   return ()=>controller.abort()
 },[brand,query,page,revision])
 const submit=(e:FormEvent)=>{e.preventDefault();setPage(0);setQuery(search.trim())}
 const open=async(client:Client)=>{
   if(selected?.phoneKey===client.phoneKey){setSelected(null);setOrders([]);return}
   setSelected(client);setOrders([]);setOrderMore(false);setOrderBusy(true);setOrderError('')
   const key=client.phoneKey
   try{
     const p=new URLSearchParams({brand,phoneKey:key,limit:'50',offset:'0'})
     const v=await read<Order>('/api/client3/watches/clients/orders?'+p)
     setOrders(v.rows||[]);setOrderMore(Boolean(v.hasMore))
   }catch(e){setOrderError(e instanceof Error?e.message:'Не удалось открыть историю.')}
   finally{setOrderBusy(false)}
 }
 const more=async()=>{
   if(!selected||orderBusy||!orderMore)return
   setOrderBusy(true);setOrderError('')
   try{
     const p=new URLSearchParams({brand,phoneKey:selected.phoneKey,limit:'50',offset:String(orders.length)})
     const v=await read<Order>('/api/client3/watches/clients/orders?'+p)
     setOrders(current=>[...current,...(v.rows||[])])
     setOrderMore(Boolean(v.hasMore))
   }catch(e){setOrderError(e instanceof Error?e.message:'История не загрузилась.')}
   finally{setOrderBusy(false)}
 }
 return <article className="card wide sector-clients client3-watch-clients" id="clients">
   <div className="card-label">Клиенты</div>
   <div className="card-meta">История покупок выбранного бренда. Клиенты объединяются по известному телефону,
     а не по совпадению имени. Сведения других брендов без разрешения не показываются.</div>
   <div className="orders-filter-panel">
     <div className="orders-filter-grid">
       <label>Бренд<select value={brand} onChange={e=>{setBrand(e.target.value as WatchBrand);setPage(0)}}>
         {brands.map(x=><option key={x} value={x}>{x}</option>)}
       </select></label>
       <form onSubmit={submit}><label>Поиск по имени или телефону
         <input value={search} maxLength={100} placeholder="ФИО или номер" onChange={e=>setSearch(e.target.value)}/>
       </label><button type="submit" className="primary">Найти</button></form>
       <button type="button" className="secondary" disabled={busy} onClick={()=>setRevision(x=>x+1)}>Обновить</button>
     </div>
   </div>
   <div className="summary-grid compact-summary">
     <div className="summary-card"><span>Клиентов по фильтру</span><strong>{total}</strong></div>
     <div className="summary-card"><span>На странице</span><strong>{rows.length}</strong></div>
   </div>
   {busy&&<p role="status">Загружаю клиентов…</p>}
   {error&&<p role="alert" className="app-alert error">{error}</p>}
   <LinkedTableScroll ariaLabel="Клиенты часовой системы">
     <table className="data-table strict-report-table">
       <thead><tr><th>Клиент</th><th>Город</th><th>Заказов</th><th>Продажи</th>
         <th>Оплачено</th><th>Возвращено</th><th>Долг</th><th>Последний заказ</th><th>Действие</th></tr></thead>
       <tbody>{rows.map(client=><tr key={client.phoneKey}>
         <td><strong>{client.name||'Без имени'}</strong><small>{client.phone||'Без телефона'}</small></td>
         <td>{client.city||'—'}</td><td>{client.orderCount}</td>
         <td>{watchMoney(client.sales)}</td><td>{watchMoney(client.received)}</td>
         <td>{watchMoney(client.returned)}</td><td>{watchMoney(client.debt)}</td>
         <td>{client.lastDate}</td>
         <td><button className="secondary compact" type="button"
           aria-expanded={selected?.phoneKey===client.phoneKey}
           onClick={()=>void open(client)}>
           {selected?.phoneKey===client.phoneKey?'Скрыть':'История'}</button></td>
       </tr>)}
       {!rows.length&&!busy&&<tr><td className="empty-state" colSpan={9}>Клиенты не найдены.</td></tr>}
       </tbody>
     </table>
   </LinkedTableScroll>
   {hasMore&&<div className="button-row">
     <button className="secondary" disabled={busy||page===0} onClick={()=>setPage(x=>Math.max(0,x-1))}>Назад</button>
     <button className="secondary" disabled={busy} onClick={()=>setPage(x=>x+1)}>Следующая страница</button>
   </div>}
   {page>0&&!hasMore&&<button className="secondary" onClick={()=>setPage(x=>Math.max(0,x-1))}>Назад</button>}
   {selected&&<section className="mini-panel">
     <div className="mini-panel-head"><div><h3>История заказов · {selected.name}</h3>
       <p className="mini-panel-note">{selected.phone}</p></div>
       <button type="button" className="secondary compact" onClick={()=>setSelected(null)}>Закрыть</button>
     </div>
     {orderError&&<p role="alert" className="app-alert error">{orderError}</p>}
     <LinkedTableScroll ariaLabel="История заказов клиента"><table className="data-table strict-report-table">
       <thead><tr><th>Дата</th><th>Заказ</th><th>Город</th><th>Продажа</th><th>Оплачено</th>
         <th>Возвраты</th><th>Долг</th><th>Отправка</th><th>Действие</th></tr></thead>
       <tbody>{orders.map(o=><tr key={o.orderId}><td>{o.orderDate}</td>
         <td>{o.externalId||'#'+o.orderId}</td><td>{o.city||'—'}</td>
         <td>{watchMoney(o.totalAmount)}</td><td>{watchMoney(o.receivedAmount)}</td>
         <td>{watchMoney(o.returnAmount)}</td><td>{watchMoney(o.debtAmount)}</td>
         <td>{o.shippingStatus==='sent'?'Отправлено':'Не отправлено / уточнить'}</td>
         <td>{onOpenOrder&&<button className="secondary compact" type="button"
           onClick={()=>onOpenOrder({brand,orderId:o.orderId,externalId:o.externalId,orderDate:o.orderDate})}>К заказу</button>}</td>
       </tr>)}
       </tbody></table></LinkedTableScroll>
     {orderMore&&<button className="secondary" type="button" disabled={orderBusy}
       onClick={()=>void more()}>{orderBusy?'Загрузка…':'Показать ещё заказы'}</button>}
     {orderBusy&&<p role="status">Загружаю историю…</p>}
   </section>}
 </article>
}
