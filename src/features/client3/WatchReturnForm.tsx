import {useRef,useState,type FormEvent} from 'react'
import type {WatchBrand} from '../../../shared/client3/watch-domain'
import {WATCH_PAYMENTS} from '../../../shared/client3/watch-domain'
import '../../styles/client3-watch-return.css'

type ReturnOrder={
 orderId:number;externalId:string;watchDescription?:string|null
 shippingStatus:string;lineCount:number;returnableQuantity:number
 receivedAmount:number;returnAmount:number
}
type ReturnKind='money_only'|'items_only'|'both'
const amt=(n:number)=>Number(n||0).toLocaleString('ru-RU')+' ₸'
export function WatchReturnForm({brand,order,onDone,onCancel}:{
 brand:WatchBrand;order:ReturnOrder;onDone:()=>void;onCancel:()=>void
}){
 const shipped=order.shippingStatus==='sent'||order.shippingStatus==='Отправлено'
 const canItems=shipped&&order.lineCount===1&&order.returnableQuantity>0
 const maxRefund=Math.max(0,Number(order.receivedAmount)-Number(order.returnAmount))
 const [kind,setKind]=useState<ReturnKind>(canItems?(maxRefund>0?'both':'items_only'):'money_only')
 const [quantity,setQuantity]=useState(String(Math.max(1,order.returnableQuantity)))
 const [amount,setAmount]=useState(String(Math.max(0,maxRefund)))
 const [paymentMethod,setPaymentMethod]=useState<(typeof WATCH_PAYMENTS)[number]>('KASPI GOLD')
 const [reason,setReason]=useState('')
 const [confirmed,setConfirmed]=useState(false)
 const [busy,setBusy]=useState(false)
 const [error,setError]=useState('')
 const key=useRef<{fingerprint:string;requestId:string}|null>(null)
 const items=kind!=='money_only',money=kind!=='items_only'
 const save=async(e:FormEvent)=>{
   e.preventDefault()
   const qty=items?Number(quantity):0
   const refund=money?Number(amount):0
   if(busy||!confirmed||!reason.trim()||items&&(!canItems||!Number.isSafeInteger(qty)||qty<1||qty>order.returnableQuantity)
      ||money&&(!Number.isSafeInteger(refund)||refund<1||refund>maxRefund)){
      setError('Проверьте вид возврата, количество, сумму, причину и подтверждение.');return
   }
   const payload={brand,kind,quantity:qty,amount:refund,paymentMethod,reason:reason.trim()}
   const fingerprint=JSON.stringify([order.orderId,payload])
   if(key.current?.fingerprint!==fingerprint)
     key.current={fingerprint,requestId:'watch-return-'+crypto.randomUUID()}
   setBusy(true);setError('')
   try{
     const response=await fetch('/api/client3/watches/orders/'+order.orderId+'/return',{
       method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},
       body:JSON.stringify({...payload,requestId:key.current.requestId}),
     })
     const data=await response.json() as {ok:boolean;message?:string}
     if(!response.ok||!data.ok)throw new Error(data.message||'Возврат не сохранён')
     key.current=null
     onDone()
   }catch(cause){setError(cause instanceof Error?cause.message:'Не удалось сохранить возврат')}
   finally{setBusy(false)}
 }
 return <form className="watch-return-form" onSubmit={e=>void save(e)}>
   <h4>Возврат по заказу {order.externalId}</h4>
   <p><strong>Часы:</strong> {order.watchDescription||'Данные комплектации доступны в заказе'}</p>
   <p>Доступно к возврату: {order.returnableQuantity} шт. · Денег к возврату: {amt(maxRefund)}</p>
   <label>Вид возврата<select value={kind} onChange={e=>{setKind(e.target.value as ReturnKind);setConfirmed(false)}}>
     <option value="money_only">Только деньги</option>
     {canItems&&<option value="items_only">Только товар</option>}
     {canItems&&maxRefund>0&&<option value="both">Товар и деньги</option>}
   </select></label>
   {items&&<label>Количество часов<input type="number" min={1} max={order.returnableQuantity}
     value={quantity} onChange={e=>{setQuantity(e.target.value);setConfirmed(false)}} required/></label>}
   {money&&<>
     <label>Сумма возврата, ₸<input type="number" min={1} max={maxRefund}
       value={amount} onChange={e=>{setAmount(e.target.value);setConfirmed(false)}} required/></label>
     <label>Способ возврата<select value={paymentMethod}
       onChange={e=>{setPaymentMethod(e.target.value as typeof paymentMethod);setConfirmed(false)}}>
       {WATCH_PAYMENTS.map(method=><option key={method}>{method}</option>)}
     </select></label>
   </>}
   <label>Причина<input maxLength={300} value={reason} required
     onChange={e=>{setReason(e.target.value);setConfirmed(false)}} placeholder="Причина возврата"/></label>
   {items&&<p>Часы будут отмечены как ожидающие приёмки. Склад увеличится только после отдельного подтверждения физического получения.</p>}
   <label className="watch-return-confirm"><input type="checkbox" checked={confirmed}
     onChange={e=>setConfirmed(e.target.checked)}/>
     Подтверждаю оформление возврата {money?amt(Number(amount)):'без денежного возврата'}
   </label>
   {error&&<p role="alert" className="watch-return-error">{error}</p>}
   <div className="watch-return-actions"><button type="submit" disabled={busy||!confirmed}>{busy?'Сохраняю…':'Оформить возврат'}</button>
     <button type="button" disabled={busy} onClick={onCancel}>Отмена</button></div>
 </form>
}
