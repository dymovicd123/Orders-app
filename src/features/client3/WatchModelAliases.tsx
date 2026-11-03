import {useEffect,useState,type FormEvent} from 'react'
import type {WatchBrand} from '../../../shared/client3/watch-domain'

type Alias={id:number;aliasText:string;aliasKey:string}
type AliasResponse={ok:boolean;message?:string;rows?:Alias[];alreadyExists?:boolean}

/** Main-like learned spellings live in the selected product detail.
 * They are explicit admin associations, not fuzzy or automatic reassignment.
 */
export function WatchModelAliases({brand,modelId}:{brand:WatchBrand;modelId:number}){
 const [rows,setRows]=useState<Alias[]>([])
 const [draft,setDraft]=useState('')
 const [loading,setLoading]=useState(true)
 const [busy,setBusy]=useState(false)
 const [error,setError]=useState('')
 const [notice,setNotice]=useState('')
 const [revision,setRevision]=useState(0)
 useEffect(()=>{
   const controller=new AbortController()
   setLoading(true);setError('');setNotice('');setRows([])
   const q=new URLSearchParams({brand,watchProductId:String(modelId)})
   void fetch('/api/client3/watches/catalog/model-aliases?'+q,{
     credentials:'include',cache:'no-store',signal:controller.signal,
   }).then(async res=>{
     const data=await res.json() as AliasResponse
     if(!res.ok||!data.ok)throw Error(data.message||'Не удалось загрузить альтернативные названия.')
     if(!controller.signal.aborted)setRows(data.rows||[])
   }).catch(e=>{if(!controller.signal.aborted)setError(
     e instanceof Error?e.message:'Ошибка справочника псевдонимов.')})
    .finally(()=>{if(!controller.signal.aborted)setLoading(false)})
   return ()=>controller.abort()
 },[brand,modelId,revision])
 async function change(method:'POST'|'DELETE',extra:Record<string,unknown>){
   const res=await fetch('/api/client3/watches/catalog/model-aliases',{
     method,credentials:'include',cache:'no-store',
     headers:{'Content-Type':'application/json'},
     body:JSON.stringify({brand,watchProductId:modelId,...extra}),
   })
   const result=await res.json() as AliasResponse
   if(!res.ok||!result.ok)throw Error(result.message||'Не удалось изменить название.')
   return result
 }
 const add=async(e:FormEvent<HTMLFormElement>)=>{
   e.preventDefault()
   const alias=draft.trim().replace(/\s+/g,' ')
   if(busy||!alias)return
   setBusy(true);setError('');setNotice('')
   try{
     const result=await change('POST',{alias})
     setDraft('')
     setNotice(result.alreadyExists?'Псевдоним уже привязан к этой модели.':
       'Дополнительное написание сохранено. Заказы и складские SKU не изменились.')
     setRevision(x=>x+1)
   }catch(e){setError(e instanceof Error?e.message:'Не удалось сохранить псевдоним.')}
   finally{setBusy(false)}
 }
 const remove=async(row:Alias)=>{
   if(busy||!window.confirm('Убрать написание «'+row.aliasText+'» из этой модели? Сам товар и заказы сохранятся.'))return
   setBusy(true);setError('');setNotice('')
   try{
     await change('DELETE',{aliasId:row.id})
     setNotice('Псевдоним удалён. Товар и его SKU сохранены.')
     setRevision(x=>x+1)
   }catch(e){setError(e instanceof Error?e.message:'Не удалось удалить псевдоним.')}
   finally{setBusy(false)}
 }
 return <section className="client3-watch-model-aliases" aria-label="Другие названия модели">
   <div className="client3-watch-alias-head"><div>
     <strong>Другие названия модели</strong>
     <small>Как в Main: сохранённые написания автоматически находят эту же модель при создании заказа. Без изменения складского SKU.</small>
   </div></div>
   {loading?<p>Загружаем написания…</p>:<div className="client3-watch-alias-items">
     {rows.map(row=><span className="client3-watch-alias-pill" key={row.id}>
       <span>{row.aliasText}</span>
       <button type="button" className="secondary compact" disabled={busy}
         aria-label={'Убрать название '+row.aliasText}
         onClick={()=>void remove(row)}>×</button>
     </span>)}
     {!rows.length&&<small>Псевдонимов ещё нет. Модель распознаётся по основному названию.</small>}
   </div>}
   <form className="client3-watch-alias-form" onSubmit={e=>void add(e)}>
     <label><span>Дополнительное написание</span>
       <input value={draft} required maxLength={150} disabled={busy}
         placeholder="Например: сокращённое название модели"
         onChange={e=>setDraft(e.target.value)}/>
     </label>
     <button className="secondary compact" type="submit" disabled={busy||!draft.trim()||rows.length>=20}>
       {busy?'Сохраняю…':'+ Добавить написание'}</button>
   </form>
   {error&&<p role="alert" className="watch-catalog-editor-error">{error}</p>}
   {notice&&<p role="status" className="watch-catalog-editor-notice">{notice}</p>}
 </section>
}
