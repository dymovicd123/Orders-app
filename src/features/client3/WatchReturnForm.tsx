import {useEffect,useRef,useState,type FormEvent} from 'react'
import type {WatchBrand} from '../../../shared/client3/watch-domain'
import {WATCH_PAYMENTS,watchReferenceLabel} from '../../../shared/client3/watch-domain'
import '../../styles/194-return-smart-ux.css'
import '../../styles/client3-watch-return.css'

type Line={
 id:number;productName:string;quantity:number;returnableQuantity:number;returnedQuantity?:number;
 shipped:number;stockWriteoffStatus:string;
 source:string;gender:string;movement:string;braceletMaterial:string;
 dialColor:string;braceletColor:string;engravingText:string
}
type ReturnOrder={
 orderId:number;externalId:string;shippingStatus:string;lineCount:number;
 receivedAmount:number;returnAmount:number;itemLines:string
}
type PhysicalState='pending'|'warehouse'|'boutique'|'no_stock'
const money=(n:number)=>Number(n||0).toLocaleString('ru-RU')+' ₸'
function rows(raw:string):Line[]{
 try{const x=JSON.parse(raw||'[]') as Line[];return Array.isArray(x)?x.filter(y=>y.id>0&&y.quantity>0):[]}
 catch{return []}
}
export function WatchReturnForm({brand,order,onDone,onCancel}:{
 brand:WatchBrand;order:ReturnOrder;onDone:()=>void;onCancel:()=>void
}){
 const lines=rows(order.itemLines)
 const issued=(line:Line)=>Boolean(Number(line.shipped))||
   ['fulfilled','written_off','negative','retired_physically_issued'].includes(line.stockWriteoffStatus)
 const returnable=lines.filter(x=>issued(x)&&Number(x.returnableQuantity)>0)
 const maxRefund=Math.max(0,Number(order.receivedAmount)-Number(order.returnAmount))
 const [selected,setSelected]=useState<Record<number,number>>(
   Object.fromEntries(returnable.map(x=>[x.id,Number(x.returnableQuantity)])))
 const [physicalByItem,setPhysicalByItem]=useState<Record<number,PhysicalState>>({})
 const [amount,setAmount]=useState('0')
 const [returnDate,setReturnDate]=useState(()=>new Date(Date.now()+5*3600*1000).toISOString().slice(0,10))
 const [methods,setMethods]=useState<string[]>([...WATCH_PAYMENTS])
 const [refunds,setRefunds]=useState<Array<{method:string;amount:string}>>([
   {method:'KASPI GOLD',amount:'0'}])
 const [reason,setReason]=useState('')
 const [confirmed,setConfirmed]=useState(false)
 const [busy,setBusy]=useState(false)
 const [error,setError]=useState('')
 const key=useRef<{fingerprint:string;requestId:string}|null>(null)
 // Main infers the operation type from independent item and money decisions.
 // Never let an empty dropdown become an invalid "return type".
 const isItems=Object.values(selected).some(v=>Number(v)>0)
 const isMoney=Number(amount)>0
 const kind=isItems?(isMoney?'both':'items_only'):'money_only'
 useEffect(()=>{
   const ctrl=new AbortController()
   void fetch('/api/client3/watches/references',{credentials:'include',signal:ctrl.signal,cache:'no-store'})
     .then(async res=>{
       const body=await res.json() as {ok?:boolean;rows?:Array<{kind:string;value:string}>}
       const values=(body.rows||[]).filter(x=>x.kind==='paymentMethods').map(x=>x.value)
       if(!ctrl.signal.aborted&&res.ok&&body.ok&&values.length){
         setMethods(values)
         setRefunds(prev=>prev.map(x=>({...x,method:values.includes(x.method)?x.method:values[0]})))
       }
     }).catch(()=>{})
   return ()=>ctrl.abort()
 },[])
 const updateRefund=(index:number,change:Partial<{method:string;amount:string}>)=>{
   setRefunds(old=>old.map((x,i)=>i===index?{...x,...change}:x));setConfirmed(false)
 }
 const submit=async(e:FormEvent)=>{
   e.preventDefault()
   const items=returnable.filter(x=>Number(selected[x.id]||0)>0)
     .map(x=>({orderItemId:x.id,quantity:Number(selected[x.id]),
       physicalState:physicalByItem[x.id]||'pending',
       restock:physicalByItem[x.id]==='warehouse'||physicalByItem[x.id]==='boutique'})):[]
   const amountValue=Number(amount)
   const parts=amountValue>0?refunds.map(x=>({method:x.method,amount:Number(x.amount)})):[]
   if(busy||!confirmed||!reason.trim()||(!items.length&&amountValue<=0)||
      items.some(x=>!Number.isSafeInteger(x.quantity)||x.quantity<1||
        x.quantity>Number(returnable.find(v=>v.id===x.orderItemId)?.returnableQuantity))||
      (!Number.isSafeInteger(amountValue)||amountValue<0||amountValue>maxRefund||
        (amountValue>0&&
        parts.some(x=>!methods.includes(x.method)||!Number.isSafeInteger(x.amount)||x.amount<1)||
        parts.reduce((t,x)=>t+x.amount,0)!==amountValue))){
     setError('Проверьте позиции, количество, суммы по способам возврата и подтверждение.');return
   }
   const body={brand,kind,returnDate,quantity:items.reduce((t,x)=>t+x.quantity,0),items,
     amount:amountValue,paymentMethod:parts[0]?.method||'',refundParts:parts,
     reason:reason.trim()}
   const fingerprint=JSON.stringify([order.orderId,body])
   if(key.current?.fingerprint!==fingerprint)
     key.current={fingerprint,requestId:'watch-return-'+crypto.randomUUID()}
   setBusy(true);setError('')
   try{
     const res=await fetch('/api/client3/watches/orders/'+order.orderId+'/return',{
       method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},
       body:JSON.stringify({...body,requestId:key.current.requestId}),
     })
     const result=await res.json() as {ok?:boolean;message?:string}
     if(!res.ok||!result.ok)throw new Error(result.message||'Возврат не сохранён')
     key.current=null;onDone()
   }catch(cause){setError(cause instanceof Error?cause.message:'Возврат не оформлен')}
   finally{setBusy(false)}
 }
 const chosenQty=returnable.reduce((n,x)=>n+Math.max(0,Number(selected[x.id]||0)),0)
 if(!returnable.length&&maxRefund===0)return <section className="watch-return-form watch-return-exhausted">
   <div className="watch-return-main-header">
     <h3>{order.externalId} · возврат</h3>
     <p>Новых товаров для физического возврата и доступных денег больше нет.
       Проведённые операции остаются в истории возвратов, а заказ — в «Все заказы».
       Повторный возврат не будет создан.</p>
   </div>
   <div className="watch-return-items">
     {lines.map(line=><div className="return-smart-card is-unissued" key={line.id}>
       <div className="return-smart-pick">
         <span className="return-smart-main"><strong>{line.productName}</strong>
           <small>{Number(line.returnedQuantity||0)>0
             ?'Ранее возвращено: '+line.returnedQuantity+' шт.'
             :issued(line)?'Позиция уже полностью возвращена':'Клиенту не выдавали'}</small>
         </span>
       </div>
     </div>)}
   </div>
   <button className="secondary" type="button" onClick={onCancel}>К заказу</button>
 </section>
 return <form className="watch-return-form" onSubmit={e=>void submit(e)}>
   <header className="watch-return-main-header">
     <div><span className="watch-return-eyebrow">ВОЗВРАТ · ЗАКАЗ</span>
       <h3>{order.externalId}</h3>
       <p>Укажите возвращаемые позиции, деньги и физическое состояние часов — как в Main.</p></div>
     <div className="watch-return-main-balances">
       <div><small>Оплачено</small><strong>{money(order.receivedAmount)}</strong></div>
       <div><small>Уже возвращено</small><strong>{money(order.returnAmount)}</strong></div>
       <div><small>Доступно к возврату</small><strong>{money(maxRefund)}</strong></div>
     </div>
   </header>
   <div className="mini-item order-payment-card watch-return-main-parameters">
     <div className="mini-item-head"><strong>Параметры возврата</strong></div>
     <div className="subgrid order-payment-grid">
       <label><span>Дата возврата</span>
         <input type="date" required value={returnDate}
           onChange={e=>{setReturnDate(e.target.value);setConfirmed(false)}}/></label>
       <label><span>Сумма возврата, ₸</span>
         <input type="number" min={0} max={maxRefund} step={1}
           value={amount} onChange={e=>{
             const value=e.target.value
             setAmount(value)
             setRefunds(old=>old.length===1?[{...old[0],amount:value}]:old)
             setConfirmed(false)
           }}/>
         <small>Введите фактическую сумму самостоятельно. Ноль означает возврат только товаров.</small>
       </label>
       <div className="watch-return-main-kind">
         <small>Вид операции по выбранным данным</small>
         <strong>{isItems?(isMoney?'Товары и деньги':'Только товары'):
           isMoney?'Только деньги':'Выберите товары или укажите деньги'}</strong>
       </div>
     </div>
   </div>
   <div className="mini-item order-payment-card watch-return-items">
   <div className="watch-return-items-head">
       <div><strong>Возвращаемые часы · {chosenQty} шт.</strong>
         <p>Можно вернуть один товар, несколько позиций или только часть количества.</p></div>
       <div className="watch-return-selection-actions">
         <button type="button" className="secondary compact" onClick={()=>{
           setSelected(Object.fromEntries(returnable.map(x=>[x.id,Number(x.returnableQuantity)])))
           setConfirmed(false)
         }}>Выбрать все</button>
         <button type="button" className="secondary compact" onClick={()=>{
           setSelected({});setConfirmed(false)
         }}>Снять выбор</button>
       </div>
     </div>
     <div className="return-smart-grid">
       {lines.map(line=>{
         const isIssued=issued(line)
         const available=isIssued&&Number(line.returnableQuantity)>0
         const selectedLine=available&&Number(selected[line.id]||0)>0
         const returned=Math.max(0,Number(line.returnedQuantity||0))
         const arrived=(physicalByItem[line.id]||'pending')!=='pending'
         return <div key={line.id} className={'watch-return-item-row return-smart-card'+
           (selectedLine?' is-selected':'')+(!available?' is-unissued':'')}>
           <button type="button" className="watch-return-select return-smart-pick"
             disabled={!available||busy} onClick={()=>{
               setSelected(previous=>({...previous,
                 [line.id]:selectedLine?0:Number(line.returnableQuantity)}))
               setConfirmed(false)
             }}>
             <span className="return-smart-check">{selectedLine?'✓':''}</span>
             <span className="return-smart-main">
               <strong>{line.productName}</strong>
               <small className="return-smart-characteristics">
                 {[
                   line.gender==='male'?'Мужские':line.gender==='female'?'Женские':'',
                   watchReferenceLabel('movements',line.movement),
                   watchReferenceLabel('bracelets',line.braceletMaterial),
                   watchReferenceLabel('dials',line.dialColor),
                   line.braceletColor?'Ремешок: '+watchReferenceLabel('leatherColors',line.braceletColor):'',
                 ].filter(Boolean).join(' · ')}
               </small>
               {line.engravingText&&<small>Гравировка: {line.engravingText}</small>}
               <small>{line.source==='boutique'?'Витрина':'Офис'} ·
                 доступно к возврату {available?line.returnableQuantity:0} шт.</small>
               {returned>0&&<small className="watch-return-prior">
                 Ранее возвращено: {returned} шт.</small>}
             </span>
             <b>{!isIssued?'Не выдавали':!available?'Уже возвращён':
               selectedLine?'Возвращаем':'Выбрать'}</b>
           </button>
           {!available&&<div className="return-smart-unissued">
             <strong>{!isIssued?'Эти часы остаются у вас':'Возврат этой позиции уже оформлен'}</strong>
             <span>{!isIssued
               ?'Физически невыданные часы нельзя вернуть второй раз. Для отмены продажи измените состав заказа.'
               :'Все доступные к возврату штуки этой позиции уже учтены. История сохранена.'}</span>
           </div>}
           {selectedLine&&<div className="watch-return-line-controls return-smart-controls">
             {Number(line.returnableQuantity)>1
               ?<div className="watch-return-quantity return-smart-quantity">
                 <span>Сколько возвращается</span>
                 <div className="watch-return-quantity-controls">
                   <button type="button" disabled={busy||Number(selected[line.id])<=1}
                     onClick={()=>{setSelected(v=>({...v,[line.id]:Math.max(1,Number(v[line.id])-1)}));setConfirmed(false)}}>−</button>
                   <input type="number" min={1} max={line.returnableQuantity} step={1}
                     value={selected[line.id]||1} aria-label={'Количество возврата: '+line.productName}
                     onChange={e=>{
                       const quantity=Math.min(line.returnableQuantity,Math.max(1,Number(e.target.value)||1))
                       setSelected(v=>({...v,[line.id]:quantity}));setConfirmed(false)
                     }}/>
                   <button type="button" disabled={busy||Number(selected[line.id])>=line.returnableQuantity}
                     onClick={()=>{setSelected(v=>({...v,[line.id]:Math.min(line.returnableQuantity,Number(v[line.id])+1)}));setConfirmed(false)}}>+</button>
                   <button type="button" className="return-smart-all"
                     onClick={()=>{setSelected(v=>({...v,[line.id]:line.returnableQuantity}));setConfirmed(false)}}>
                     Все {line.returnableQuantity}
                   </button>
                 </div>
               </div>
               :<div className="return-smart-one-unit">Возвращается 1 шт.</div>}
             <div className="watch-return-physical-choice return-smart-physical">
               <span>Где часы сейчас?</span>
               <div className="return-smart-choice-row">
                 <button type="button" className={!arrived?'is-active':''}
                   onClick={()=>{setPhysicalByItem(v=>({...v,[line.id]:'pending'}));setConfirmed(false)}}>
                   Ещё едет обратно
                 </button>
                 <button type="button" className={arrived?'is-active':''}
                   onClick={()=>{setPhysicalByItem(v=>({...v,[line.id]:
                     line.source==='boutique'?'boutique':'warehouse'}));setConfirmed(false)}}>
                   Уже вернули
                 </button>
               </div>
               {arrived?<label><span>Куда принять</span>
                 <select value={physicalByItem[line.id]||'warehouse'}
                   onChange={e=>{
                     setPhysicalByItem(v=>({...v,[line.id]:e.target.value as PhysicalState}))
                     setConfirmed(false)
                   }}>
                   <option value="warehouse">Офис</option>
                   <option value="boutique">Витрина</option>
                   <option value="no_stock">Не добавлять в остаток</option>
                 </select>
               </label>:<small>После оформления часы появятся в очереди физической приёмки.</small>}
             </div>
           </div>}
         </div>
       })}
     </div>
     {lines.some(line=>!issued(line))&&<p className="watch-return-physical-help">
       Есть невыданные товары. Они показаны в списке, но их физический возврат невозможен:
       клиент их не получал. При отмене невыданной позиции измените состав заказа.
     </p>}
   </div>
   {isMoney&&<>
     <div className="watch-return-split-payments">
       <strong>Как возвращаете деньги</strong>
       {refunds.map((part,index)=><div className="watch-return-pay-part" key={index}>
         <label>Способ {index+1}
           <select value={part.method} onChange={e=>updateRefund(index,{method:e.target.value})}>
             {methods.map(method=><option key={method} value={method}>{method}</option>)}
           </select></label>
         <label>Сумма, ₸
           <input type="number" min={1} step={1} required value={part.amount}
             onChange={e=>updateRefund(index,{amount:e.target.value})}/>
         </label>
         {refunds.length>1&&<button type="button" className="secondary"
           onClick={()=>{
             setRefunds(p=>p.filter((_,i)=>i!==index));setConfirmed(false)
           }}>Убрать</button>}
       </div>)}
       {refunds.length<3&&<button className="secondary" type="button"
         onClick={()=>{setRefunds(p=>[...p,{method:methods[0]||'',amount:''}]);setConfirmed(false)}}>
         + Ещё один способ оплаты
       </button>}
       <small>Суммы всех способов должны равняться {money(Number(amount)||0)}.
         Каждая часть учитывается отдельно.</small>
     </div>
   </>}
   <label>Причина
     <input required maxLength={300} value={reason}
       onChange={e=>{setReason(e.target.value);setConfirmed(false)}}/>
   </label>
   {isItems&&<p className="watch-return-physical-help">Товары в пути останутся в очереди приёмки. Для уже полученных часов Main зафиксирует выбранный физический статус сразу при оформлении возврата.</p>}
   <label className="watch-return-confirm"><input type="checkbox" checked={confirmed}
     onChange={e=>setConfirmed(e.target.checked)}/>
     Подтверждаю возврат {isItems?chosenQty+' шт.':''}
     {isMoney?' и '+money(Number(amount)||0):' без возврата денег'}
   </label>
   {error&&<p role="alert" className="watch-return-error">{error}</p>}
   <div className="watch-return-actions">
     <button type="submit" disabled={busy||!confirmed}>
       {busy?'Сохраняю…':'Оформить возврат'}</button>
     <button type="button" disabled={busy} onClick={onCancel}>Отмена</button>
   </div>
 </form>
}
