import {useEffect,useRef,useState,type FormEvent} from 'react'
import type {WatchBrand} from '../../../shared/client3/watch-domain'
import {WATCH_PAYMENTS,watchReferenceLabel} from '../../../shared/client3/watch-domain'
import '../../styles/194-return-smart-ux.css'
import '../../styles/client3-watch-return.css'

type Line={
 id:number;productName:string;quantity:number;returnableQuantity:number;shipped:number;stockWriteoffStatus:string;
 source:string;gender:string;movement:string;braceletMaterial:string;
 dialColor:string;braceletColor:string;engravingText:string
}
type ReturnOrder={
 orderId:number;externalId:string;shippingStatus:string;lineCount:number;
 receivedAmount:number;returnAmount:number;itemLines:string
}
type ReturnKind='money_only'|'items_only'|'both'
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
 const returnable=lines.filter(x=>(Number(x.shipped)>0||x.stockWriteoffStatus==='fulfilled')&&Number(x.returnableQuantity)>0)
 const maxRefund=Math.max(0,Number(order.receivedAmount)-Number(order.returnAmount))
 const [kind,setKind]=useState<ReturnKind>(returnable.length?(maxRefund?'both':'items_only'):'money_only')
 const [selected,setSelected]=useState<Record<number,number>>(
   Object.fromEntries(returnable.map(x=>[x.id,Number(x.returnableQuantity)])))
 const [physicalByItem,setPhysicalByItem]=useState<Record<number,PhysicalState>>({})
 const [amount,setAmount]=useState(String(maxRefund))
 const [methods,setMethods]=useState<string[]>([...WATCH_PAYMENTS])
 const [refunds,setRefunds]=useState<Array<{method:string;amount:string}>>([
   {method:'KASPI GOLD',amount:String(maxRefund)}])
 const [reason,setReason]=useState('')
 const [confirmed,setConfirmed]=useState(false)
 const [busy,setBusy]=useState(false)
 const [error,setError]=useState('')
 const key=useRef<{fingerprint:string;requestId:string}|null>(null)
 const isItems=kind!=='money_only',isMoney=kind!=='items_only'
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
   const items=isItems?returnable.filter(x=>Number(selected[x.id]||0)>0)
     .map(x=>({orderItemId:x.id,quantity:Number(selected[x.id]),
       physicalState:physicalByItem[x.id]||'pending',
       restock:physicalByItem[x.id]==='warehouse'||physicalByItem[x.id]==='boutique'})):[]
   const amountValue=isMoney?Number(amount):0
   const parts=isMoney?refunds.map(x=>({method:x.method,amount:Number(x.amount)})):[]
   if(busy||!confirmed||!reason.trim()||isItems&&!items.length||
      items.some(x=>!Number.isSafeInteger(x.quantity)||x.quantity<1||
        x.quantity>Number(returnable.find(v=>v.id===x.orderItemId)?.returnableQuantity))||
      isMoney&&(!Number.isSafeInteger(amountValue)||amountValue<1||amountValue>maxRefund||
        parts.some(x=>!methods.includes(x.method)||!Number.isSafeInteger(x.amount)||x.amount<1)||
        parts.reduce((t,x)=>t+x.amount,0)!==amountValue)){
     setError('Проверьте позиции, количество, суммы по способам возврата и подтверждение.');return
   }
   const body={brand,kind,quantity:items.reduce((t,x)=>t+x.quantity,0),items,
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
   <label>Вид возврата
     <select value={kind} onChange={e=>{setKind(e.target.value as ReturnKind);setConfirmed(false)}}>
       {maxRefund>0&&<option value="money_only">Только деньги</option>}
       {!!returnable.length&&<option value="items_only">Только товар</option>}
       {!!returnable.length&&maxRefund>0&&<option value="both">Товар и деньги</option>}
     </select>
   </label>
   {isItems&&<div className="watch-return-items">
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
     {returnable.map(line=><div key={line.id} className={'watch-return-item-row return-smart-card'+
       (Number(selected[line.id]||0)>0?' is-selected':'')}>
       <label className="watch-return-select return-smart-pick">
         <input type="checkbox" checked={Number(selected[line.id]||0)>0}
           onChange={e=>{
             setSelected(prev=>({...prev,[line.id]:e.target.checked?Number(line.returnableQuantity):0}))
             setConfirmed(false)
           }}/>
         <span className="return-smart-main"><strong>{line.productName}</strong>
           <small>{line.gender==='male'?'Мужские':'Женские'} · {watchReferenceLabel('movements',line.movement)} ·
             {watchReferenceLabel('bracelets',line.braceletMaterial)} · {watchReferenceLabel('dials',line.dialColor)}
             {line.braceletColor?' · '+watchReferenceLabel('leatherColors',line.braceletColor):''}</small>
           {line.engravingText&&<small>Гравировка: {line.engravingText}</small>}
           <small>Доступно к возврату: {line.returnableQuantity} шт.</small>
         </span>
       </label>
       <div className="watch-return-line-controls return-smart-controls">
         <label className="watch-return-quantity return-smart-quantity">
           <span>Вернуть, шт.</span>
           <input type="number" min={0} max={line.returnableQuantity} step={1}
             value={selected[line.id]??0} aria-label={'Количество возврата: '+line.productName}
             onChange={e=>{
               setSelected(prev=>({...prev,[line.id]:e.target.value===''?0:Number(e.target.value)}))
               setConfirmed(false)
             }}/>
         </label>
         {Number(selected[line.id]||0)>0&&<label className="watch-return-physical-choice return-smart-physical">
           <span>Где эти часы сейчас?</span>
           <select value={physicalByItem[line.id]||'pending'}
             onChange={e=>{
               setPhysicalByItem(prev=>({...prev,[line.id]:e.target.value as PhysicalState}))
               setConfirmed(false)
             }}>
             <option value="pending">У клиента / в пути — ещё не получили</option>
             <option value="warehouse">Уже получили в офис</option>
             <option value="boutique">Уже получили на витрину</option>
             <option value="no_stock">Уже получили, без добавления в остаток</option>
           </select>
         </label>}
       </div>
     </div>)}
     </div>
   </div>}
   {isMoney&&<>
     <label>Всего вернуть денег, ₸ (не более {money(maxRefund)})
       <input type="number" min={1} max={maxRefund} step={1} value={amount} required
         onChange={e=>{
           const v=e.target.value
           setAmount(v);setRefunds(p=>p.length===1?[{...p[0],amount:v}]:p)
           setConfirmed(false)
         }}/>
     </label>
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
