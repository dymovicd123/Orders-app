import {useEffect,useRef,useState} from 'react'
import {watchReferenceLabel,type WatchBrand} from '../../../shared/client3/watch-domain'
import {WatchExchangeCancelChainPanel} from './WatchExchangeCancelChainPanel'
import '../../styles/client3-watch-exchange-history.css'

type ExchangeLine={
 id:number;orderItemId:number|null;productName:string;modelName:string;quantity:number;
 gender:string;movement:string;braceletMaterial:string;dialColor:string;braceletColor:string;
 engravingText:string;physicalTracking:boolean;physicalReceivedAt:string|null;
 wasNotIssued:boolean;activeQuantity:number;shippedQuantity:number;
 returnedQuantity:number;pendingReturnQuantity:number
}
type ExchangeEntry={
 id:number;exchangeDate:string;isSetExchange:boolean;status:string;comment:string;
 cancellationComment:string|null;oldItems:ExchangeLine[];newItems:ExchangeLine[];
 financialAction:string;financialAmount:number;paymentMethod:string
}
type History={ok:boolean;exchanges:ExchangeEntry[];hasMore:boolean;message?:string}
const money=(n:number)=>Number(n||0).toLocaleString('ru-RU')+' ₸'
const attrs=(item:ExchangeLine)=>[
 item.gender==='male'?'Мужские':item.gender==='female'?'Женские':'',
 watchReferenceLabel('movements',item.movement),
 watchReferenceLabel('bracelets',item.braceletMaterial),
 watchReferenceLabel('dials',item.dialColor),
 item.braceletColor?'Ремешок: '+watchReferenceLabel('leatherColors',item.braceletColor):'',
].filter(Boolean).join(' · ')
const moneyState=(entry:ExchangeEntry)=>{
 const action=entry.financialAction
 return action==='extra_payment'?'Доплата: '+money(entry.financialAmount):
   action==='refund'?'Возврат денег: '+money(entry.financialAmount):
   'Без дополнительной денежной операции'
}

export function WatchExchangeHistoryPanel({brand,orderId,onClose,onDone}:{
 brand:WatchBrand;orderId:number;onClose:()=>void;onDone:()=>void
}){
 const [items,setItems]=useState<ExchangeEntry[]>([])
 const [hasMore,setHasMore]=useState(false)
 const [busy,setBusy]=useState(false)
 const [loading,setLoading]=useState(true)
 const [error,setError]=useState('')
 const [refresh,setRefresh]=useState(0)
 const [selected,setSelected]=useState<number|null>(null)
 const [reason,setReason]=useState('')
 const [confirmed,setConfirmed]=useState(false)
 const [showChain,setShowChain]=useState(false)
 const requests=useRef<Record<number,{fingerprint:string;requestId:string}>>({})
 useEffect(()=>{
   const ctrl=new AbortController()
   setLoading(true);setError('')
   void fetch('/api/client3/watches/orders/'+orderId+'/exchanges/history?brand='+encodeURIComponent(brand),{
     credentials:'include',cache:'no-store',signal:ctrl.signal,
   }).then(async response=>{
     const data=await response.json() as History
     if(!response.ok||!data.ok)throw new Error(data.message||'История обменов недоступна')
     if(!ctrl.signal.aborted){setItems(data.exchanges||[]);setHasMore(Boolean(data.hasMore))}
   }).catch(cause=>{if(!ctrl.signal.aborted)setError(cause instanceof Error?cause.message:'Не удалось загрузить обмены')})
     .finally(()=>{if(!ctrl.signal.aborted)setLoading(false)})
   return ()=>ctrl.abort()
 },[brand,orderId,refresh])
 const cancel=async(entry:ExchangeEntry)=>{
   if(busy||selected!==entry.id||!confirmed||reason.trim().length<8)return
   const fingerprint=JSON.stringify([brand,orderId,entry.id,reason.trim()])
   if(requests.current[entry.id]?.fingerprint!==fingerprint)
     requests.current[entry.id]={fingerprint,requestId:'watch-exchange-cancel-'+crypto.randomUUID()}
   setBusy(true);setError('')
   try{
     const response=await fetch('/api/client3/watches/orders/'+orderId+'/exchanges/'+entry.id+'/cancel',{
       method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},
       body:JSON.stringify({brand,requestId:requests.current[entry.id].requestId,reason:reason.trim()}),
     })
     const result=await response.json() as {ok:boolean;message?:string}
     if(!response.ok||!result.ok)throw new Error(result.message||'Отмена обмена не выполнена')
     delete requests.current[entry.id]
     setSelected(null);setReason('');setConfirmed(false)
     setRefresh(n=>n+1);onDone()
   }catch(cause){setError(cause instanceof Error?cause.message:'Обмен не отменён')}
   finally{setBusy(false)}
 }
 return <section className="watch-exchange-history" aria-label="История обменов заказа">
   <header className="watch-exchange-history-head">
     <div><h3>История обменов</h3><p>Используется история Main: старые и новые позиции, физическая приёмка и денежные действия.</p></div>
     <div className="watch-exchange-history-top-actions">
       {items.some(item=>item.status!=='cancelled')&&<button type="button"
         className="secondary compact" disabled={busy} onClick={()=>setShowChain(x=>!x)}>
         {showChain?'Скрыть отмену цепочки':'Отменить последний / все обмены'}
       </button>}
       <button type="button" className="secondary compact" disabled={busy} onClick={onClose}>Закрыть</button>
     </div>
   </header>
   {showChain&&<WatchExchangeCancelChainPanel brand={brand} orderId={orderId}
     onClose={()=>setShowChain(false)}
     onDone={()=>{setShowChain(false);setRefresh(n=>n+1);onDone()}}/>}
   {error&&<p role="alert" className="watch-exchange-history-error">{error}</p>}
   {loading?<p>Загружаю историю…</p>:items.length===0?<p>Обменов по заказу нет.</p>:<>
     <div className="watch-exchange-history-list">{items.map(entry=><article key={entry.id} className="watch-exchange-history-entry">
       <div className="watch-exchange-history-title">
         <div><strong>Обмен №{entry.id}</strong><small>{entry.exchangeDate} · {entry.isSetExchange?'Групповой обмен':'Обычный обмен'}</small></div>
         <span>{entry.status==='cancelled'?'Отменён':'Оформлен'}</span>
       </div>
       {entry.comment&&<p>{entry.comment}</p>}
       <div className="watch-exchange-history-columns">
         <div><h4>Исходные часы</h4>{entry.oldItems.map(line=><div className="watch-exchange-history-item" key={line.id}>
           <strong>{line.modelName||line.productName} · {line.quantity} шт.</strong>
           <small>{attrs(line)}</small>
           <small>{entry.status==='cancelled'?'Обмен отменён':
             line.wasNotIssued?'Не передавались клиенту':
             line.physicalTracking?
               (line.physicalReceivedAt?'Физически приняты':'Ожидается физический возврат'):
             'Физическая приёмка не требуется'}</small>
         </div>)}</div>
         <div><h4>Новые часы</h4>{entry.newItems.map(line=><div className="watch-exchange-history-item" key={line.id}>
           <strong>{line.modelName||line.productName} · {line.quantity} шт.</strong>
           <small>{attrs(line)}</small>
           {line.engravingText&&<small>Гравировка: {line.engravingText}</small>}
           <small>{entry.status==='cancelled'?'Замена отменена':
             Number(line.shippedQuantity||0)>0?
               ('Отправлено: '+line.shippedQuantity+' шт.'):'Ожидает отправки в логистике'}</small>
           {Number(line.returnedQuantity||0)>0&&<small>Позднее возвращено: {line.returnedQuantity} шт.</small>}
         </div>)}</div>
       </div>
       <p className="watch-exchange-history-finance">{moneyState(entry)}
         {entry.status==='cancelled'?' · операция отменена':''}</p>
       {entry.cancellationComment&&<small>Причина отмены: {entry.cancellationComment}</small>}
       {entry.status!=='cancelled'&&(selected===entry.id?
         <div className="watch-exchange-history-confirm">
           <p>Отмена изменит текущий состав продажи, резервы и денежные операции. Main откажет при зависимых возвратах, отправках или последующих обменах.</p>
           <label>Причина отмены<textarea rows={2} maxLength={500} value={reason}
             onChange={e=>{setReason(e.target.value);setConfirmed(false)}}/></label>
           <label className="watch-exchange-history-check"><input type="checkbox" checked={confirmed}
             onChange={e=>setConfirmed(e.target.checked)}/>Подтверждаю последствия отмены</label>
           <div><button type="button" disabled={busy||!confirmed||reason.trim().length<8}
             onClick={()=>void cancel(entry)}>{busy?'Проверяю…':'Подтвердить отмену'}</button>
             <button type="button" className="secondary" disabled={busy} onClick={()=>{
               setSelected(null);setConfirmed(false);setReason('')
             }}>Не отменять</button></div>
         </div>:
         <button type="button" className="secondary compact" disabled={busy}
           onClick={()=>{setSelected(entry.id);setReason('');setConfirmed(false)}}>Отменить этот обмен</button>)}
     </article>)}</div>
     {hasMore&&<p>Показаны последние 100 обменов. Для более старых операций потребуется отдельная загрузка истории.</p>}
   </>}
 </section>
}
