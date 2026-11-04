import {useEffect,useRef,useState,type FormEvent} from 'react'
import {SmartPickerInput} from '../../components/inputs/SmartPickerInput'
import {WATCH_OPTIONS,WATCH_PAYMENTS,type WatchBrand,type WatchGender,type WatchSource} from '../../../shared/client3/watch-domain'
import '../../styles/193-exchange-set-v2.css'
import '../../styles/client3-watch-exchange.css'
import '../../styles/client3-qa-exchange-parity-20261104.css'

type OldLine={id:number;productName:string;quantity:number;returnableQuantity:number;
 exchangeableQuantity:number;shippedQuantity:number;returnedQuantity:number;stockWriteoffStatus:string;
 unitPrice:number;lineTotal:number;catalogPriceSnapshot:number|null;shipped:number;
 source?:string;gender:string;movement:string;braceletMaterial:string;dialColor:string;braceletColor:string}
type Order={orderId:number;externalId:string;totalAmount:number;receivedAmount:number;
 returnAmount:number;commercialReturnedValue?:number;itemLines:string}
type NewLine={key:string;modelName:string;gender:WatchGender;movement:string;
 braceletMaterial:string;dialColor:string;braceletColor:string;source:WatchSource;
 quantity:string;unitPrice:string;engravingText:string;shipmentState:''|'pending'|'sent';issuePossessionConfirmed:boolean}
type Payment={key:string;method:string;amount:string}
type OldChoice={quantity:string;physicalState:''|'not_issued'|'pending'|'warehouse'|'boutique'|'no_stock'}
const blank=():NewLine=>({key:crypto.randomUUID(),modelName:'',gender:'male',
 movement:'quartz',braceletMaterial:'steel',dialColor:'black',braceletColor:'',
 source:'office',quantity:'1',unitPrice:'',engravingText:'',shipmentState:'',issuePossessionConfirmed:false})
const opt=(a:readonly {value:string;label:string}[],v:string)=>
 a.find(x=>x.value===v)?.label||v
const codeFor=(a:readonly {value:string;label:string}[],v:string)=>
 a.find(x=>x.label.toLocaleLowerCase('ru-RU')===v.trim().toLocaleLowerCase('ru-RU'))?.value||v.trim()
const parse=(v:string):OldLine[]=>{
 try{const x=JSON.parse(v||'[]') as OldLine[];return Array.isArray(x)?x.filter(y=>y.id>0&&y.quantity>0):[]}
 catch{return []}
}
const amount=(n:number)=>Number(n||0).toLocaleString('ru-RU')+' ₸'
export const watchExchangeQuantityForState=(line:OldLine,state:OldChoice['physicalState'])=>{
 const quantity=Math.max(0,Number(line.quantity||0))
 const returned=Math.max(0,Number(line.returnedQuantity||0))
 const shipped=Math.max(0,Number(line.shippedQuantity??(line.shipped?quantity:0)))
 const issued=line.stockWriteoffStatus==='fulfilled'?quantity:Math.min(quantity,shipped)
 if(state==='not_issued')return Math.max(0,quantity-issued)
 if(state==='')return Math.max(0,Number(line.exchangeableQuantity??(quantity-returned)))
 return Math.max(0,Math.min(Number(line.returnableQuantity||0),issued-returned))
}
export function WatchExchangeForm({brand,order,onDone,onCancel}:{
 brand:WatchBrand;order:Order;onDone:()=>void;onCancel:()=>void
}){
 const old=parse(order.itemLines).filter(x=>watchExchangeQuantityForState(x,'')>0)
 const [chosen,setChosen]=useState<Record<number,OldChoice>>({})
 const [newLines,setNewLines]=useState<NewLine[]>([blank()])
 const [methods,setMethods]=useState<string[]>([...WATCH_PAYMENTS])
 const [models,setModels]=useState<string[]>([])
 const [refs,setRefs]=useState<Record<string,string[]>>({})
 const [payments,setPayments]=useState<Payment[]>([])
 const [refunds,setRefunds]=useState<Payment[]>([])
 const [reason,setReason]=useState('')
 const [confirmed,setConfirmed]=useState(false)
 const [busy,setBusy]=useState(false)
 const [error,setError]=useState('')
 const request=useRef<{fingerprint:string;id:string}|null>(null)
 useEffect(()=>{
   const abort=new AbortController()
   void Promise.all([
     fetch('/api/client3/watches/references',{credentials:'include',signal:abort.signal}),
     fetch('/api/client3/watches/models?brand='+encodeURIComponent(brand),{
       credentials:'include',signal:abort.signal}),
   ]).then(async([a,b])=>{
     const x=await a.json() as {rows?:Array<{kind:string;value:string}>}
     const y=await b.json() as {models?:Array<{modelName:string}>}
     if(abort.signal.aborted)return
     const next:Record<string,string[]>={}
     for(const r of x.rows||[])(next[r.kind]??=[]).push(r.value)
     setRefs(next)
     if(next.paymentMethods?.length)setMethods(next.paymentMethods)
     setModels([...new Set((y.models||[]).map(m=>m.modelName))])
   }).catch(()=>{})
   return ()=>abort.abort()
 },[brand])
 const toggleOld=(line:OldLine)=>{
   const selected=Number(chosen[line.id]?.quantity||0)>0
   const physicalState:OldChoice['physicalState']=
     watchExchangeQuantityForState(line,'pending')>0?'pending':'not_issued'
   const quantity=selected?'0':'1'
   setChosen(current=>({...current,[line.id]:{quantity,
     physicalState:selected?'':physicalState}}))
   setConfirmed(false)
 }
 const choose=(id:number,update:Partial<OldChoice>)=>{
   setChosen(state=>({...state,[id]:{...(state[id]||{quantity:'0',physicalState:''}),...update}}))
   setConfirmed(false)
 }
 const update=(key:string,update:Partial<NewLine>)=>{
   setNewLines(rows=>rows.map(r=>r.key===key?{...r,...update}:r))
   setConfirmed(false)
 }
 const choiceRows=old.filter(x=>Number(chosen[x.id]?.quantity||0)>0)
 const removed=choiceRows.reduce((v,x)=>v+Number(chosen[x.id].quantity)*x.unitPrice,0)
 const added=newLines.reduce((v,x)=>v+(Number(x.quantity)||0)*(Number(x.unitPrice)||0),0)
 const finalTotal=order.totalAmount-removed+added
 const cashPaid=order.receivedAmount-order.returnAmount
 const noncashCredit=Math.max(0,Number(order.commercialReturnedValue||0))
 const netPaid=cashPaid+noncashCredit
 const due=Math.max(0,finalTotal-netPaid)
 const refundDue=Math.max(0,netPaid-finalTotal)
 const updatePay=(type:'payment'|'refund',key:string,patch:Partial<Payment>)=>{
   const setter=type==='payment'?setPayments:setRefunds
   setter(rows=>rows.map(r=>r.key===key?{...r,...patch}:r));setConfirmed(false)
 }
 const addPay=(type:'payment'|'refund')=>{
   const setter=type==='payment'?setPayments:setRefunds
   setter(rows=>rows.length>=2?rows:[...rows,{key:crypto.randomUUID(),
     method:methods[0]||'',amount:type==='refund'?String(refundDue):''}])
   setConfirmed(false)
 }
 const save=async(e:FormEvent)=>{
   e.preventDefault();if(busy)return
   if(!choiceRows.length||!newLines.length||newLines.length>20||
     choiceRows.some(x=>{
       const y=chosen[x.id];return !['pending','not_issued','warehouse','boutique','no_stock'].includes(y.physicalState)||
         !Number.isSafeInteger(Number(y.quantity))||Number(y.quantity)<1||
         Number(y.quantity)>watchExchangeQuantityForState(x,y.physicalState)
     })){
     setError('Выберите старые часы, количество и факт отправки каждой позиции.');return
   }
   const next=newLines.map(x=>({
     manual:{modelName:x.modelName.trim(),gender:x.gender,
       movement:codeFor(WATCH_OPTIONS.movements,x.movement),
       braceletMaterial:codeFor(WATCH_OPTIONS.braceletMaterials,x.braceletMaterial),
       dialColor:codeFor(WATCH_OPTIONS.dialColors,x.dialColor),
       braceletColor:x.braceletColor.trim()},
     quantity:Number(x.quantity),unitPrice:Number(x.unitPrice),
     source:x.source,engravingText:x.engravingText.trim(),
     shipmentState:x.shipmentState,issuePossessionConfirmed:x.issuePossessionConfirmed,
   }))
   if(next.some(x=>!x.manual.modelName||!x.manual.movement||
      !x.manual.braceletMaterial||!x.manual.dialColor||
      (x.manual.braceletMaterial==='leather'&&!x.manual.braceletColor)||
      !Number.isSafeInteger(x.quantity)||x.quantity<1||x.quantity>1000||
      !Number.isSafeInteger(x.unitPrice)||x.unitPrice<0||
      !['pending','sent'].includes(x.shipmentState)||
      (x.shipmentState==='sent'&&!x.issuePossessionConfirmed))){
     setError('Заполните характеристики, количество, цену и факт отправки новых часов.');return
   }
   const pay=payments.map(x=>({method:x.method,amount:Number(x.amount)}))
   const back=refunds.map(x=>({method:x.method,amount:Number(x.amount)}))
   if(!Number.isSafeInteger(finalTotal)||finalTotal<0||
     (refundDue>0&&!back.length)||(refundDue===0&&back.length>0)||
     (due===0&&pay.length>0)||
     pay.reduce((n,x)=>n+x.amount,0)>due||
     back.reduce((n,x)=>n+x.amount,0)!==refundDue||
     [...pay,...back].some(x=>!methods.includes(x.method)||
       !Number.isSafeInteger(x.amount)||x.amount<1)||
     !confirmed||!reason.trim()){
     setError('Суммы доплаты и возврата по способам не сходятся с итогом обмена.');return
   }
   const payload={
     brand,expectedOrderTotal:order.totalAmount,
     oldItems:choiceRows.map(x=>({
       orderItemId:x.id,quantity:Number(chosen[x.id].quantity),
       physicalState:chosen[x.id].physicalState,
       expectedActiveQuantity:x.quantity,expectedUnitPrice:x.unitPrice,
       expectedLineTotal:x.lineTotal,expectedCatalogPriceSnapshot:x.catalogPriceSnapshot,
     })),
     newItems:next,paymentParts:pay,refundParts:back,reason:reason.trim(),
   }
   const fingerprint=JSON.stringify(payload)
   if(request.current?.fingerprint!==fingerprint)
     request.current={fingerprint,id:'watch-exchange-set-'+crypto.randomUUID()}
   setBusy(true);setError('')
   try{
     const response=await fetch('/api/client3/watches/orders/'+order.orderId+'/exchange-set',{
       method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},
       body:JSON.stringify({...payload,requestId:request.current.id}),
     })
     const result=await response.json() as {ok?:boolean;message?:string}
     if(!response.ok||!result.ok)throw new Error(result.message||'Обмен не подтверждён.')
     onDone()
   }catch(cause){setError(cause instanceof Error?cause.message:'Обмен не сохранён.')}
   finally{setBusy(false)}
 }
 const suggestions=(options:readonly {value:string;label:string}[],key:string)=>
   [...new Set([...options.map(x=>x.label),...(refs[key]||[])])]
 const payEditor=(type:'payment'|'refund',parts:Payment[],target:number)=>(
   <div className="watch-exchange-payments">
     <strong>{type==='payment'?'Получаем доплату':'Возвращаем клиенту'} · {amount(target)}</strong>
     {parts.map(x=><div key={x.key} className="watch-exchange-pay-row">
       <label>Способ<select value={x.method}
         onChange={e=>updatePay(type,x.key,{method:e.target.value})}>
         {methods.map(m=><option key={m} value={m}>{m}</option>)}</select></label>
       <label>Сумма, ₸<input type="number" min={1} step={1} value={x.amount}
         onChange={e=>updatePay(type,x.key,{amount:e.target.value})}/></label>
       <button type="button" className="secondary"
         onClick={()=>{
           (type==='payment'?setPayments:setRefunds)(rows=>rows.filter(r=>r.key!==x.key))
           setConfirmed(false)
         }}>Убрать</button>
     </div>)}
     {parts.length<2&&<button className="secondary" type="button" onClick={()=>addPay(type)}>
       + Ещё один способ оплаты
     </button>}
     <small>{type==='payment'?'Доплату можно внести частично; остаток станет долгом.':
       'Вся сумма возврата должна быть распределена по способам.'}</small>
   </div>
 )
 return <form className="watch-exchange-form watch-exchange-set exchange-set-page" onSubmit={e=>void save(e)}>
   <header className="exchange-set-hero">
      <div><span className="exchange-set-kicker">ОБМЕН · ЗАКАЗ</span>
        <h2>{order.externalId}</h2>
        <p>Старые часы → новые часы → расчёт → подтверждение.</p></div>
      <div className="exchange-order-context">
        <div><small>Сумма заказа</small><strong>{amount(order.totalAmount)}</strong></div>
        <div><small>Оплачено деньгами</small><strong>{amount(cashPaid)}</strong></div>
        {noncashCredit>0&&<div><small>Зачёт возвращённых часов (не деньги)</small><strong>{amount(noncashCredit)}</strong></div>}
      </div>
   </header>
   <p className="exchange-workspace-note">Отметьте старые часы, добавьте новые позиции и подтвердите фактическую отправку. Денежные расчёты учитываются отдельно.</p>
   <section className="exchange-set-step watch-exchange-old-step">
     <div className="exchange-set-section-head">
       <div><span className="exchange-set-kicker">1 · Старые товары</span>
         <h3>Что убираем из заказа</h3>
         <p>Выберите товары из этого заказа и нужное количество.</p></div>
     </div>
     <div className="exchange-old-grid">
       {old.map(x=>{
         const selection=chosen[x.id]
         const selected=Number(selection?.quantity||0)>0
         const max=watchExchangeQuantityForState(x,selection?.physicalState||'')
         const returned=selected&&selection.physicalState!=='not_issued'&&selection.physicalState!=='pending'
         return <div key={x.id} className={'exchange-old-card'+(selected?' is-selected':'')}>
           <button type="button" className="exchange-old-pick" onClick={()=>toggleOld(x)}>
             <span className="exchange-check">{selected?'✓':''}</span>
             <span className="exchange-old-main"><strong>{x.productName}</strong>
               <small>{[x.gender==='male'?'Мужские':'Женские',
                 opt(WATCH_OPTIONS.movements,x.movement),
                 opt(WATCH_OPTIONS.braceletMaterials,x.braceletMaterial),
                 opt(WATCH_OPTIONS.dialColors,x.dialColor),x.braceletColor].filter(Boolean).join(' · ')}</small>
             </span>
             <span className="exchange-old-order-info">
               <strong>{x.quantity} шт.</strong><small>в заказе</small>
               <small>Можно обменять: {watchExchangeQuantityForState(x,'')} шт.</small>
               <em>Цена: {amount(x.unitPrice)} / шт.</em>
             </span>
           </button>
           {selected&&<div className="exchange-old-controls">
             {max>1?<div className="exchange-quantity-control">
               <span>Меняем</span>
               <button type="button" disabled={Number(selection.quantity)<=1}
                 onClick={()=>choose(x.id,{quantity:String(Math.max(1,Number(selection.quantity)-1))})}>−</button>
               <strong>{selection.quantity} из {max}</strong>
               <button type="button" disabled={Number(selection.quantity)>=max}
                 onClick={()=>choose(x.id,{quantity:String(Math.min(max,Number(selection.quantity)+1))})}>+</button>
             </div>:<span className="exchange-one-unit">Меняем 1 шт.</span>}
             {watchExchangeQuantityForState(x,'pending')===0?
               <div className="exchange-auto-state"><strong>Клиенту не выдавали</strong>
                 <span>Позицию уберём из заказа без фиктивной обратной приёмки.</span></div>:
               <div className="exchange-physical-choice">
                 <span>Часы уже вернулись?</span>
                 <div className="exchange-choice-row">
                   <button type="button" className={!returned?'is-active':''}
                     onClick={()=>choose(x.id,{physicalState:'pending'})}>Нет, ещё у клиента</button>
                   <button type="button" className={returned?'is-active':''}
                     onClick={()=>choose(x.id,{physicalState:x.source==='boutique'?'boutique':'warehouse'})}>
                     Да, уже у нас</button>
                 </div>
                 {returned?<label><span>Куда принять часы</span>
                   <select value={selection.physicalState} onChange={e=>choose(x.id,{physicalState:e.target.value as OldChoice['physicalState']})}>
                     <option value="warehouse">Офис</option>
                     <option value="boutique">Витрина</option>
                     <option value="no_stock">Не добавлять в остаток</option>
                   </select></label>:<small>После обмена часы появятся в очереди приёмки.</small>}
               </div>}
           </div>}
         </div>
       })}
       {old.length===0&&<p className="exchange-set-empty-inline">Нет часов, доступных к обмену.</p>}
     </div>
   </section>
   <section className="exchange-set-step watch-exchange-new-step">
     <div className="exchange-set-section-head"><div><span className="exchange-set-kicker">2 · Клиент получает</span>
       <h3>Что выдаём взамен</h3>
       <p>Добавьте часы, затем укажите их характеристики, количество и источник.</p></div></div>
     {newLines.map((x,index)=><div key={x.key} className="watch-exchange-new exchange-new-card">
       <div className="exchange-new-card-head"><div><span>Товар {index+1}</span><strong>{x.modelName||'Выберите часы'}</strong></div>
         <button className="secondary" type="button" disabled={newLines.length===1}
           onClick={()=>{setNewLines(v=>v.filter(r=>r.key!==x.key));setConfirmed(false)}}>Удалить</button>
       </div>
       <div className="exchange-new-primary-fields">
         <label><span>Товар</span><SmartPickerInput value={x.modelName} options={models}
           placeholder="Начните вводить название" onChange={v=>update(x.key,{modelName:v})}/></label>
         <label><span>Количество</span><input required type="number" min={1} max={1000} step={1}
           value={x.quantity} onChange={e=>update(x.key,{quantity:e.target.value})}/></label>
         <label><span>Откуда выдаём</span><select value={x.source}
           onChange={e=>update(x.key,{source:e.target.value as WatchSource})}>
           {WATCH_OPTIONS.sources.map(v=><option key={v.value} value={v.value}>{v.label}</option>)}
         </select></label>
       </div>
       {x.modelName.trim()?<>
       <div className="exchange-new-details"><span className="exchange-field-group-title">Характеристики</span>
       <div className="watch-exchange-new-grid exchange-new-fields">
         <label>Пол<select value={x.gender}
           onChange={e=>update(x.key,{gender:e.target.value as WatchGender})}>
           {WATCH_OPTIONS.genders.map(v=><option key={v.value} value={v.value}>{v.label}</option>)}
         </select></label>
         <label>Механизм<SmartPickerInput value={opt(WATCH_OPTIONS.movements,x.movement)}
           options={suggestions(WATCH_OPTIONS.movements,'movements')}
           onChange={v=>update(x.key,{movement:codeFor(WATCH_OPTIONS.movements,v)})}/></label>
         <label>Материал браслета<SmartPickerInput value={opt(WATCH_OPTIONS.braceletMaterials,x.braceletMaterial)}
           options={suggestions(WATCH_OPTIONS.braceletMaterials,'bracelets')}
           onChange={v=>update(x.key,{braceletMaterial:codeFor(WATCH_OPTIONS.braceletMaterials,v)})}/></label>
         <label>Цвет циферблата<SmartPickerInput value={opt(WATCH_OPTIONS.dialColors,x.dialColor)}
           options={suggestions(WATCH_OPTIONS.dialColors,'dials')}
           onChange={v=>update(x.key,{dialColor:codeFor(WATCH_OPTIONS.dialColors,v)})}/></label>
         {x.braceletMaterial==='leather'&&<label>Цвет ремешка
           <SmartPickerInput value={x.braceletColor} options={refs.leatherColors||[]}
             onChange={v=>update(x.key,{braceletColor:v})}/></label>}
         <label>Цена продажи за шт., ₸<input required type="number" min={0} step={1}
           value={x.unitPrice} onChange={e=>update(x.key,{unitPrice:e.target.value})}/></label>
         <label className="watch-exchange-wide">Гравировка<textarea rows={2} maxLength={500}
           value={x.engravingText} onChange={e=>update(x.key,{engravingText:e.target.value})}/></label>
       </div></div>
       <div className={'exchange-shipment-choice'+(!x.shipmentState?' needs-choice':'')}>
         <strong>Новые часы уже отправили клиенту?</strong>
         <div className="exchange-choice-row" role="group" aria-label="Фактическая отправка замены">
           <button type="button" aria-pressed={x.shipmentState==='sent'}
             className={x.shipmentState==='sent'?'is-active':''}
             onClick={()=>update(x.key,{shipmentState:'sent',issuePossessionConfirmed:false})}>Уже отправили</button>
           <button type="button" aria-pressed={x.shipmentState==='pending'}
             className={x.shipmentState==='pending'?'is-active':''}
             onClick={()=>update(x.key,{shipmentState:'pending',issuePossessionConfirmed:false})}>Ещё не отправили</button>
         </div>
         {x.shipmentState==='pending'&&<div className="exchange-shipment-warning" role="status">
           <strong>Не забудьте отметить отправку!</strong>
           <span>После передачи откройте «Отправить» в заказе и выберите готовые часы в логистике.</span>
         </div>}
       </div>
         {x.shipmentState==='sent'&&<label className="watch-exchange-wide watch-exchange-physical-verified">
           <input type="checkbox" checked={x.issuePossessionConfirmed}
             onChange={e=>update(x.key,{issuePossessionConfirmed:e.target.checked})}/>
           Подтверждаю фактическую передачу именно этих часов. Main зафиксирует физическую выдачу;
           если по учёту не хватает остатка, он не станет отрицательным.
         </label>}
       </>:<div className="exchange-new-hint">Сначала выберите модель — появятся характеристики и цена.</div>}
     </div>)}
     <button type="button" className="secondary" disabled={newLines.length>=20}
       onClick={()=>{setNewLines(v=>[...v,blank()]);setConfirmed(false)}}>+ Добавить часы</button>
   </section>
   <div className="watch-exchange-set-money exchange-settlement-card">
     <strong>Итог обмена: {amount(finalTotal)}</strong>
     <small>Уже оплачено за вычетом возвратов: {amount(netPaid)} ·
       {due>0?' к оплате '+amount(due):refundDue>0?' вернуть '+amount(refundDue):' рассчитано полностью'}</small>
     {due>0&&payEditor('payment',payments,due)}
     {refundDue>0&&payEditor('refund',refunds,refundDue)}
   </div>
   <label>Причина обмена<input maxLength={300} required value={reason}
     onChange={e=>{setReason(e.target.value);setConfirmed(false)}}/></label>
   <label className="watch-exchange-confirm"><input type="checkbox" checked={confirmed}
     onChange={e=>setConfirmed(e.target.checked)}/>
     Подтверждаю состав, физическое состояние старых часов и денежный расчёт</label>
   {error&&<p role="alert" className="watch-exchange-error">{error}</p>}
   <div className="watch-exchange-actions">
     <button type="submit" disabled={busy||!confirmed}>{busy?'Сохраняю…':'Оформить обмен'}</button>
     <button type="button" disabled={busy} onClick={onCancel}>Отмена</button>
   </div>
 </form>
}
