import {useEffect,useMemo,useRef,useState} from 'react'
import {OrderReturnV2Cancellation} from './OrderReturnV2Cancellation'
import {returnV2PreviewMode,type ReturnV2UiMode} from './returnV2UiMode'

type Line={
 orderItemId:number;productName:string;sourceType:string;
 proposedAction:'physical_return_pending'|'cancel_unshipped_reservation'|'cancel_unresolved_reservation'|'cancel_workshop_obligation'|'cancel_unreserved_obligation'|'needs_review';
 status:string;message:string;requiresReview:boolean;availableQuantity:number;
 selectedQuantity:number;soldUnitPrice:number;selectedSaleValue:number
}
type Preview={
 enabled:boolean;eligible:boolean;exclusive?:boolean;reason?:string|null;
 evidence:{orderVersion:string;lines:Line[]};
 finance:{currentSale:number;paidIn:number;paidOut:number;netHeld:number;
   maxRefund:number;customerDebt:number;customerOverpay:number};
 cancellation?:{postingId:number;returnId:number;refundAmount:number;
   hasSent:boolean;hasUnsent:boolean;available:boolean;reason:string}|null
}
type Props={
 order:{id:number;external_id:string}|null;
 formatMoney:(n:number)=>string;
 SmartPickerInput:any;paymentMethods:any[];
 onMode:(orderId:number,mode:ReturnV2UiMode)=>void;
 onSaved:()=>void;
 onBack:()=>void
}
type Intent='pending'|'warehouse'|'boutique'|'no_stock'

const labels:Record<Intent,string>={
 pending:'Ожидаем физическое получение',
 warehouse:'Уже получен — принять на склад',
 boutique:'Уже получен — принять в бутик',
 no_stock:'Уже получен — не добавлять в остатки'
}
const money=(n:unknown)=>Number.isFinite(Number(n))?Math.max(0,Math.trunc(Number(n))):0
async function loadJson(res:Response){
 const payload=await res.json().catch(()=>({ok:false,message:'Сервер вернул некорректный ответ.'}))
 if(!res.ok||payload.ok===false&&!payload.contractPosted)
   throw new Error(String(payload.message||'Операция не проведена. Обновите форму.'))
 return payload
}
export function OrderReturnV2Flow({
 order,formatMoney,SmartPickerInput,paymentMethods,onMode,onSaved,onBack
}:Props){
 const orderId=Number(order?.id||0)
 const [preview,setPreview]=useState<Preview|null>(null)
 const [fetching,setFetching]=useState(false)
 const [eligible,setEligible]=useState(false)
 const [viewMode,setViewMode]=useState<ReturnV2UiMode>('checking')
 const [error,setError]=useState('')
 const [selections,setSelections]=useState<Record<number,number>>({})
 const [intents,setIntents]=useState<Record<number,Intent>>({})
 const [refundAmount,setRefundAmount]=useState(0)
 const [manualRefund,setManualRefund]=useState(false)
 const [refundMethod,setRefundMethod]=useState('')
 const [busy,setBusy]=useState(false)
 const [committed,setCommitted]=useState<any|null>(null)
 const [unknownResult,setUnknownResult]=useState(false)
 const requestRef=useRef('')
 const loadedOrderRef=useRef(0)
 const lines=preview?.evidence.lines||[]
 const reviewCount=lines.filter(line=>line.requiresReview).length
 const maxRefund=preview?.finance.maxRefund||0
 const selectedLines=useMemo(()=>lines.filter(line=>
   !line.requiresReview && money(selections[line.orderItemId])>0
 ).map(line=>({...line,selected:Math.min(money(selections[line.orderItemId]),line.availableQuantity)})),
 [lines,selections])
 const selectedSale=selectedLines.reduce((n,line)=>n+line.selected*line.soldUnitPrice,0)
 const finalSale=Math.max(0,(preview?.finance.currentSale||0)-selectedSale)
 const projectedHeld=(preview?.finance.netHeld||0)-refundAmount
 const projectedDebt=Math.max(0,finalSale-projectedHeld)
 const projectedOverpay=Math.max(0,projectedHeld-finalSale)
 const selectedQuantity=selectedLines.reduce((n,line)=>n+line.selected,0)
 const setQuantity=(id:number,qty:number)=>{
   setSelections(current=>({...current,[id]:qty}))
   requestRef.current=''
 }
 const setReceipt=(id:number,intent:Intent)=>{
   setIntents(current=>({...current,[id]:intent}))
   requestRef.current=''
 }
 const refresh=async(id:number,signal?:AbortSignal)=>{
   setFetching(true);setError('')
   if(!preview){
     setViewMode('checking')
     onMode(id,'checking')
   }
   try{
     const response=await fetch(`/api/orders/${id}/returns/v2/preview`,{
       credentials:'same-origin',cache:'no-store',signal
     })
     const body=await response.json()
     if(signal?.aborted||loadedOrderRef.current!==id)return
     const nextMode=returnV2PreviewMode(body,response.ok)
     if(nextMode==='error')throw new Error(String(body?.message||'Сервер не подтвердил режим Return V2. Операция остановлена.'))
     if(nextMode==='legacy'){
       // Legacy mode is permitted ONLY when the server explicitly reports
       // that Return V2 is disabled, never for an ineligible/malformed order.
       setPreview(null);setViewMode('legacy');setEligible(false)
       onMode(id,'legacy')
       return
     }
     const data=body as Preview
     setPreview(data)
     setViewMode('v2')
     setEligible(Boolean(data.eligible))
     // Every enabled order gets a visible version-aware result, including
     // review-only items. An unsafe fallback to V1 must never occur.
     onMode(id,'v2')
     const selected:Record<number,number>={}
     const receipt:Record<number,Intent>={}
     for(const item of data.evidence.lines){
       selected[item.orderItemId]=item.requiresReview?0:item.availableQuantity
       receipt[item.orderItemId]='pending'
     }
     setSelections(selected);setIntents(receipt)
     const sale=data.evidence.lines.reduce((n,item)=>
       n+(item.requiresReview?0:item.availableQuantity*item.soldUnitPrice),0)
     setRefundAmount(Math.min(sale,data.finance.maxRefund))
     setManualRefund(false);setRefundMethod('')
     requestRef.current=''
   }catch(e){
     if(signal?.aborted||loadedOrderRef.current!==id)return
     setError(e instanceof Error?e.message:'Проверка заказа недоступна.')
     setPreview(null);setViewMode('error');setEligible(false)
     // Failed previews must not silently expose a V1 write path.
     onMode(id,'error')
   }finally{
     if(loadedOrderRef.current===id&&!signal?.aborted)setFetching(false)
   }
 }
 useEffect(()=>{
   loadedOrderRef.current=orderId
   setCommitted(null);setUnknownResult(false);setPreview(null);setViewMode('checking')
   setEligible(false);setError('');setRefundMethod('');requestRef.current=''
   if(!orderId){onMode(0,'checking');return}
   const ac=new AbortController()
   void refresh(orderId,ac.signal)
   return ()=>ac.abort()
 },[orderId])
 useEffect(()=>{
   if(!manualRefund&&preview&&!committed)
     setRefundAmount(Math.min(selectedSale,maxRefund))
 },[selectedSale,maxRefund,manualRefund,preview,committed])
 async function submit(){
   if(!orderId||!preview||busy||committed)return
   if(!selectedLines.length||selectedQuantity===0){
     setError('Выберите хотя бы один подтверждённый товар.');return
   }
   if(!Number.isSafeInteger(refundAmount)||refundAmount<0||refundAmount>maxRefund){
     setError('Сумма возврата должна быть целой и не превышать полученные деньги.');return
   }
   if(refundAmount>0&&!refundMethod.trim()){
     setError('Выберите способ фактического возврата денег.');return
   }
   if(refundAmount===0&&refundMethod.trim()){
     setError('При нулевой выплате способ возврата не нужен.');return
   }
   if(!requestRef.current)requestRef.current=`v2-ui:${crypto.randomUUID()}`
   setBusy(true);setError('');setUnknownResult(false)
   try{
     const res=await fetch(`/api/orders/${orderId}/returns/v2`,{
       method:'POST',credentials:'same-origin',
       headers:{'Content-Type':'application/json'},
       body:JSON.stringify({
         requestId:requestRef.current,
         expectedOrderVersion:preview.evidence.orderVersion,
         items:selectedLines.map(line=>({
           orderItemId:line.orderItemId,quantity:line.selected,
           receiptIntent:line.proposedAction==='physical_return_pending'
             ?intents[line.orderItemId]||'pending':'pending'
         })),
         refundAmount,refundMethod
       })
     })
     const saved=await loadJson(res)
     if(saved.contractPosted===true){
       setCommitted(saved)
       onSaved()
     }else throw new Error('Подтверждение записи не получено. Повторите исходный запрос.')
   }catch(e){
     const msg=e instanceof Error?e.message:'Не удалось подтвердить сохранение.'
     setError(msg)
     // Retain this requestId. A network failure may occur after the D1
     // commit; another ID could create a second contract.
     // After a POST begins, any lost response may hide a committed Return.
     // Lock the exact payload until idempotent replay confirms the outcome.
     setUnknownResult(true)
   }finally{setBusy(false)}
 }
 if(!orderId||viewMode==='legacy')return null
 if(viewMode==='checking')return <section className="mini-panel debt-form-panel" aria-label="Проверка Return V2" aria-busy="true">
   <div className="mini-panel-head">
     <div><h3>Проверка товаров и остатков</h3>
       <p className="mini-panel-note">Проверяем фактическую отправку, резерв и деньги перед оформлением возврата.</p>
     </div>
     <button className="secondary compact" type="button" onClick={onBack}>Назад к заказам</button>
   </div>
 </section>
 if(viewMode==='error')return <section className="mini-panel debt-form-panel" aria-label="Ошибка проверки Return V2">
   <div className="mini-panel-head">
     <div><h3>Возврат · требуется проверка</h3>
       <p className="mini-panel-note">Новая форма не смогла проверить заказ. Старая форма не используется автоматически, чтобы не нарушить учёт.</p>
     </div>
     <button className="secondary compact" type="button" onClick={onBack}>Назад к заказам</button>
   </div>
   <div className="history-note is-danger" role="alert">
     <strong>Не удалось проверить заказ №{order?.external_id||orderId}</strong>
     <span>{error||'Проверьте соединение и повторите запрос.'}</span>
   </div>
   <button className="secondary compact" type="button" disabled={fetching}
     onClick={()=>void refresh(orderId)}>{fetching?'Проверяем…':'Повторить проверку'}</button>
 </section>
 return <section className="mini-panel debt-form-panel return-v2-panel" aria-label="Оформление возврата">
   <div className="mini-panel-head">
     <div>
       <h3>Возврат заказа №{order?.external_id||orderId}</h3>
       <p className="mini-panel-note">Товары для возврата уже выбраны. Проверьте список и сумму выплаты.</p>
     </div>
     <div className="mini-panel-actions">
       <button type="button" className="secondary compact" disabled={busy||Boolean(committed)||unknownResult||fetching}
         onClick={()=>void refresh(orderId)}>{fetching?'Проверяю…':'Обновить данные'}</button>
       <button type="button" className="secondary compact" onClick={onBack}>Назад к заказам</button>
     </div>
   </div>
   {!eligible?<div className="return-v2-notice" role="status">
      <strong>{lines.length===0?'Нет товаров для возврата':'Сейчас нельзя оформить выбранные товары'}</strong>
      <span>{preview?.reason||'По этим позициям нет достаточно надёжных данных для записи. Ни деньги, ни остатки не изменены.'}</span>
     </div>:reviewCount>0?<div className="return-v2-notice" role="status">
       <span>{reviewCount} {reviewCount===1?'позиция требует':'позиции требуют'} уточнения. Остальные товары можно оформить без ожидания.</span>
     </div>:null}
   {preview?<div className="return-v2-finance-overview">
      <div><span>Осталось в покупке</span><strong>{formatMoney(preview.finance.currentSale)} ₸</strong></div>
      <div><span>Уже оплачено (за вычетом выплат)</span><strong>{formatMoney(preview.finance.netHeld)} ₸</strong></div>
      <div><span>Долг клиента</span><strong>{formatMoney(preview.finance.customerDebt)} ₸</strong></div>
   </div>:null}
   <div className="return-v2-items-title">
      <strong>Товары</strong>
      <span>{lines.filter(line=>!line.requiresReview&&money(selections[line.orderItemId])>0).length} из {lines.length} выбрано</span>
   </div>
   <div className="return-smart-grid">
     {lines.map(line=>{
       const quantity=selections[line.orderItemId]||0
       const shipped=line.proposedAction==='physical_return_pending'
       const workshop=line.proposedAction==='cancel_workshop_obligation'
       const noReserve=line.proposedAction==='cancel_unreserved_obligation'
       const locked=busy||Boolean(committed)||unknownResult||!eligible
       return <div key={line.orderItemId}
          className={`return-smart-card ${quantity>0?'is-selected':''} ${shipped?'':'is-unissued'}`}>
         <button className="return-smart-pick" type="button" disabled={locked||line.requiresReview}
           onClick={()=>setQuantity(line.orderItemId,quantity>0?0:line.availableQuantity)}>
           <span className="return-smart-check">{quantity>0?'✓':''}</span>
           <span className="return-smart-main">
             <strong>{line.productName}</strong>
             <small>{line.status} · {line.sourceType==='boutique'?'Бутик':line.sourceType==='workshop'?'Цех':'Склад'}</small>
             <small>{line.availableQuantity} шт. · цена продажи {formatMoney(line.soldUnitPrice)} ₸/шт.</small>
           </span>
           <b>{line.requiresReview?'Проверить':quantity>0?'Выбран':'Добавить'}</b>
         </button>
         <div className="return-smart-controls">
           {line.requiresReview?<small className="field-hint">{line.message}</small>:null}
           {!line.requiresReview&&quantity>0?<>
             {line.availableQuantity>1?<label><span>Количество</span>
               <input type="number" min="0" max={line.availableQuantity} value={quantity} disabled={locked}
                 onChange={e=>setQuantity(line.orderItemId,Math.max(0,Math.min(line.availableQuantity,money(e.target.value))))}/>
             </label>:null}
             <strong className="return-v2-line-total">К возврату: {formatMoney(quantity*line.soldUnitPrice)} ₸</strong>
             {noReserve?<div className="return-smart-unissued">
               <strong>Не отправлен</strong>
               <span>Покупка отменится. Склад и резерв не изменятся.</span>
             </div>:workshop?<div className="return-smart-unissued">
               <strong>Цех · отказ клиента</strong>
               <span>Исключим из покупки. Задание, изделие и оплата цеху сохранятся.</span>
             </div>:shipped?<label><span>Физический статус возвращаемого товара</span>
               <select value={intents[line.orderItemId]||'pending'} disabled={locked}
                onChange={e=>setReceipt(line.orderItemId,e.target.value as Intent)}>
                {(Object.keys(labels) as Intent[]).map(k=><option key={k} value={k}>{labels[k]}</option>)}
               </select>
               <small>Приёмка добавит товар в остаток только после подтверждения его фактического получения.</small>
             </label>:<div className="return-smart-unissued">
               <strong>Не отправлен</strong>
               <span>Покупка отменится, резерв освободится. Физический остаток не изменится.</span>
             </div>}
           </>:null}
         </div>
       </div>
     })}
   </div>
   {eligible?<div className="mini-item order-payment-card">
      <div className="mini-item-head"><strong>Деньги и итог возврата</strong></div>
      <div className="subgrid order-payment-grid">
        <label><span>Фактически выплатить клиенту, ₸</span>
          <input type="number" min="0" step="1" max={maxRefund} value={refundAmount}
            disabled={busy||Boolean(committed)||unknownResult}
            onChange={e=>{
              setManualRefund(true);setRefundAmount(money(e.target.value));requestRef.current=''
            }}/>
          <small className="field-hint">Можно изменить, включая 0 ₸. Выплата не может превышать деньги, оставшиеся у магазина.</small>
        </label>
        <label><span>Способ выплаты</span>
          <SmartPickerInput value={refundMethod} options={paymentMethods||[]}
             disabled={busy||Boolean(committed)||unknownResult}
             onChange={(value:string)=>{
               if(busy||committed||unknownResult)return
               setRefundMethod(value);requestRef.current=''
             }}
             placeholder="Выберите способ только если выплачиваете деньги"/>
        </label>
      </div>
      <div className="return-smart-summary" role="status">
        <div><span>Исключаем из покупки</span><strong>{selectedQuantity} шт. · {formatMoney(selectedSale)} ₸</strong></div>
        <div><span>После возврата останется</span><strong>{formatMoney(finalSale)} ₸</strong></div>
        {projectedDebt>0?<div><span>Долг клиента после возврата</span><strong>{formatMoney(projectedDebt)} ₸</strong></div>:null}
        {projectedOverpay>0?<div><span>Переплата клиенту</span><strong>{formatMoney(projectedOverpay)} ₸</strong></div>:null}
      </div>
   </div>:null}
   {preview?.cancellation?<OrderReturnV2Cancellation
     key={`${orderId}:${preview.cancellation.postingId}`}
     orderId={orderId} cancellation={preview.cancellation}
     formatMoney={formatMoney} SmartPickerInput={SmartPickerInput}
     paymentMethods={paymentMethods} onSaved={onSaved}
   />:null}
   {error?<div className="history-note is-danger" role="alert"><strong>{error}</strong>
     {unknownResult?<span>Не создавайте новый запрос. Повторите прежнее сохранение с теми же параметрами.</span>:null}
   </div>:null}
   {committed?<div className="history-note" role="status">
      <strong>Возврат №{committed.returnId} проведён в историю заказа.</strong>
      <span>Деньги: {formatMoney(committed.cashRefund)} ₸. Осталась стоимость товаров: {formatMoney(committed.remainingSale)} ₸.</span>
      <span>{committed.receipt?.receiptPending
        ?'Есть товары, ожидающие физической приёмки. Проверьте очередь «Нужно принять» и складские подтверждения.'
        :'Физический статус выбранных товаров обработан.'}</span>
   </div>:null}
   <div className="actions order-create-actions form-bottom-actions">
      {!committed&&eligible?<button className="primary" type="button" disabled={busy||selectedQuantity===0}
         onClick={()=>void submit()}>{busy?'Сохраняю...':unknownResult?'Проверить прежнее сохранение':'Оформить возврат'}</button>:null}
   </div>
 </section>
}
