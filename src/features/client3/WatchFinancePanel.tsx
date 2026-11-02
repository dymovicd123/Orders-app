import {useEffect,useState} from 'react'
import type {WatchBrand} from '../../../shared/client3/watch-domain'
import {LinkedTableScroll} from '../../components/tables/LinkedTableScroll'
import '../../styles/client3-watch-finance.css'
type Event={id:number;eventDate:string;eventType:string;amountDelta:number;paymentMethod:string|null;externalOrderId:string;comment:string|null}
type Method={method:string;incoming:number;outgoing:number;net:number}
type Result={ok:boolean;rows:Event[];methods:Method[];totals:{eventCount:number;incoming:number;outgoing:number;net:number};hasMore:boolean;message?:string}
const amount=(n:number)=>Number(n||0).toLocaleString('ru-RU')+' ₸'
const currentMonth=()=>new Date(Date.now()+5*3600*1000).toISOString().slice(0,7)
export function WatchFinancePanel({brands}:{brands:readonly WatchBrand[]}) {
  const [brand,setBrand]=useState<WatchBrand>(brands[0]||'TAUWACH')
  const [month,setMonth]=useState(currentMonth)
  const [page,setPage]=useState(0)
  const [refresh,setRefresh]=useState(0)
  const [result,setResult]=useState<Result|null>(null)
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  useEffect(()=>{
    const controller=new AbortController()
    setBusy(true);setError('');setResult(null)
    const params=new URLSearchParams({brand,month,limit:'50',offset:String(page*50)})
    void fetch('/api/client3/watches/finance?'+params,{
      credentials:'include',cache:'no-store',signal:controller.signal,
    }).then(async response=>{
      const data=await response.json() as Result
      if(!response.ok||!data.ok)throw new Error(data.message||'Не удалось загрузить движения денег')
      if(!controller.signal.aborted)setResult(data)
    }).catch(cause=>{if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'Ошибка финансов')})
      .finally(()=>{if(!controller.signal.aborted)setBusy(false)})
    return ()=>controller.abort()
  },[brand,month,page,refresh])
  return <section className="watch-finance">
    <header><div><h2>Движение денег</h2>
      <p>События оплат и возвратов по выбранному бренду. Данные других брендов не смешиваются.</p>
    </div><button type="button" onClick={()=>setRefresh(x=>x+1)} disabled={busy}>Обновить</button></header>
    <div className="watch-finance-filters">
      <label>Бренд<select value={brand} onChange={e=>{setBrand(e.target.value as WatchBrand);setPage(0)}}>
        {brands.map(code=><option key={code} value={code}>{code}</option>)}
      </select></label>
      <label>Месяц<input type="month" value={month} onChange={e=>{setMonth(e.target.value);setPage(0)}}/></label>
    </div>
    {error&&<p role="alert" className="watch-finance-error">{error}</p>}
    {busy&&<p>Загрузка истории…</p>}
    {result&&<>
      <div className="watch-finance-summary">
        <div><small>Получено</small><strong>{amount(result.totals.incoming)}</strong></div>
        <div><small>Возвращено / списано</small><strong>{amount(result.totals.outgoing)}</strong></div>
        <div><small>Чистое движение</small><strong>{amount(result.totals.net)}</strong></div>
        <div><small>Событий</small><strong>{result.totals.eventCount}</strong></div>
      </div>
      <p className="watch-finance-note">Это история денежных событий, а не баланс банковских счетов или наличных. События без привязки к заказу бренда сюда не входят.</p>
      {result.methods.length>0&&<div className="watch-finance-methods">
        {result.methods.map(m=><div key={m.method}><strong>{m.method}</strong>
          <span>Поступило: {amount(m.incoming)} · Возвраты: {amount(m.outgoing)} · Итог: {amount(m.net)}</span></div>)}
      </div>}
      {result.rows.length===0?<p>За этот месяц денежных событий нет.</p>:
        <LinkedTableScroll className="watch-main-finance-scroll" ariaLabel="История денежных событий">
          <table className="watch-main-finance-table">
            <thead><tr><th>Дата</th><th>Заказ</th><th>Операция</th><th>Способ оплаты</th><th>Комментарий</th><th>Сумма</th></tr></thead>
            <tbody>{result.rows.map(event=><tr key={event.id}>
              <td>{event.eventDate}</td><td><strong>{event.externalOrderId||'—'}</strong></td>
              <td>{event.eventType}</td><td>{event.paymentMethod||'Не указан'}</td>
              <td>{event.comment||'—'}</td><td className={event.amountDelta<0?'watch-finance-out':'watch-finance-in'}>
                {event.amountDelta>0?'+':''}{amount(event.amountDelta)}</td>
            </tr>)}</tbody>
          </table>
        </LinkedTableScroll>}
      <div className="watch-finance-pages"><button disabled={busy||page===0} onClick={()=>setPage(p=>p-1)}>Назад</button>
        <span>Страница {page+1}</span>
        <button disabled={busy||!result.hasMore} onClick={()=>setPage(p=>p+1)}>Дальше</button></div>
    </>}
  </section>
}
