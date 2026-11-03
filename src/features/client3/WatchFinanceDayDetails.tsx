import {useEffect,useRef,useState} from 'react'
import type {WatchBrand} from '../../../shared/client3/watch-domain'
import {LinkedTableScroll} from '../../components/tables/LinkedTableScroll'
import {watchMoney} from './useWatchAnalytics'

type Row={id:number;eventDate:string;eventType:string;amountDelta:number;paymentMethod:string;
 externalOrderId:string;orderId:number;recordedAt:string|null;orderDate:string;
 customer:string;manager:string;reason:string|null;comment:string|null}
type Totals={eventCount:number;incoming:number;outgoing:number;net:number}
type Method={method:string;incoming:number;outgoing:number;net:number}
type Ledger={ok:boolean;message?:string;rows:Row[];totals:Totals;methods:Method[];hasMore:boolean}
const operation:Record<string,string>={
 order_payment:'Оплата заказа',debt_close:'Закрытие долга',order_extra:'Доплата',
 exchange_extra:'Доплата за обмен',order_refund:'Возврат денег',
 exchange_refund:'Возврат при обмене',payment_correction:'Исправление оплаты',
}
function recorded(value:string|null){
 if(!value)return 'Время не сохранено'
 const normalized=/(?:Z|[+-]\d\d:?\d\d)$/i.test(value)?value:value.replace(' ','T')+'Z'
 const stamp=new Date(normalized)
 return Number.isNaN(stamp.getTime())?'Время не сохранено':
   stamp.toLocaleString('ru-RU',{timeZone:'Asia/Almaty'})
}
export function WatchFinanceDayDetails({brand,date,onClose,onOpenOrder}:{
 brand:WatchBrand;date:string;onClose:()=>void;
 onOpenOrder?:(order:{brand:WatchBrand;orderId:number;externalId:string;orderDate:string})=>void
}){
 const [rows,setRows]=useState<Row[]>([])
 const [totals,setTotals]=useState<Totals|null>(null)
 const [methods,setMethods]=useState<Method[]>([])
 const [hasMore,setHasMore]=useState(false)
 const [busy,setBusy]=useState(false)
 const [error,setError]=useState('')
 const pageKey=useRef('')
 const fetchPage=async(offset:number,signal?:AbortSignal):Promise<Ledger>=>{
   const q=new URLSearchParams({brand,date,limit:'100',offset:String(offset)})
   const r=await fetch('/api/client3/watches/finance?'+q,{credentials:'include',cache:'no-store',signal})
   const v=await r.json() as Ledger
   if(!r.ok||!v.ok)throw Error(v.message||'Финансовый журнал не загрузился.')
   return v
 }
 useEffect(()=>{
   const controller=new AbortController(),key=brand+':'+date
   pageKey.current=key
   setRows([]);setTotals(null);setMethods([]);setHasMore(false)
   setBusy(true);setError('')
   void fetchPage(0,controller.signal).then(v=>{
     if(!controller.signal.aborted&&pageKey.current===key){
       setRows(v.rows||[]);setTotals(v.totals);setMethods(v.methods||[])
       setHasMore(v.hasMore)
     }
   }).catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Ошибка журнала.')})
     .finally(()=>{if(!controller.signal.aborted)setBusy(false)})
   return ()=>controller.abort()
 },[brand,date])
 const more=async()=>{
   if(busy||!hasMore)return
   const key=pageKey.current,offset=rows.length
   setBusy(true);setError('')
   try{
     const v=await fetchPage(offset)
     if(pageKey.current!==key)return
     setRows(current=>[...current,...(v.rows||[])])
     setHasMore(v.hasMore)
   }catch(e){if(pageKey.current===key)setError(e instanceof Error?e.message:'Не удалось загрузить продолжение.')}
   finally{if(pageKey.current===key)setBusy(false)}
 }
 return <section className="mini-panel finance-day client3-watch-day-ledger" aria-label={'Денежные операции '+date}>
   <div className="finance-day-heading">
     <div><h3>Деньги за {date.split('-').reverse().join('.')} · {brand}</h3>
       <p>История всех денежных операций бренда за выбранный день. Время внесения отделено от даты операции.</p></div>
     <button className="secondary compact" type="button" onClick={onClose}>Свернуть день</button>
   </div>
   {totals&&<div className="finance-day-totals">
     <article><span>Поступило</span><strong>{watchMoney(totals.incoming)}</strong></article>
     <article><span>Возвращено клиентам</span><strong>{watchMoney(totals.outgoing)}</strong></article>
     <article><span>Чистое движение</span><strong>{watchMoney(totals.net)}</strong></article>
     <article><span>Операций</span><strong>{totals.eventCount}</strong></article>
   </div>}
   {methods.length>0&&<div className="finance-day-methods">
     {methods.map(x=><div key={x.method}><span>{x.method}</span>
       <strong>+{watchMoney(x.incoming)} / −{watchMoney(x.outgoing)}</strong></div>)}
   </div>}
   <p className="mini-panel-note">Здесь учитываются только оплаты и возвраты по заказам бренда.
     Ручные движения наличных и общий остаток обеих марок проверяйте в разделе «Касса».</p>
   <LinkedTableScroll ariaLabel={'Журнал операций '+date}>
     <table className="data-table strict-report-table">
       <thead><tr><th>Когда внесено</th><th>Операция</th><th>Заказ / клиент</th>
         <th>Метод</th><th>Сумма</th><th>Комментарий</th><th>Действие</th></tr></thead>
       <tbody>{rows.map(x=><tr key={x.id}>
         <td>{recorded(x.recordedAt)}</td>
         <td>{operation[x.eventType]||x.eventType}</td>
         <td><strong>{x.externalOrderId||'#'+x.orderId}</strong><small>{x.customer||'—'}</small></td>
         <td>{x.paymentMethod||'—'}</td>
         <td className="num"><strong>{x.amountDelta<0?'− ':'+ '}{watchMoney(Math.abs(x.amountDelta))}</strong></td>
         <td>{x.comment||x.reason||'—'}</td>
         <td>{x.orderId>0&&onOpenOrder?<button className="secondary compact" type="button"
           onClick={()=>onOpenOrder({brand,orderId:x.orderId,externalId:x.externalOrderId,orderDate:x.orderDate})}>К заказу</button>:'—'}</td>
       </tr>)}
       {!rows.length&&!busy&&<tr><td colSpan={7}>Операций нет.</td></tr>}
       </tbody>
     </table>
   </LinkedTableScroll>
   {error&&<p role="alert" className="app-alert error">{error}</p>}
   {hasMore&&<button type="button" className="secondary" disabled={busy}
     onClick={()=>void more()}>{busy?'Загрузка…':'Показать ещё · '+rows.length+' из '+(totals?.eventCount||0)}</button>}
   {busy&&<p role="status">Загрузка операций…</p>}
 </section>
}
