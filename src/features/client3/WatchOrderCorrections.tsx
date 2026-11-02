import {useRef,useState,type FormEvent} from 'react'
import type {WatchBrand} from '../../../shared/client3/watch-domain'

export type WatchCorrectionOrder={
 orderId:number;orderDate:string;externalId:string;
 recipientName:string;recipientPhone:string;city:string;deliveryMethod:string;
 canonicalCustomerName:string;canonicalCustomerPhone:string;canonicalCity:string;canonicalDeliveryType:string;
 orderComment:string;shippingStatus:string;orderStatus:string;
 totalAmount:number;receivedAmount:number;debtAmount:number;returnAmount:number;
 itemLines:string
}
type Line={id:number;productName:string;quantity:number;unitPrice:number;
 lineTotal:number;catalogPriceSnapshot:number|null;source:string}
type Props={brand:WatchBrand;order:WatchCorrectionOrder;isAdmin:boolean;onDone:()=>void;onCancel:()=>void}
type Metadata={orderDate:string;customerName:string;customerPhone:string;city:string;deliveryType:string;comment:string}
const initial=(o:WatchCorrectionOrder):Metadata=>({
 orderDate:o.orderDate,
 customerName:o.canonicalCustomerName||o.recipientName,
 customerPhone:o.canonicalCustomerPhone||o.recipientPhone,
 city:o.canonicalCity||o.city,
 deliveryType:o.canonicalDeliveryType||o.deliveryMethod,
 comment:o.orderComment||'',
})
const lines=(raw:string):Line[]=>{
 try{const x=JSON.parse(raw) as Line[];return Array.isArray(x)?x.filter(x=>x.id>0&&x.quantity>0):[]}catch{return []}
}
const num=(n:number)=>Number(n||0).toLocaleString('ru-RU')+' ₸'
const path=(id:number,mode:'metadata'|'prices')=>'/api/client3/watches/orders/'+id+'/'+mode
/** Exactly Main's two narrow correction modes. Does NOT send a full order payload.
 * The server validates both the original state and role independently.
 */
export function WatchOrderCorrections({brand,order,isAdmin,onDone,onCancel}:Props){
 const expected=initial(order)
 const items=lines(order.itemLines)
 const [mode,setMode]=useState<'metadata'|'prices'>('metadata')
 const [next,setNext]=useState<Metadata>(expected)
 const [prices,setPrices]=useState<Record<number,string>>(
   Object.fromEntries(items.map(x=>[x.id,String(x.unitPrice)])))
 const [error,setError]=useState('')
 const [busy,setBusy]=useState(false)
 const pending=useRef<{fingerprint:string;id:string}|null>(null)
 const update=(field:keyof Metadata,value:string)=>setNext(v=>({...v,[field]:value}))
 const submit=async(e:FormEvent<HTMLFormElement>)=>{
   e.preventDefault();if(busy)return
   const body:Record<string,unknown>={brand}
   if(mode==='metadata'){
     if(JSON.stringify(expected)===JSON.stringify(next)){
       setError('Изменений нет.');return
     }
     if(!next.customerName.trim()||!next.customerPhone.trim()||!next.city.trim()||!next.deliveryType.trim()){
       setError('ФИО, телефон, город и способ доставки обязательны.');return
     }
     if(!isAdmin&&next.orderDate!==expected.orderDate){
       setError('Изменять дату заказа может только администратор.');return
     }
     body.expected=expected;body.next=next
     body.expectedState={
       totalAmount:order.totalAmount,receivedAmount:order.receivedAmount,
       debtAmount:order.debtAmount,returnAmount:order.returnAmount,
       shippingStatus:order.shippingStatus,orderStatus:order.orderStatus,
     }
   }else{
     const changes=items.filter(x=>Number(prices[x.id])!==x.unitPrice)
       .map(x=>({
         orderItemId:x.id,unitPrice:Number(prices[x.id]),
         expectedUnitPrice:x.unitPrice,expectedQuantity:x.quantity,
         expectedLineTotal:x.lineTotal,expectedCatalogPriceSnapshot:x.catalogPriceSnapshot,
       }))
     if(!changes.length){setError('Цены не изменены.');return}
     if(changes.some(x=>!Number.isSafeInteger(x.unitPrice)||x.unitPrice<0)){
       setError('Цена должна быть целым числом от 0 ₸.');return
     }
     body.changes=changes
   }
   const fingerprint=JSON.stringify({mode,body})
   if(pending.current?.fingerprint!==fingerprint)
     pending.current={fingerprint,id:'watch-correct-'+crypto.randomUUID()}
   setBusy(true);setError('')
   try{
     const result=await fetch(path(order.orderId,mode),{
       method:'PATCH',credentials:'include',cache:'no-store',
       headers:{'Content-Type':'application/json'},
       body:JSON.stringify({...body,requestId:pending.current.id}),
     })
     const value=await result.json() as {ok?:boolean;message?:string}
     if(!result.ok||!value.ok)throw new Error(value.message||'Исправление не принято.')
     onDone()
   }catch(err){setError(err instanceof Error?err.message:'Не удалось исправить заказ.')}
   finally{setBusy(false)}
 }
 return <section className="watch-corrections" aria-label={'Исправление заказа '+order.externalId}>
   <div className="watch-corrections-title">
     <strong>Исправить заказ {order.externalId}</strong>
     <small>{isAdmin?'Администратор':'Менеджер'} · отдельные безопасные действия Main</small>
   </div>
   <div className="watch-corrections-tabs">
     <button type="button" className={mode==='metadata'?'primary':'secondary'}
       onClick={()=>{setMode('metadata');setError('')}}>Реквизиты</button>
     <button type="button" className={mode==='prices'?'primary':'secondary'}
       onClick={()=>{setMode('prices');setError('')}}>Записанная цена</button>
   </div>
   <form onSubmit={e=>void submit(e)}>
     {mode==='metadata'?<>
       <p className="watch-corrections-hint">Исправление контактов, города, доставки и комментария не меняет
         состав, остатки, отправку или оплаты.</p>
       <div className="watch-corrections-grid">
         <label>ФИО клиента
           <input required maxLength={200} value={next.customerName}
             onChange={e=>update('customerName',e.target.value)}/></label>
         <label>Телефон
           <input required maxLength={100} type="tel" value={next.customerPhone}
             onChange={e=>update('customerPhone',e.target.value)}/></label>
         <label>Город
           <input required maxLength={100} value={next.city}
             onChange={e=>update('city',e.target.value)}/></label>
         <label>Способ доставки
           <input required maxLength={120} value={next.deliveryType}
             onChange={e=>update('deliveryType',e.target.value)}/></label>
         {isAdmin&&<label>Дата заказа
           <input type="date" required value={next.orderDate}
             onChange={e=>update('orderDate',e.target.value)}/></label>}
         <label className="watch-corrections-wide">Комментарий к заказу
           <textarea maxLength={500} rows={2} value={next.comment}
             onChange={e=>update('comment',e.target.value)}/></label>
       </div>
     </>:<>
       <p className="watch-corrections-hint">Исправляется только записанная цена продажи.
         Сумма заказа и долг пересчитываются механизмом Main. Отправка и склад не меняются.</p>
       <div className="watch-corrections-lines">
         {items.map(x=><label key={x.id} className="watch-corrections-item">
           <span><strong>{x.productName||'Часы'} · {x.quantity} шт.</strong>
             <small>{x.source==='boutique'?'Витрина':'Офис'} · было {num(x.unitPrice)} / шт.</small></span>
           <span>Новая цена за 1 шт., ₸
             <input required type="number" min={0} max={1000000000} step={1}
               value={prices[x.id]??''}
               onChange={e=>setPrices(p=>({...p,[x.id]:e.target.value}))}/></span>
         </label>)}
       </div>
       {!items.length&&<p>Нет активных товарных позиций для исправления.</p>}
     </>}
     {error&&<p className="watch-orders-error" role="alert">{error}</p>}
     <div className="watch-corrections-actions">
       <button className="primary" type="submit" disabled={busy||mode==='prices'&&!items.length}>
         {busy?'Сохранение…':'Сохранить исправление'}</button>
       <button type="button" className="secondary" disabled={busy} onClick={onCancel}>Отмена</button>
     </div>
   </form>
 </section>
}
