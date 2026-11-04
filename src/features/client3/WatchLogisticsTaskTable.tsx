import {useState} from 'react'
import {watchReferenceLabel,type WatchBrand} from '../../../shared/client3/watch-domain'
import {LinkedTableScroll} from '../../components/tables/LinkedTableScroll'
import {watchItemFullyIssued,watchItemReturnSummary,watchItemAwaitingReceipt} from './watchItemLifecycle'
import type {WatchLogisticsRow} from './WatchLogisticsPanel'
import '../../styles/client3-watch-workshop-parity.css'

type Group={order:WatchLogisticsRow;items:WatchLogisticsRow[]}
type Props={
 groups:Group[];filter:string;canCompleteEngraving:boolean;canDispatch:boolean;canCorrectDispatch:boolean
 workingReady:number|null;workingSend:number|null;checkingOrder:number|null;workingCorrection:number|null
 onReady:(orderId:number,itemId:number)=>void
 onSend:(order:WatchLogisticsRow,item:WatchLogisticsRow,quantity:number)=>void
 onCorrect:(order:WatchLogisticsRow,dispatchItemId:number,reason:string)=>Promise<void>
 onOpenReturns?:(brand:WatchBrand)=>void;onOpenStock?:(brand:WatchBrand)=>void
}
const watchDetails=(item:WatchLogisticsRow)=>[
 {label:'Пол',value:item.gender==='male'?'Мужские':item.gender==='female'?'Женские':''},
 {label:'Механизм',value:item.movement?watchReferenceLabel('movements',item.movement):''},
 {label:'Браслет',value:item.braceletMaterial?watchReferenceLabel('bracelets',item.braceletMaterial):''},
 {label:'Циферблат',value:item.dialColor?watchReferenceLabel('dials',item.dialColor):''},
 {label:'Ремешок',value:item.braceletColor?watchReferenceLabel('leatherColors',item.braceletColor):''},
].filter(x=>x.value)
const fmtDeadline=(raw:string)=>{
 const date=new Date(raw)
 return Number.isFinite(date.getTime())?
   date.toLocaleString('ru-RU',{timeZone:'Asia/Almaty',day:'2-digit',month:'2-digit',year:'numeric',
     hour:'2-digit',minute:'2-digit'}):'Не указан'
}
export const readyForSend=(item:WatchLogisticsRow)=>
 Boolean(item.orderItemId&&Number(item.quantity)>0&&
   !watchItemFullyIssued(item)&&Number(item.shippedQuantity||0)===0&&
   (!item.engravingText?.trim()||Boolean(item.engravingReady)))
export const requiresEngraving=(item:WatchLogisticsRow)=>
 Boolean(item.orderItemId&&Number(item.quantity)>0&&
  item.engravingText?.trim()&&!item.engravingReady&&!watchItemFullyIssued(item))
export const visibleLogisticsTasks=(groups:Group[],filter:string)=>groups.flatMap(group=>
 group.items.filter(item=>{
   if(!item.orderItemId)return false
   const active=Number(item.quantity)>0
   if(filter==='sent')return watchItemFullyIssued(item)||
     (!active&&Number(item.returnedQuantity||0)>0)
   if(filter==='unshipped'||filter==='pending')return active&&!watchItemFullyIssued(item)
   if(filter==='ready')return readyForSend(item)
   if(filter==='engraving')return requiresEngraving(item)
   return true
 }).map(item=>({order:group.order,item})))

/** Main WorkshopSection pattern: one product per row with customer,
 * deadline and direct per-item preparation/send. */
export function WatchLogisticsTaskTable({
 groups,filter,canCompleteEngraving,canDispatch,canCorrectDispatch,
 workingReady,workingSend,checkingOrder,workingCorrection,
 onReady,onSend,onCorrect,onOpenReturns,onOpenStock,
}:Props){
 const [quantities,setQuantities]=useState<Record<number,number>>({})
 const [correction,setCorrection]=useState<{orderId:number;dispatchId:number;reason:string}|null>(null)
 const tasks=visibleLogisticsTasks(groups,filter)
 const locked=workingReady!==null||workingSend!==null||checkingOrder!==null||workingCorrection!==null
 return <section className="watch-task-section" aria-label="Часы в логистике">
   <div className="workshop-list-head watch-task-head">
     <div><strong>Очередь часов</strong>
       <span>По одной позиции, как в Цехе Main. Готовность и отправка учитываются отдельно.</span>
     </div>
     <span className="watch-task-count">{tasks.length} позиций</span>
   </div>
   <LinkedTableScroll className="workshop-table-shell watch-task-scroll" ariaLabel="Очередь часов">
     <table className="data-table workshop-grid-table workshop-order-like-table watch-task-table">
       <thead><tr>
         <th>Заказ</th><th>Часы</th><th>Клиент</th><th>Приоритет</th><th>Действия</th>
       </tr></thead>
       <tbody>
         {tasks.map(({order,item})=>{
           const id=Number(item.orderItemId)
           const issued=watchItemFullyIssued(item)
           const historical=Number(item.quantity)<=0
           const engravingNeeded=requiresEngraving(item)
           const prepared=readyForSend(item)
           const waitingReceipt=watchItemAwaitingReceipt(item)
           const shortage=item.reservationStatus!=='active'||item.stockWriteoffStatus!=='reserved'
           const qty=Math.max(0,Number(item.quantity||0))
           const requested=quantities[id]??qty
           const sending=workingSend===order.orderId||checkingOrder===order.orderId
           const overdue=!issued&&Date.parse(order.shippingDeadlineAt)<Date.now()
           return <tr key={order.orderId+':'+id}
             className={'watch-task-row'+(Boolean(order.urgent)?' is-urgent':'')+
               (engravingNeeded?' needs-preparation':'')+(issued?' is-shipped':'')}>
             <td>
               <div className="order-cell-stack workshop-order-ref">
                 <strong>{order.externalId||'#'+order.orderId}</strong>
                 <small>{order.brand} · {order.legacySource==='boutique'?'Витрина':'Офис'}</small>
                 {order.orderDate&&<span>Заказ {order.orderDate}</span>}
                 {order.managerName&&<span>Менеджер: {order.managerName}</span>}
               </div>
             </td>
             <td><div className="workshop-product-card watch-task-product">
               <div className="workshop-product-title-row">
                 <strong>{item.modelName||'Модель не определена'}</strong>
                 <span className="workshop-qty-pill">{qty} шт.</span>
               </div>
               <div className="workshop-detail-grid">
                 {watchDetails(item).map(x=>
                   <span className="workshop-detail-chip" key={x.label}>
                     <small>{x.label}</small><b>{x.value}</b>
                   </span>)}
               </div>
               <div className="watch-task-engraving">
                 <small>Гравировка</small>
                 <strong>{item.engravingText?.trim()||'Не требуется'}</strong>
               </div>
               {watchItemReturnSummary(item)&&<small className="watch-task-return-note">
                 {watchItemReturnSummary(item)}</small>}
             </div></td>
             <td><div className="order-cell-stack watch-task-client">
               <strong>{order.recipientName||'—'}</strong>
               <span>{order.recipientPhone||'—'}</span>
               <span>{order.city||'—'} · {order.address||'Адрес не указан'}</span>
               {order.postalCode&&<small>Индекс: {order.postalCode}</small>}
               <small>Доставка: {order.deliveryMethod||'—'}</small>
             </div></td>
             <td><div className="workshop-special-stack watch-task-priority">
               <span className={order.urgent?'urgent-pill':'normal-pill'}>
                 {order.urgent?'Срочно':'Обычно'}</span>
               <span className={'watch-task-deadline'+(overdue?' is-overdue':'')}>
                 до {fmtDeadline(order.shippingDeadlineAt)}</span>
               <span className={'status-pill '+(issued?'status-online':
                 engravingNeeded?'status-warning':'status-info')}>
                 {historical?'История позиции':issued?'Отправлен':
                   engravingNeeded?'Гравировка не готова':'Готово к отправке'}</span>
               {waitingReceipt>0&&<span className="watch-task-intake">
                 Ожидаем приёмку: {waitingReceipt} шт.</span>}
             </div></td>
             <td><div className="workshop-actions table-actions-vertical watch-task-actions">
               {engravingNeeded&&canCompleteEngraving&&<button type="button"
                 className="primary compact watch-task-ready"
                 disabled={locked} onClick={()=>onReady(order.orderId,id)}>
                 {workingReady===id?'Сохраняю…':'Готово в логистике'}
               </button>}
               {prepared&&canDispatch&&<div className="watch-task-send-box">
                 {qty>1&&<label className="watch-task-qty">
                   <span>Отправить, шт.</span>
                   <input type="number" min={1} max={qty} step={1} disabled={locked}
                     value={requested} onChange={e=>setQuantities(old=>({
                       ...old,[id]:Number(e.target.value),
                     }))}/>
                 </label>}
                 <button type="button" className="primary compact watch-task-send"
                   disabled={locked||!Number.isSafeInteger(requested)||requested<1||requested>qty}
                   onClick={()=>onSend(order,item,requested)}>
                   {sending?'Проверяю…':'Отправить'+(qty>1?' '+requested+' шт.':'')}
                 </button>
                 {shortage&&<small className="watch-task-stock-hint">
                   {item.stockWriteoffStatus==='catalog_retired'?
                     'Товар удалён из каталога. Отправка без повторного списания после подтверждения передачи.':
                     'Резерв не подтверждён. Потребуется уточнить физический остаток.'}
                 </small>
               </div>}
               {issued&&<span className="status-pill status-online">Отправлено</span>}
               {!historical&&!issued&&!prepared&&!engravingNeeded&&<small className="watch-task-stock-hint">
                 Проверьте статус товара и складскую привязку.</small>}
               {!historical&&!issued&&shortage&&onOpenStock&&<button type="button" className="secondary compact"
                 onClick={()=>onOpenStock(order.brand)}>Проверить остаток</button>}
               {waitingReceipt>0&&onOpenReturns&&<button type="button" className="secondary compact"
                 onClick={()=>onOpenReturns(order.brand)}>Приёмка возврата</button>}
               {canCorrectDispatch&&item.dispatchItemId&&issued&&
                 <button type="button" className="secondary compact"
                   onClick={()=>setCorrection({orderId:order.orderId,
                     dispatchId:Number(item.dispatchItemId),reason:''})}>
                   Исправить отправку
                 </button>}
               {correction?.orderId===order.orderId&&
                 correction.dispatchId===item.dispatchItemId&&<div className="watch-task-correction">
                   <strong>Исправление отправки</strong>
                   <small>Только если отправку отметили ошибочно. Реальный возврат оформляется отдельно.</small>
                   <textarea rows={2} maxLength={500} value={correction.reason}
                     placeholder="Причина, от 8 символов"
                     onChange={e=>setCorrection(old=>old?{...old,reason:e.target.value}:null)}/>
                   <div className="watch-task-correction-buttons">
                     <button type="button" className="primary compact"
                       disabled={locked||correction.reason.trim().length<8}
                       onClick={()=>void onCorrect(order,correction.dispatchId,correction.reason)
                         .then(()=>setCorrection(null)).catch(()=>{})}>
                       Сохранить исправление
                     </button>
                     <button type="button" className="secondary compact" disabled={locked}
                       onClick={()=>setCorrection(null)}>Отмена</button>
                   </div>
                 </div>}
             </div></td>
           </tr>
         })}
         {!tasks.length&&<tr><td colSpan={5} className="empty-state">
           В выбранной очереди часов нет.</td></tr>}
       </tbody>
     </table>
   </LinkedTableScroll>
 </section>
}
