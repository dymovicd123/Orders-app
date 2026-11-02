import {useEffect,useRef,useState,type FormEvent} from 'react'
import type {WatchBrand} from '../../../shared/client3/watch-domain'

type Manager={id:number;name:string}
type Payment={id:number;method:string;amount:number;date:string;kind:string;comment:string}
type DeletePreview={
 externalId:string;totalAmount:number;receivedAmount:number;returnedAmount:number;
 activeReturns:number;activeExchanges:number;issuedItems:number;paymentCount:number;
 reasons:string[];explanations:string[];canDelete:boolean;expectedSnapshot:string
}
const money=(x:number)=>Number(x||0).toLocaleString('ru-RU')+' ₸'
type Props={
 brand:WatchBrand;orderId:number;externalId:string;managerId:number;paymentLines:string;
 onDone:()=>void
}
/** Main's verified delete preview, never a one-click destructive button. */
export function WatchAdminOrderActions({brand,orderId,externalId,managerId,paymentLines,onDone}:Props){
 const payments:Payment[]=(()=>{try{return JSON.parse(paymentLines||'[]') as Payment[]}catch{return []}})()
 const [mode,setMode]=useState<'manager'|'delete'|'payment'|null>(null)
 const [managers,setManagers]=useState<Manager[]>([])
 const [target,setTarget]=useState(managerId)
 const [methods,setMethods]=useState<string[]>([])
 const [chosenPayment,setChosenPayment]=useState(0)
 const [method,setMethod]=useState('')
 const [preview,setPreview]=useState<DeletePreview|null>(null)
 const [reason,setReason]=useState('')
 const [ack,setAck]=useState(false)
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
 const openDelete=async()=>{
   setBusy(true);setError('');setMode('delete');setPreview(null);setAck(false)
   try{
     const response=await fetch('/api/client3/watches/orders/'+orderId+'/delete?brand='+brand,{
       credentials:'include',cache:'no-store',
     })
     const data=await response.json() as {ok?:boolean;preview?:DeletePreview;message?:string}
     if(!response.ok||!data.ok||!data.preview)throw new Error(data.message||'Невозможно проверить удаление.')
     setPreview(data.preview)
   }catch(err){setError(err instanceof Error?err.message:'Ошибка проверки удаления.')}
   finally{setBusy(false)}
 }
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
     setMode(null);setPreview(null);onDone()
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
 const changeMethod=async(event:FormEvent<HTMLFormElement>)=>{
   event.preventDefault()
   const original=payments.find(x=>x.id===chosenPayment)
   if(!original||!method||method===original.method){
     setError('Выберите оплату и новый способ.');return
   }
   await commit('/api/client3/watches/orders/'+orderId+'/payment-method',{
     brand,change:{
       paymentId:original.id,method,
       expectedPaymentDate:original.date,expectedMethod:original.method,
       expectedAmount:original.amount,expectedPaymentKind:original.kind,
       expectedComment:original.comment||'',
     },
   },'PATCH')
 }
 const executeDelete=async(event:FormEvent<HTMLFormElement>)=>{
   event.preventDefault()
   if(busy||!preview?.canDelete||!ack||reason.trim().length<5)return
   await commit('/api/client3/watches/orders/'+orderId+'/delete',{
     brand,expectedSnapshot:preview.expectedSnapshot,comment:reason.trim(),
   },'POST')
 }
 return <section className="watch-admin-actions">
   <div className="watch-admin-actions-buttons">
     <button type="button" className="secondary compact" disabled={busy}
       onClick={()=>{setMode(mode==='manager'?null:'manager');setError('');setPreview(null)}}>
       Сменить менеджера
     </button>
     {payments.length>0&&<button type="button" className="secondary compact" disabled={busy}
       onClick={()=>{
         setMode(mode==='payment'?null:'payment');setError('');
         setChosenPayment(payments[0].id);setMethod(payments[0].method)
       }}>Исправить способ оплаты</button>}
     <button type="button" className="secondary compact watch-admin-delete-trigger" disabled={busy}
       onClick={()=>void openDelete()}>Удалить заказ</button>
   </div>
   {mode==='manager'&&<form className="watch-admin-action-form" onSubmit={e=>void setManager(e)}>
     <strong>Ответственный за заказ {externalId}</strong>
     <p>Переназначение возможно только действующему менеджеру этого бренда. Main ведёт историю изменения.</p>
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
   {mode==='payment'&&<form className="watch-admin-action-form" onSubmit={e=>void changeMethod(e)}>
     <strong>Исправить способ проведённой оплаты</strong>
     <p>Меняется только способ, не сумма и не дата. Main сохраняет финансовые последствия отдельной корректировкой.</p>
     <label>Проведённая оплата
       <select required value={chosenPayment}
         onChange={e=>{
           const id=Number(e.target.value)
           setChosenPayment(id);setMethod(payments.find(x=>x.id===id)?.method||'')
         }}>
         {payments.map(x=><option value={x.id} key={x.id}>
           {x.date} · {x.method} · {money(x.amount)}
         </option>)}
       </select>
     </label>
     <label>Правильный способ оплаты
       <select required value={method} onChange={e=>setMethod(e.target.value)}>
         <option value="">Выберите способ</option>
         {methods.map(x=><option key={x} value={x}>{x}</option>)}
       </select>
     </label>
     <div className="watch-admin-actions-buttons">
       <button className="primary" type="submit" disabled={busy||!method}>
         Сохранить способ оплаты</button>
       <button type="button" className="secondary" disabled={busy} onClick={()=>setMode(null)}>Отмена</button>
     </div>
   </form>}
   {mode==='delete'&&<section className="watch-admin-action-form" aria-label="Предпросмотр последствий удаления">
     <strong>Удаление заказа {externalId}</strong>
     {busy&&!preview&&<p>Проверяю финансовые и складские последствия…</p>}
     {preview&&<>
       <p><strong>Сумма:</strong> {money(preview.totalAmount)} ·
         <strong> Оплачено:</strong> {money(preview.receivedAmount)} ·
         <strong> Возвраты:</strong> {money(preview.returnedAmount)}</p>
       <p>Оплат: {preview.paymentCount} · Выданных позиций: {preview.issuedItems} ·
         Возвратов: {preview.activeReturns} · Обменов: {preview.activeExchanges}</p>
       {preview.explanations.map((x,i)=><p key={i}>{x}</p>)}
       {preview.reasons.map((x,i)=><p className="watch-admin-delete-reason" key={i}>{x}</p>)}
       {preview.canDelete?<form onSubmit={e=>void executeDelete(e)}>
         <label>Причина удаления *
           <textarea required minLength={5} maxLength={500} rows={2}
             placeholder="Причина для истории" value={reason}
             onChange={e=>setReason(e.target.value)}/></label>
         <label className="watch-admin-delete-confirm">
           <input type="checkbox" checked={ack} onChange={e=>setAck(e.target.checked)}/>
           Подтверждаю удаление заказа и отмену его учётных оплат/резервов
         </label>
         <div className="watch-admin-actions-buttons">
           <button className="primary watch-admin-delete-confirm-button" type="submit"
             disabled={busy||!ack||reason.trim().length<5}>Подтвердить удаление</button>
           <button type="button" className="secondary" disabled={busy} onClick={()=>setMode(null)}>Отмена</button>
         </div>
       </form>:<p>Удаление заблокировано до разрешения перечисленных зависимостей.</p>}
     </>}
   </section>}
   {error&&<p className="watch-orders-error" role="alert">{error}</p>}
 </section>
}
