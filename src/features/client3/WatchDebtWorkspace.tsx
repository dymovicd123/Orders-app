import {useEffect,useState,type FormEvent} from 'react'
import type {WatchBrand} from '../../../shared/client3/watch-domain'
import {LinkedTableScroll} from '../../components/tables/LinkedTableScroll'
import {WatchDebtPaymentForm} from './WatchDebtPaymentForm'
import {WatchDebtHistoryPanel} from './WatchDebtHistoryPanel'
import '../../styles/client3-qa-debt-20261104.css'

type DebtOrder={
 orderId:number;externalId:string;orderDate:string;managerName:string|null;
 recipientName:string;recipientPhone:string;city:string;watchDescription:string|null;
 totalAmount:number;receivedAmount:number;debtAmount:number
}
type DebtResponse={ok:boolean;rows:DebtOrder[];totals:{
 orderCount:number;debtAmount:number
};hasMore:boolean;message?:string}
type Target={brand:WatchBrand;orderId:number;externalId:string}
type Mode='list'|'pay'|'history'
type Props={brands:readonly WatchBrand[];initialTarget?:Target|null}
const money=(n:number)=>Number(n||0).toLocaleString('ru-RU')+' ₸'

/** Main orders -> dedicated Debt tab. A payment never opens inside an order table row.
 * The register is date-independent; history has its own tab and is read-only. */
export function WatchDebtWorkspace({brands,initialTarget}:Props){
 const [brand,setBrand]=useState<WatchBrand>(initialTarget?.brand||brands[0]||'TAUWACH')
 const [mode,setMode]=useState<Mode>(initialTarget?'pay':'list')
 const [selectedId,setSelectedId]=useState<number|null>(initialTarget?.orderId??null)
 const [search,setSearch]=useState(initialTarget?.externalId||'')
 const [query,setQuery]=useState(initialTarget?.externalId||'')
 const [page,setPage]=useState(0)
 const [reload,setReload]=useState(0)
 const [data,setData]=useState<DebtResponse|null>(null)
 const [loading,setLoading]=useState(true)
 const [error,setError]=useState('')
 useEffect(()=>{
  const controller=new AbortController()
  const params=new URLSearchParams({
   brand,limit:'50',offset:String(page*50),shipping:'all',payment:'debt',
  })
  if(query)params.set('q',query)
  setLoading(true);setError('')
  void fetch('/api/client3/watches/orders?'+params,{
   credentials:'include',cache:'no-store',signal:controller.signal,
  }).then(async response=>{
   const result=await response.json() as DebtResponse
   if(!response.ok||!result.ok)throw Error(result.message||'Не удалось получить долги')
   if(!controller.signal.aborted)setData(result)
  }).catch(cause=>{
   if(!controller.signal.aborted){setData(null)
    setError(cause instanceof Error?cause.message:'Ошибка загрузки долгов')}
  }).finally(()=>{if(!controller.signal.aborted)setLoading(false)})
  return ()=>controller.abort()
 },[brand,query,page,reload])
 const selected=data?.rows.find(row=>row.orderId===selectedId)
 const choose=(order:DebtOrder)=>{setSelectedId(order.orderId);setMode('pay')}
 const backToList=()=>{setMode('list');setSelectedId(null)}
 const changeBrand=(value:WatchBrand)=>{
  setBrand(value);setPage(0);setQuery('');setSearch('');backToList()
 }
 const searchDebts=(e:FormEvent<HTMLFormElement>)=>{
  e.preventDefault();setPage(0);setQuery(search.trim());backToList()
 }
 const finishPayment=()=>{
  backToList();setSearch('');setQuery('');setPage(0);setReload(v=>v+1)
 }
 return <section className="watch-orders watch-debt-workspace">
  <header className="watch-orders-header">
   <div>
    <h2>Закрытие долга</h2>
    <p>Отдельный раздел заказов по образцу Main. Выберите заказ, затем откройте форму оплаты.</p>
   </div>
   <button type="button" className="secondary compact"
    onClick={()=>setReload(v=>v+1)} disabled={loading}>Обновить</button>
  </header>
  <div className="watch-debt-workspace-nav" role="tablist" aria-label="Долги и история">
   <button type="button" className={'secondary compact'+(mode==='list'?' is-active':'')}
    role="tab" aria-selected={mode==='list'} onClick={backToList}>Открытые долги</button>
   {selectedId!==null&&<button type="button"
    className={'secondary compact'+(mode==='pay'?' is-active':'')}
    role="tab" aria-selected={mode==='pay'} onClick={()=>setMode('pay')}>Форма закрытия долга</button>}
   <button type="button" className={'secondary compact'+(mode==='history'?' is-active':'')}
    role="tab" aria-selected={mode==='history'} onClick={()=>setMode('history')}>История закрытий</button>
  </div>
  <div className="watch-debt-brand-filter">
   <label>Бренд
    <select value={brand} onChange={e=>changeBrand(e.target.value as WatchBrand)}>
     {brands.map(code=><option key={code} value={code}>{code}</option>)}
    </select>
   </label>
  </div>
  {mode==='history'?<WatchDebtHistoryPanel key={brand} brand={brand} refreshToken={reload}/>:
   mode==='pay'?<section className="mini-panel watch-debt-form-page">
    <div className="mini-panel-head">
     <div><h3>Оплата по долгу</h3>
      <p>Сохранение оплат изменяет финансовую историю и остаток долга заказа.</p></div>
     <button type="button" className="secondary compact back-action"
      onClick={backToList}>Назад к таблице долгов</button>
    </div>
    {loading&&<p role="status">Открываю долг заказа…</p>}
    {error&&<p role="alert" className="watch-orders-error">{error}</p>}
    {!loading&&!error&&selected&&selected.debtAmount>0&&<>
     <div className="watch-debt-order-context">
      <strong>{selected.externalId}</strong>
      <span>{selected.orderDate} · {selected.recipientName||selected.recipientPhone||'—'} · {selected.managerName||'—'}</span>
      <span>Сумма заказа: {money(selected.totalAmount)} · Получено: {money(selected.receivedAmount)}</span>
     </div>
     <WatchDebtPaymentForm key={selected.orderId} brand={brand}
      orderId={selected.orderId} externalId={selected.externalId}
      debt={selected.debtAmount} onDone={finishPayment} onCancel={backToList}/>
    </>}
    {!loading&&!error&&!selected&&<p role="alert" className="watch-orders-error">
     Открытый долг выбранного заказа не найден. Возможно, долг уже закрыт.
     Вернитесь к таблице или проверьте поиск.</p>}
   </section>:
   <section className="mini-panel debt-table-panel watch-debt-list-page">
    <div className="mini-panel-head">
     <div><h3>Таблица долгов</h3>
      <p>Все незакрытые долги бренда, без ограничения текущим месяцем.</p></div>
     {data&&<div className="debt-filter-summary"><span>С долгом</span>
      <strong>{data.totals.orderCount}</strong></div>}
    </div>
    <form className="watch-debt-search" onSubmit={searchDebts}>
     <label>Найти заказ или клиента
      <input value={search} maxLength={100} placeholder="Номер заказа, имя, телефон"
       onChange={e=>setSearch(e.target.value)}/>
     </label>
     <button type="submit" className="primary compact">Найти</button>
     {(search||query)&&<button type="button" className="secondary compact" onClick={()=>{
      setSearch('');setQuery('');setPage(0)
     }}>Сбросить</button>}
    </form>
    {error&&<p role="alert" className="watch-orders-error">{error}</p>}
    {loading&&<p role="status">Загрузка долгов…</p>}
    {!loading&&!error&&data&&<>
     <div className="watch-debt-list-summary">Открытых заказов: <strong>{data.totals.orderCount}</strong>
      <span>Общий долг: <strong>{money(data.totals.debtAmount)}</strong></span></div>
     <LinkedTableScroll className="watch-debt-list-scroll" ariaLabel="Таблица открытых долгов">
      <table className="data-table debt-order-table watch-debt-list-table">
       <thead><tr><th>Дата / заказ</th><th>Клиент</th><th>Менеджер</th>
        <th>Часы</th><th>Получено</th><th>Долг</th><th>Действие</th></tr></thead>
       <tbody>{data.rows.map(order=><tr key={order.orderId}>
        <td><strong>{order.orderDate}</strong><small>{order.externalId}</small></td>
        <td><strong>{order.recipientName||'—'}</strong><small>{order.recipientPhone} · {order.city}</small></td>
        <td>{order.managerName||'—'}</td><td>{order.watchDescription||'Часы'}</td>
        <td>{money(order.receivedAmount)}</td>
        <td><strong>{money(order.debtAmount)}</strong></td>
        <td><button type="button" className="primary compact"
         onClick={()=>choose(order)}>Закрыть долг</button></td>
       </tr>)}
       {!data.rows.length&&<tr><td colSpan={7} className="empty-state">
        Заказов с открытым долгом не найдено.</td></tr>}
       </tbody>
      </table>
     </LinkedTableScroll>
     <div className="watch-debt-pagination">
      <button type="button" className="secondary compact" disabled={page===0}
       onClick={()=>setPage(v=>Math.max(0,v-1))}>Назад</button>
      <span>Страница {page+1}</span>
      <button type="button" className="secondary compact" disabled={!data.hasMore}
       onClick={()=>setPage(v=>v+1)}>Показать ещё</button>
     </div>
    </>}
   </section>}
 </section>
}
