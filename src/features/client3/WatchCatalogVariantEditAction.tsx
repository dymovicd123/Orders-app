import {useState,type FormEvent} from 'react'
import {WATCH_OPTIONS,type WatchBrand,type WatchVariantInput} from '../../../shared/client3/watch-domain'

type Row={
  watchProductId:number;watchVariantId:number|null;catalogVariantId:number|null
  gender:string|null;movement:string|null;braceletMaterial:string|null
  dialColor:string|null;braceletColor:string|null
}
type Choices={movements:string[];bracelets:string[];dials:string[]}
type Props={brand:WatchBrand;row:Row;choices:Choices;strapColors:string[];
  disabled?:boolean;onSaved:()=>void;onCreateReplacement:(variant:WatchVariantInput)=>void}
const request=async (brand:WatchBrand,body:Record<string,unknown>)=>{
 const response=await fetch('/api/client3/watches/catalog/variants',{
   method:'PATCH',credentials:'include',cache:'no-store',
   headers:{'Content-Type':'application/json'},body:JSON.stringify({brand,...body}),
 })
 const value=await response.json() as {ok?:boolean;message?:string}
 if(!response.ok||!value.ok)throw new Error(value.message||'Не удалось обновить позицию.')
}
const choice=(values:readonly string[],current:string)=>{
 const selected=current&& !values.includes(current)?[current]:[]
 return [...selected,...values]
}
const label=(value:string)=>[
 ...WATCH_OPTIONS.movements,...WATCH_OPTIONS.braceletMaterials,...WATCH_OPTIONS.dialColors
].find(x=>x.value===value)?.label.toLocaleUpperCase('ru-RU')||value.toLocaleUpperCase('ru-RU')

/** Main's catalog variant editor, adapted for watch identity and shared reference values. */
export function WatchCatalogVariantEditAction({brand,row,choices,strapColors,disabled,onSaved,onCreateReplacement}:Props){
 const initial=():WatchVariantInput=>({
   gender:row.gender==='female'?'female':'male',
   movement:row.movement||'quartz',
   braceletMaterial:row.braceletMaterial||'steel',
   dialColor:row.dialColor||'black',
   braceletColor:row.braceletColor||'',
 })
 const [open,setOpen]=useState(false)
 const [draft,setDraft]=useState<WatchVariantInput>(initial)
 const [busy,setBusy]=useState(false)
 const [error,setError]=useState('')
 const linked=Boolean(row.catalogVariantId)
 const save=async(event:FormEvent<HTMLFormElement>)=>{
   event.preventDefault()
   if(busy||!row.watchVariantId)return
   setBusy(true);setError('')
   try{
     await request(brand,{
       watchProductId:row.watchProductId,watchVariantId:row.watchVariantId,
       expected:initial(),...draft,
       braceletColor:draft.braceletMaterial==='leather'?draft.braceletColor:'',
     })
     setOpen(false);onSaved()
   }catch(e){setError(e instanceof Error?e.message:'Не удалось сохранить позицию.')}
   finally{setBusy(false)}
 }
 return <>
   <button className="secondary compact" type="button" disabled={disabled}
     onClick={()=>{setDraft(initial());setError('');setOpen(true)}}>
     Изменить характеристики
   </button>
   {open&&<div className="modal-backdrop catalog-retirement-backdrop" role="presentation"
     onMouseDown={event=>{if(event.target===event.currentTarget&&!busy)setOpen(false)}}>
     <section className="modal-card catalog-retirement-modal client3-watch-edit-modal"
       role="dialog" aria-modal="true" aria-labelledby={'watch-edit-'+row.watchVariantId}>
       <div className="catalog-retirement-head">
         <span className="card-label">Каталог · {brand}</span>
         <h3 id={'watch-edit-'+row.watchVariantId}>Характеристики позиции</h3>
         <p>Размер и длина не используются. Все характеристики берутся из общих справочников.</p>
       </div>
       {linked?<div className="catalog-retirement-explanation">
         <strong>Складской SKU связан</strong>
         <p>Если позиция ещё не использовалась в заказах, приходах, движениях или резервах,
           изменения сохранятся под прежним складским ID, как в Main.
           Иначе сервер не позволит изменить её историю — можно создать новую комплектацию.</p>
       </div>:null}
       <form className="catalog-variant-form-grid client3-watch-edit-fields" onSubmit={event=>void save(event)}>
         <label>Пол
           <select value={draft.gender} onChange={e=>setDraft({...draft,gender:e.target.value as WatchVariantInput['gender']})}>
             {WATCH_OPTIONS.genders.map(x=><option key={x.value} value={x.value}>{x.label}</option>)}
           </select>
         </label>
         <label>Механизм
           <select value={draft.movement} onChange={e=>setDraft({...draft,movement:e.target.value})}>
             {choice(choices.movements,draft.movement).map(value=><option key={value} value={value}>{label(value)}</option>)}
           </select>
         </label>
         <label>Браслет
           <select value={draft.braceletMaterial} onChange={e=>setDraft({...draft,braceletMaterial:e.target.value,
             braceletColor:e.target.value==='leather'?draft.braceletColor:''})}>
             {choice(choices.bracelets,draft.braceletMaterial).map(value=><option key={value} value={value}>{label(value)}</option>)}
           </select>
         </label>
         <label>Цвет циферблата
           <select value={draft.dialColor} onChange={e=>setDraft({...draft,dialColor:e.target.value})}>
             {choice(choices.dials,draft.dialColor).map(value=><option key={value} value={value}>{label(value)}</option>)}
           </select>
         </label>
         {draft.braceletMaterial==='leather'&&<label>Цвет кожаного ремешка
           <select value={draft.braceletColor||''} required
             onChange={e=>setDraft({...draft,braceletColor:e.target.value})}>
             <option value="">Выберите цвет</option>
             {choice(strapColors,draft.braceletColor||'').map(value=><option key={value} value={value}>{value.toLocaleUpperCase('ru-RU')}</option>)}
           </select>
         </label>}
         {error&&<p className="catalog-retirement-modal-error" role="alert">{error}</p>}
         {linked&&error&&<button className="secondary" type="button" onClick={()=>{
           const comparable=(v:WatchVariantInput)=>JSON.stringify([
             v.gender,v.movement,v.braceletMaterial,v.dialColor,v.braceletMaterial==='leather'?v.braceletColor||'':'',
           ])
           if(comparable(draft)===comparable(initial())){
             setError('Укажите хотя бы одну новую характеристику для замены.')
             return
           }
           onCreateReplacement({...draft,braceletColor:draft.braceletMaterial==='leather'?draft.braceletColor:''})
           setOpen(false)
         }}>Создать новую комплектацию вместо изменения старой</button>}
         <div className="modal-actions">
           <button type="submit" className="primary" disabled={busy}> {busy?'Сохранение…':'Сохранить изменения'}</button>
           <button type="button" className="secondary" disabled={busy} onClick={()=>setOpen(false)}>Отмена</button>
         </div>
       </form>
     </section>
   </div>}
 </>
}
