import {useState} from 'react'
import {watchReferenceLabel,type WatchBrand} from '../../../shared/client3/watch-domain'
import '../../styles/client3-watch-retired-history.css'
type Item={watchProductId:number;modelName:string;productActive:number;watchVariantId:number|null;variantActive:number|null;gender:string|null;movement:string|null;braceletMaterial:string|null;dialColor:string|null;braceletColor:string|null;modelRetiredAt:string;variantRetiredAt:string;historicItemCount:number}
const label=(kind:'movements'|'bracelets'|'dials'|'leatherColors',raw:string|null)=>raw?watchReferenceLabel(kind,raw):'—'
const when=(r:Item)=>{
 const raw=r.productActive===0?(r.modelRetiredAt||r.variantRetiredAt):(r.variantRetiredAt||r.modelRetiredAt)
 if(!raw)return 'Дата не зафиксирована'
 const d=new Date(raw)
 return Number.isNaN(d.getTime())?raw:d.toLocaleString('ru-RU',{timeZone:'Asia/Almaty',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'})
}
export function WatchCatalogRetiredHistory({brand}:{brand:WatchBrand}){
 const [open,setOpen]=useState(false)
 const [rows,setRows]=useState<Item[]>([])
 const [offset,setOffset]=useState(0)
 const [more,setMore]=useState(false)
 const [busy,setBusy]=useState(false)
 const [error,setError]=useState('')
 const load=async(start:number)=>{
   setBusy(true);setError('')
   try{
     const q=new URLSearchParams({brand,offset:String(start)})
     const response=await fetch('/api/client3/watches/catalog/retired?'+q,{credentials:'include',cache:'no-store'})
     const data=await response.json() as {ok:boolean;message?:string;rows:Item[];hasMore:boolean}
     if(!response.ok||!data.ok)throw Error(data.message||'Архив недоступен')
     setRows(old=>start?[...old,...data.rows]:data.rows)
     setOffset(start+data.rows.length);setMore(Boolean(data.hasMore))
   }catch(e){setError(e instanceof Error?e.message:'Ошибка загрузки архива.')}
   finally{setBusy(false)}
 }
 return <>
   <button className="secondary compact" type="button" onClick={()=>{setOpen(true);void load(0)}}>Удалённые</button>
   {open&&<div className="modal-backdrop watch-retired-backdrop" role="presentation"
     onMouseDown={e=>{if(e.target===e.currentTarget&&!busy)setOpen(false)}}>
     <section className="modal-card watch-retired-modal" role="dialog" aria-modal="true" aria-label={'Архив каталога '+brand}>
       <header className="watch-retired-header"><div><span className="card-label">АРХИВ · {brand}</span>
         <h3>Удалённые товары и комплектации</h3>
         <p>Исторические SKU, заказы и движения сохранены. В действующие списки удалённые часы не попадают.</p>
       </div><button type="button" className="secondary compact" disabled={busy} onClick={()=>setOpen(false)}>Закрыть</button></header>
       {error&&<p role="alert" className="watch-orders-error">{error}</p>}
       {busy&&!rows.length&&<p role="status">Загрузка архива…</p>}
       <div className="watch-retired-list">
         {rows.map((r,i)=><article key={r.watchProductId+'-'+(r.watchVariantId||'model')+'-'+i}>
           <div><strong>{r.modelName}</strong>
             <small>{r.productActive===0?'Удалён товар':'Удалена комплектация'} · {when(r)}</small>
             {r.watchVariantId&&<span>{[
               r.gender==='male'?'Мужские':'Женские',label('movements',r.movement),
               label('bracelets',r.braceletMaterial),label('dials',r.dialColor),
               r.braceletColor?'Ремешок: '+label('leatherColors',r.braceletColor):''
             ].filter(Boolean).join(' · ')}</span>}
             <small>Исторических позиций заказов: {Number(r.historicItemCount||0)}</small>
           </div><span className="watch-retired-status">В архиве</span>
         </article>)}
         {!rows.length&&!busy&&!error&&<p>Удалённых товаров этого бренда нет.</p>}
       </div>
       {more&&<button className="secondary compact" type="button" disabled={busy}
         onClick={()=>void load(offset)}>{busy?'Загрузка…':'Показать ещё'}</button>}
       <p className="watch-retired-note">Архив только для просмотра. Восстановление — отдельная операция без автоматического возвращения старых остатков.</p>
     </section>
   </div>}
 </>
}
