import {useEffect,useRef,useState,type FormEvent} from 'react'
import type {WatchBrand} from '../../../shared/client3/watch-domain'
import {WatchAdminDeleteChainPanel} from './WatchAdminDeleteChainPanel'

type Manager={id:number;name:string}
type Payment={id:number;method:string;amount:number;date:string;kind:string;comment:string}
const money=(x:number)=>Number(x||0).toLocaleString('ru-RU')+' ₸'
type Props={
 brand:WatchBrand;orderId:number;externalId:string;managerId:number;paymentLines:string;
 orderDate:string;linkedOperations:boolean;
 onDone:()=>void
}
/** Main's verified delete preview, never a one-click destructive button. */
export function WatchAdminOrderActions({brand,orderId,externalId,managerId,paymentLines,orderDate,linkedOperations,onDone}:Props){
 const payments:Payment[]=(()=>{try{return JSON.parse(paymentLines||'[]') as Payment[]}catch{return []}})()
 const [mode,setMode]=useState<'manager'|'delete'|'payment'|null>(null)
 const [managers,setManagers]=useState<Manager[]>([])
 const [target,setTarget]=useState(managerId)
 const [methods,setMethods]=useState<string[]>([])
 const [chosenPayment,setChosenPayment]=useState(0)
 const [method,setMethod]=useState('')
 const [paymentDraft,setPaymentDraft]=useState({date:'',amount:'',kind:'primary',comment:''})
 const selectPayment=(p:Payment|undefined)=>{
   setChosenPayment(p?.id||0);setMethod(p?.method||'')
   setPaymentDraft({date:p?.date||'',amount:String(p?.amount??''),kind:p?.kind||'primary',comment:p?.comment||''})
 }
 const [busy,setBusy]=useState(false)
 const [error,setError]=useState('')
 const pending=useRef<{key:string;id:string}|null>(null)
 useEffect(()=>{
   const controller=new AbortController()
   void fetch('/api/client3/watches/managers?brand='+encodeURIComponent(brand),{
     credentials:'include',signal:controller.signal,cache:'no-store',
   }).then(async response=>{
     const data=await response.json() as {ok:boolean;managers?:Manager[]}
     if(response.ok&&data.ok&&!controller.signal.aborted)setManagers(data.managers||[])
   }).catch(()=>{})
   void fetch('/api/client3/watches/references',{credentials:'include',cache:'no-store',signal:controller.signal})
     .then(async response=>{
       const data=await response.json() as {ok?:boolean;rows?:Array<{kind:string;value:string}>}
       if(!response.ok||!data.ok||controller.signal.aborted)return
       const values=(data.rows||[]).filter(x=>x.kind==='paymentMethods').map(x=>x.value)
       setMethods(values)
     }).catch(()=>{})
   return ()=>controller.abort()
 },[brand])
 const commit=async(url:string,body:Record<string,unknown>,method:'POST'|'PATCH')=>{
   const key=JSON.stringify({url,body})
   if(pending.current?.key!==key)pending.current={key,id:'watch-admin-'+crypto.randomUUID()}
   setBusy(true);setError('')
   try{
     const response=await fetch(url,{method,credentials:'include',cache:'no-store',
       headers:{'Content-Type':'application/json'},
       body:JSON.stringify({...body,requestId:pending.current.id}),
     })
     const data=await response.json() as {ok?:boolean;message?:string}
     if(!response.ok||!data.ok)throw new Error(data.message||'Действие не завершено.')
     setMode(null);onDone()
   }catch(err){setError(err instanceof Error?err.message:'Действие не завершено.')}
   finally{setBusy(false)}
 }
 const setManager=async(event:FormEvent<HTMLFormElement>)=>{
   event.preventDefault()
   if(busy||!Number.isSafeInteger(target)||target<1||target===managerId){
     setError('Выберите другого действующего менеджера бренда.');return
   }
   await commit('/api/client3/watches/orders/'+orderId+'/manager',{
     brand,managerId:target,expectedManagerId:managerId,
   },'PATCH')
 }
 const savePayment=async(event:FormEvent<HTMLFormElement>)=>{
   event.preventDefault()
   const original=payments.find(x=>x.id===chosenPayment)
   if(!original||!method.trim()){setError('Выберите оплату и способ.');return}
   const amount=Number(paymentDraft.amount)
   if(!Number.isSafeInteger(amount)||amount<1||amount>1_000_000_000||
     !/^\d{4}-\d{2}-\d{2}$/.test(paymentDraft.date)||
     !['primary','debt_close','extra'].includes(paymentDraft.kind)){
     setError('Введите корректную дату, целую сумму и назначение оплаты.');return
   }
   const changedOther=amount!==original.amount||paymentDraft.date!==original.date||
     paymentDraft.kind!==original.kind||paymentDraft.comment.trim()!==(original.comment||'').trim()
   const changedMethod=method.trim().toLocaleUpperCase('ru-RU')!==original.method.toLocaleUpperCase('ru-RU')
   if(!changedOther&&!changedMethod){setError('Изменений нет.');return}
   if(changedOther&&(linkedOperations||original.kind==='extra')){
     setError('После возврата допускается отдельно исправить только способ оплаты.');return
   }
   const url='/api/client3/watches/orders/'+orderId+
     (changedOther?'/recorded-payment':'/payment-method')
   const expected={
     paymentId:original.id,expectedPaymentDate:original.date,expectedMethod:original.method,
     expectedAmount:original.amount,expectedPaymentKind:original.kind,
     expectedComment:original.comment||'',
   }
   await commit(url,changedOther
     ?{brand,expectedOrderDate:orderDate,change:{...expected,
       method:method.trim(),paymentDate:paymentDraft.date,amount,
       paymentKind:paymentDraft.kind,comment:paymentDraft.comment.trim()}}
     :{brand,change:{...expected,method:method.trim()}},'PATCH')
 }
 return <section className="watch-admin-actions">
   <div className="watch-admin-actions-buttons">
     <button type="button" className="secondary compact" disabled={busy}
       onClick={()=>{setMode(mode==='manager'?null:'manager');setError('')}}>
       Сменить менеджера
     </button>
     {payments.length>0&&<button type="button" className="secondary compact" disabled={busy}
       onClick={()=>{
         setMode(mode==='payment'?null:'payment');setError('');
         selectPayment(payments[0])
       }}>Редактировать проведённые оплаты</button>}
     <button type="button" className="secondary compact watch-admin-delete-trigger" disabled={busy}
       onClick={()=>{setMode('delete');setError('')}}>Удалить заказ</button>
   </div>
   {mode==='manager'&&<form className="watch-admin-action-form" onSubmit={e=>void setManager(e)}>
     <strong>Ответственный за заказ {externalId}</strong>
     <p>Переназначение возможно только действующему менеджеру этого бренда. Изменение проходит через редактор Main с проверкой прав бренда.</p>
     <label>Новый менеджер
       <select required value={target} onChange={e=>setTarget(Number(e.target.value))}>
         <option value={0}>Выберите менеджера</option>
         {managers.map(x=><option value={x.id} key={x.id}>{x.name}</option>)}
       </select>
     </label>
     <div className="watch-admin-actions-buttons">
       <button className="primary" type="submit" disabled={busy||target===managerId}>Сохранить менеджера</button>
       <button type="button" className="secondary" disabled={busy} onClick={()=>setMode(null)}>Отмена</button>
     </div>
   </form>}
   {mode==='payment'&&<form className="watch-admin-action-form" onSubmit={e=>void savePayment(e)}>
     <strong>Редактирование проведённой оплаты · Main</strong>
     <p>{linkedOperations
       ?'В заказе есть возвраты: отдельно исправляется только способ оплаты. Изменение финансовой цепочки выполняется через операцию возврата.'
       :'Администратор может исправить дату, сумму, способ, назначение и комментарий проведённой оплаты. Изменения проверяются финансовым ядром Main; новые оплаты оформляются отдельно.'}</p>
     <label>Проведённая оплата
       <select required value={chosenPayment} onChange={e=>selectPayment(payments.find(x=>x.id===Number(e.target.value)))}>
         {payments.map(x=><option value={x.id} key={x.id}>
           {x.date} · {x.method} · {money(x.amount)}
         </option>)}
       </select>
     </label>
     <div className="watch-admin-payment-grid">
       <label>Дата оплаты
         <input required type="date" disabled={busy||linkedOperations||payments.find(x=>x.id===chosenPayment)?.kind==='extra'}
           value={paymentDraft.date} onChange={e=>setPaymentDraft(p=>({...p,date:e.target.value}))}/>
       </label>
       <label>Сумма оплаты, ₸
         <input required type="number" min={1} max={1000000000} step={1}
           disabled={busy||linkedOperations||payments.find(x=>x.id===chosenPayment)?.kind==='extra'}
           value={paymentDraft.amount} onChange={e=>setPaymentDraft(p=>({...p,amount:e.target.value}))}/>
       </label>
       <label>Способ оплаты
         <select required value={method} onChange={e=>setMethod(e.target.value)}>
           <option value="">Выберите способ</option>
           {methods.map(x=><option key={x} value={x}>{x}</option>)}
           {method&&!methods.includes(method)&&<option value={method}>{method} · ранее использованный</option>}
         </select>
       </label>
       <label>Назначение
         <select value={paymentDraft.kind} disabled={busy||linkedOperations||payments.find(x=>x.id===chosenPayment)?.kind==='extra'}
           onChange={e=>setPaymentDraft(p=>({...p,kind:e.target.value}))}>
           <option value="primary">Первичная оплата</option>
           <option value="debt_close">Закрытие долга</option>
           {paymentDraft.kind==='extra'&&<option value="extra">Дополнительная оплата (ранее проведена)</option>}
         </select>
       </label>
       <label className="watch-admin-payment-comment">Комментарий
         <textarea rows={2} maxLength={500} value={paymentDraft.comment}
           disabled={busy||linkedOperations||payments.find(x=>x.id===chosenPayment)?.kind==='extra'}
           onChange={e=>setPaymentDraft(p=>({...p,comment:e.target.value}))}/>
       </label>
     </div>
     <div className="watch-admin-actions-buttons">
       <button className="primary" type="submit" disabled={busy||!method||!chosenPayment}>
         {busy?'Сохраняю…':'Сохранить изменение оплаты'}</button>
       <button type="button" className="secondary" disabled={busy} onClick={()=>setMode(null)}>Отмена</button>
     </div>
   </form>}
   {mode==='delete'&&<WatchAdminDeleteChainPanel brand={brand} orderId={orderId}
     externalId={externalId} onDone={onDone} onClose={()=>setMode(null)}/>}
   {error&&<p className="watch-orders-error" role="alert">{error}</p>}
 </section>
}
