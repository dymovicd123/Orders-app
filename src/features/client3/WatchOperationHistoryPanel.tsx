import {Fragment,useEffect,useRef,useState} from 'react'
import type {WatchBrand} from '../../../shared/client3/watch-domain'
import {watchReferenceLabel} from '../../../shared/client3/watch-domain'
import {LinkedTableScroll} from '../../components/tables/LinkedTableScroll'
import '../../styles/client3-watch-operation-history.css'

type Item={
 id:number;orderItemId:number;productName:string;quantity:number;
 role:'old'|'new';gender:string;movement:string;braceletMaterial:string;
 dialColor:string;braceletColor:string;source:string;
 physicalTracking:number;physicalReceivedAt:string|null;stockWriteoffStatus?:string
}
type Operation={
 id:number;orderId:number;externalOrderId:string;orderDate:string;
 operationDate:string;status:string;amount:number;paymentMethod:string;
 comment:string;financialAction:string;manager:string;itemsJson:string
}
type Response={ok:boolean;message?:string;rows?:Operation[];total?:number;
 cancelled?:number;money?:number;hasMore?:boolean}
const money=(amount:number)=>Number(amount||0).toLocaleString('ru-RU')+' ₸'
const readItems=(raw:string):Item[]=>{
 try{const parsed=JSON.parse(raw||'[]') as Item[];return Array.isArray(parsed)?parsed:[]}
 catch{return []}
}
const physical=(x:Item)=>{
 if(x.role==='new')return ['fulfilled','written_off','negative'].includes(x.stockWriteoffStatus||'')
   ?'Переданы клиенту':'Ожидают отправки'
 if(x.source==='not_issued')return 'Клиенту не выдавались'
 if(!x.physicalTracking)return 'Без отдельной записи приёмки'
 if(!x.physicalReceivedAt)return 'Ожидают физического получения'
 if(x.source==='warehouse')return 'Получены в офис'
 if(x.source==='boutique')return 'Получены на витрину'
 return 'Получены без постановки на остаток'
}
const details=(item:Item)=>[
 item.gender==='male'?'Мужские':item.gender==='female'?'Женские':'',
 watchReferenceLabel('movements',item.movement||''),
 watchReferenceLabel('bracelets',item.braceletMaterial||''),
 watchReferenceLabel('dials',item.dialColor||''),
 item.braceletColor?'Ремешок: '+watchReferenceLabel('leatherColors',item.braceletColor):'',
].filter(Boolean).join(' · ')

export function WatchOperationHistoryPanel({
 kind,brands,initialBrand,onOpenOrder,isAdmin=false,
}:{
 kind:'return'|'exchange';brands:readonly WatchBrand[];initialBrand?:WatchBrand;
 isAdmin?:boolean;
 onOpenOrder?:(row:{brand:WatchBrand;orderId:number;externalId:string;orderDate:string})=>void;
}){
 const [brand,setBrand]=useState<WatchBrand>(initialBrand&&brands.includes(initialBrand)?initialBrand:brands[0]||'TAUWACH')
 const [mode,setMode]=useState<'all'|'active'|'cancelled'>('all')
 const [rows,setRows]=useState<Operation[]>([])
 const [open,setOpen]=useState<number|null>(null)
 const [offset,setOffset]=useState(0)
 const [more,setMore]=useState(false)
 const [count,setCount]=useState(0)
 const [sum,setSum]=useState(0)
 const [cancelled,setCancelled]=useState(0)
 const [refresh,setRefresh]=useState(0)
 const [busy,setBusy]=useState(false)
 const [error,setError]=useState('')
 const [cancelTarget,setCancelTarget]=useState<number|null>(null)
 const [cancelReason,setCancelReason]=useState('')
 const [cancelBusy,setCancelBusy]=useState(false)
 const [cancelError,setCancelError]=useState('')
 const cancelKey=useRef<{fingerprint:string;requestId:string}|null>(null)
 const cancelOperation=async(id:number)=>{
   const reason=cancelReason.trim()
   if(!isAdmin||cancelBusy||cancelTarget!==id||reason.length<8)return
   const fingerprint=JSON.stringify({brand,kind,id,reason})
   if(cancelKey.current?.fingerprint!==fingerprint)
     cancelKey.current={fingerprint,requestId:'watch-cancel-'+crypto.randomUUID()}
   setCancelBusy(true);setCancelError('')
   try{
     const response=await fetch('/api/client3/watches/operations/cancel',{
       method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},
       body:JSON.stringify({brand,kind,id,reason,requestId:cancelKey.current.requestId}),
     })
     const result=await response.json() as {ok?:boolean;message?:string}
     if(!response.ok||result.ok!==true)
       throw Error(result.message||'Операцию не удалось отменить.')
     cancelKey.current=null;setCancelTarget(null);setCancelReason('')
     setRows([]);setOffset(0);setOpen(null);setRefresh(x=>x+1)
   }catch(e){setCancelError(e instanceof Error?e.message:'Не удалось отменить операцию.')}
   finally{setCancelBusy(false)}
 }
 useEffect(()=>{
   const abort=new AbortController()
   setBusy(true);setError('')
   const q=new URLSearchParams({brand,kind,status:mode,limit:'30',offset:String(offset)})
   void fetch('/api/client3/watches/operations/history?'+q,{
     credentials:'include',cache:'no-store',signal:abort.signal,
   }).then(async response=>{
     const data=await response.json() as Response
     if(!response.ok||!data.ok)throw Error(data.message||'Не удалось загрузить историю.')
     if(abort.signal.aborted)return
     setRows(old=>offset===0?data.rows||[]:[...old,...(data.rows||[])])
     setMore(Boolean(data.hasMore));setCount(Number(data.total||0))
     setCancelled(Number(data.cancelled||0));setSum(Number(data.money||0))
   }).catch(e=>{if(!abort.signal.aborted)setError(e instanceof Error?e.message:'Ошибка загрузки.')})
     .finally(()=>{if(!abort.signal.aborted)setBusy(false)})
   return ()=>abort.abort()
 },[brand,kind,mode,offset,refresh])
 const change=(value:'all'|'active'|'cancelled')=>{
   setMode(value);setRows([]);setOffset(0);setOpen(null)
 }
 return <section className="client3-main-history-panel" aria-label={kind==='return'?'История возвратов':'История обменов'}>
   <div className="client3-history-heading">
     <div><span className="client3-history-kicker">ИСТОРИЯ</span>
       <h3>{kind==='return'?'Оформленные возвраты':'Оформленные обмены'}</h3>
       <p>По каждому заказу видны реальные товары, деньги и состояние физической приёмки.</p></div>
     <button className="secondary compact" type="button" disabled={busy}
       onClick={()=>{setOffset(0);setRows([]);setRefresh(x=>x+1)}}>Обновить историю</button>
   </div>
   <div className="client3-history-filters">
     <label>Бренд <select value={brand} onChange={e=>{
       setBrand(e.target.value as WatchBrand);setRows([]);setOffset(0);setOpen(null)
     }}>{brands.map(x=><option key={x} value={x}>{x}</option>)}</select></label>
     <div className="client3-history-tablist" role="group" aria-label="Состояние операции">
       {([['all','Все'],['active','Действующие'],['cancelled','Отменённые']] as const).map(([value,label])=>
         <button key={value} type="button" className={'secondary compact'+(mode===value?' is-active':'')}
           aria-pressed={mode===value} onClick={()=>change(value)}>{label}</button>)}
     </div>
   </div>
   <div className="client3-history-summary">
     <div><small>Операций по фильтру</small><strong>{count}</strong></div>
     <div><small>{kind==='return'?'Возвращено денег':'Денежные операции обменов'}</small><strong>{money(sum)}</strong></div>
     <div><small>Отменено</small><strong>{cancelled}</strong></div>
   </div>
   {error&&<p className="app-alert error" role="alert">{error}</p>}
   <LinkedTableScroll ariaLabel={kind==='return'?'История возвратов часов':'История обменов часов'}>
     <table className="data-table client3-history-table">
       <thead><tr><th>Дата / операция</th><th>Заказ</th><th>Менеджер</th>
         <th>{kind==='return'?'Возвращено':'Финансовый расчёт'}</th><th>Статус</th><th>Действие</th></tr></thead>
       <tbody>{rows.map(row=>{
         const visible=open===row.id,items=readItems(row.itemsJson)
         return <Fragment key={row.id}>
           <tr>
             <td><strong>{row.operationDate||'—'}</strong><small>№ {row.id}</small></td>
             <td><strong>{row.externalOrderId}</strong><small>{items.length} поз.</small></td>
             <td>{row.manager||'—'}</td>
             <td>{kind==='exchange'&&row.financialAction==='none'?'Без доплаты':<strong>{money(row.amount)}</strong>}
               {row.paymentMethod&&<small>{row.paymentMethod}</small>}
               {kind==='exchange'&&row.financialAction==='refund'&&<small>Возврат клиенту</small>}
               {kind==='exchange'&&row.financialAction==='extra_payment'&&<small>Доплата клиента</small>}
             </td>
             <td>{row.status==='cancelled'?'Отменено':'Оформлено'}</td>
             <td><button className="secondary compact" type="button"
               aria-expanded={visible} onClick={()=>setOpen(v=>v===row.id?null:row.id)}>
               {visible?'Свернуть':'Подробнее'}</button></td>
           </tr>
           {visible&&<tr className="client3-history-expanded"><td colSpan={6}>
             <div className="client3-history-detail">
               <div className="client3-history-detail-head">
                 <div><strong>{kind==='return'?'Возврат':'Обмен'} № {row.id}</strong>
                   <small>{row.comment||'Причина не указана'}</small></div>
                 <div className="client3-history-detail-actions">
                   {onOpenOrder&&<button className="secondary compact" type="button"
                     onClick={()=>onOpenOrder({brand,orderId:row.orderId,
                       externalId:row.externalOrderId,orderDate:row.orderDate})}>К заказу</button>}
                   {isAdmin&&row.status!=='cancelled'&&<button className="secondary compact" type="button"
                     disabled={cancelBusy} onClick={()=>{
                       setCancelTarget(v=>v===row.id?null:row.id);
                       setCancelReason('');setCancelError('');cancelKey.current=null
                     }}>Отменить операцию</button>}
                 </div>
               </div>
               {isAdmin&&row.status!=='cancelled'&&cancelTarget===row.id&&
                 <div className="client3-history-cancel">
                   <strong>Отменить {kind==='return'?'возврат':'обмен'} № {row.id}?</strong>
                   <p>Это финансовая и складская операция. Используется механизм отмены Main:
                     он проверит зависимые возвраты, отправки и изменения остатков. 
                     При конфликте действие не выполняется.</p>
                   <label>Причина отмены (минимум 8 символов)
                     <textarea rows={2} maxLength={500} value={cancelReason}
                       onChange={e=>{setCancelReason(e.target.value);cancelKey.current=null}}/>
                   </label>
                   {cancelError&&<p className="app-alert error" role="alert">{cancelError}</p>}
                   <div><button type="button" disabled={cancelBusy||cancelReason.trim().length<8}
                       onClick={()=>void cancelOperation(row.id)}>
                       {cancelBusy?'Проверяю и отменяю…':'Подтвердить отмену'}</button>
                     <button className="secondary compact" type="button" disabled={cancelBusy}
                       onClick={()=>setCancelTarget(null)}>Назад</button></div>
                 </div>}
               <div className="client3-history-items">
                 {items.map(item=><article key={item.id} className="client3-history-item">
                   <div><strong>{kind==='exchange'?(item.role==='old'?'Отдают: ':'Получают: '):''}
                     {item.productName||'Часы'} · {item.quantity} шт.</strong>
                     <small>{details(item)}</small></div>
                   <span>{physical(item)}</span>
                 </article>)}
                 {!items.length&&<p>Товары в этой операции не указаны.</p>}
               </div>
             </div>
           </td></tr>}
         </Fragment>
       })}
       {!rows.length&&!busy&&<tr><td colSpan={6}>Операций по фильтру нет.</td></tr>}
       </tbody>
     </table>
   </LinkedTableScroll>
   {busy&&<p role="status">Загружаю историю…</p>}
   {more&&<button className="secondary compact" type="button" disabled={busy}
     onClick={()=>setOffset(v=>v+30)}>Показать ещё</button>}
 </section>
}
