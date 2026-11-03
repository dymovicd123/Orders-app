import {useEffect,useState} from 'react'
import type {WatchBrand} from '../../../shared/client3/watch-domain'
import {LinkedTableScroll} from '../../components/tables/LinkedTableScroll'
import {watchMoney,type AnalyticsRow} from './useWatchAnalytics'

type Details={ok:boolean;message?:string;date:string;
  summary:{orderCount:number;totalSales:number;receivedOnOrders:number};
  managers:AnalyticsRow[];cities:AnalyticsRow[];products:AnalyticsRow[]}
type Kind='managers'|'products'|'cities'
const definitions:{key:Kind;title:string;fields:[string,string][]}[]=[
 {key:'managers',title:'Менеджеры',fields:[['manager','Менеджер'],['orderCount','Заказов'],['totalSales','Продажи'],['receivedOnOrders','Получено по заказам'],['debt','Долг']]},
 {key:'products',title:'Модели часов',fields:[['product','Товар'],['quantity','Продано'],['orderCount','Заказов'],['revenue','Сумма позиций']]},
 {key:'cities',title:'Города',fields:[['city','Город'],['orderCount','Заказов'],['totalSales','Продажи'],['debt','Долг']]},
]
export function WatchReportDayDetails({brand,date,onClose}:{
 brand:WatchBrand;date:string;onClose:()=>void
}){
 const [data,setData]=useState<Details|null>(null)
 const [busy,setBusy]=useState(true)
 const [error,setError]=useState('')
 useEffect(()=>{
  const controller=new AbortController()
  setBusy(true);setError('');setData(null)
  const params=new URLSearchParams({brand,date})
  void fetch('/api/client3/watches/analytics/day?'+params,{
    credentials:'include',cache:'no-store',signal:controller.signal,
  }).then(async r=>{
    const result=await r.json() as Details
    if(!r.ok||!result.ok)throw Error(result.message||'Не удалось открыть детализацию.')
    if(!controller.signal.aborted)setData(result)
  }).catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Ошибка детализации.')})
    .finally(()=>{if(!controller.signal.aborted)setBusy(false)})
  return ()=>controller.abort()
 },[brand,date])
 return <section className="strict-day-card client3-main-day-detail" aria-label={'Детализация '+date}>
   <div className="strict-day-head">
     <strong>Детализация · {date}</strong>
     <button type="button" className="secondary compact" onClick={onClose}>Свернуть</button>
   </div>
   {busy&&<p role="status">Загружаем статистику дня…</p>}
   {error&&<p role="alert" className="app-alert error">{error}</p>}
   {data&&<div className="summary-grid compact-summary">
     <div className="summary-card"><span>Заказов</span><strong>{data.summary.orderCount}</strong></div>
     <div className="summary-card"><span>Продажи</span><strong>{watchMoney(data.summary.totalSales)}</strong></div>
     <div className="summary-card"><span>Получено по заказам</span><strong>{watchMoney(data.summary.receivedOnOrders)}</strong></div>
   </div>}
   {data&&definitions.map(def=>
     <section className="report-table-card" key={def.key}>
       <div className="strict-section-head"><h3>{def.title}</h3><span className="soft-badge">{data[def.key].length}</span></div>
       <LinkedTableScroll ariaLabel={def.title+' за '+date}>
         <table className="data-table strict-report-table">
           <thead><tr>{def.fields.map(([name,label])=><th key={name}>{label}</th>)}</tr></thead>
           <tbody>{data[def.key].map((row,i)=><tr key={i}>
             {def.fields.map(([field],j)=><td className={j?'num':undefined} key={field}>
               {['totalSales','receivedOnOrders','debt','revenue'].includes(field)?
                 watchMoney(row[field]):String(row[field]??'—')}
             </td>)}</tr>)}
             {data[def.key].length===0&&<tr><td colSpan={def.fields.length} className="empty-state">Нет данных.</td></tr>}
           </tbody>
         </table>
       </LinkedTableScroll>
     </section>)}
 </section>
}
