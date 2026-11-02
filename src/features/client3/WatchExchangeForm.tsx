import {useEffect,useMemo,useRef,useState,type FormEvent} from 'react'
import type {WatchBrand,WatchSource} from '../../../shared/client3/watch-domain'
import {WATCH_OPTIONS} from '../../../shared/client3/watch-domain'
import '../../styles/client3-watch-exchange.css'
type Model={
  watchVariantId:number;modelName:string;gender:string;movement:string;
  braceletMaterial:string;dialColor:string;braceletColor:string;
  officePhysical:number;officeReserved:number;showcasePhysical:number;showcaseReserved:number
}
type Order={orderId:number;externalId:string;activeWatchVariantId:number|null;watchDescription:string|null}
type Load={ok:boolean;models:Model[];message?:string}
export function WatchExchangeForm({brand,order,onDone,onCancel}:{
 brand:WatchBrand;order:Order;onDone:()=>void;onCancel:()=>void
}){
 const [models,setModels]=useState<Model[]>([])
 const [busy,setBusy]=useState(false)
 const [error,setError]=useState('')
 const [source,setSource]=useState<WatchSource>('office')
 const [chosenId,setChosenId]=useState(0)
 const [engraving,setEngraving]=useState('')
 const [reason,setReason]=useState('')
 const [confirmed,setConfirmed]=useState(false)
 const request=useRef<{fingerprint:string;id:string}|null>(null)
 useEffect(()=>{
   const ctrl=new AbortController()
   void fetch('/api/client3/watches/models?brand='+encodeURIComponent(brand),{
     credentials:'include',cache:'no-store',signal:ctrl.signal
   }).then(async response=>{
     const result=await response.json() as Load
     if(!response.ok||!result.ok)throw new Error(result.message||'Не удалось загрузить часы')
     if(!ctrl.signal.aborted)setModels(result.models||[])
   }).catch(e=>{if(!ctrl.signal.aborted)setError(e instanceof Error?e.message:'Ошибка каталога')})
   return ()=>ctrl.abort()
 },[brand])
 const options=useMemo(()=>models.filter(m=>{
   const free=source==='office'?m.officePhysical-m.officeReserved:m.showcasePhysical-m.showcaseReserved
   return m.watchVariantId!==order.activeWatchVariantId&&free>=1
 }),[models,source,order.activeWatchVariantId])
 const selected=options.find(m=>m.watchVariantId===chosenId)
 const submit=async(e:FormEvent)=>{
   e.preventDefault()
   if(busy||!confirmed||!selected||!reason.trim()){setError('Выберите доступные часы, причину и подтвердите обмен.');return}
   const payload={brand,newWatchVariantId:chosenId,newSource:source,engravingText:engraving.trim(),reason:reason.trim()}
   const fingerprint=JSON.stringify([order.orderId,payload])
   if(request.current?.fingerprint!==fingerprint)
     request.current={fingerprint,id:'watch-exchange-'+crypto.randomUUID()}
   setBusy(true);setError('')
   try{
     const response=await fetch('/api/client3/watches/orders/'+order.orderId+'/exchange',{
       method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},
       body:JSON.stringify({...payload,requestId:request.current.id}),
     })
     const result=await response.json() as {ok:boolean;message?:string}
     if(!response.ok||!result.ok)throw new Error(result.message||'Обмен не подтверждён')
     request.current=null
     onDone()
   }catch(e){setError(e instanceof Error?e.message:'Не удалось выполнить обмен')}
   finally{setBusy(false)}
 }
 return <form className="watch-exchange-form" onSubmit={e=>void submit(e)}>
   <h4>Обмен по заказу {order.externalId}</h4>
   <p>Исходные часы: <strong>{order.watchDescription||'Текущая комплектация'}</strong></p>
   <p>Поддерживается полная замена одной отправленной единицы внутри того же бренда, без доплаты и возврата денег.</p>
   <label>Новая точка выдачи<select value={source} onChange={e=>{setSource(e.target.value as WatchSource);setChosenId(0);setConfirmed(false)}}>
     {WATCH_OPTIONS.sources.map(x=><option key={x.value} value={x.value}>{x.label}</option>)}
   </select></label>
   <label>Новая комплектация<select value={chosenId} required
     onChange={e=>{setChosenId(Number(e.target.value));setConfirmed(false)}}>
     <option value={0}>Выберите доступные часы</option>
     {options.map(m=><option key={m.watchVariantId} value={m.watchVariantId}>
       {m.modelName} · {m.gender==='male'?'Мужские':'Женские'} · {m.braceletMaterial} · {m.dialColor}
       {m.braceletColor?' · '+m.braceletColor:''} · свободно {source==='office'?m.officePhysical-m.officeReserved:m.showcasePhysical-m.showcaseReserved} шт.
     </option>)}
   </select></label>
   {models.length>0&&options.length===0&&<p>Свободных альтернатив на выбранном источнике нет.</p>}
   <label>Гравировка новых часов<textarea rows={2} maxLength={500} value={engraving}
     onChange={e=>{setEngraving(e.target.value);setConfirmed(false)}} placeholder="Необязательно"/></label>
   <label>Причина обмена<input required maxLength={300} value={reason}
     onChange={e=>{setReason(e.target.value);setConfirmed(false)}} placeholder="Например, клиент выбрал другой ремешок"/></label>
   <p>Старые часы будут ожидать отдельного физического приёма. Новые будут зарезервированы,
      но не отправлены до явного подтверждения отправки. При наличии гравировки логистика должна подтвердить её готовность.</p>
   <label className="watch-exchange-confirm"><input type="checkbox" checked={confirmed}
     onChange={e=>setConfirmed(e.target.checked)}/>
     Подтверждаю полную замену 1 шт. и отсутствие доплаты
   </label>
   {error&&<p role="alert" className="watch-exchange-error">{error}</p>}
   <div className="watch-exchange-actions"><button disabled={busy||!confirmed||!selected} type="submit">{busy?'Сохраняю…':'Оформить обмен'}</button>
     <button disabled={busy} type="button" onClick={onCancel}>Отмена</button></div>
 </form>
}
