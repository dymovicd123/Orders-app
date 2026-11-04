import {useEffect,useState} from 'react'
import type {WatchBrand} from '../../../shared/client3/watch-domain'

type Row={
 id:number;orderId:number;externalId:string;orderDate:string;
 paymentDate:string;method:string;amount:number;comment:string|null;
 recordedAt:string;customer:string
}
type ResponseData={ok?:boolean;message?:string;rows?:Row[];hasMore?:boolean}
const fmt=(n:number)=>Number(n||0).toLocaleString('ru-RU')+' ₸'

/** Real Main payment records. No duplicates and no fabricated financial events. */
export function WatchDebtHistoryPanel({brand,orderId=0,refreshToken=0}:{
 brand:WatchBrand;orderId?:number;refreshToken?:number
}){
 const [rows,setRows]=useState<Row[]>([])
 const [loading,setLoading]=useState(true)
 const [error,setError]=useState('')
 const [hasMore,setHasMore]=useState(false)
 const [reload,setReload]=useState(0)
 useEffect(()=>{
   const controller=new AbortController()
   const url='/api/client3/watches/debt-history?'+new URLSearchParams({
     brand,...(orderId>0?{orderId:String(orderId)}:{}),
   })
   setLoading(true);setError('')
   void fetch(url,{credentials:'include',cache:'no-store',signal:controller.signal})
     .then(async response=>{
       const data=await response.json() as ResponseData
       if(!response.ok||!data.ok)throw Error(data.message||'Не удалось получить историю оплат.')
       if(!controller.signal.aborted){
         setRows(data.rows||[]);setHasMore(Boolean(data.hasMore))
       }
     }).catch(e=>{
       if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Не удалось получить оплаты.')
     }).finally(()=>{if(!controller.signal.aborted)setLoading(false)})
   return ()=>controller.abort()
 },[brand,orderId,refreshToken,reload])
 return <section className="watch-debt-history" aria-label="История закрытия долгов">
   <div className="watch-debt-history-head">
     <div><strong>История закрытия долгов</strong>
       <small>{orderId>0?'Оплаты этого заказа':'Записи о закрытии долгов по бренду '+brand}</small></div>
     <button type="button" className="secondary compact" disabled={loading}
       onClick={()=>setReload(v=>v+1)}>Обновить историю</button>
   </div>
   {loading&&<p role="status">Загружаю историю оплат…</p>}
   {error&&<p role="alert" className="watch-orders-error">{error}</p>}
   {!loading&&!error&&<div className="watch-debt-history-scroll">
     <table className="watch-debt-history-table">
       <thead><tr><th>Дата</th><th>Заказ</th><th>Способ оплаты</th><th>Сумма</th><th>Примечание</th></tr></thead>
       <tbody>{rows.map(row=><tr key={row.id}>
         <td><strong>{row.paymentDate}</strong></td>
         <td><strong>{row.externalId}</strong>
           <small>{row.customer||'—'}</small></td>
         <td>{row.method}</td><td><strong>{fmt(row.amount)}</strong></td>
         <td>{row.comment||'—'}</td>
       </tr>)}
       {!rows.length&&<tr><td colSpan={5} className="watch-debt-empty">
         Закрытий долга пока нет. После сохранения оплаты она появится здесь.</td></tr>}
       </tbody>
     </table>
   </div>}
   {!loading&&hasMore&&<small>Показаны последние 80 закрытий. Полная денежная история сохраняется в финансовом журнале.</small>}
 </section>
}
