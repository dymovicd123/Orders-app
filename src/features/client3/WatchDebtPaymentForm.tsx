import {useEffect,useRef,useState,type FormEvent} from 'react'
import {WATCH_PAYMENTS,type WatchBrand} from '../../../shared/client3/watch-domain'
import {WatchDebtHistoryPanel} from './WatchDebtHistoryPanel'
import '../../styles/client3-qa-debt-20261104.css'

type Props={
 brand:WatchBrand;orderId:number;externalId:string;debt:number;
 onDone:()=>void;onCancel:()=>void
}
type Part={id:string;paymentDate:string;method:string;amount:string;comment:string}
const fmt=(value:number)=>Number(value||0).toLocaleString('ru-RU')+' ₸'
const today=()=>new Date(Date.now()+5*60*60*1000).toISOString().slice(0,10)
const initial=(debt:number):Part=>({
 id:'initial',method:'KASPI GOLD',amount:String(debt),paymentDate:today(),comment:'',
})

/** Main's multi-method debt editor. Every line is a separately idempotent
 * critical payment, with visible partial-completion recovery if one fails.
 * Never reissue an already-acknowledged payment during a retry. */
export function WatchDebtPaymentForm({brand,orderId,externalId,debt,onDone,onCancel}:Props){
 const [methods,setMethods]=useState<string[]>([...WATCH_PAYMENTS])
 const [parts,setParts]=useState<Part[]>(()=>[initial(debt)])
 const [saved,setSaved]=useState<Record<string,boolean>>({})
 const [busy,setBusy]=useState(false)
 const [error,setError]=useState('')
 const [message,setMessage]=useState('')
 const [historyRefresh,setHistoryRefresh]=useState(0)
 const keys=useRef<Record<string,{fingerprint:string;requestId:string}>>({})
 const total=parts.reduce((sum,x)=>sum+Number(x.amount||0),0)
 const remaining=debt-total
 const savedCount=parts.filter(x=>saved[x.id]).length

 useEffect(()=>{
   const controller=new AbortController()
   void fetch('/api/client3/watches/references',{
     credentials:'include',cache:'no-store',signal:controller.signal,
   }).then(async response=>{
     const data=await response.json() as {ok?:boolean;rows?:Array<{kind:string;value:string}>}
     if(!response.ok||!data.ok)return
     const options=(data.rows||[]).filter(x=>x.kind==='paymentMethods').map(x=>x.value)
     if(!controller.signal.aborted&&options.length){
       setMethods(options)
       setParts(current=>current.map(part=>options.includes(part.method)
         ?part:{...part,method:options[0]}))
     }
   }).catch(()=>{})
   return ()=>controller.abort()
 },[])

 const edit=(id:string,patch:Partial<Part>)=>{
   if(saved[id]||busy)return
   setParts(current=>current.map(x=>x.id===id?{...x,...patch}:x))
   setError('');setMessage('')
 }
 const add=()=>{
   if(busy||parts.length>=8)return
   setParts(current=>[...current,{
     id:'p-'+crypto.randomUUID(),paymentDate:today(),
     method:methods[0]||'KASPI GOLD',amount:'',comment:'',
   }])
   setError('');setMessage('')
 }
 const remove=(id:string)=>{
   if(busy||saved[id]||parts.length<=1)return
   setParts(current=>current.filter(x=>x.id!==id))
   delete keys.current[id]
   setError('');setMessage('')
 }
 const submit=async(event:FormEvent<HTMLFormElement>)=>{
   event.preventDefault()
   if(busy)return
   if(!parts.length||parts.some(x=>!Number.isSafeInteger(Number(x.amount))||
     Number(x.amount)<1||!methods.includes(x.method)||!x.paymentDate)||
     total<1||total>debt){
     setError('Укажите сумму и способ каждой оплаты. Общая сумма не должна превышать остаток долга.')
     return
   }
   setBusy(true);setError('');setMessage('')
   let accepted=0
   try{
     for(const part of parts){
       if(saved[part.id])continue
       const payload={
         brand,method:part.method,amount:Number(part.amount),
         paymentDate:part.paymentDate,comment:part.comment.trim(),
       }
       const fingerprint=JSON.stringify([orderId,payload])
       if(keys.current[part.id]?.fingerprint!==fingerprint)
         keys.current[part.id]={fingerprint,requestId:'watch-debt-'+crypto.randomUUID()}
       const response=await fetch('/api/client3/watches/orders/'+orderId+'/payments',{
         method:'POST',credentials:'include',cache:'no-store',
         headers:{'Content-Type':'application/json'},
         body:JSON.stringify({...payload,requestId:keys.current[part.id].requestId}),
       })
       const data=await response.json() as {ok?:boolean;message?:string}
       if(!response.ok||!data.ok)throw Error(data.message||'Оплата не сохранена.')
       accepted++
       setSaved(previous=>({...previous,[part.id]:true}))
       setHistoryRefresh(previous=>previous+1)
     }
     setMessage('Сохранено '+parts.length+' оплат на '+fmt(total)+'.')
     onDone()
   }catch(cause){
     const done=savedCount+accepted
     setError((done>0?'Сохранено '+done+' из '+parts.length+' оплат. ':'')+
       (cause instanceof Error?cause.message:'Не удалось добавить оплату.')+
       ' Уже сохранённые строки повторно не списываются. Можно исправить оставшиеся и повторить.')
   }finally{setBusy(false)}
 }
 return <form className="watch-main-debt-form watch-debt-multi-form" onSubmit={e=>void submit(e)}>
   <div className="watch-debt-head"><strong>Закрытие долга · {externalId}</strong>
     <small>Разделите долг на несколько способов оплаты, как в Main. Каждая сумма сохраняется в денежной истории заказа.</small>
   </div>
   <div className="watch-debt-totals">
     <div><small>Долг сейчас</small><strong>{fmt(debt)}</strong></div>
     <div><small>Принимаем</small><strong>{fmt(total)}</strong></div>
     <div><small>Останется после оплат</small>
       <strong className={remaining<0?'is-error':''}>{fmt(remaining)}</strong></div>
   </div>
   <div className="watch-debt-payments-head">
     <h3>Оплаты по долгу</h3>
     <button type="button" className="secondary compact" disabled={busy||parts.length>=8}
       onClick={add}>+ Ещё способ оплаты</button>
   </div>
   <div className="watch-debt-parts">{parts.map((part,index)=>
     <div className={'watch-debt-part'+(saved[part.id]?' is-saved':'')} key={part.id}>
       <div className="watch-debt-part-head">
         <strong>Оплата {index+1}</strong>
         {saved[part.id]?<span className="watch-debt-part-saved">Сохранено в истории</span>:
         parts.length>1&&<button type="button" className="secondary compact"
           disabled={busy} onClick={()=>remove(part.id)}>Удалить</button>}
       </div>
       <div className="watch-main-debt-grid">
         <label><span>Дата</span>
           <input type="date" required disabled={busy||saved[part.id]}
             value={part.paymentDate} onChange={e=>edit(part.id,{paymentDate:e.target.value})}/>
         </label>
         <label><span>Способ оплаты</span>
           <select required disabled={busy||saved[part.id]}
             value={part.method} onChange={e=>edit(part.id,{method:e.target.value})}>
             {methods.map(m=><option key={m} value={m}>{m}</option>)}
           </select>
         </label>
         <label><span>Сумма, ₸</span>
           <input type="number" required min={1} max={debt} step={1}
             disabled={busy||saved[part.id]} value={part.amount}
             onChange={e=>edit(part.id,{amount:e.target.value})}/>
         </label>
         <label><span>Комментарий</span>
           <input maxLength={300} placeholder="Необязательно"
             disabled={busy||saved[part.id]} value={part.comment}
             onChange={e=>edit(part.id,{comment:e.target.value})}/>
         </label>
       </div>
     </div>)}</div>
   {remaining<0&&<p role="alert" className="watch-orders-error">
     Сумма оплат превышает текущий долг на {fmt(-remaining)}.</p>}
   {error&&<p role="alert" className="watch-orders-error">{error}</p>}
   {message&&<p role="status">{message}</p>}
   <div className="watch-main-debt-actions">
     <button className="primary" type="submit"
       disabled={busy||remaining<0||!parts.length||savedCount===parts.length}>
       {busy?'Сохраняю оплаты…':'Сохранить '+(parts.length-savedCount)+' оплат'}
     </button>
     <button className="secondary" type="button" disabled={busy} onClick={onCancel}>Отмена</button>
   </div>
   <WatchDebtHistoryPanel brand={brand} orderId={orderId} refreshToken={historyRefresh}/>
 </form>
}
