import {useEffect,useState} from 'react'
import {watchReferenceLabel,type WatchBrand} from '../../../shared/client3/watch-domain'
import '../../styles/client3-watch-handover.css'

type HandoverItem={
 orderItemId:number;productName:string;itemDetails:string;source:'warehouse'|'boutique';
 quantity:number;state:string;reviewNeeded:boolean;reservationStatus:string;
 checkpointId:number|null;checkpointAt:string|null;checkpointKind:'revision'|'check'|null;
 reviewReason:string|null;physicalQuantity:number;totalReservedQuantity:number;
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
const label=(line:Line|undefined,raw:string)=>line?
 [line.gender==='male'?'Мужские':line.gender==='female'?'Женские':'',
  watchReferenceLabel('movements',line.movement),
  watchReferenceLabel('bracelets',line.braceletMaterial),
  watchReferenceLabel('dials',line.dialColor),
  line.braceletColor?'Ремешок: '+watchReferenceLabel('leatherColors',line.braceletColor):'',
 ].filter(Boolean).join(' · '):raw
export function WatchOrderHandoverPanel({brand,orderId,lines,onDone,onClose}:{
 brand:WatchBrand;orderId:number;lines:Line[];onDone:()=>void;onClose:()=>void
}){
 const [data,setData]=useState<State|null>(null)
 const [busy,setBusy]=useState(false)
 const [loading,setLoading]=useState(true)
 const [error,setError]=useState('')
 const [notice,setNotice]=useState('')
 const [choice,setChoice]=useState<{id:number;decision:Decision}|null>(null)
 const [checked,setChecked]=useState(false)
 const [version,setVersion]=useState(0)
 useEffect(()=>{
   const controller=new AbortController()
   setLoading(true);setError('')
   void call<Result>('/api/client3/watches/orders/'+orderId+
     '/stock-handover?brand='+encodeURIComponent(brand),{signal:controller.signal})
     .then(x=>{if(!controller.signal.aborted)setData(x.state||null)})
     .catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Не удалось получить сведения о выдаче.')})
     .finally(()=>{if(!controller.signal.aborted)setLoading(false)})
   return ()=>controller.abort()
 },[brand,orderId,version])
 const decide=async(item:HandoverItem,decision:Decision)=>{
   if(!checked||busy||!item.checkpointId||!item.checkpointAt)return
   setBusy(true);setError('');setNotice('')
   try{
     const result=await call<Result>('/api/client3/watches/orders/'+orderId+'/stock-handover',{
       method:'POST',headers:{'Content-Type':'application/json'},
       body:JSON.stringify({brand,action:decision,orderItemId:item.orderItemId,
         checkpointId:item.checkpointId,checkpointAt:item.checkpointAt}),
     })
     setData(result.state||null);setChoice(null);setChecked(false)
     setNotice(result.message||'Уточнение сохранено.');onDone()
   }catch(e){setError(e instanceof Error?e.message:'Не удалось подтвердить выдачу.')}
   finally{setBusy(false)}
 }
 const pending=(data?.items||[]).filter(x=>x.reviewNeeded)
 return <section className="client3-watch-handover" aria-label="Уточнение выдачи после ревизии">
   <div className="client3-watch-handover-title">
     <div><h3>Уточнение выдачи после ревизии</h3>
       <p>Как в основной системе: выясняем, находились ли часы в наличии на момент последней проверки. Не отмечаем отправку автоматически.</p>
     </div>
     <button type="button" className="secondary compact" onClick={onClose}>Закрыть</button>
   </div>
   {loading&&<p role="status">Проверяем последние ревизии и резервы…</p>}
   {error&&<p role="alert" className="stocktake-inline-notice w6-notice-error">{error}
     <button type="button" className="secondary compact" onClick={()=>setVersion(x=>x+1)}>Повторить</button>
   </p>}
   {notice&&<p role="status" className="stocktake-inline-notice">{notice}</p>}
   {!loading&&data&&pending.length===0&&<p className="client3-watch-handover-empty">
     Для этого заказа сейчас нет позиций, требующих уточнения после ревизии.
     Если физическая проверка ещё не завершена, вернитесь сюда после её завершения.
   </p>}
   {!loading&&pending.map(item=>{
     const current=choice?.id===item.orderItemId?choice.decision:null
     const itemLabel=label(lines.find(x=>x.id===item.orderItemId),item.itemDetails)
     return <article key={item.orderItemId} className="client3-watch-handover-item">
       <h4>{item.productName} · {item.quantity} шт.</h4>
       <p>{itemLabel} · {item.source==='warehouse'?'Офис':'Витрина'}</p>
       <p>Последняя {item.checkpointKind==='revision'?'ревизия':'сверка'}:
         {' '}{item.checkpointAt?new Date(item.checkpointAt).toLocaleString('ru-RU',{timeZone:'Asia/Almaty'}):'—'}.
         По системе {item.physicalQuantity}, резерв {item.totalReservedQuantity}.</p>
       {item.reservationStatus!=='active'&&<div className="client3-watch-handover-stock-warning" role="alert">
         <strong>Отправка заблокирована: резерв не подтверждён.</strong>
         <p>Заказ старше ревизии, но нужных часов нет в подтверждённом резерве.
         Сначала проверьте физический остаток в разделе «Склад» и восстановите резерв;
         затем вернитесь к уточнению. Нельзя подтверждать выдачу несуществующего резерва.</p>
       </div>}
       {item.reservationStatus==='active'&&<div className="client3-watch-handover-actions">
         <button type="button" className={current==='issued_before_checkpoint'?'primary':'secondary'}
           disabled={busy} onClick={()=>{setChoice({id:item.orderItemId,decision:'issued_before_checkpoint'});setChecked(false)}}>
           Уже выдали до проверки
         </button>
         <button type="button" className={current==='still_here'?'primary':'secondary'}
           disabled={busy} onClick={()=>{setChoice({id:item.orderItemId,decision:'still_here'});setChecked(false)}}>
           На момент проверки были у нас
         </button>
       </div>
       {current&&<div className="client3-watch-handover-confirm">
         <strong>{current==='issued_before_checkpoint'
           ?'Часы физически передали клиенту ДО последней ревизии?'
           :'Часы оставались у компании во время последней ревизии?'}</strong>
         <p>{current==='issued_before_checkpoint'
           ?'Закроем старый резерв без повторного списания физического остатка. Это не создаст запись отправки и не изменит оплату.'
           :'Оставим резерв активным. Вы сможете отправить часы позднее через «Логистику»; физический остаток и деньги не изменятся.'}</p>
         <label><input type="checkbox" checked={checked} disabled={busy}
           onChange={e=>setChecked(e.target.checked)}/> Подтверждаю фактическое местонахождение этой комплектации</label>
         <div className="client3-watch-handover-actions">
           <button type="button" className="primary" disabled={!checked||busy}
             onClick={()=>void decide(item,current)}>{busy?'Сохраняю…':'Сохранить уточнение'}</button>
           <button type="button" className="secondary" disabled={busy}
             onClick={()=>{setChoice(null);setChecked(false)}}>Отмена</button>
         </div>
       </div>}
     </article>
   })}
 </section>
}
