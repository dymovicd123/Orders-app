import {useMemo,useRef,useState,type FormEvent} from 'react'
import {SmartPickerInput} from '../../components/inputs/SmartPickerInput'
import {WatchOrderSourcePicker,sourceAvailable,stockKey,watchLabels} from './WatchOrderSourcePicker'
import '../../styles/client3-watch-source-picker.css'
import '../../styles/188f-stock-trust.css'
import '../../styles/client3-watch-main-create.css'
import '../../styles/client3-watch-order.css'
import {
 WATCH_OPTIONS,WATCH_PAYMENTS,validateWatchOrderInput,
 type WatchBrand,type WatchSource,type WatchPaymentMethod,
} from '../../../shared/client3/watch-domain'

export type WatchOrderChoice={
 brand:WatchBrand;watchProductId:number;watchVariantId:number;catalogVariantId:number;
 modelName:string;gender:'male'|'female';movement:string;braceletMaterial:string;
 dialColor:string;braceletColor:string;
 officePhysical:number;officeReserved:number;showcasePhysical:number;showcaseReserved:number;
 catalogPriceSnapshot?:number|null
}
type ManualFields={modelName:string;gender:'male'|'female';movement:string;
 braceletMaterial:string;dialColor:string;braceletColor:string}
type DraftLine={id:string;kind:'stock'|'preorder'|'manual';watchVariantId:number;catalogVariantId:number;source:WatchSource;quantity:number;
 unitPrice:string;engravingText:string;manual:ManualFields}
export type WatchOrderDraftPayload=ReturnType<typeof validateWatchOrderInput>&{
 orderDate:string;shippingDeadlineLocal:string;requestId:string;receivedAmount:number;
 payments:Array<{method:WatchPaymentMethod;amount:number}>;managerId?:number;
 items:Array<{watchVariantId:number;catalogVariantId?:number;orderMode?:'stock'|'preorder'|'manual';quantity:number;unitPrice:number;
   source:WatchSource;engravingText:string;manual?:ManualFields}>
 // Backwards compatibility with early third-tenant Clients and Main tests.
 watchVariantId:number;catalogVariantId:number;quantity:number;unitPrice:number;engravingText:string;
 catalogPriceSnapshot:number|null
}
type Props={
 allowedBrands:readonly WatchBrand[];catalog:readonly WatchOrderChoice[];
 managers?:readonly {brand:WatchBrand;id:number;name:string}[];
 isAdmin?:boolean;deliveryMethods:readonly string[];paymentMethods?:readonly string[];
 references?:{movements:readonly string[];bracelets:readonly string[];
   dials:readonly string[];leatherColors:readonly string[];cities?:readonly string[]};
 onSave:(draft:WatchOrderDraftPayload)=>Promise<void>|void
}
const readable=(options:readonly {value:string;label:string}[],value:string)=>
 options.find(x=>x.value===value)?.label||value
const canonical=(options:readonly {value:string;label:string}[],raw:string)=>{
 const value=raw.trim().replace(/\s+/g,' ')
 const match=options.find(x=>x.value.toLocaleLowerCase('ru')===value.toLocaleLowerCase('ru')||
   x.label.toLocaleLowerCase('ru')===value.toLocaleLowerCase('ru'))
 return match?.value||value
}
const comparable=(value:string)=>value.trim().replace(/\s+/g,' ').toLocaleLowerCase('ru-RU')
const free=(x:WatchOrderChoice,source:WatchSource)=>Math.max(0,Number(source==='office'?
 x.officePhysical-x.officeReserved:x.showcasePhysical-x.showcaseReserved)||0)
const businessToday=()=>new Date(Date.now()+5*3600*1000).toISOString().slice(0,10)
const newLine=(source:WatchSource='office'):DraftLine=>({
 id:crypto.randomUUID(),kind:'manual',watchVariantId:0,catalogVariantId:0,source,quantity:1,unitPrice:'',engravingText:'',
 manual:{modelName:'',gender:'male',movement:'quartz',braceletMaterial:'steel',dialColor:'black',braceletColor:''},
})

/** Same workflow as Main's CreateOrderSection: brand → multiple lines with own
 * sources and quantities → multiple payments → review. Stock is informative,
 * never a precondition for accepting an order.
 */
export function WatchOrderForm({allowedBrands,catalog,managers=[],isAdmin=false,
 deliveryMethods,paymentMethods=WATCH_PAYMENTS,references,onSave}:Props){
 const [brand,setBrand]=useState<WatchBrand|''>('')
 const [source,setSource]=useState<WatchSource>('office')
 const [lines,setLines]=useState<DraftLine[]>([])
 const [payments,setPayments]=useState<Array<{method:string;amount:string}>>([
   {method:paymentMethods[0]||'KASPI GOLD',amount:'0'},
 ])
 const [managerId,setManagerId]=useState(0)
 const [recipientName,setRecipientName]=useState('')
 const [recipientPhone,setRecipientPhone]=useState('')
 const [city,setCity]=useState('')
 const [otherCity,setOtherCity]=useState(false)
 const [address,setAddress]=useState('')
 const [postalCode,setPostalCode]=useState('')
 const [deliveryMethod,setDeliveryMethod]=useState(deliveryMethods[0]||'')
 const [shippingDeadlineLocal,setShippingDeadlineLocal]=useState('')
 const [orderDate,setOrderDate]=useState(businessToday)
 const [urgent,setUrgent]=useState(false)
 const [busy,setBusy]=useState(false)
 const [error,setError]=useState('')
 const requestRef=useRef<{fingerprint:string;requestId:string}|null>(null)
 const scoped=useMemo(()=>catalog.filter(x=>x.brand===brand&&x.catalogVariantId>0),
   [catalog,brand])
 const staff=managers.filter(x=>x.brand===brand)
 const update=(id:string,patch:Partial<DraftLine>)=>setLines(all=>all.map(x=>x.id===id?{...x,...patch}:x))
 const suggestions=useMemo(()=>({
   models:[...new Set(scoped.map(x=>x.modelName))],
   movements:[...new Set([...(references?.movements||[]),...scoped.map(x=>x.movement),
     ...WATCH_OPTIONS.movements.map(x=>x.value)])]
     .map(x=>readable(WATCH_OPTIONS.movements,x)),
   bracelets:[...new Set([...(references?.bracelets||[]),...scoped.map(x=>x.braceletMaterial),
     ...WATCH_OPTIONS.braceletMaterials.map(x=>x.value)])]
     .map(x=>readable(WATCH_OPTIONS.braceletMaterials,x)),
   dials:[...new Set([...(references?.dials||[]),...scoped.map(x=>x.dialColor),
     ...WATCH_OPTIONS.dialColors.map(x=>x.value)])]
     .map(x=>readable(WATCH_OPTIONS.dialColors,x)),
   leatherColors:[...new Set([...(references?.leatherColors||[]),
     ...scoped.map(x=>x.braceletColor).filter(Boolean)])],
 }),[scoped,references])
 const matches=lines.map(line=>line.kind!=='manual'
   ?scoped.find(x=>x.watchVariantId===line.watchVariantId&&x.catalogVariantId===line.catalogVariantId)
   :scoped.find(x=>
     comparable(x.modelName)===comparable(line.manual.modelName)&&
     x.gender===line.manual.gender&&
     comparable(x.movement)===comparable(canonical(WATCH_OPTIONS.movements,line.manual.movement))&&
     comparable(x.braceletMaterial)===comparable(canonical(WATCH_OPTIONS.braceletMaterials,line.manual.braceletMaterial))&&
     comparable(x.dialColor)===comparable(canonical(WATCH_OPTIONS.dialColors,line.manual.dialColor))&&
     comparable(x.braceletColor||'')===comparable(line.manual.braceletColor||'')))
 const allocated=useMemo(()=>{
   const bySku=new Map<string,number>()
   for(const line of lines.filter(x=>x.kind==='stock')){
     const key=stockKey(line.source,line.watchVariantId)
     bySku.set(key,(bySku.get(key)||0)+Math.max(0,line.quantity))
   }
   return bySku
 },[lines])
 const addExisting=(choice:WatchOrderChoice,kind:'stock'|'preorder',selectedSource:WatchSource)=>{
   const available=sourceAvailable(choice,selectedSource)
   if(kind==='stock'&&(allocated.get(stockKey(selectedSource,choice.watchVariantId))||0)>=available)return
   const item:DraftLine={
     id:crypto.randomUUID(),kind,watchVariantId:choice.watchVariantId,
     catalogVariantId:choice.catalogVariantId,source:selectedSource,quantity:1,
     unitPrice:choice.catalogPriceSnapshot===null||choice.catalogPriceSnapshot===undefined?'':String(choice.catalogPriceSnapshot),
     engravingText:'',
     manual:{modelName:choice.modelName,gender:choice.gender,movement:choice.movement,
       braceletMaterial:choice.braceletMaterial,dialColor:choice.dialColor,braceletColor:choice.braceletColor||''},
   }
   setLines(current=>current.length>=20?current:[...current,item])
 }
 const lineTotal=(line:DraftLine)=>line.unitPrice.trim()!==''?line.quantity*Number(line.unitPrice):0
 const total=lines.reduce((sum,line)=>sum+(Number.isFinite(lineTotal(line))?lineTotal(line):0),0)
 const received=payments.reduce((sum,row)=>sum+(Number(row.amount)||0),0)
 const debt=Math.max(0,total-received)
 const paymentMethod=payments.find(x=>Number(x.amount)>0)?.method||payments[0]?.method||paymentMethods[0]||'KASPI GOLD'
 const validLines=lines.length>0&&lines.length<=20&&lines.every((line,i)=>{
   const attrsValid=line.kind!=='manual'
     ?line.watchVariantId>0&&line.catalogVariantId>0&&Boolean(matches[i])
     :Boolean(line.manual.modelName.trim()&&line.manual.movement.trim()&&
       line.manual.braceletMaterial.trim()&&line.manual.dialColor.trim()&&
       (canonical(WATCH_OPTIONS.braceletMaterials,line.manual.braceletMaterial)!=='leather'||
         line.manual.braceletColor.trim()))
   return attrsValid&&Number.isSafeInteger(line.quantity)&&line.quantity>=1&&line.quantity<=1000&&
     line.unitPrice.trim()!==''&&Number.isSafeInteger(Number(line.unitPrice))&&
     Number(line.unitPrice)>=0&&Number(line.unitPrice)<=1000000000&&line.engravingText.length<=500
 })&&lines.every(line=>line.kind!=='stock'||Boolean(scoped.find(x=>x.watchVariantId===line.watchVariantId&&
   sourceAvailable(x,line.source)>=(allocated.get(stockKey(line.source,line.watchVariantId))||0))))
 const validPayments=payments.length>=1&&payments.length<=8&&payments.every((row,index)=>
   paymentMethods.includes(row.method)&&row.amount.trim()!==''&&
   Number.isSafeInteger(Number(row.amount))&&Number(row.amount)>=(index===0?0:1))
 const canSave=Boolean(brand&&allowedBrands.includes(brand as WatchBrand)&&validLines&&
   Number.isSafeInteger(total)&&Number.isSafeInteger(received)&&received<=total&&
   validPayments&&(!isAdmin||staff.some(x=>x.id===managerId))&&
   recipientName.trim()&&recipientPhone.trim()&&city.trim()&&address.trim()&&postalCode.trim()&&
   deliveryMethod.trim()&&shippingDeadlineLocal&&/^\d{4}-\d{2}-\d{2}$/.test(orderDate)&&orderDate<=businessToday()&&!busy)
 const reset=()=>{
   setBrand('');setSource('office');setLines([]);setManagerId(0)
   setPayments([{method:paymentMethods[0]||'KASPI GOLD',amount:'0'}])
   setRecipientName('');setRecipientPhone('');setCity('');setOtherCity(false);setAddress('');setPostalCode('')
   setDeliveryMethod(deliveryMethods[0]||'');setShippingDeadlineLocal('');setUrgent(false);setOrderDate(businessToday())
   setError('');requestRef.current=null
 }
 const submit=async(event:FormEvent<HTMLFormElement>)=>{
   event.preventDefault();setError('')
   if(!brand||!canSave){setError('Выберите бренд, заполните товары, данные клиента и оплаты.');return}
   try{
     const selected=lines.map(line=>({
       watchVariantId:line.kind==='manual'?0:line.watchVariantId,
       ...(line.kind==='manual'?{}:{catalogVariantId:line.catalogVariantId}),
       orderMode:line.kind,
       quantity:line.quantity,unitPrice:Number(line.unitPrice),source:line.source,
       engravingText:line.engravingText.trim(),
       ...(line.kind==='manual'?{manual:{
         modelName:line.manual.modelName.trim().replace(/\s+/g,' '),
         gender:line.manual.gender,
         movement:canonical(WATCH_OPTIONS.movements,line.manual.movement),
         braceletMaterial:canonical(WATCH_OPTIONS.braceletMaterials,line.manual.braceletMaterial),
         dialColor:canonical(WATCH_OPTIONS.dialColors,line.manual.dialColor),
         braceletColor:line.manual.braceletColor.trim(),
       }}:{}),
     }))
     const first=selected[0]
     const base=validateWatchOrderInput({
       brand,source:first.source,recipientName,recipientPhone,city,address,postalCode,
       deliveryMethod,shippingDeadlineLocal,urgent,paymentMethod,
     })
     const payload={
       ...base,orderDate,shippingDeadlineLocal,items:selected,
       watchVariantId:first.watchVariantId,catalogVariantId:first.catalogVariantId||0,
       quantity:first.quantity,unitPrice:first.unitPrice,engravingText:first.engravingText,
       catalogPriceSnapshot:matches[0]?.catalogPriceSnapshot??null,
       receivedAmount:received,payments:payments.filter(x=>Number(x.amount)>0)
         .map(x=>({method:x.method,amount:Number(x.amount)})),
       ...(isAdmin?{managerId}:{}),
     }
     const fingerprint=JSON.stringify(payload)
     if(requestRef.current?.fingerprint!==fingerprint)
       requestRef.current={fingerprint,requestId:'watch-'+crypto.randomUUID()}
     setBusy(true)
     await onSave({...payload,requestId:requestRef.current!.requestId})
   }catch(e){setError(e instanceof Error?e.message:'Не удалось сохранить заказ.')}
   finally{setBusy(false)}
 }
 return <form className="main-watch-create card wide sector-orders" id="create"
   onSubmit={event=>void submit(event)}>
   <div className="create-hero">
     <div><div className="card-label">Новый заказ</div>
       <div className="card-meta">Введите товар и характеристики. Наличие на складе не ограничивает регистрацию заказа.</div></div>
     <div className="orders-workspace-kpis create-kpis">
       <div><span>Товаров</span><strong>{lines.reduce((n,x)=>n+(Number.isFinite(x.quantity)?Math.max(0,x.quantity):0),0)}</strong></div>
       <div><span>Оплат</span><strong>{payments.filter(x=>Number(x.amount)>0).length}</strong></div>
       <div><span>Долг</span><strong>{debt.toLocaleString('ru-RU')} ₸</strong></div>
     </div>
   </div>
   <section className="order-step-card">
     <div className="order-step-head"><div className="order-step-index">1</div>
       <div><h3>Клиент и условия заказа</h3>
         <p>Выберите бренд. Контакты, доставка и крайний срок передаются логистике.</p></div>
     </div>
     <div className="main-watch-create-grid">
       <label>Бренд *
         <select required value={brand} onChange={e=>{
           setBrand(e.target.value as WatchBrand);setSource('office');setLines([]);setManagerId(0);setError('')
         }}>
           <option value="">Выберите бренд</option>
           {allowedBrands.map(x=><option value={x} key={x}>{x}</option>)}
         </select>
       </label>
       <label>Дата заказа *
         <input required type="date" value={orderDate} max={businessToday()}
           onChange={e=>setOrderDate(e.target.value)}/>
         
       </label>
       <label>ФИО получателя *
         <input required maxLength={200} value={recipientName} autoComplete="name"
           onChange={e=>setRecipientName(e.target.value)}/>
       </label>
       <label>Телефон *
         <input required maxLength={50} type="tel" value={recipientPhone}
           onChange={e=>setRecipientPhone(e.target.value)} autoComplete="tel"/>
       </label>
       <label>Город *
         <select required value={otherCity?'__other__':city}
           onChange={e=>{
             const value=e.target.value
             setOtherCity(value==='__other__')
             setCity(value==='__other__'?'':value)
           }}>
           <option value="">Выберите город</option>
           {(references?.cities||[]).map(name=><option key={name} value={name}>{name}</option>)}
           <option value="__other__">ДРУГОЙ ГОРОД — ВВЕСТИ ВРУЧНУЮ</option>
         </select>
         {otherCity&&<input required maxLength={100} value={city}
           autoComplete="address-level2" placeholder="Введите город"
           onChange={e=>setCity(e.target.value.toLocaleUpperCase('ru-RU'))}/>}
       </label>
       <label>Доставка *
         <select required value={deliveryMethod}
           onChange={e=>setDeliveryMethod(e.target.value)}>
           {deliveryMethods.map(x=><option key={x} value={x}>{x.toLocaleUpperCase('ru-RU')}</option>)}
         </select>
       </label>
       <label>Индекс *
         <input required maxLength={20} value={postalCode} onChange={e=>setPostalCode(e.target.value)}/>
       </label>
       <label>Отправить до (Алматы) *
         <input required type="datetime-local" value={shippingDeadlineLocal}
           onChange={e=>setShippingDeadlineLocal(e.target.value)}/>
       </label>
       <label className="main-watch-create-wide">Адрес *
         <textarea required rows={2} maxLength={500} value={address}
           onChange={e=>setAddress(e.target.value)}/>
       </label>
       <label className="main-watch-create-urgent">
         <input type="checkbox" checked={urgent} onChange={e=>setUrgent(e.target.checked)}/>
         Срочный заказ
       </label>
     </div>
   </section>
   <section className="order-step-card" data-client3-product-workspace="source-first">
     <div className="order-step-head">
       <div className="order-step-index">2</div>
       <div><h3>Товары заказа</h3>
         <p>Выберите часы из остатков или оформите под заказ. Характеристики подставляются автоматически.</p>
       </div>
     </div>
     {!brand?<div className="main-watch-create-placeholder">Сначала выберите бренд. После этого откроется каталог выбранного бренда.</div>:
       <div className="watch-pick-layout">
         <WatchOrderSourcePicker brand={brand} source={source} onSourceChange={setSource}
           catalog={scoped} allocated={allocated} onAdd={addExisting}
           onManual={selectedSource=>setLines(all=>all.length>=20?all:[...all,newLine(selectedSource)])}/>
         <aside className="watch-pick-cart-shell" aria-label="Выбранные товары заказа">
           <div className="watch-pick-cart-title"><strong>Состав заказа</strong>
             <span>{lines.length} из 20 позиций</span></div>
           {!lines.length?<div className="watch-pick-cart-empty">Выберите комплектацию слева или добавьте товар вручную.</div>:
             <div className="watch-pick-cart">
               {lines.map((line,index)=>{
                 const chosen=matches[index]
                 const available=chosen?sourceAvailable(chosen,line.source):0
                 const quantityReserved=allocated.get(stockKey(line.source,line.watchVariantId))||0
                 const shortage=line.kind==='stock'&&quantityReserved>available
                 return <article className="watch-pick-cart-item" key={line.id}>
                   <div className="watch-pick-cart-row">
                     <div><span className={'order-kind'+(line.kind==='preorder'?' waiting':line.kind==='manual'?' custom':'')}>
                       {line.kind==='stock'?'Из наличия':line.kind==='preorder'?'Ожидание товара':'Ручной ввод'}</span>
                       <h4 style={{marginTop:8}}>{line.kind==='manual'
                         ?line.manual.modelName||'Новая модель':chosen?.modelName||'Комплектация недоступна'}</h4>
                       {line.kind!=='manual'&&chosen&&<p className="cart-sub">{watchLabels(chosen).join(' · ')}</p>}
                     </div>
                     <button type="button" className="cart-remove" title="Убрать позицию" aria-label="Убрать позицию"
                       onClick={()=>setLines(old=>old.filter(x=>x.id!==line.id))}>Удалить</button>
                   </div>
                   {line.kind==='manual'&&<div className="cart-manual">
                     <label className="wide">Название товара *
                       <SmartPickerInput value={line.manual.modelName} options={suggestions.models}
                         placeholder="Модель часов" onChange={value=>update(line.id,{manual:{...line.manual,modelName:value}})}/>
                     </label>
                     <label>Пол *
                       <select value={line.manual.gender}
                         onChange={e=>update(line.id,{manual:{...line.manual,gender:e.target.value as 'male'|'female'}})}>
                         {WATCH_OPTIONS.genders.map(x=><option key={x.value} value={x.value}>{x.label}</option>)}
                       </select>
                     </label>
                     <label>Механизм *
                       <SmartPickerInput value={readable(WATCH_OPTIONS.movements,line.manual.movement)}
                         options={suggestions.movements} placeholder="Кварцевый, механический…"
                         onChange={value=>update(line.id,{manual:{...line.manual,movement:canonical(WATCH_OPTIONS.movements,value)}})}/>
                     </label>
                     <label>Материал браслета *
                       <SmartPickerInput value={readable(WATCH_OPTIONS.braceletMaterials,line.manual.braceletMaterial)}
                         options={suggestions.bracelets} placeholder="Сталь, кожа, каучук…"
                         onChange={value=>{
                           const braceletMaterial=canonical(WATCH_OPTIONS.braceletMaterials,value)
                           update(line.id,{manual:{...line.manual,braceletMaterial,
                             braceletColor:braceletMaterial==='leather'?line.manual.braceletColor:''}})
                         }}/>
                     </label>
                     <label>Цвет циферблата *
                       <SmartPickerInput value={readable(WATCH_OPTIONS.dialColors,line.manual.dialColor)}
                         options={suggestions.dials} placeholder="Цвет"
                         onChange={value=>update(line.id,{manual:{...line.manual,dialColor:canonical(WATCH_OPTIONS.dialColors,value)}})}/>
                     </label>
                     {canonical(WATCH_OPTIONS.braceletMaterials,line.manual.braceletMaterial)==='leather'&&
                       <label className="wide">Цвет кожаного ремешка *
                         <SmartPickerInput value={line.manual.braceletColor}
                           options={suggestions.leatherColors} placeholder="Цвет ремешка"
                           onChange={value=>update(line.id,{manual:{...line.manual,braceletColor:value}})}/>
                       </label>}
                   </div>}
                   <div className="cart-edit-grid">
                     <label>Источник позиции *
                       <select value={line.source} onChange={e=>update(line.id,{source:e.target.value as WatchSource})}>
                         {WATCH_OPTIONS.sources.map(x=><option key={x.value} value={x.value}>{x.label}</option>)}
                       </select>
                     </label>
                     <label>Количество *
                       <input type="number" min={1} max={1000} required value={line.quantity}
                         onChange={e=>update(line.id,{quantity:Number(e.target.value)})}/>
                     </label>
                     <label>Каталожная цена
                       <output>{chosen?.catalogPriceSnapshot==null?'Не задана':
                         chosen.catalogPriceSnapshot.toLocaleString('ru-RU')+' ₸'}</output>
                     </label>
                     <label>Цена продажи, ₸ *
                       <input type="text" inputMode="numeric" pattern="[0-9]*" required
                         value={line.unitPrice} onChange={e=>{
                           if(/^\d{0,10}$/.test(e.target.value))update(line.id,{unitPrice:e.target.value})
                         }}/>
                     </label>
                     <label className="wide">Комментарий логисту / гравировка
                       <textarea rows={2} maxLength={500} value={line.engravingText}
                         onChange={e=>update(line.id,{engravingText:e.target.value})}
                         placeholder="Текст гравировки и пожелания клиента"/>
                     </label>
                   </div>
                   {line.kind==='stock'&&!shortage&&<p className="cart-status">Источник подтверждён: свободно {available} шт. До сохранения остаток может измениться.</p>}
                   {shortage&&<div className="watch-pick-confirm-warning">
                     Недостаточно свободных часов: доступно {available} шт. для {quantityReserved} шт. в этом заказе.
                     <button type="button" className="cart-availability-action" onClick={()=>update(line.id,{kind:'preorder'})}>
                       Оформить эту позицию под заказ
                     </button>
                   </div>}
                   {line.kind==='preorder'&&<p className="cart-status warning">Заказ будет оформлен без подтверждённого резерва, если нужных часов нет. Отправка возможна после поступления.</p>}
                   {line.kind==='manual'&&<p className="cart-status">Система проверит характеристики через резолвер: существующий SKU будет использован повторно, новую комплектацию зарегистрирует без фиктивного прихода.</p>}
                 </article>
               })}
             </div>}
           <div className="watch-pick-cart-total"><span>Сумма товаров</span>
             <strong>{total.toLocaleString('ru-RU')} ₸</strong></div>
           {lines.length>=20&&<p className="cart-status warning">Достигнут лимит в 20 позиций для одного заказа.</p>}
         </aside>
       </div>}
   </section>
   <section className="order-step-card">
     <div className="order-step-head"><div className="order-step-index">3</div>
       <div><h3>Менеджер и оплаты</h3><p>Можно принять несколько оплат разными способами.</p></div>
     </div>
     {isAdmin&&<div className="main-watch-create-grid">
       <label>Менеджер бренда *
         <select required value={managerId} onChange={e=>setManagerId(Number(e.target.value))}>
           <option value={0}>Выберите менеджера</option>
           {staff.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}
         </select>
       </label>
     </div>}
     {payments.map((row,index)=><div className="main-watch-create-item" key={index}>
       <div className="main-watch-create-item-head">
         <strong>Оплата {index+1}</strong>
         {index>0&&<button type="button" className="secondary compact"
           onClick={()=>setPayments(all=>all.filter((_,i)=>i!==index))}>Удалить</button>}
       </div>
       <div className="main-watch-create-grid">
         <label>Способ оплаты
           <select required value={row.method}
             onChange={e=>setPayments(all=>all.map((x,i)=>i===index?{...x,method:e.target.value}:x))}>
             {paymentMethods.map(x=><option value={x} key={x}>{x.toLocaleUpperCase('ru-RU')}</option>)}
           </select>
         </label>
         <label>Получено, ₸ *
           <input type="number" min={index===0?0:1} step={1} required
             value={row.amount}
             onChange={e=>setPayments(all=>all.map((x,i)=>i===index?{...x,amount:e.target.value}:x))}/>
         </label>
       </div>
     </div>)}
     <div className="actions">
       <button type="button" className="secondary" disabled={payments.length>=8}
         onClick={()=>setPayments(all=>[...all,{method:paymentMethods[0]||'KASPI GOLD',amount:''}])}>
         + Добавить оплату
       </button>
       <strong>Получено {received.toLocaleString('ru-RU')} ₸ · Долг {debt.toLocaleString('ru-RU')} ₸</strong>
     </div>
   </section>
   <section className="order-step-card">
     <div className="order-step-head"><div className="order-step-index">4</div>
       <div><h3>Проверка заказа</h3><p>Сверьте позиции и деньги перед сохранением.</p></div>
     </div>
     <div className="main-watch-create-review">
       <div className="main-watch-create-totals">
         <div><span>СУММА</span><strong>{total.toLocaleString('ru-RU')} ₸</strong></div>
         <div><span>ОПЛАЧЕНО</span><strong>{received.toLocaleString('ru-RU')} ₸</strong></div>
         <div><span>ДОЛГ</span><strong>{debt.toLocaleString('ru-RU')} ₸</strong></div>
         <div><span>ПОЗИЦИИ</span><strong>{lines.length}</strong></div>
       </div>
       <div className="main-watch-create-summary">
         <strong>Состав заказа · {brand||'Бренд не выбран'}</strong>
         {lines.map(line=>{
           const match=scoped.find(x=>x.watchVariantId===line.watchVariantId)
           return <div key={line.id}>
             <span>{line.kind==='manual'?line.manual.modelName||'Товар не указан':match?.modelName||'Комплектация недоступна'}
               · {line.kind==='manual'
                 ?[readable(WATCH_OPTIONS.movements,line.manual.movement),readable(WATCH_OPTIONS.braceletMaterials,line.manual.braceletMaterial),readable(WATCH_OPTIONS.dialColors,line.manual.dialColor)].join(' · ')
                 :match?watchLabels(match).join(' · '):''}
             </span>
             <b>{line.source==='office'?'Офис':'Витрина'} · ×{line.quantity} · {line.kind==='stock'?'Из наличия':'Под заказ'}</b>
           </div>
         })}
       </div>
       {!brand&&<p className="main-watch-create-validation">Выберите бренд.</p>}
       {received>total&&<p className="main-watch-create-validation">Оплата превышает сумму.</p>}
       {error&&<p className="main-watch-create-validation" role="alert">{error}</p>}
       <div className="actions order-create-actions form-bottom-actions">
         <button className="primary" type="submit" disabled={!canSave}>
           {busy?'Сохранение…':'Сохранить заказ'}
         </button>
         <button className="secondary" type="button" disabled={busy}
           onClick={()=>{if(window.confirm('Очистить введённые данные?'))reset()}}>
           Очистить
         </button>
       </div>
     </div>
   </section>
 </form>
}
