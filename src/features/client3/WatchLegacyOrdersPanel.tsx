import {useEffect,useState} from 'react'
type Row={orderId:number;externalId:string;orderDate:string;managerName:string|null;legacySource:string;shippingStatus:string;totalAmount:number;receivedAmount:number;debtAmount:number;items:string|null}
export function WatchLegacyOrdersPanel(){
 const [rows,setRows]=useState<Row[]>([])
 const [busy,setBusy]=useState(true)
 const [error,setError]=useState('')
 useEffect(()=>{
   const abort=new AbortController()
   void fetch('/api/client3/watches/legacy-orders',{credentials:'include',cache:'no-store',signal:abort.signal})
     .then(async response=>{
       const data=await response.json() as {ok:boolean;rows:Row[];message?:string}
       if(!response.ok||!data.ok)throw new Error(data.message||'Не удалось получить историю')
       if(!abort.signal.aborted)setRows(data.rows||[])
     }).catch(cause=>{if(!abort.signal.aborted)setError(cause instanceof Error?cause.message:'История недоступна')})
       .finally(()=>{if(!abort.signal.aborted)setBusy(false)})
   return ()=>abort.abort()
 },[])
 const money=(n:number)=>Number(n||0).toLocaleString('ru-RU')+' ₸'
 return <section className="watch-orders" style={{maxWidth:1200,margin:'auto',padding:16}}>
   <h2>Исторические заказы до перехода на часы</h2>
   <p>Старые заказы третьей системы сохранены и доступны администратору только для просмотра.
      Бренды им не назначаются автоматически.</p>
   {busy&&<p>Загрузка…</p>}
   {error&&<p role="alert">{error}</p>}
   {!busy&&rows.length===0&&<p>Исторических заказов нет.</p>}
   <div className="watch-orders-list">{rows.map(row=><article key={row.orderId} style={{padding:15}}>
     <strong>{row.externalId||'#'+row.orderId}</strong>
     <p>{row.orderDate} · {row.managerName||'Менеджер не указан'} · {row.shippingStatus}</p>
     <p>{row.items||'Позиции не указаны'}</p>
     <p>Сумма: {money(row.totalAmount)} · Получено: {money(row.receivedAmount)} · Долг: {money(row.debtAmount)}</p>
   </article>)}</div>
 </section>
}
