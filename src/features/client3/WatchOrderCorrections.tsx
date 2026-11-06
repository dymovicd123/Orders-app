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
type Line={id:number;productName:string;quantity:number;unitPrice:number;
 lineTotal:number;catalogPriceSnapshot:number|null;source:string;engravingText:string}
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
const path=(id:number,mode:'metadata'|'prices'|'watch'|'composition')=>'/api/client3/watches/orders/'+id+'/'+
  (mode==='watch'?'watch-details':mode)
type AdminWatch={deliveryAddress:string;postalCode:string;urgent:boolean;
 shippingDeadlineAt:string;items:Array<{orderItemId:number;engravingText:string}>}
const toLocal=(iso:string)=>{
 const parsed=Date.parse(iso||'')
 return Number.isFinite(parsed)?new Date(parsed+5*3600000).toISOString().slice(0,16):''
}
const toUTC=(local:string)=>local&&Number.isFinite(Date.parse(local+'+05:00'))
 ?new Date(local+'+05:00').toISOString():''
const fromOrder=(order:WatchCorrectionOrder):AdminWatch=>({
 deliveryAddress:order.deliveryAddress||'',postalCode:order.postalCode||'',
 urgent:order.urgent===1,shippingDeadlineAt:order.shippingDeadlineAt,
 items:lines(order.itemLines).map(x=>({orderItemId:x.id,engravingText:x.engravingText||''})),
})
/** Exactly Main's two narrow correction modes. Does NOT send a full order payload.
 * The server validates both the original state and role independently.
 */
export function WatchOrderCorrections({brand,order,isAdmin,onDone,onCancel}:Props){
 const expected=initial(order)
 const items=lines(order.itemLines)

 const [next,setNext]=useState<Metadata>(expected)
 const [prices,setPrices]=useState<Record<number,string>>(
   Object.fromEntries(items.map(x=>[x.id,String(x.unitPrice)])))
 const [watch,setWatch]=useState<AdminWatch>(fromOrder(order))
 const [error,setError]=useState('')
 const [busy,setBusy]=useState(false)
 const pending=useRef<{fingerprint:string;id:string}|null>(null)
 const update=(field:keyof Metadata,value:string)=>setNext(v=>({...v,[field]:value}))
 const submit=async(e:FormEvent<HTMLFormElement>,section:'metadata'|'prices'|'watch')=>{
   e.preventDefault();if(busy)return
   const body:Record<string,unknown>={brand}
   if(section==='metadata'){
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
   }else if(section==='watch'){
     if(!isAdmin){setError('Только администратор может исправлять данные логистики.');return}
     const expectedWatch=fromOrder(order)
     if(JSON.stringify(expectedWatch)===JSON.stringify(watch)){
       setError('Изменений нет.');return
     }
     if(!watch.deliveryAddress.trim()||!watch.postalCode.trim()||
       !Number.isFinite(Date.parse(watch.shippingDeadlineAt))){
       setError('Проверьте адрес, индекс и точное время отправки.');return
     }
     body.expected=expectedWatch;body.next=watch
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
   const fingerprint=JSON.stringify({section,body})
   if(pending.current?.fingerprint!==fingerprint)
     pending.current={fingerprint,id:'watch-correct-'+crypto.randomUUID()}
   setBusy(true);setError('')
   try{
     const result=await fetch(path(order.orderId,section),{
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
 return <section className="watch-corrections watch-editor-unified" aria-label={'Исправление заказа '+order.externalId}>
   <header className="watch-editor-header">
     <div><div className="watch-editor-kicker">Редактирование заказа</div>
       <h2>{order.externalId}</h2>
       <p>Всё на одной странице. Каждое изменение сохраняется отдельно с проверкой прав и финансовой истории.</p>
     </div>
     <button type="button" className="secondary" onClick={onCancel}>Назад к заказу</button>
   </header>
   {error&&<p className="watch-orders-error" role="alert">{error}</p>}
   <div className="watch-editor-sections">
     
     <section className="watch-editor-card" id="watch-edit-metadata">
       <div className="watch-editor-section-head"><div><h3>Клиент и реквизиты</h3><p>Контакты, дата заказа, город и способ доставки</p></div></div>
       <form onSubmit={event=>void submit(event,'metadata')}>
         
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

         <div className="watch-editor-form-actions">
           <button className="primary" type="submit" disabled={busy}>
             Сохранить реквизиты</button>
         </div>
       </form>
     </section>
     {isAdmin&&
     <section className="watch-editor-card" id="watch-edit-watch">
       <div className="watch-editor-section-head"><div><h3>Доставка и гравировка</h3><p>Адрес, отправка и пожелания по каждому изделию</p></div></div>
       <form onSubmit={event=>void submit(event,'watch')}>
         
       <p className="watch-corrections-hint">Администратор может исправить доставку,
         срочность, срок отправки и гравировку до фактической отправки.
         Если гравировка отмечена готовой, текст нельзя переписывать.</p>
       <div className="watch-corrections-grid">
         <label className="watch-corrections-wide">Полный адрес доставки *
           <textarea rows={2} required maxLength={500} value={watch.deliveryAddress}
             onChange={e=>setWatch(prev=>({...prev,deliveryAddress:e.target.value}))}/></label>
         <label>Почтовый индекс *
           <input required maxLength={20} value={watch.postalCode}
             onChange={e=>setWatch(prev=>({...prev,postalCode:e.target.value}))}/></label>
         <label>Отправить до (Алматы) *
           <input type="datetime-local" required value={toLocal(watch.shippingDeadlineAt)}
             onChange={e=>setWatch(prev=>({...prev,shippingDeadlineAt:toUTC(e.target.value)}))}/></label>
         <label className="watch-corrections-wide watch-corrections-checkbox">
           <input type="checkbox" checked={watch.urgent}
             onChange={e=>setWatch(prev=>({...prev,urgent:e.target.checked}))}/>
           Срочный заказ</label>
       </div>
       <div className="watch-corrections-lines">
         {items.map(x=><label key={x.id} className="watch-corrections-item">
           <span><strong>{x.productName||'Часы'} · {x.quantity} шт.</strong>
             <small>Комментарий логисту / гравировка для этой позиции</small></span>
           <textarea maxLength={500} rows={2}
             value={watch.items.find(y=>y.orderItemId===x.id)?.engravingText||''}
             onChange={e=>setWatch(prev=>({...prev,items:prev.items.map(y=>
               y.orderItemId===x.id?{...y,engravingText:e.target.value}:y)}))}/>
         </label>)}
       </div>

         <div className="watch-editor-form-actions">
           <button className="primary" type="submit" disabled={busy}>
             Сохранить доставку и гравировку</button>
         </div>
       </form>
     </section>}
     
     <section className="watch-editor-card" id="watch-edit-prices">
       <div className="watch-editor-section-head"><div><h3>Цена продажи</h3><p>Цены товаров и автоматический пересчёт суммы</p></div></div>
       <form onSubmit={event=>void submit(event,'prices')}>
         
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

         <div className="watch-editor-form-actions">
           <button className="primary" type="submit" disabled={busy||!items.length}>
             Сохранить цены</button>
         </div>
       </form>
     </section>
     {isAdmin&&<section className="watch-editor-card watch-editor-actions">
       <div className="watch-editor-section-head"><div><h3>Менеджер, оплаты и удаление</h3>
         <p>Дополнительные действия — без переключения между вкладками</p></div></div>
       <WatchAdminOrderActions brand={brand} orderId={order.orderId} externalId={order.externalId}
         managerId={order.managerId} paymentLines={order.paymentLines} orderDate={order.orderDate}
         linkedOperations={Number(order.committedReturnCount||0)>0} onDone={onDone}/>
     </section>}
     {isAdmin&&<details className="watch-editor-card watch-editor-disclosure">
       <summary><span><strong>Изменить состав товаров</strong>
         <small>Добавление и удаление часов с проверкой остатков</small></span>
         <span className="watch-editor-expand" aria-hidden="true">Развернуть</span></summary>
       <div className="watch-editor-disclosure-content">
         <WatchAdminCompositionEditor brand={brand} orderId={order.orderId}
           itemLines={order.itemLines} receivedAmount={order.receivedAmount}
           onDone={onDone} onCancel={onCancel}/>
       </div>
     </details>}
     {order.committedReturnCount>0&&<details className="watch-editor-card watch-editor-disclosure">
       <summary><span><strong>Возвраты и их отмена</strong>
         <small>Проверка связанной операции</small></span>
         <span className="watch-editor-expand" aria-hidden="true">Развернуть</span></summary>
       <div className="watch-editor-disclosure-content">
         <WatchReturnHistoryPanel brand={brand} orderId={order.orderId} onClose={onCancel} onDone={onDone}/>
       </div>
     </details>}
   </div>
 </section>
}
}
