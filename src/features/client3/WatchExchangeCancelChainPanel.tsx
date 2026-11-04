import {useRef,useState} from 'react'
import type {WatchBrand} from '../../../shared/client3/watch-domain'

type Step={type:'return'|'exchange';id:number;order:number;reason:string;
 requiresManualReview:boolean}
type Mode='last'|'all'
type Plan={ok:boolean;message?:string;mode:Mode;availableExchangeIds:number[];
 selectedExchangeIds:number[];steps:Step[];signature:string;manualReviewRequired:boolean;
 canExecute:boolean;notice:string}
type Props={brand:WatchBrand;orderId:number;onDone:()=>void;onClose:()=>void}
const url=(orderId:number,brand:WatchBrand,mode:Mode)=>
 '/api/client3/watches/orders/'+orderId+'/exchanges/cancel-plan?'+
 new URLSearchParams({brand,mode})
async function getPlan(orderId:number,brand:WatchBrand,mode:Mode):Promise<Plan>{
 const res=await fetch(url(orderId,brand,mode),{credentials:'include',cache:'no-store'})
 const data=await res.json() as Plan
 if(!res.ok||!data.ok)throw Error(data.message||'Невозможно проверить обмены.')
 return data
}

/** Main parity: a fresh topological dependency graph is required immediately
 * before writes; Main's cancellation engine rechecks CAS at every step.
 * A failure stops the chain and preserves completed steps for safe reopening. */
export function WatchExchangeCancelChainPanel({brand,orderId,onDone,onClose}:Props){
 const [mode,setMode]=useState<Mode>('last')
 const [plan,setPlan]=useState<Plan|null>(null)
 const [loading,setLoading]=useState(false)
 const [busy,setBusy]=useState(false)
 const [error,setError]=useState('')
 const [reason,setReason]=useState('')
 const [ack,setAck]=useState(false)
 const [progress,setProgress]=useState({done:0,total:0})
 const requests=useRef<Record<string,string>>({})
 const choose=(next:Mode)=>{setMode(next);setPlan(null);setAck(false);setError('')}
 const load=async()=>{
  if(busy)return
  setLoading(true);setError('');setAck(false);setProgress({done:0,total:0})
  try{setPlan(await getPlan(orderId,brand,mode))}
  catch(e){setError(e instanceof Error?e.message:'Ошибка проверки обменов.')}
  finally{setLoading(false)}
 }
 const run=async()=>{
  if(!plan||!plan.canExecute||!plan.steps.length||!ack||reason.trim().length<8||busy)return
  setBusy(true);setError('')
  try{
   const fresh=await getPlan(orderId,brand,mode)
   if(!fresh.canExecute||fresh.signature!==plan.signature)
     throw Error('Связанные операции изменились. Заново откройте предпросмотр.')
   for(let i=0;i<fresh.steps.length;i++){
    const step=fresh.steps[i],key=step.type+':'+step.id
    if(!requests.current[key])requests.current[key]='watch-chain-'+crypto.randomUUID()
    const action='/api/client3/watches/orders/'+orderId+
      (step.type==='return'?'/returns/':'/exchanges/')+step.id+'/cancel'
    const res=await fetch(action,{method:'POST',credentials:'include',cache:'no-store',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({brand,requestId:requests.current[key],reason:reason.trim()})})
    const result=await res.json() as {ok?:boolean;message?:string}
    if(!res.ok||result.ok===false)
      throw Error('Шаг '+(i+1)+' из '+fresh.steps.length+': '+
        (result.message||'Отмена операции отклонена.')+
        '. Завершённые шаги сохранены. Откройте актуальную цепочку повторно.')
    setProgress({done:i+1,total:fresh.steps.length})
   }
   setPlan(null);setAck(false);onDone()
  }catch(e){
   setError(e instanceof Error?e.message:'Цепочка остановлена.')
   setPlan(null)
  }finally{setBusy(false)}
 }
 return <section className="watch-exchange-cancel-chain" aria-label="Отмена цепочки обменов Main">
  <header className="watch-return-history-head">
   <div><h3>Отмена обменов по правилам Main</h3>
    <p>Сначала анализ зависимостей, затем отмена возвратов и обменов в правильном порядке.
      Отправленные замены нельзя незаметно возвращать на склад.</p>
   </div>
   <button type="button" className="secondary compact" disabled={busy} onClick={onClose}>Закрыть проверку</button>
  </header>
  <div className="watch-exchange-chain-mode" role="group" aria-label="Диапазон отмены">
   <button type="button" className={mode==='last'?'primary':'secondary'} disabled={busy}
    onClick={()=>choose('last')}>Последний обмен</button>
   <button type="button" className={mode==='all'?'primary':'secondary'} disabled={busy}
    onClick={()=>choose('all')}>Все обмены</button>
   <button type="button" className="secondary" disabled={busy||loading}
    onClick={()=>void load()}>{loading?'Проверяю…':'Проверить цепочку'}</button>
  </div>
  {error&&<p className="watch-orders-error" role="alert">{error}</p>}
  {plan&&<div className="watch-exchange-chain-preview">
   <strong>{plan.notice}</strong>
   <p>Отменяемых обменов: {plan.selectedExchangeIds.length}.
    Зависимых действий: {plan.steps.length}.</p>
   <ol>{plan.steps.map(s=><li key={s.type+':'+s.id}>
     {s.type==='return'?'Возврат':'Обмен'} №{s.id} · {s.reason}
     {s.requiresManualReview&&<span> · требует отдельной проверки</span>}
   </li>)}</ol>
   {plan.canExecute&&plan.steps.length>0?<div className="watch-exchange-chain-confirm">
    <label>Причина отмены
     <textarea rows={2} maxLength={500} value={reason} disabled={busy}
      onChange={e=>{setReason(e.target.value);setAck(false)}}/></label>
    <label><input type="checkbox" checked={ack} disabled={busy}
      onChange={e=>setAck(e.target.checked)}/>
      Подтверждаю отмену связанных операций, финансовые и складские последствия</label>
    <button type="button" className="primary" disabled={busy||!ack||reason.trim().length<8}
      onClick={()=>void run()}>{busy?'Выполняется безопасная цепочка…':'Отменить выбранные обмены'}</button>
   </div>:<p role="status">Автоматическая отмена недоступна. Никакие операции не изменены.</p>}
  </div>}
  {progress.total>0&&<p role="status">Отменено: {progress.done} из {progress.total} операций.</p>}
 </section>
}
