import {useEffect,useMemo,useRef,useState} from 'react'
import {StocktakeSizeCountCell} from '../inventory/views/StocktakeSharedInputs'
import type {WatchBrand} from '../../../shared/client3/watch-domain'
import '../../styles/client3-stage5-warehouse.css'
import '../../styles/client3-watch-bulk.css'

type Source='office'|'showcase'
type Mode='arrival'|'writeoff'|'transfer'
type WatchRow={
 watchVariantId:number|null;catalogVariantId:number|null;watchProductId:number;modelName:string;
 gender:string|null;movement:string|null;braceletMaterial:string|null;dialColor:string|null;
 braceletColor:string|null;officePhysical:number;officeReserved:number;showcasePhysical:number;showcaseReserved:number
}
const modes:Record<Mode,{title:string;description:string;verb:string}>={
 arrival:{title:'Приход',description:'Фактически полученные часы',verb:'Принять'},
 writeoff:{title:'Списание',description:'Только свободный остаток',verb:'Списать'},
 transfer:{title:'Перемещение',description:'Между офисом и витриной',verb:'Переместить'},
}
const readable=(v:WatchRow)=>[
 v.gender==='male'?'Мужские':'Женские',v.movement,v.braceletMaterial,
 v.dialColor,v.braceletColor?('Ремешок: '+v.braceletColor):'',
].filter(Boolean).join(' · ')
const physical=(v:WatchRow,s:Source)=>Number(s==='office'?v.officePhysical:v.showcasePhysical)||0
const reserved=(v:WatchRow,s:Source)=>Number(s==='office'?v.officeReserved:v.showcaseReserved)||0
const valid=(s:string)=>/^\d{1,4}$/.test(s)&&Number(s)>=1&&Number(s)<=1000

/** One Main inventory transaction with up to 30 distinct watches and no partial writes. */
export function WatchBulkOperations({brand,variants,onSaved}:{
 brand:WatchBrand;variants:readonly WatchRow[];onSaved:()=>void
}){
 const [open,setOpen]=useState(false)
 const [mode,setMode]=useState<Mode>('arrival')
 const [source,setSource]=useState<Source>('office')
 const [search,setSearch]=useState('')
 const [draft,setDraft]=useState<Record<number,string>>({})
 const [reason,setReason]=useState('')
 const [review,setReview]=useState(false)
 const [confirmed,setConfirmed]=useState(false)
 const [error,setError]=useState('')
 const [notice,setNotice]=useState('')
 const [busy,setBusy]=useState(false)
 const request=useRef<{fingerprint:string;id:string}|null>(null)
 const reset=()=>{
   setDraft({});setReason('');setReview(false);setConfirmed(false);
   setError('');request.current=null
 }
 useEffect(()=>{reset();setNotice('')},[brand,source,mode])
 const available=useMemo(()=>variants.filter(x=>Number(x.watchVariantId)>0&&Number(x.catalogVariantId)>0),[variants])
 const found=available.filter(x=>(x.modelName+' '+readable(x))
   .toLocaleLowerCase('ru-RU').includes(search.trim().toLocaleLowerCase('ru-RU')))
 const selected=available.filter(x=>x.watchVariantId!=null&&draft[x.watchVariantId]!==undefined&&draft[x.watchVariantId]!=='')
 const invalid=selected.some(x=>!valid(draft[x.watchVariantId!])||
   (mode!=='arrival'&&Number(draft[x.watchVariantId!])>Math.max(0,physical(x,source)-reserved(x,source))))
 const canReview=selected.length>=1&&selected.length<=30&&!invalid&&
   (mode!=='writeoff'||reason.trim().length>0)&&!busy
 const changeMode=(next:Mode)=>{if(busy)return;setMode(next)}
 const save=async()=>{
   if(!canReview||!confirmed||busy)return
   const payload={brand,source,kind:mode,comment:reason.trim(),
     items:selected.map(x=>({
       watchVariantId:x.watchVariantId,
       quantity:Number(draft[x.watchVariantId!]),expectedPhysical:physical(x,source),
     })),
   }
   const fingerprint=JSON.stringify(payload)
   if(request.current?.fingerprint!==fingerprint)
     request.current={fingerprint,id:'watch-bulk-'+crypto.randomUUID()}
   setBusy(true);setError('')
   try{
     const response=await fetch('/api/client3/watches/stock/bulk',{
       method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},
       body:JSON.stringify({...payload,requestId:request.current.id}),
     })
     const result=await response.json() as {ok?:boolean;message?:string}
     if(!response.ok||result.ok!==true)throw Error(result.message||'Операция не сохранена.')
     const done=selected.length
     reset();setOpen(false);setNotice('Сохранено: '+done+' комплектаций, '+modes[mode].title.toLowerCase()+'.')
     onSaved()
   }catch(e){setError(e instanceof Error?e.message:'Не удалось сохранить операцию.')}
   finally{setBusy(false)}
 }
 return <section className="client3-watch-bulk" data-unified-operation={mode==='arrival'?'arrival':mode}>
   <header className="client3-stage5-section-head">
     <div><h3>Массовые складские операции</h3>
       <p>Приход, списание и перемещение нескольких комплектаций за одно сохранение — без частичного применения.</p></div>
     <button type="button" className="secondary compact" disabled={busy}
       onClick={()=>{setOpen(x=>!x);reset()}}>{open?'Свернуть':'Выбрать товары'}</button>
   </header>
   {notice&&<p className="client3-stage5-notice" role="status">{notice}</p>}
   {open&&<>
     <div className="client3-watch-bulk-modes" role="group" aria-label="Тип операции">
       {(['arrival','writeoff','transfer'] as const).map(x=>
         <button type="button" key={x} data-operation={x}
           aria-pressed={mode===x} className={mode===x?'is-active':''} disabled={busy}
           onClick={()=>changeMode(x)}><strong>{modes[x].title}</strong><small>{modes[x].description}</small></button>)}
     </div>
     <div className="client3-stage5-filter">
       <label>Точка {mode==='transfer'?'отправления':'операции'}
         <select value={source} disabled={busy||review} onChange={e=>setSource(e.target.value as Source)}>
           <option value="office">Офис</option><option value="showcase">Витрина</option>
         </select></label>
       {mode==='transfer'&&<strong>→ {source==='office'?'Витрина':'Офис'}</strong>}
       {!review&&<label>Модель или характеристики
         <input placeholder="Название, механизм, цвет…" value={search} onChange={e=>setSearch(e.target.value)}/>
       </label>}
       <span>{selected.length} / 30 позиций</span>
     </div>
     {!review?<div className="client3-stage5-rows">
       {found.map(v=><div key={v.watchVariantId} className="client3-stage5-row">
         <div><strong>{v.modelName}</strong><small>{readable(v)}</small>
           <small>На месте: {physical(v,source)} · Резерв: {reserved(v,source)}
             {mode!=='arrival'?' · Свободно: '+Math.max(0,physical(v,source)-reserved(v,source)):''}</small>
         </div>
         <StocktakeSizeCountCell cellId={v.watchVariantId!}
           currentQuantity={physical(v,source)} value={draft[v.watchVariantId!]||''}
           size={modes[mode].verb} disabled={busy}
           ariaLabel={modes[mode].verb+' '+v.modelName+' '+readable(v)}
           onChange={n=>{if(n!==''&&!/^\d{0,4}$/.test(n))return;
             setDraft(old=>({...old,[v.watchVariantId!]:n}));setConfirmed(false)}}
           onClear={()=>{setDraft(old=>{const copy={...old};delete copy[v.watchVariantId!];return copy})}}/>
       </div>)}
       {!found.length&&<p>Комплектации по поиску не найдены.</p>}
     </div>:<div className="client3-stage5-review">
       <strong>{modes[mode].title} · {source==='office'?'Офис':'Витрина'}</strong>
       {selected.map(v=><div key={v.watchVariantId} className="client3-stage5-review-line">
         <span>{v.modelName} · {readable(v)}</span>
         <span>{mode==='arrival'?'+':mode==='writeoff'?'−':'→'} {draft[v.watchVariantId!]} шт.</span>
       </div>)}
       <label className="client3-stage5-ack"><input type="checkbox" checked={confirmed} disabled={busy}
         onChange={e=>setConfirmed(e.target.checked)}/>
         Подтверждаю конкретные комплектации, количество и складскую операцию
       </label>
     </div>}
     <label className="client3-watch-bulk-reason">
       {mode==='writeoff'?'Причина списания (обязательно)':'Комментарий (необязательно)'}
       <input maxLength={300} value={reason} disabled={busy||review}
         onChange={e=>{setReason(e.target.value);setConfirmed(false)}}
         placeholder={mode==='writeoff'?'Почему списываем эти часы':'При необходимости укажите основание'}/>
     </label>
     {invalid&&<p className="client3-stage5-error" role="alert">Проверьте количество: не более 1000 шт. и только свободный остаток.</p>}
     {error&&<p className="client3-stage5-error" role="alert">{error}</p>}
     <div className="client3-stage5-actions">
       {review&&<button type="button" className="secondary" disabled={busy}
         onClick={()=>{setReview(false);setConfirmed(false)}}>Исправить</button>}
       <button type="button" className="client3-watch-bulk-confirm" disabled={review?!canReview||!confirmed:!canReview}
         onClick={()=>review?void save():(setError(''),setReview(true))}>
         {busy?'Сохранение…':review?'Сохранить '+modes[mode].title.toLowerCase():'Проверить '+selected.length+' позиций'}
       </button>
     </div>
   </>}
 </section>
}
