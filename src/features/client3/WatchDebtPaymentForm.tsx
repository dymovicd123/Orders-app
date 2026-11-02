import {useEffect,useRef,useState,type FormEvent} from 'react'
import {WATCH_PAYMENTS,type WatchBrand} from '../../../shared/client3/watch-domain'

type Props={
 brand:WatchBrand;orderId:number;externalId:string;debt:number;
 onDone:()=>void;onCancel:()=>void
}
const format=(value:number)=>value.toLocaleString('ru-RU')+' ₸'
const today=()=>new Date(Date.now()+5*60*60*1000).toISOString().slice(0,10)

/** Main's debt-close payment action, never a second private finance ledger. */
export function WatchDebtPaymentForm({brand,orderId,externalId,debt,onDone,onCancel}:Props){
 const [methods,setMethods]=useState<string[]>([...WATCH_PAYMENTS])
 const [method,setMethod]=useState<string>('KASPI GOLD')
 const [amount,setAmount]=useState(String(debt))
 const [paymentDate,setPaymentDate]=useState(today)
 const [comment,setComment]=useState('')
 const [busy,setBusy]=useState(false)
 const [error,setError]=useState('')
 const request=useRef<{fingerprint:string;id:string}|null>(null)
 useEffect(()=>{
   const controller=new AbortController()
   void fetch('/api/client3/watches/references',{credentials:'include',cache:'no-store',signal:controller.signal})
     .then(async response=>{
       const data=await response.json() as {ok?:boolean;rows?:Array<{kind:string;value:string}>}
       if(!response.ok||!data.ok)return
       const options=(data.rows||[]).filter(x=>x.kind==='paymentMethods').map(x=>x.value)
       if(!controller.signal.aborted&&options.length){
         setMethods(options)
         setMethod(v=>options.includes(v)?v:options[0])
       }
     }).catch(()=>{})
   return ()=>controller.abort()
 },[])
 const submit=async(e:FormEvent<HTMLFormElement>)=>{
   e.preventDefault()
   const value=Number(amount)
   if(busy||!Number.isSafeInteger(value)||value<=0||value>debt||
     !methods.includes(method)){
     setError('Проверьте способ оплаты и сумму — она не может превышать текущий долг.')
     return
   }
   const payload={brand,method,amount:value,paymentDate,comment:comment.trim()}
   const fingerprint=JSON.stringify(payload)
   if(request.current?.fingerprint!==fingerprint)
     request.current={fingerprint,id:'watch-debt-'+crypto.randomUUID()}
   setBusy(true);setError('')
   try{
     const response=await fetch('/api/client3/watches/orders/'+orderId+'/payments',{
       method:'POST',credentials:'include',cache:'no-store',
       headers:{'Content-Type':'application/json'},
       body:JSON.stringify({...payload,requestId:request.current.id}),
     })
     const data=await response.json() as {ok?:boolean;message?:string}
     if(!response.ok||!data.ok)throw new Error(data.message||'Оплата не сохранена.')
     onDone()
   }catch(cause){
     setError(cause instanceof Error?cause.message:'Не удалось добавить оплату.')
   }finally{setBusy(false)}
 }
 return <form className="watch-main-debt-form" onSubmit={e=>void submit(e)}>
   <div><strong>Закрыть долг · {externalId}</strong>
     <small>Текущий долг {format(debt)}. Запись попадёт в финансовую историю Main.</small></div>
   <div className="watch-main-debt-grid">
     <label>Дата оплаты
       <input type="date" required value={paymentDate} onChange={e=>setPaymentDate(e.target.value)}/>
     </label>
     <label>Способ оплаты
       <select required value={method} onChange={e=>setMethod(e.target.value)}>
         {methods.map(x=><option key={x} value={x}>{x}</option>)}
       </select>
     </label>
     <label>Сумма, ₸
       <input type="number" required min={1} max={debt} step={1}
         value={amount} onChange={e=>setAmount(e.target.value)}/>
     </label>
     <label>Комментарий
       <input maxLength={300} value={comment} onChange={e=>setComment(e.target.value)}
         placeholder="Необязательно"/>
     </label>
   </div>
   {error&&<p role="alert" className="watch-orders-error">{error}</p>}
   <div className="watch-main-debt-actions">
     <button className="primary" type="submit" disabled={busy}>
       {busy?'Сохраняю…':'Подтвердить оплату'}
     </button>
     <button className="secondary" type="button" disabled={busy} onClick={onCancel}>Отмена</button>
   </div>
 </form>
}
