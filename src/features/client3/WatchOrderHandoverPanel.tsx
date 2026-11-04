import {useEffect,useState} from 'react'
import {watchReferenceLabel,type WatchBrand} from '../../../shared/client3/watch-domain'
import '../../styles/188k3-safe-early-handover.css'
import '../../styles/client3-watch-handover-main-parity.css'

type HandoverItem={
 orderItemId:number;productName:string;itemDetails:string;source:'warehouse'|'boutique'
 quantity:number;state:string;reviewNeeded:boolean;reservationStatus:string
 checkpointId:number|null;checkpointAt:string|null;checkpointKind:'revision'|'check'|null
 reviewReason:string|null;physicalQuantity:number;totalReservedQuantity:number
 reviewedCheckpointAt?:string|null;reviewDecision?:string|null;itemCreatedAt?:string|null
}
type State={orderId:number;externalId:string;orderDate:string;items:HandoverItem[]}
type Result={ok:boolean;message?:string;state?:State;reviewCount?:number;decision?:string}
type Line={id:number;gender:string;movement:string;braceletMaterial:string;dialColor:string;braceletColor:string}
type Decision='issued_before_checkpoint'|'still_here'
async function call<T extends Result>(path:string,options?:RequestInit):Promise<T>{
 const response=await fetch(path,{credentials:'include',cache:'no-store',...options})
 const data=await response.json() as T
 if(!response.ok||!data.ok)throw Error(data.message||'Уточнение выдачи не выполнено.')
 return data
}
const details=(line:Line|undefined,raw:string)=>line?
 [line.gender==='male'?'Мужские':line.gender==='female'?'Женские':'',
  watchReferenceLabel('movements',line.movement),
  watchReferenceLabel('bracelets',line.braceletMaterial),
  watchReferenceLabel('dials',line.dialColor),
  line.braceletColor?'Ремешок: '+watchReferenceLabel('leatherColors',line.braceletColor):'',
 ].filter(Boolean).join(' · '):raw
const date=(value?:string|null)=>value?new Date(value).toLocaleString('ru-RU',{timeZone:'Asia/Almaty'}):'—'

/** The Main handover panel: two factual answers, one direct server mutation.
 * No intermediary input, checkbox, redundant confirmation or stock writeoff.
 * Main CAS verifies exact checkpoint and item before accepting each decision.
 */
export function WatchOrderHandoverPanel({brand,orderId,lines,onDone,onClose,onOpenStock}:{
 brand:WatchBrand;orderId:number;lines:Line[];onDone:()=>void;onClose:()=>void
 onOpenStock?:()=>void
}){
 const [data,setData]=useState<State|null>(null)
 const [busyItem,setBusyItem]=useState<number|null>(null)
 const [loading,setLoading]=useState(true)
 const [error,setError]=useState('')
 const [notice,setNotice]=useState('')
 const [version,setVersion]=useState(0)
 useEffect(()=>{
   const controller=new AbortController()
   setLoading(true);setError('')
   void call<Result>('/api/client3/watches/orders/'+orderId+
     '/stock-handover?brand='+encodeURIComponent(brand),{signal:controller.signal})
     .then(result=>{if(!controller.signal.aborted)setData(result.state||null)})
     .catch(reason=>{
       if(!controller.signal.aborted)
         setError(reason instanceof Error?reason.message:'Не удалось получить сведения о выдаче.')
     }).finally(()=>{if(!controller.signal.aborted)setLoading(false)})
   return ()=>controller.abort()
 },[brand,orderId,version])
 const decide=async(item:HandoverItem,action:Decision)=>{
   if(busyItem!==null||!item.checkpointId||!item.checkpointAt||
     item.reservationStatus!=='active')return
   setBusyItem(item.orderItemId);setError('');setNotice('')
   try{
     const result=await call<Result>('/api/client3/watches/orders/'+orderId+'/stock-handover',{
       method:'POST',headers:{'Content-Type':'application/json'},
       body:JSON.stringify({brand,action,orderItemId:item.orderItemId,
         checkpointId:item.checkpointId,checkpointAt:item.checkpointAt}),
     })
     setData(result.state||null)
     setNotice(result.message||'Решение сохранено. Остальные товары не изменены.')
     onDone()
     if(result.state&&!result.state.items.some(x=>x.reviewNeeded))onClose()
   }catch(cause){
     setError(cause instanceof Error?cause.message:'Не удалось подтвердить выдачу.')
     setVersion(v=>v+1)
   }finally{setBusyItem(null)}
 }
 const pending=(data?.items||[]).filter(x=>x.reviewNeeded)
 const completed=(data?.items||[]).filter(x=>!x.reviewNeeded&&x.reviewDecision)
 return <div className="modal-backdrop order-stock-handover-backdrop client3-handover-backdrop"
   role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget&&busyItem===null)onClose()}}>
   <section className="modal-card order-stock-handover-modal client3-main-handover"
     role="dialog" aria-modal="true" aria-label={'Уточнение выдачи · '+(data?.externalId||orderId)}>
     <header className="modal-head order-stock-handover-head">
       <div>
         <div className="card-label">Товары из офиса и витрины</div>
         <h3>{data?.externalId||'Заказ #'+orderId}</h3>
         {data?.orderDate&&<div className="order-stock-handover-context">
           <span>Заказ от {data.orderDate}</span>
         </div>}
         <p>Для заказа после ревизии уточните, где были часы в день проверки.
           Ответ касается только этих часов, не изменяет оплаты и не отмечает отправку.</p>
       </div>
       <button type="button" className="secondary compact" disabled={busyItem!==null}
         onClick={onClose}>Закрыть</button>
     </header>
     {loading&&<p className="order-stock-handover-loading">Проверяю состояние часов…</p>}
     {error&&<p className="client3-handover-error" role="alert">{error}
       <button type="button" className="secondary compact" onClick={()=>setVersion(v=>v+1)}>
         Обновить</button>
     </p>}
     {notice&&<p className="client3-handover-success" role="status">{notice}</p>}
     {!loading&&data&&<div className="order-stock-handover-list">
       {pending.map(item=>{
         const when=date(item.checkpointAt)
         const kind=item.checkpointKind==='revision'?'ревизии':'сверки'
         const canAnswer=item.reservationStatus==='active'
         return <article className={'order-stock-handover-item is-'+item.state} key={item.orderItemId}>
           <div className="order-stock-handover-item-main">
             <div><strong>{item.productName}</strong>
               <small>{details(lines.find(x=>x.id===item.orderItemId),item.itemDetails)}</small>
               <span>{item.source==='warehouse'?'Офис':'Витрина'} · {item.quantity} шт.</span>
             </div>
           </div>
           <div className="order-stock-handover-question">
             <strong>К моменту {kind} {when} часы уже были у клиента?</strong>
             <span>{item.reviewReason==='late_entry'
               ?'Заказ внесён задним числом после проверки.'
               :'После даты заказа была физическая проверка.'}</span>
             <span>Если уже выдали — резерв закроется без второго списания.
               Если часы оставались у вас — резерв сохранится до отправки.</span>
           </div>
           {canAnswer?
             <div className="order-stock-handover-choice-grid">
               <button type="button" className="secondary order-stock-handover-choice is-client"
                 disabled={busyItem!==null}
                 onClick={()=>void decide(item,'issued_before_checkpoint')}>
                 <strong>{busyItem===item.orderItemId?'Сохраняю…':'Да, выдали до проверки'}</strong>
                 <span>Закрыть резерв без повторного списания</span>
               </button>
               <button type="button" className="secondary order-stock-handover-choice is-here"
                 disabled={busyItem!==null}
                 onClick={()=>void decide(item,'still_here')}>
                 <strong>{busyItem===item.orderItemId?'Сохраняю…':'Нет, во время проверки были у нас'}</strong>
                 <span>Сохранить резерв для реальной отправки</span>
               </button>
             </div>:
             <div className="order-stock-handover-result is-attention">
               <strong>По учёту резерв не подтверждён</strong>
               <span>Сначала проверьте фактические остатки в разделе «Склад».
                 Подтверждение выдачи без сверки резерва недопустимо.</span>
               {onOpenStock&&<button type="button" className="primary compact"
                 onClick={onOpenStock}>Открыть склад для исправления количества</button>}
             </div>}
         </article>
       })}
       {completed.map(item=><article key={item.orderItemId}
         className="order-stock-handover-item is-already_issued">
         <div className="order-stock-handover-item-main"><div>
           <strong>{item.productName}</strong>
           <small>{details(lines.find(x=>x.id===item.orderItemId),item.itemDetails)}</small>
         </div></div>
         <div className="order-stock-handover-result is-done">
           <strong>{item.reviewDecision==='issued_before_checkpoint'
             ?'Выдано до ревизии':'На проверке оставались у нас'}</strong>
           <span>Решение уже сохранено. Повторно подтверждать не нужно.</span>
         </div>
       </article>)}
       {!pending.length&&!completed.length&&<p className="order-stock-handover-empty">
         Нет товаров, требующих уточнения.</p>}
     </div>}
   </section>
 </div>
}
