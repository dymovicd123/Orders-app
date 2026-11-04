import {useEffect,useRef,useState} from 'react'
import type {WatchBrand} from '../../../shared/client3/watch-domain'
import '../../styles/client3-watch-admin-delete-chain.css'

type Step={type:'return'|'exchange';id:number;order:number;reason:string;requiresManualReview:boolean}
type Progress={requestId:string;status:string;nextStep:number;totalSteps:number;lastError?:string}
type MainPreview={
 externalId:string;canAttemptDelete:boolean;canStartChain:boolean;
 canPreparePhysicalCorrection:boolean;requiresPhysicalFact:boolean;
 activeExchanges:number[];activeReturns:number[];issuedQuantity:number;
 paymentCount:number;receivedAmount:number;returnAmount:number;
 chainPlan:{snapshotFingerprint:string;steps:Step[];manualReviewRequired:boolean;
   blockers:string[];allOperationsAccountedFor:boolean};
 impact?:{saleAmount:number;debtAmount:number;paymentReversal:number;
   refundReversal:number;netMoneyReversal:number;truncated?:boolean};
 reasons:string[];explanations:string[]
}
type Compact={canDelete:boolean;expectedSnapshot:string;issuedItems:number;reasons:string[]}
const money=(n:number)=>Number(n||0).toLocaleString('ru-RU')+' ₸'
type Props={brand:WatchBrand;orderId:number;externalId:string;onDone:()=>void;onClose:()=>void}
const base=(orderId:number)=>'/api/client3/watches/orders/'+orderId
async function read<T extends {ok?:boolean;message?:string}>(url:string,options?:RequestInit):Promise<T>{
 const res=await fetch(url,{credentials:'include',cache:'no-store',...options})
 const json=await res.json() as T
 if(!res.ok||json.ok===false)throw Error(json.message||'Не удалось выполнить проверку Main.')
 return json
}

/** The Main deletion saga is a persistent, individually rechecked transaction
 * chain. A network retry reuses its server-side operation ID. No local SQL
 * reversion or direct writeoff is ever performed here. */
export function WatchAdminDeleteChainPanel({brand,orderId,externalId,onDone,onClose}:Props){
 const [preview,setPreview]=useState<MainPreview|null>(null)
 const [compact,setCompact]=useState<Compact|null>(null)
 const [progress,setProgress]=useState<Progress|null>(null)
 const [loading,setLoading]=useState(true)
 const [busy,setBusy]=useState(false)
 const [error,setError]=useState('')
 const [warning,setWarning]=useState('')
 const [reason,setReason]=useState('')
 const [ack,setAck]=useState(false)
 const [physical,setPhysical]=useState<''|'not_issued'|'issued'>('')
 const [reload,setReload]=useState(0)
 const request=useRef<string>('')
 const fetchPreview=async()=>{
  const d=await read<{ok:boolean;preview:Compact;mainPreview:MainPreview}>(
   base(orderId)+'/delete?brand='+encodeURIComponent(brand))
  setCompact(d.preview);setPreview(d.mainPreview)
 }
 useEffect(()=>{
  let alive=true
  setLoading(true);setError('');setWarning('')
  void (async()=>{
   try{
    const [d,chain]=await Promise.allSettled([
     read<{ok:boolean;preview:Compact;mainPreview:MainPreview}>(
       base(orderId)+'/delete?brand='+encodeURIComponent(brand)),
     read<{ok:boolean;progress:Progress|null}>(
       base(orderId)+'/delete-chain?brand='+encodeURIComponent(brand)),
    ])
    if(!alive)return
    if(d.status==='rejected')throw d.reason
    setPreview(d.value.mainPreview);setCompact(d.value.preview)
    if(chain.status==='fulfilled'){
      setProgress(chain.value.progress||null)
      if(chain.value.progress?.requestId)request.current=chain.value.progress.requestId
    }else{
      setWarning('Журнал цепочки Main пока недоступен: '+
        (chain.reason instanceof Error?chain.reason.message:'ошибка проверки')+
        '. Удаление со связанными операциями не разрешено.')
    }
   }catch(e){if(alive)setError(e instanceof Error?e.message:'Не удалось проверить последствия.')}
   finally{if(alive)setLoading(false)}
  })()
  return ()=>{alive=false}
 },[orderId,brand,reload])

 const direct=Boolean(preview?.canAttemptDelete&&compact?.canDelete&&!progress)
 const chained=Boolean(progress&&['planned','running','ready_for_final_delete'].includes(progress.status)
   ||preview?.canStartChain&&!warning&&!progress)
 const canCorrect=Boolean(preview?.canPreparePhysicalCorrection&&!progress&&physical==='not_issued')
 const snapshot=preview?.chainPlan?.snapshotFingerprint||''
 const finalAck=ack&&reason.trim().length>=5&&reason.trim().length<=500
 const post=(suffix:string,payload:Record<string,unknown>)=>read<{ok:boolean;
  message?:string;progress?:Progress;preview?:MainPreview}>(
   base(orderId)+suffix,{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({brand,...payload})})

 const confirmPhysical=async()=>{
  if(!canCorrect||!snapshot||busy)return
  setBusy(true);setError('')
  try{
   const data=await post('/delete-physical-confirm',{
    expectedSnapshot:snapshot,physicalOutcome:'not_issued',
   })
   setPhysical('');setAck(false)
   if(data.preview){setPreview(data.preview);setCompact(null)}
   // Also fetch the compact, brand-scoped fresh view.
   await fetchPreview()
   setWarning('Факт выдачи перепроверен. Перед удалением заново изучите последствия и подтвердите действие.')
   setReload(n=>n+1)
  }catch(e){setError(e instanceof Error?e.message:'Физическая сверка не выполнена.')}
  finally{setBusy(false)}
 }
 const execute=async()=>{
  if(!finalAck||busy||(!direct&&!chained))return
  setBusy(true);setError('');setWarning('')
  try{
   if(direct){
    if(!request.current)request.current='watch-delete-'+crypto.randomUUID()
    await post('/delete',{requestId:request.current,expectedSnapshot:snapshot,comment:reason.trim()})
    onDone();return
   }
   if(!request.current)request.current='watch-delete-chain-'+crypto.randomUUID()
   const id=progress?.requestId||request.current
   for(let n=0;n<125;n++){
    const res=await post('/delete-chain',{
      requestId:id,expectedSnapshot:snapshot,
    })
    if(!res.progress)throw Error('Сервер не вернул состояние цепочки. Повторите проверку.')
    setProgress(res.progress)
    if(res.progress.status==='completed'){onDone();return}
    if(!['planned','running','ready_for_final_delete'].includes(res.progress.status))
      throw Error(res.progress.lastError||'Цепочка остановлена Main для ручной проверки.')
   }
   throw Error('Цепочка требует продолжения. Выполненные шаги сохранены.')
  }catch(e){
   setError(e instanceof Error?e.message:'Удаление остановлено.')
   setReload(n=>n+1)
  }finally{setBusy(false)}
 }
 return <section className="watch-admin-delete-workspace" aria-label="Удаление заказа с последствиями Main">
  <header><div><strong>Удаление заказа {externalId}</strong>
   <p>Только администратор. Все зависимые операции проверяются и отменяются через ядро Main.</p></div>
   <button type="button" className="secondary compact" disabled={busy} onClick={onClose}>Назад к редактору</button>
  </header>
  {loading&&<p role="status">Получаю актуальные зависимости, финансы и склад…</p>}
  {warning&&<p className="watch-admin-delete-warning" role="status">{warning}</p>}
  {error&&<p role="alert" className="watch-orders-error">{error}</p>}
  {preview&&<div className="watch-admin-delete-content">
   <div className="watch-admin-delete-metrics">
    <div><small>Сумма заказа</small><strong>{money(preview.impact?.saleAmount||0)}</strong></div>
    <div><small>Долг</small><strong>{money(preview.impact?.debtAmount||0)}</strong></div>
    <div><small>Аннулирование оплат</small><strong>{money(preview.impact?.paymentReversal||0)}</strong></div>
    <div><small>Аннулирование возвратов</small><strong>{money(preview.impact?.refundReversal||0)}</strong></div>
    <div><small>Обменов / возвратов</small>
     <strong>{preview.activeExchanges.length} / {preview.activeReturns.length}</strong></div>
    <div><small>Учётная выдача</small><strong>{preview.issuedQuantity} шт.</strong></div>
   </div>
   {preview.explanations?.map((s,i)=><p key={i} className="watch-admin-delete-info">{s}</p>)}
   {preview.chainPlan?.steps?.length>0&&<section className="watch-admin-delete-steps">
    <strong>Порядок отмены операций</strong>
    <ol>{preview.chainPlan.steps.map(s=><li key={s.type+':'+s.id}>
     {s.type==='exchange'?'Обмен':'Возврат'} №{s.id} — {s.reason}
     {s.requiresManualReview&&<b> · требуется ручная проверка</b>}
    </li>)}</ol>
   </section>}
   {progress&&<p role="status" className="watch-admin-delete-progress">
    Цепочка Main: {progress.status} · выполнено {progress.nextStep} из {progress.totalSteps}
    {progress.lastError&&<span> · {progress.lastError}</span>}
   </p>}
   {preview.reasons?.length>0&&<div className="watch-admin-delete-blockers">
    <strong>Ограничения и расхождения</strong>
    {preview.reasons.map((s,i)=><p key={i}>{s}</p>)}
   </div>}
   {preview.requiresPhysicalFact&&!progress&&<div className="watch-admin-delete-fact">
    <strong>Передавались ли эти часы клиенту физически?</strong>
    <label><input type="radio" name="watch-admin-delete-physical" checked={physical==='issued'}
      disabled={busy} onChange={()=>setPhysical('issued')}/>Да, передавались — удаление не выполняется</label>
    <label><input type="radio" name="watch-admin-delete-physical" checked={physical==='not_issued'}
      disabled={busy} onChange={()=>setPhysical('not_issued')}/>Нет, не передавались — требуется сверка движений</label>
    {canCorrect&&<button type="button" className="secondary"
      disabled={busy} onClick={()=>void confirmPhysical()}>Перепроверить и исправить ошибочную выдачу</button>}
    {physical==='issued'&&<p>Используйте возврат и приёмку, а не удаление физически переданного товара.</p>}
   </div>}
   {(direct||chained)&&<div className="watch-admin-delete-confirm">
    <label>Причина аннулирования *<textarea rows={3} minLength={5} maxLength={500}
      disabled={busy} value={reason} onChange={e=>{setReason(e.target.value);setAck(false)}}
      placeholder="Причина для журнала операций"/></label>
    <label><input type="checkbox" disabled={busy} checked={ack}
      onChange={e=>setAck(e.target.checked)}/>
      Подтверждаю последствия для остатков, резерва, возвратов и денег. Это учётное сторно, не выдача денег клиенту.</label>
    <button className="primary" type="button" disabled={busy||!finalAck}
      onClick={()=>void execute()}>{busy?'Проверяю и выполняю шаги…':
      chained?'Отменить зависимые операции и удалить заказ':'Удалить ошибочный заказ'}</button>
   </div>}
   {!loading&&!direct&&!chained&&<p className="watch-admin-delete-blocked">
    Автоматическое удаление недоступно. Связанные данные не изменены; требуется разрешить ограничения выше.
   </p>}
  </div>}
 </section>
}
