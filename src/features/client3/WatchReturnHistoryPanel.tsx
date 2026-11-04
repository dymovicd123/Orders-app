import {useEffect,useRef,useState} from 'react'
import {watchReferenceLabel,type WatchBrand} from '../../../shared/client3/watch-domain'
import '../../styles/client3-watch-return-history.css'

type Item={
 id:number;orderItemId:number;quantity:number;modelName:string;gender:string;
 movement:string;braceletMaterial:string;dialColor:string;braceletColor:string;
 physicalTracking:number;physicalReceivedAt:string|null
}
type Entry={
 id:number;date:string;amount:number;commercialGoodsValue:number;method:string;status:string;comment:string;
 parentExchangeId:number|null;items:string;archivedAppliedCount:number
}
type HistoryResponse={ok:boolean;rows:Entry[];message?:string}
const money=(n:number)=>Number(n||0).toLocaleString('ru-RU')+' ₸'
const decodeItems=(raw:string):Item[]=>{
 try{const rows=JSON.parse(raw||'[]') as unknown;return Array.isArray(rows)?rows as Item[]:[]}
 catch{return []}
}

export function WatchReturnHistoryPanel({brand,orderId,onDone,onClose}:{
 brand:WatchBrand;orderId:number;onDone:()=>void;onClose:()=>void
}){
 const [rows,setRows]=useState<Entry[]>([])
 const [loading,setLoading]=useState(true)
 const [busy,setBusy]=useState(false)
 const [error,setError]=useState('')
 const [reload,setReload]=useState(0)
 const [selected,setSelected]=useState<number|null>(null)
 const [reason,setReason]=useState('')
 const [confirmed,setConfirmed]=useState(false)
 const [physicalLocation,setPhysicalLocation]=useState<'customer'|'office'|'unknown'>('unknown')
 const requests=useRef<Record<number,{fingerprint:string;requestId:string}>>({})
 useEffect(()=>{
   const controller=new AbortController()
   setLoading(true);setError('')
   void fetch('/api/client3/watches/orders/'+orderId+'/returns/history?brand='+encodeURIComponent(brand),{
     credentials:'include',cache:'no-store',signal:controller.signal,
   }).then(async response=>{
     const result=await response.json() as HistoryResponse
     if(!response.ok||!result.ok)throw new Error(result.message||'История возвратов недоступна')
     if(!controller.signal.aborted)setRows(result.rows||[])
   }).catch(cause=>{if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'Ошибка истории')})
     .finally(()=>{if(!controller.signal.aborted)setLoading(false)})
   return ()=>controller.abort()
 },[brand,orderId,reload])
 const cancel=async(row:Entry)=>{
   if(busy||selected!==row.id||!confirmed||reason.trim().length<8)return
   const fingerprint=JSON.stringify([brand,orderId,row.id,reason.trim(),
   Number(row.archivedAppliedCount||0)>0?physicalLocation:null])
   if(requests.current[row.id]?.fingerprint!==fingerprint){
     requests.current[row.id]={fingerprint,requestId:'watch-return-cancel-'+crypto.randomUUID()}
   }
   setBusy(true);setError('')
   try{
     const response=await fetch('/api/client3/watches/orders/'+orderId+'/returns/'+row.id+'/cancel',{
       method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},
       body:JSON.stringify({brand,requestId:requests.current[row.id].requestId,reason:reason.trim(),
         physicalLocation:Number(row.archivedAppliedCount||0)>0?physicalLocation:undefined}),
     })
     const result=await response.json() as {ok:boolean;message?:string}
     if(!response.ok||!result.ok)throw new Error(result.message||'Невозможно отменить возврат')
     delete requests.current[row.id]
     setSelected(null);setReason('');setConfirmed(false);setPhysicalLocation('unknown')
     setReload(x=>x+1);onDone()
   }catch(cause){setError(cause instanceof Error?cause.message:'Возврат не отменён')}
   finally{setBusy(false)}
 }
 return <section className="watch-return-history mini-panel" aria-label="История возвратов заказа">
   <div className="watch-return-history-head">
     <div><h3>История возвратов</h3>
       <p>Оформление возврата, физическая приёмка и денежная операция учитываются отдельно. Отмена проверяется механизмом Main.</p></div>
     <button type="button" className="secondary compact" onClick={onClose} disabled={busy}>Закрыть</button>
   </div>
   {error&&<p role="alert" className="watch-return-history-error">{error}</p>}
   {loading?<p>Загружаю историю…</p>:rows.length===0?<p>Возвратов по этому заказу нет.</p>:
     <div className="watch-return-history-list">{rows.map(row=>{
       const items=decodeItems(row.items)
       const linked=Number(row.parentExchangeId||0)>0
       const cancelled=row.status==='cancelled'
       return <article className="watch-return-history-entry" key={row.id}>
         <header><div><strong>Возврат №{row.id}</strong><small>{row.date}</small></div>
           <strong>Деньги: {money(row.amount)} · {row.method||'Без денежного возврата'}</strong></header>
         {row.commercialGoodsValue>0&&<small>
           {cancelled?'Отменённый коммерческий зачёт товара: ':'Уменьшение стоимости продажи: '}
           {money(row.commercialGoodsValue)}
         </small>}
         <div className="watch-return-history-status">{cancelled?'Отменён':linked?
           'Связан с обменом №'+row.parentExchangeId:'Действующий возврат'}</div>
         {row.comment&&<p>{row.comment}</p>}
         {items.length>0?<div className="watch-return-history-items">
           {items.map(item=><div key={item.id}>
             <strong>{item.modelName} · {item.quantity} шт.</strong>
             <small>{[
               item.gender==='male'?'Мужские':item.gender==='female'?'Женские':'',
               watchReferenceLabel('movements',item.movement),
               watchReferenceLabel('bracelets',item.braceletMaterial),
               watchReferenceLabel('dials',item.dialColor),
               item.braceletColor?'Ремешок: '+watchReferenceLabel('leatherColors',item.braceletColor):'',
             ].filter(Boolean).join(' · ')}</small>
             <small>{item.physicalTracking?
               (item.physicalReceivedAt?'Физически принят: '+item.physicalReceivedAt:'Ожидается физическая приёмка'):
               'Без ожидания физической приёмки'}</small>
           </div>)}
         </div>:<small>Возврат только денег</small>}
         {linked&&!cancelled&&<small>Отмена этого возврата отдельно запрещена. Управляйте цепочкой обмена.</small>}
         {!cancelled&&!linked&&(selected===row.id?
           <div className="watch-return-history-confirm">
             {Number(row.archivedAppliedCount||0)>0&&<div className="watch-return-history-archive-note">
               <strong>Часы удалены из рабочего каталога</strong>
               <p>Денежный возврат и коммерческая операция отменяются через Main. Старый складской остаток не меняется. Уточните, где фактически находятся часы; это сохранится в причине отмены.</p>
               <label>Фактическое местонахождение
                 <select value={physicalLocation} onChange={e=>{
                   setPhysicalLocation(e.target.value as 'customer'|'office'|'unknown')
                   setConfirmed(false)
                 }}>
                   <option value="unknown">Пока неизвестно</option>
                   <option value="office">У продавца</option>
                   <option value="customer">У клиента</option>
                 </select>
               </label>
             </div>}
             <label>Причина отмены
               <textarea rows={2} maxLength={500} value={reason} onChange={e=>{setReason(e.target.value);setConfirmed(false)}}/>
             </label>
             <label><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>
               Подтверждаю отмену возврата и понимаю, что Main проверит связанные движения и деньги
             </label>
             <div><button type="button" disabled={busy||!confirmed||reason.trim().length<8}
               onClick={()=>void cancel(row)}>{busy?'Сохраняю…':'Подтвердить отмену'}</button>
               <button type="button" className="secondary" disabled={busy}
                 onClick={()=>{setSelected(null);setConfirmed(false);setReason('');setPhysicalLocation('unknown')}}>Не отменять</button></div>
           </div>:
           <button type="button" className="secondary compact" disabled={busy}
             onClick={()=>{setSelected(row.id);setReason('');setConfirmed(false);setPhysicalLocation('unknown')}}>Отменить возврат</button>)}
       </article>
     })}</div>}
 </section>
}
