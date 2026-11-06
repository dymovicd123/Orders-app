import {useEffect,useRef,useState,type FormEvent} from 'react'
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
 managerId:number;managerName?:string|null;paymentLines:string;committedReturnCount:number;
 itemLines:string
}
type Item={
 id:number;productName:string;gender?:string;movement?:string;braceletMaterial?:string;
 dialColor?:string;braceletColor?:string;quantity:number;unitPrice:number;
 lineTotal:number;catalogPriceSnapshot:number|null;source:string;engravingText:string;
 shippedQuantity?:number;returnedQuantity?:number;stockWriteoffStatus?:string;dispatchItemId?:number|null
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
 const [correctionItem,setCorrectionItem]=useState<number|null>(null)
 const [correctionReason,setCorrectionReason]=useState('')
 const [correctionConfirmed,setCorrectionConfirmed]=useState(false)
 const [correcting,setCorrecting]=useState(false)
 const [correctionResult,setCorrectionResult]=useState('')
 const correctionRequests=useRef<Record<number,{reason:string;requestId:string}>>({})
 const [referenceOptions,setReferenceOptions]=useState<{cities:string[];deliveries:string[]}>({cities:[],deliveries:[]})
 useEffect(()=>{
   const controller=new AbortController()
   void fetch('/api/client3/watches/references',{credentials:'include',cache:'no-store',
     signal:controller.signal}).then(async response=>{
       const data=await response.json() as {ok?:boolean;rows?:Array<{kind:string;value:string}>}
       if(!response.ok||!data.ok||controller.signal.aborted)return
       const values=(kind:string)=>(data.rows||[]).filter(x=>x.kind===kind).map(x=>x.value)
       setReferenceOptions({cities:values('cities'),deliveries:values('deliveryMethods')})
     }).catch(()=>{})
   return ()=>controller.abort()
 },[])

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
   if(metadataDirty&&!/^\d{4}-\d{2}-\d{2}$/.test(next.orderDate)){
     setError('Укажите правильную дату заказа.');return
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
     <div><small>Заказ {order.externalId} · Бренд {brand}</small><h2>Изменение состава</h2>
       <p>Выбор комплектаций и остатков доступен только из склада бренда {brand}.</p></div>
     <button type="button" className="watch-editor-back" onClick={()=>setComposing(false)}>К редактированию заказа</button>
   </header>
   <WatchAdminCompositionEditor brand={brand} orderId={order.orderId}
     itemLines={order.itemLines} receivedAmount={order.receivedAmount}
     linkedReturns={order.committedReturnCount} shippingStatus={order.shippingStatus}
     onDone={onDone} onCancel={()=>setComposing(false)}/>
 </section>
 const currentAmount=items.reduce((sum,x)=>sum+x.quantity*(Number(prices[x.id])||0),0)
 const paymentEntries:(Array<{id:number;date:string;method:string;amount:number;kind:string}>)=(()=>{
   try{const raw=JSON.parse(order.paymentLines||'[]')
     return Array.isArray(raw)?raw.filter(x=>x&&Number(x.id)>0):[]
   }catch{return []}
 })()
 const cityOptions=[...new Set([...referenceOptions.cities,next.city].filter(Boolean))]
 const deliveryOptions=[...new Set([...referenceOptions.deliveries,next.deliveryType].filter(Boolean))]
 const back=()=>{
   if(dirty&&!window.confirm('Есть несохранённые изменения. Выйти без сохранения?'))return
   onCancel()
 }
 return <section className="watch-corrections watch-editor-unified watch-editor-parity" aria-label={'Исправление заказа '+order.externalId}>
   <header className="watch-editor-header create-hero">
     <div>
       <small>РЕДАКТИРОВАНИЕ ЗАКАЗА</small>
       <h2>{order.externalId}</h2>
       <p>Бренд {brand} · {order.shippingStatus==='sent'?'Отправлен':
          order.shippingStatus==='partially_sent'?'Частично отправлен':'Заказ в работе'}</p>
     </div>
     <button type="button" className="watch-editor-back" onClick={back} disabled={busy}>Назад к заказам</button>
   </header>
   {error&&<p className="watch-orders-error" role="alert">{error}</p>}
   <form id="watch-client3-order-edit-form" noValidate className="watch-editor-main-form main-watch-create"
     onSubmit={event=>void save(event)}>
     <section className="watch-editor-step-card order-step-card">
       <div className="order-step-head">
         <div className="order-step-index">1</div>
         <div><h3>Клиент и условия заказа</h3>
           <p>Реквизиты, доставка, адрес и крайний срок отправки.</p>
         </div>
       </div>
       <div className="watch-editor-step-grid">
         <label>Бренд
           <input readOnly value={brand} aria-label="Бренд заказа — изменить нельзя"/>
           <small>Остатки и каталог других брендов недоступны.</small>
         </label>
         {isAdmin&&<label>Дата заказа
           <input type="date" value={next.orderDate} onChange={e=>update('orderDate',e.target.value)}/>
         </label>}
         <label>ФИО получателя
           <input maxLength={200} value={next.customerName} onChange={e=>update('customerName',e.target.value)}/>
         </label>
         <label>Телефон
           <input maxLength={100} type="tel" value={next.customerPhone}
             onChange={e=>update('customerPhone',e.target.value)}/>
         </label>
         <label>Город
           <select value={next.city} onChange={e=>update('city',e.target.value)}>
             <option value="">Выберите город</option>
             {cityOptions.map(x=><option key={x} value={x}>{x}</option>)}
           </select>
         </label>
         <label>Доставка
           <select value={next.deliveryType} onChange={e=>update('deliveryType',e.target.value)}>
             <option value="">Выберите доставку</option>
             {deliveryOptions.map(x=><option key={x} value={x}>{x}</option>)}
           </select>
         </label>
         {isAdmin&&<>
           <label>Индекс
             <input maxLength={20} value={watch.postalCode}
               onChange={e=>changeWatch({postalCode:e.target.value})}/>
           </label>
           <label>Отправить до (Алматы)
             <input type="datetime-local" value={localDate(watch.shippingDeadlineAt)}
               onChange={e=>changeWatch({shippingDeadlineAt:toUtc(e.target.value)})}/>
           </label>
           <label className="watch-editor-step-wide">Адрес
             <textarea maxLength={500} rows={2} value={watch.deliveryAddress}
               onChange={e=>changeWatch({deliveryAddress:e.target.value})}/>
           </label>
           <label className="watch-editor-urgent">
             <input type="checkbox" checked={watch.urgent}
               onChange={e=>changeWatch({urgent:e.target.checked})}/> Срочный заказ
           </label>
         </>}
         <label className="watch-editor-step-wide">Комментарий к заказу
           <textarea rows={2} maxLength={500} value={next.comment}
             onChange={e=>update('comment',e.target.value)}/>
         </label>
       </div>
     </section>
     <section className="watch-editor-step-card order-step-card">
       <div className="order-step-head">
         <div className="order-step-index">2</div>
         <div><h3>Товары заказа</h3>
           <p>Характеристики, цена и гравировка каждой позиции.</p>
         </div>
         {isAdmin&&<button type="button" className="watch-editor-change-items"
           disabled={busy} onClick={()=>{
             if(dirty&&!window.confirm('Есть несохранённые изменения. Перейти к составу без сохранения?'))return
             setComposing(true)
           }}>Изменить состав</button>}
       </div>
       <div className="watch-editor-product-list">
         {items.map((x,index)=><article key={x.id} className="watch-editor-product watch-editor-item-line">
           <div className="watch-editor-product-top">
             <div><small>Позиция {index+1} · {label(x.source)} · {brand}</small>
               <strong>{x.productName||'Часы'} · {x.quantity} шт.</strong>
               <p>{[x.gender==='female'?'Женские':x.gender==='male'?'Мужские':'',
                 x.movement,x.braceletMaterial,x.dialColor,x.braceletColor].filter(Boolean).join(' · ')}</p>
             </div>
             <span className="watch-editor-item-status">
               {Number(x.shippedQuantity||0)>0?'Отправлено: '+x.shippedQuantity:
                 Number(x.returnedQuantity||0)>0?'Возвращено: '+x.returnedQuantity:'Не отправлен'}
             </span>
           </div>
           <div className="watch-editor-product-fields">
             <label>Цена продажи, ₸
               <input type="number" min={0} max={1000000000} step={1}
                 value={prices[x.id]??''} onChange={e=>{setPrices(prev=>({...prev,[x.id]:e.target.value}));setError('')}}/>
             </label>
             <span className="watch-editor-line-total">{money(x.quantity*(Number(prices[x.id])||0))}</span>
             {isAdmin&&<label className="watch-editor-engraving">Гравировка / комментарий логисту
               <input maxLength={500}
                 value={watch.items.find(y=>y.orderItemId===x.id)?.engravingText||''}
                 onChange={e=>setWatch(prev=>({...prev,items:prev.items.map(y=>
                   y.orderItemId===x.id?{...y,engravingText:e.target.value}:y)}))}/>
             </label>}
           </div>
         </article>)}
       </div>
     </section>
   </form>
   <section className="watch-editor-step-card order-step-card watch-editor-finance-step">
     <div className="order-step-head">
       <div className="order-step-index">3</div>
       <div><h3>Менеджер и оплаты</h3>
         <p>Проведённые оплаты сохраняют отдельную финансовую историю.</p>
       </div>
     </div>
     <div className="watch-editor-finance-grid">
       <div className="watch-editor-manager-panel">
         <small>Ответственный менеджер</small>
         <strong>{order.managerName||'Менеджер №'+order.managerId}</strong>
         {isAdmin&&<WatchAdminOrderActions view="manager" brand={brand}
           orderId={order.orderId} externalId={order.externalId} managerId={order.managerId}
           paymentLines={order.paymentLines} orderDate={order.orderDate}
           linkedOperations={Number(order.committedReturnCount||0)>0} onDone={onDone}/>}
       </div>
       <div className="watch-editor-payments-panel">
         <div className="watch-editor-payments-title"><strong>Проведённые оплаты</strong>
           <small>{paymentEntries.length} записей</small></div>
         {paymentEntries.length?paymentEntries.map(x=><div key={x.id} className="watch-editor-payment-line">
           <span>{x.date} · {x.method}</span><strong>{money(x.amount)}</strong>
         </div>):<p className="watch-editor-no-payments">Проведённых оплат нет.</p>}
         {isAdmin&&<WatchAdminOrderActions view="payment" brand={brand}
           orderId={order.orderId} externalId={order.externalId} managerId={order.managerId}
           paymentLines={order.paymentLines} orderDate={order.orderDate}
           linkedOperations={Number(order.committedReturnCount||0)>0} onDone={onDone}/>}
       </div>
     </div>
     <div className="watch-editor-totals">
       <span>Стоимость активных товаров <strong>{money(currentAmount)}</strong></span>
       <span>По оплатам <strong>{money(order.receivedAmount)}</strong></span>
       <span>Расчётный остаток <strong>{money(Math.max(0,currentAmount-order.receivedAmount))}</strong></span>
     </div>
     {order.committedReturnCount>0&&<p className="watch-editor-footnote">
       В заказе есть возвраты. Финансовый итог проверяется по истории проведённых операций.
     </p>}
   </section>
   <div className="watch-editor-savebar">
     <div>{dirty?<strong>Есть несохранённые изменения</strong>:<span>Изменений нет</span>}
       {savedSections>0&&<small>Сохранено разделов: {savedSections}</small>}</div>
     <div className="watch-editor-save-actions">
       <button type="button" className="watch-editor-back" onClick={back} disabled={busy}>Отмена</button>
       <button type="submit" form="watch-client3-order-edit-form" className="primary" disabled={busy||!dirty}>
         {busy?'Сохранение…':'Сохранить изменения'}</button>
     </div>
   </div>
   {(isAdmin||order.committedReturnCount>0)&&<details className="watch-editor-extra">
     <summary>Дополнительные действия и история</summary>
     {order.committedReturnCount>0&&<WatchReturnHistoryPanel brand={brand}
       orderId={order.orderId} onClose={back} onDone={onDone}/>}
     {isAdmin&&<WatchAdminOrderActions view="delete" brand={brand}
       orderId={order.orderId} externalId={order.externalId}
       managerId={order.managerId} paymentLines={order.paymentLines} orderDate={order.orderDate}
       linkedOperations={Number(order.committedReturnCount||0)>0} onDone={onDone}/>}
   </details>}
 </section>
}
