import {useRef,useState,type FormEvent} from 'react'
import '../../styles/client3-watch-unified-editor.css'
import type {WatchBrand} from '../../../shared/client3/watch-domain'
import {WatchAdminCompositionEditor} from './WatchAdminCompositionEditor'
import {WatchAdminOrderActions} from './WatchAdminOrderActions'
import {WatchReturnHistoryPanel} from './WatchReturnHistoryPanel'

export type WatchCorrectionOrder={
 orderId:number;orderDate:string;externalId:string;
 recipientName:string;recipientPhone:string;city:string;deliveryMethod:string;
 canonicalCustomerName:string;canonicalCustomerPhone:string;canonicalCity:string;canonicalDeliveryType:string;
 orderComment:string;shippingStatus:string;orderStatus:string;
 deliveryAddress:string;postalCode:string;urgent:number;shippingDeadlineAt:string;
 totalAmount:number;receivedAmount:number;debtAmount:number;returnAmount:number;
 managerId:number;paymentLines:string;committedReturnCount:number;
 itemLines:string
}
type Item={
 id:number;productName:string;gender?:string;movement?:string;braceletMaterial?:string;
 dialColor?:string;braceletColor?:string;quantity:number;unitPrice:number;
 lineTotal:number;catalogPriceSnapshot:number|null;source:string;engravingText:string;
 shippedQuantity?:number;returnedQuantity?:number;stockWriteoffStatus?:string
}
type Props={brand:WatchBrand;order:WatchCorrectionOrder;isAdmin:boolean;
 onDone:()=>void;onCancel:()=>void}
type Metadata={orderDate:string;customerName:string;customerPhone:string;city:string;
 deliveryType:string;comment:string}
type WatchDetails={deliveryAddress:string;postalCode:string;urgent:boolean;shippingDeadlineAt:string;
 items:Array<{orderItemId:number;engravingText:string}>}
type Section='metadata'|'watch'|'prices'
const money=(n:number)=>Number(n||0).toLocaleString('ru-RU')+' ₸'
const parse=(raw:string):Item[]=>{
 try{
   const x=JSON.parse(raw) as Item[]
   return Array.isArray(x)?x.filter(line=>line.id>0&&line.quantity>0):[]
 }catch{return []}
}
const initialMetadata=(o:WatchCorrectionOrder):Metadata=>({
 orderDate:o.orderDate,customerName:o.canonicalCustomerName||o.recipientName,
 customerPhone:o.canonicalCustomerPhone||o.recipientPhone,city:o.canonicalCity||o.city,
 deliveryType:o.canonicalDeliveryType||o.deliveryMethod,comment:o.orderComment||'',
})
const initialWatch=(o:WatchCorrectionOrder,items:Item[]):WatchDetails=>({
 deliveryAddress:o.deliveryAddress||'',postalCode:o.postalCode||'',
 urgent:o.urgent===1,shippingDeadlineAt:o.shippingDeadlineAt,
 items:items.map(x=>({orderItemId:x.id,engravingText:x.engravingText||''})),
})
const localDate=(iso:string)=>{
 const value=Date.parse(iso||'')
 return Number.isFinite(value)?new Date(value+5*3600000).toISOString().slice(0,16):''
}
const toUtc=(value:string)=>value&&Number.isFinite(Date.parse(value+'+05:00'))
 ?new Date(value+'+05:00').toISOString():''
const label=(source:string)=>source==='boutique'?'Витрина':'Офис'
const path=(id:number,part:Section)=>'/api/client3/watches/orders/'+id+'/'+
 (part==='watch'?'watch-details':part)

export function WatchOrderCorrections({brand,order,isAdmin,onDone,onCancel}:Props){
 const items=parse(order.itemLines)
 const expected=initialMetadata(order)
 const expectedWatch=initialWatch(order,items)
 const [next,setNext]=useState<Metadata>(expected)
 const [watch,setWatch]=useState<WatchDetails>(expectedWatch)
 const [prices,setPrices]=useState<Record<number,string>>(
   Object.fromEntries(items.map(x=>[x.id,String(x.unitPrice)])))
 const [composing,setComposing]=useState(false)
 const [busy,setBusy]=useState(false)
 const [error,setError]=useState('')
 const [savedSections,setSavedSections]=useState(0)
 const pending=useRef<Partial<Record<Section,{fingerprint:string;id:string}>>>({})
 const metadataDirty=JSON.stringify(next)!==JSON.stringify(expected)
 const watchDirty=isAdmin&&JSON.stringify(watch)!==JSON.stringify(expectedWatch)
 const changedPrices=items.filter(x=>Number(prices[x.id])!==x.unitPrice)
 const priceDirty=changedPrices.length>0
 const dirty=metadataDirty||watchDirty||priceDirty
 const update=(key:keyof Metadata,value:string)=>{setNext(prev=>({...prev,[key]:value}));setError('')}
 const changeWatch=(patch:Partial<WatchDetails>)=>{setWatch(prev=>({...prev,...patch}));setError('')}
 const send=async(part:Section,body:Record<string,unknown>)=>{
   const fingerprint=JSON.stringify(body)
   if(pending.current[part]?.fingerprint!==fingerprint)
     pending.current[part]={fingerprint,id:'watch-correct-'+crypto.randomUUID()}
   const response=await fetch(path(order.orderId,part),{
     method:'PATCH',credentials:'include',cache:'no-store',
     headers:{'Content-Type':'application/json'},
     body:JSON.stringify({...body,requestId:pending.current[part]!.id}),
   })
   const result=await response.json() as {ok?:boolean;message?:string}
   if(!response.ok||!result.ok)throw Error(result.message||'Изменение не принято.')
 }
 const save=async(event:FormEvent<HTMLFormElement>)=>{
   event.preventDefault()
   if(busy||!dirty)return
   if(metadataDirty&&(!next.customerName.trim()||!next.customerPhone.trim()||
     !next.city.trim()||!next.deliveryType.trim())){
     setError('Укажите клиента, телефон, город и доставку.');return
   }
   if(watchDirty&&(!watch.deliveryAddress.trim()||!watch.postalCode.trim()||
     !Number.isFinite(Date.parse(watch.shippingDeadlineAt)))){
     setError('Проверьте адрес, индекс и время отправки.');return
   }
   if(priceDirty&&changedPrices.some(x=>
     !Number.isSafeInteger(Number(prices[x.id]))||Number(prices[x.id])<0||
     prices[x.id].trim()==='')){
     setError('Цена должна быть целым числом от 0 ₸.');return
   }
   setError('');setSavedSections(0);setBusy(true)
   let saved=0
   try{
     // These endpoints have separate atomic checks and historical journals.
     // Never falsely represent a multi-endpoint save as one DB transaction.
     if(metadataDirty){
       await send('metadata',{brand,expected,next,expectedState:{
         totalAmount:order.totalAmount,receivedAmount:order.receivedAmount,
         debtAmount:order.debtAmount,returnAmount:order.returnAmount,
         shippingStatus:order.shippingStatus,orderStatus:order.orderStatus,
       }})
       saved++;setSavedSections(saved)
     }
     if(watchDirty){
       await send('watch',{brand,expected:expectedWatch,next:watch})
       saved++;setSavedSections(saved)
     }
     if(priceDirty){
       await send('prices',{brand,changes:changedPrices.map(x=>({
         orderItemId:x.id,unitPrice:Number(prices[x.id]),
         expectedUnitPrice:x.unitPrice,expectedQuantity:x.quantity,
         expectedLineTotal:x.lineTotal,expectedCatalogPriceSnapshot:x.catalogPriceSnapshot,
       }))})
       saved++;setSavedSections(saved)
     }
     onDone()
   }catch(cause){
     const reason=cause instanceof Error?cause.message:'Изменение не принято.'
     setError(saved>0?'Сохранено разделов: '+saved+'. Остальное не сохранено: '+reason+
       ' Вернитесь к заказу и откройте его заново перед повтором.':reason)
   }finally{setBusy(false)}
 }
 if(composing)return <section className="watch-corrections watch-editor-unified">
   <header className="watch-editor-header">
     <div><small>Заказ {order.externalId}</small><h2>Изменение состава</h2></div>
     <button type="button" className="watch-editor-back" onClick={()=>setComposing(false)}>Назад к редактору</button>
   </header>
   <WatchAdminCompositionEditor brand={brand} orderId={order.orderId}
     itemLines={order.itemLines} receivedAmount={order.receivedAmount}
     linkedReturns={order.committedReturnCount}
     onDone={onDone} onCancel={()=>setComposing(false)}/>
 </section>
 return <section className="watch-corrections watch-editor-unified" aria-label={'Исправление заказа '+order.externalId}>
   <header className="watch-editor-header">
     <div>
       <small>Редактирование заказа · {brand}</small>
       <h2>{order.externalId}</h2>
       <p>{order.shippingStatus==='sent'?'Отправлен':order.shippingStatus==='partially_sent'?'Частично отправлен':'Заказ в работе'} · Изменяйте необходимые поля.</p>
     </div>
     <button type="button" className="watch-editor-back" onClick={onCancel} disabled={busy}>Назад к заказам</button>
   </header>
   {error&&<p className="watch-orders-error" role="alert">{error}</p>}
   <form className="watch-editor-main-form" onSubmit={event=>void save(event)}>
     <div className="watch-editor-sections">
       <section className="watch-editor-card">
         <div className="watch-editor-section-title"><h3>Клиент и доставка</h3></div>
         <div className="watch-editor-grid">
           <label>Клиент<input maxLength={200} value={next.customerName}
             onChange={e=>update('customerName',e.target.value)} /></label>
           <label>Телефон<input maxLength={100} type="tel" value={next.customerPhone}
             onChange={e=>update('customerPhone',e.target.value)}/></label>
           <label>Город<input maxLength={100} value={next.city}
             onChange={e=>update('city',e.target.value)}/></label>
           <label>Способ доставки<input maxLength={120} value={next.deliveryType}
             onChange={e=>update('deliveryType',e.target.value)}/></label>
           {isAdmin&&<label>Дата заказа<input type="date" value={next.orderDate}
             onChange={e=>update('orderDate',e.target.value)}/></label>}
           <label className="watch-editor-wide">Комментарий к заказу
             <input maxLength={500} value={next.comment}
               onChange={e=>update('comment',e.target.value)}/></label>
         </div>
       </section>
       {isAdmin&&<section className="watch-editor-card">
         <div className="watch-editor-section-title"><h3>Отправка</h3></div>
         <div className="watch-editor-grid">
           <label className="watch-editor-wide">Адрес доставки
             <input maxLength={500} value={watch.deliveryAddress}
               onChange={e=>changeWatch({deliveryAddress:e.target.value})}/></label>
           <label>Индекс<input maxLength={20} value={watch.postalCode}
             onChange={e=>changeWatch({postalCode:e.target.value})}/></label>
           <label>Отправить до (Алматы)
             <input type="datetime-local" value={localDate(watch.shippingDeadlineAt)}
               onChange={e=>changeWatch({shippingDeadlineAt:toUtc(e.target.value)})}/></label>
           <label className="watch-editor-checkbox">
             <input type="checkbox" checked={watch.urgent}
               onChange={e=>changeWatch({urgent:e.target.checked})}/> Срочный заказ</label>
         </div>
       </section>}
       <section className="watch-editor-card watch-editor-products">
         <div className="watch-editor-section-title">
           <div><h3>Товары и цены</h3><p>Цена и гравировка находятся рядом с товаром.</p></div>
           {isAdmin&&<button type="button" className="watch-editor-change-items" disabled={busy}
             onClick={()=>{
               if(dirty&&!window.confirm('Есть несохранённые изменения. Перейти к составу без сохранения?'))return
               setComposing(true)
             }}>Изменить состав</button>}
         </div>
         <div className="watch-editor-product-list">
           {items.map(x=><article key={x.id} className="watch-editor-product">
             <div className="watch-editor-product-top"><div>
               <strong>{x.productName||'Часы'} · {x.quantity} шт.</strong>
               <p>{label(x.source)} · {[x.gender==='female'?'Женские':x.gender==='male'?'Мужские':'',
                 x.movement,x.braceletMaterial,x.dialColor,x.braceletColor].filter(Boolean).join(' · ')}</p>
             </div><small>{Number(x.shippedQuantity||0)>0?'Отправлено: '+x.shippedQuantity:
                 Number(x.returnedQuantity||0)>0?'Возвращено: '+x.returnedQuantity:'Не отправлен'}</small></div>
             <div className="watch-editor-product-fields">
               <label>Цена за 1 шт., ₸<input type="number" min={0} max={1000000000} step={1}
                 value={prices[x.id]??''}
                 onChange={e=>{setPrices(prev=>({...prev,[x.id]:e.target.value}));setError('')}}/></label>
               <span className="watch-editor-line-total">{money(x.quantity*(Number(prices[x.id])||0))}</span>
               {isAdmin&&<label className="watch-editor-engraving">Гравировка / комментарий логисту
                 <input maxLength={500} value={watch.items.find(y=>y.orderItemId===x.id)?.engravingText||''}
                   onChange={e=>setWatch(prev=>({...prev,items:prev.items.map(y=>
                     y.orderItemId===x.id?{...y,engravingText:e.target.value}:y)}))}/></label>}
             </div>
           </article>)}
         </div>
       </section>
       <section className="watch-editor-card watch-editor-financial">
         <div className="watch-editor-section-title"><h3>Оплаты</h3>
          </div>
         <div className="watch-editor-totals">
           <span>Сумма заказа <strong>{money(items.reduce((sum,x)=>sum+x.quantity*(Number(prices[x.id])||0),0))}</strong></span>
           <span>Оплачено <strong>{money(order.receivedAmount)}</strong></span>
           <span>Долг <strong>{money(Math.max(0,items.reduce((sum,x)=>sum+x.quantity*(Number(prices[x.id])||0),0)-order.receivedAmount))}</strong></span>
         </div>
         <p className="watch-editor-footnote">Проведённые платежи и возвраты не изменяются при исправлении цены.</p>
       </section>
     </div>
     <div className="watch-editor-savebar">
       <div>{dirty?<span>Есть несохранённые изменения</span>:<span>Изменений нет</span>}
         {savedSections>0&&<small>Сохранено разделов: {savedSections}</small>}</div>
       <div className="watch-editor-save-actions">
         <button type="button" className="watch-editor-back" onClick={onCancel} disabled={busy}>Отмена</button>
         <button type="submit" className="primary" disabled={busy||!dirty}>
           {busy?'Сохранение…':'Сохранить изменения'}</button>
       </div>
     </div>
   </form>
   {isAdmin&&<details className="watch-editor-extra">
     <summary>Менеджер, проведённые оплаты и удаление заказа</summary>
     <WatchAdminOrderActions brand={brand} orderId={order.orderId} externalId={order.externalId}
       managerId={order.managerId} paymentLines={order.paymentLines} orderDate={order.orderDate}
       linkedOperations={Number(order.committedReturnCount||0)>0} onDone={onDone}/>
   </details>}
   {order.committedReturnCount>0&&<details className="watch-editor-extra">
     <summary>История возвратов ({order.committedReturnCount})</summary>
     <WatchReturnHistoryPanel brand={brand} orderId={order.orderId}
       onClose={onCancel} onDone={onDone}/>
   </details>}
 </section>
}
