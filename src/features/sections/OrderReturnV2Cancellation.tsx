import {useEffect,useRef,useState} from 'react'

type Cancellation={
 postingId:number;returnId:number;refundAmount:number;
 hasSent:boolean;hasUnsent:boolean;available:boolean;reason:string
}
type Props={
 orderId:number;
 cancellation:Cancellation;
 formatMoney:(n:number)=>string;
 SmartPickerInput:any;
 paymentMethods:any[];
 onSaved:()=>void
}
export function OrderReturnV2Cancellation({
 orderId,cancellation,formatMoney,SmartPickerInput,paymentMethods,onSaved
}:Props){
 const [open,setOpen]=useState(false)
 const [reason,setReason]=useState('')
 const [shipped,setShipped]=useState(false)
 const [reserved,setReserved]=useState(false)
 const [cash,setCash]=useState(false)
 const [method,setMethod]=useState('')
 const [busy,setBusy]=useState(false)
 const [uncertain,setUncertain]=useState(false)
 const [error,setError]=useState('')
 const [finished,setFinished]=useState(false)
 const requestId=useRef('')
 const previous=useRef('')
 const key=`${orderId}:${cancellation.postingId}`
 useEffect(()=>{
   if(previous.current===key)return
   previous.current=key;requestId.current=''
   setOpen(false);setReason('');setShipped(false);setReserved(false)
   setCash(false);setMethod('');setBusy(false);setUncertain(false)
   setError('');setFinished(false)
 },[key])
 const locked=busy||uncertain||finished
 const saveLocked=busy||finished
 const edit=(callback:()=>void)=>{
   if(locked)return
   requestId.current=''
   setError('')
   callback()
 }
 async function save(){
   if(saveLocked||!cancellation.available)return
   if(!reason.trim()||reason.trim().length>300){
     setError('Укажите причину отмены до 300 символов.');return
   }
   if((cancellation.hasSent&&!shipped)||(cancellation.hasUnsent&&!reserved)){
     setError('Подтвердите отдельно статус отправленных и неотправленных товаров.');return
   }
   if(cancellation.refundAmount>0&&(!cash||!method.trim())){
     setError('До отмены деньги должны фактически вернуться магазину. Укажите способ поступления.');return
   }
   if(!requestId.current)requestId.current=`v2-cancel:${crypto.randomUUID()}`
   setBusy(true);setError('')
   let knownResponse=false
   try{
     const response=await fetch(`/api/orders/${orderId}/returns/v2/${cancellation.postingId}/cancel`,{
       method:'POST',credentials:'same-origin',
       headers:{'Content-Type':'application/json'},
       body:JSON.stringify({
         requestId:requestId.current,reason:reason.trim(),
         shippedGoodsUnreceivedConfirmed:cancellation.hasSent&&shipped,
         reservationsRestoreConfirmed:cancellation.hasUnsent&&reserved,
         refundRecoveredConfirmed:cancellation.refundAmount>0&&cash,
         recoveryMethod:cancellation.refundAmount>0?method:''
       })
     })
     const payload=await response.json()
     knownResponse=true
     if(!response.ok||payload.ok!==true||payload.cancelled!==true)
       throw new Error(String(payload.message||'Отмена не подтверждена.'))
     setFinished(true);setOpen(false);onSaved()
   }catch(e){
     setError(e instanceof Error?e.message:'Результат операции неизвестен.')
     // A lost response may have committed; retry with the SAME immutable ID.
     // A known 409 explicitly rejects the operation and permits correction.
     setUncertain(!knownResponse)
   }finally{setBusy(false)}
 }
 return <div className="mini-item order-payment-card">
   <div className="mini-item-head">
     <strong>Отмена проведённого возврата №{cancellation.returnId}</strong>
   </div>
   {finished?<div className="history-note" role="status">
      <strong>Отмена проведена.</strong>
      <span>Физический остаток не увеличен. Резерв восстановлен только там, где хватает свободного товара; подтверждённое поступление денег отражено отдельно.</span>
    </div>
   :!cancellation.available?<p className="field-hint">{cancellation.reason}</p>
   :<>
      <p className="field-hint">Допустима только отмена до физической приёмки. Сервер дополнительно проверяет кассу, склад и отсутствие последующих операций.</p>
      <button type="button" className="secondary compact" disabled={locked}
        onClick={()=>setOpen(v=>!v)}>{open?'Скрыть отмену':'Проверить отмену'}</button>
      {open?<div className="stack">
        <label><span>Причина отмены</span>
          <textarea rows={2} maxLength={300} value={reason} disabled={locked}
            onChange={e=>edit(()=>setReason(e.target.value))}/>
        </label>
        {cancellation.hasSent?<label>
          <input type="checkbox" checked={shipped} disabled={locked}
            onChange={e=>edit(()=>setShipped(e.target.checked))}/>
          Подтверждаю: отправленные товары ещё НЕ были приняты обратно магазином.
        </label>:null}
        {cancellation.hasUnsent?<label>
          <input type="checkbox" checked={reserved} disabled={locked}
            onChange={e=>edit(()=>setReserved(e.target.checked))}/>
          Подтверждаю: неотправленные товары физически находятся у нас. Резерв можно восстановить, только если есть свободный остаток.
        </label>:null}
        {cancellation.refundAmount>0?<>
          <label><input type="checkbox" checked={cash} disabled={locked}
            onChange={e=>edit(()=>setCash(e.target.checked))}/>
            Подтверждаю фактическое поступление {formatMoney(cancellation.refundAmount)} ₸ от клиента обратно магазину.
          </label>
          <label><span>Способ поступления денег</span>
            <SmartPickerInput value={method} options={paymentMethods||[]}
              disabled={locked} placeholder="Выберите фактический способ"
              onChange={(value:string)=>edit(()=>setMethod(value))}/>
          </label>
        </>:null}
        {error?<div className="history-note is-danger" role="alert">{error}</div>:null}
        {uncertain?<p className="field-hint">Ответ сервера не получен. Не создавайте новую отмену. Обновите историю и проверьте результат прежде чем повторять действие.</p>:null}
        <button type="button" className="secondary compact"
          disabled={saveLocked||!reason.trim()} onClick={()=>void save()}>
          {busy?'Проверка и отмена…':uncertain?'Проверить прежнюю отмену':'Подтвердить отмену возврата'}
        </button>
      </div>:null}
      {!open&&error?<div className="history-note is-danger" role="alert">{error}</div>:null}
   </>}
 </div>
}
