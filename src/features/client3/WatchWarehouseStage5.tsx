import {useEffect,useMemo,useRef,useState} from 'react'
import {StocktakeSizeCountCell} from '../inventory/views/StocktakeSharedInputs'
import {LinkedTableScroll} from '../../components/tables/LinkedTableScroll'
import type {WatchBrand} from '../../../shared/client3/watch-domain'
import '../../styles/client3-stage5-warehouse.css'

type Source='office'|'showcase'
type Variant={
 watchVariantId:number|null;catalogVariantId:number|null;watchProductId:number;
 modelName:string;gender:string|null;movement:string|null;braceletMaterial:string|null;
 dialColor:string|null;braceletColor:string|null;officePhysical:number;officeReserved:number;
 showcasePhysical:number;showcaseReserved:number
}
type HistoryRow={
 id:number;source:Source;movementType:string;quantityDelta:number;quantityAfter:number;
 comment:string;createdAt:string;modelName:string;watchVariantId:number;
 gender:string;movement:string;braceletMaterial:string;dialColor:string;braceletColor:string;
 referenceType:string;referenceId:string
}
const sourceLabel=(source:Source)=>source==='office'?'Офис':'Витрина'
const qty=(row:Variant,source:Source)=>Number(source==='office'?row.officePhysical:row.showcasePhysical)||0
const reserved=(row:Variant,source:Source)=>Number(source==='office'?row.officeReserved:row.showcaseReserved)||0
const description=(row:Pick<Variant,'gender'|'movement'|'braceletMaterial'|'dialColor'|'braceletColor'>)=>
 [row.gender==='male'?'Мужские':row.gender==='female'?'Женские':'',
  row.movement,row.braceletMaterial,row.dialColor,row.braceletColor?('Ремешок: '+row.braceletColor):'']
 .filter(Boolean).join(' · ')
const moveLabels:Record<string,string>={
 arrival:'Приход',writeoff:'Списание',manual_set:'Корректировка',
 transfer_in:'Перемещение (приход)',transfer_out:'Перемещение (расход)',
 revision:'Ревизия',sale:'Отправка',return:'Возврат',
}
const positive=(x:string)=>/^\d{1,7}$/.test(x)&&Number.isSafeInteger(Number(x))&&Number(x)<=1_000_000

/** Selective Main quick stocktake: all chosen SKUs in one D1 atomic write. */
export function WatchSelectiveRecount({brand,variants,onSaved}:{
 brand:WatchBrand;variants:readonly Variant[];onSaved:()=>void
}){
 const [open,setOpen]=useState(false)
 const [source,setSource]=useState<Source>('office')
 const [search,setSearch]=useState('')
 const [draft,setDraft]=useState<Record<number,string>>({})
 const [review,setReview]=useState(false)
 const [confirmed,setConfirmed]=useState(false)
 const [allowShortage,setAllowShortage]=useState(false)
 const [busy,setBusy]=useState(false)
 const [error,setError]=useState('')
 const [notice,setNotice]=useState('')
 const request=useRef<{fingerprint:string;id:string}|null>(null)
 const active=useMemo(()=>variants.filter(v=>Number.isSafeInteger(v.watchVariantId)&&v.watchVariantId!>0),[variants])
 const selected=active.filter(v=>v.watchVariantId&&draft[v.watchVariantId]!==undefined&&draft[v.watchVariantId]!=='')
 const invalid=selected.some(v=>!positive(draft[v.watchVariantId!]))
 const shortages=selected.filter(v=>Number(draft[v.watchVariantId!])<reserved(v,source))
 const canReview=selected.length>0&&selected.length<=30&&!invalid&&!busy
 const reset=()=>{
   setDraft({});setReview(false);setConfirmed(false);setAllowShortage(false);
   setError('');request.current=null
 }
 useEffect(()=>{reset();setNotice('')},[brand,source])
 const filtered=active.filter(v=>(v.modelName+' '+description(v)).toLocaleLowerCase('ru-RU')
   .includes(search.trim().toLocaleLowerCase('ru-RU')))
 const save=async()=>{
   if(!canReview||!confirmed||(shortages.length>0&&!allowShortage))return
   const items=selected.map(v=>({
     watchVariantId:v.watchVariantId,expectedPhysical:qty(v,source),
     countedQuantity:Number(draft[v.watchVariantId!]),
   }))
   const payload={brand,source,items,confirmed:true,allowShortage}
   const fingerprint=JSON.stringify(payload)
   if(request.current?.fingerprint!==fingerprint)
     request.current={fingerprint,id:'watch-selective-'+crypto.randomUUID()}
   setBusy(true);setError('')
   try{
     const response=await fetch('/api/client3/watches/stock/count-batch',{
       method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},
       body:JSON.stringify({...payload,requestId:request.current.id}),
     })
     const result=await response.json() as {ok?:boolean;message?:string;attention?:string}
     if(!response.ok||result.ok!==true)throw Error(result.message||'Сверка не сохранена.')
     setNotice(result.attention||'Выборочная сверка сохранена. Все позиции обработаны атомарно.')
     reset();onSaved()
   }catch(cause){setError(cause instanceof Error?cause.message:'Ошибка сохранения сверки.')}
   finally{setBusy(false)}
 }
 return <section className="client3-stage5-recount">
   <header className="client3-stage5-section-head">
     <div><h3>Выборочная ревизия</h3>
       <p>Пересчитайте несколько комплектаций одной точки за один раз. Как в Main — ничего не изменится, если хотя бы один остаток устарел.</p></div>
     <button type="button" className="secondary compact" disabled={busy} onClick={()=>{setOpen(v=>!v);reset()}}>
       {open?'Свернуть':'Начать ревизию'}
     </button>
   </header>
   {notice&&<p role="status" className="client3-stage5-notice">{notice}</p>}
   {open&&<>
     <div className="client3-stage5-filter">
       <label>Точка<select value={source} disabled={busy||review} onChange={e=>setSource(e.target.value as Source)}>
         <option value="office">Офис</option><option value="showcase">Витрина</option>
       </select></label>
       {!review&&<label>Поиск модели или характеристики<input value={search} onChange={e=>setSearch(e.target.value)}
         placeholder="Модель, механизм, цвет…"/></label>}
       <span>{selected.length} из 30 позиций</span>
     </div>
     {!review?<div className="client3-stage5-rows">
       {filtered.map(v=><div className="client3-stage5-row" key={v.watchVariantId}>
         <div><strong>{v.modelName}</strong><small>{description(v)}</small>
           <small>По системе: {qty(v,source)} · Резерв: {reserved(v,source)}</small></div>
         <StocktakeSizeCountCell cellId={v.watchVariantId!} size="Фактически"
           currentQuantity={qty(v,source)} value={draft[v.watchVariantId!]||''}
           disabled={busy} ariaLabel={'Фактическое количество '+v.modelName+' '+description(v)}
           onChange={n=>{if(n!==''&&!/^\d{0,7}$/.test(n))return;
             setDraft(old=>({...old,[v.watchVariantId!]:n}));setConfirmed(false)}}
           onClear={()=>{setDraft(old=>{const copy={...old};delete copy[v.watchVariantId!];return copy})}}/>
       </div>)}
       {!filtered.length&&<p>Нет подготовленных комплектаций по этому поиску.</p>}
     </div>:<div className="client3-stage5-review">
       <strong>Проверьте фактические количества · {sourceLabel(source)}</strong>
       {selected.map(v=><div key={v.watchVariantId} className="client3-stage5-review-line">
         <span>{v.modelName} · {description(v)}</span>
         <span>По системе {qty(v,source)} → Фактически <b>{draft[v.watchVariantId!]}</b></span>
       </div>)}
       {shortages.length>0&&<label className="client3-stage5-ack">
         <input type="checkbox" checked={allowShortage} disabled={busy}
           onChange={e=>setAllowShortage(e.target.checked)}/>
         Подтверждаю фактическую недостачу по {shortages.length} позициям с резервом
       </label>}
       <label className="client3-stage5-ack"><input type="checkbox" checked={confirmed}
         disabled={busy} onChange={e=>setConfirmed(e.target.checked)}/>
         Подтверждаю физический пересчёт каждой выбранной комплектации</label>
     </div>}
     {error&&<p role="alert" className="client3-stage5-error">{error}</p>}
     <div className="client3-stage5-actions">
       {review&&<button type="button" className="secondary" disabled={busy}
         onClick={()=>{setReview(false);setConfirmed(false)}}>Исправить</button>}
       <button type="button" disabled={review?
           (!canReview||!confirmed||(shortages.length>0&&!allowShortage)):!canReview}
         onClick={()=>review?void save():(setReview(true),setError(''))}>
         {busy?'Сохраняем…':review?'Сохранить ревизию':'Проверить выбранные позиции'}
       </button>
     </div>
   </>}
 </section>
}

/** Small, bounded, read-only warehouse history. No Problems queue or management actions. */
export function WatchWarehouseHistory({brand,revision=0}:{brand:WatchBrand;revision?:number}){
 const [source,setSource]=useState<'all'|Source>('all')
 const [rows,setRows]=useState<HistoryRow[]>([])
 const [before,setBefore]=useState<number|null>(null)
 const [hasMore,setHasMore]=useState(false)
 const [busy,setBusy]=useState(false)
 const [error,setError]=useState('')
 const [page,setPage]=useState(0)
 useEffect(()=>{
   const controller=new AbortController()
   setBusy(true);setError('')
   const q=new URLSearchParams({brand,source})
   if(before)q.set('beforeId',String(before))
   void fetch('/api/client3/watches/stock/history?'+q,{
     credentials:'include',cache:'no-store',signal:controller.signal,
   }).then(async response=>{
     const result=await response.json() as {
       ok?:boolean;message?:string;rows?:HistoryRow[];hasMore?:boolean;nextBeforeId?:number|null}
     if(!response.ok||!result.ok)throw Error(result.message||'Не удалось загрузить историю.')
     if(!controller.signal.aborted){
       setRows(old=>page===0?(result.rows||[]):[...old,...(result.rows||[])])
       setHasMore(Boolean(result.hasMore))
       setBefore(result.nextBeforeId||null)
     }
   }).catch(cause=>{if(!controller.signal.aborted)setError(String(cause))})
     .finally(()=>{if(!controller.signal.aborted)setBusy(false)})
   return ()=>controller.abort()
 },[brand,source,revision,page])
 const reset=(s:'all'|Source)=>{setRows([]);setBefore(null);setPage(0);setSource(s)}
 return <section className="client3-stage5-history">
   <header className="client3-stage5-section-head"><div>
     <h3>История склада</h3><p>Только реальные операции часов выбранного бренда. Без очереди проблем.</p>
   </div><label>Точка<select value={source} onChange={e=>reset(e.target.value as 'all'|Source)}>
     <option value="all">Обе точки</option><option value="office">Офис</option>
     <option value="showcase">Витрина</option>
   </select></label></header>
   {error&&<p role="alert" className="client3-stage5-error">{error}</p>}
   <LinkedTableScroll><table className="client3-stage5-table"><thead><tr>
     <th>Дата</th><th>Товар</th><th>Операция</th><th>Точка</th><th>Изменение</th><th>После</th><th>Комментарий</th>
   </tr></thead><tbody>{rows.map(row=><tr key={row.id}>
     <td>{row.createdAt?new Date(row.createdAt).toLocaleString('ru-RU'):'—'}</td>
     <td><strong>{row.modelName}</strong><small>{description(row)}</small></td>
     <td>{moveLabels[row.movementType]||row.movementType}</td>
     <td>{sourceLabel(row.source)}</td>
     <td className={row.quantityDelta<0?'is-negative':'is-positive'}>
       {row.quantityDelta>0?'+':''}{row.quantityDelta}</td>
     <td>{row.quantityAfter}</td><td>{row.comment||'—'}</td>
   </tr>)}</tbody></table></LinkedTableScroll>
   {!rows.length&&!busy&&<p>Движений часов в выбранной точке пока нет.</p>}
   {hasMore&&<button type="button" className="secondary compact" disabled={busy}
     onClick={()=>setPage(x=>x+1)}>{busy?'Загрузка…':'Показать ещё'}</button>}
 </section>
}
