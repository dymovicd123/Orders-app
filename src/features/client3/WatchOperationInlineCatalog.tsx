import {useEffect,useRef,useState,type FormEvent} from 'react'
import {WATCH_OPTIONS,watchReferenceLabel,type WatchBrand,type WatchVariantInput} from '../../../shared/client3/watch-domain'

type Reference={kind:string;value:string}
type Result={ok?:boolean;message?:string;watchProductId?:number;watchVariantId?:number;canonicalVariantId?:number}
async function post(path:string,payload:Record<string,unknown>):Promise<Result>{
 const response=await fetch(path,{method:'POST',credentials:'include',
   headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)})
 const result=await response.json() as Result
 if(!response.ok||!result.ok)throw new Error(result.message||'Не удалось зарегистрировать комплектацию.')
 return result
}

/** Inline watch adaptation of Main's missing-product/variant admission.
 * Creates canonical identity only; stock changes exclusively in the parent
 * confirmation step using Main's atomic inventory operation engine.
 */
export function WatchOperationInlineCatalog({brand,models,selectedModelId,onCreated,onCancel}:{
 brand:WatchBrand;models:readonly (readonly [number,string])[];selectedModelId:number|null;
 onCreated:(modelId:number,variantId:number)=>void;onCancel:()=>void
}){
 const [modelChoice,setModelChoice]=useState(selectedModelId?String(selectedModelId):'')
 const [modelName,setModelName]=useState('')
 const [gender,setGender]=useState<WatchVariantInput['gender']>('male')
 const [movement,setMovement]=useState('')
 const [braceletMaterial,setBraceletMaterial]=useState('')
 const [dialColor,setDialColor]=useState('')
 const [braceletColor,setBraceletColor]=useState('')
 const [referenceRows,setReferenceRows]=useState<Reference[]>([])
 const [loading,setLoading]=useState(true)
 const [busy,setBusy]=useState(false)
 const [error,setError]=useState('')
 const inFlight=useRef(false)
 useEffect(()=>{
   const controller=new AbortController()
   setLoading(true);setError('')
   void fetch('/api/client3/watches/references',{credentials:'include',
     cache:'no-store',signal:controller.signal})
     .then(async response=>{
       const result=await response.json() as {ok:boolean;message?:string;rows?:Reference[]}
       if(!response.ok||!result.ok)throw Error(result.message||'Не удалось загрузить справочники часов.')
       if(!controller.signal.aborted)setReferenceRows(result.rows||[])
     })
     .catch(cause=>{if(!controller.signal.aborted)setError(
       cause instanceof Error?cause.message:'Справочники недоступны.')})
     .finally(()=>{if(!controller.signal.aborted)setLoading(false)})
   return ()=>controller.abort()
 },[brand])
 const values=(kind:string)=>referenceRows.filter(x=>x.kind===kind).map(x=>x.value)
 const movements=[...new Set([...WATCH_OPTIONS.movements.map(x=>x.value),...values('movements')])]
 const bracelets=[...new Set([...WATCH_OPTIONS.braceletMaterials.map(x=>x.value),...values('bracelets')])]
 const dials=[...new Set([...WATCH_OPTIONS.dialColors.map(x=>x.value),...values('dials')])]
 const leatherColors=values('leatherColors')
 const selectedMovement=movements.includes(movement)?movement:(movements[0]||'')
 const selectedBracelet=bracelets.includes(braceletMaterial)?braceletMaterial:(bracelets[0]||'')
 const selectedDial=dials.includes(dialColor)?dialColor:(dials[0]||'')
 const selectedLeatherColor=leatherColors.includes(braceletColor)?braceletColor:(leatherColors[0]||'')
 const ready=!busy&&!loading&&!error&&Boolean(modelChoice)&&
   (modelChoice!=='new'||Boolean(modelName.trim()))&&
   selectedMovement&&selectedBracelet&&selectedDial&&
   (selectedBracelet!=='leather'||selectedLeatherColor)
 const save=async(e:FormEvent<HTMLFormElement>)=>{
   e.preventDefault()
   if(!ready||inFlight.current)return
   inFlight.current=true;setBusy(true);setError('')
   try{
     let modelId=Number(modelChoice)
     if(modelChoice==='new'){
       const model=await post('/api/client3/watches/catalog/models',{
         brand,modelName:modelName.trim(),
       })
       modelId=Number(model.watchProductId)
     }
     if(!Number.isSafeInteger(modelId)||modelId<1)throw Error('Выберите модель часов.')
     const variant=await post('/api/client3/watches/catalog/variants',{
       brand,watchProductId:modelId,gender,movement:selectedMovement,
       braceletMaterial:selectedBracelet,dialColor:selectedDial,
       braceletColor:selectedBracelet==='leather'?selectedLeatherColor:'',
     })
     if(!variant.watchVariantId)throw Error('Система не подтвердила комплектацию.')
     const provision=await post('/api/client3/watches/catalog/provision',{
       brand,watchVariantId:variant.watchVariantId,
     })
     if(!provision.canonicalVariantId)throw Error('Складская идентичность не подтверждена.')
     onCreated(modelId,variant.watchVariantId)
   }catch(cause){
     setError(cause instanceof Error?cause.message:'Не удалось создать комплект часов.')
   }finally{inFlight.current=false;setBusy(false)}
 }
 return <section className="stocktake-inline-add client3-stock-inline-add"
   aria-label="Добавление недостающих часов в операцию">
   <div className="stocktake-e-product-nav stocktake-e-product-nav-v5">
     <div><span>Нужного товара или варианта нет в каталоге</span>
       <h4>Добавить модель или комплектацию часов</h4>
       <small>Как в Main: сначала регистрируем характеристики, затем вводим количество в этой же операции.</small>
     </div>
     <button type="button" className="secondary compact" disabled={busy}
       onClick={onCancel}>Закрыть</button>
   </div>
   {error&&<p role="alert" className="stocktake-inline-notice w6-notice-error">{error}</p>}
   <form className="subgrid inventory-subgrid catalog-variant-form-grid w6-variant-form-grid"
     onSubmit={e=>void save(e)}>
     <label>Модель часов<select required value={modelChoice} disabled={busy}
       onChange={e=>setModelChoice(e.target.value)}>
       <option value="">Выберите модель</option>
       {models.map(([id,name])=><option value={String(id)} key={id}>{name}</option>)}
       <option value="new">+ Новая модель</option>
     </select></label>
     {modelChoice==='new'&&<label>Название новой модели
       <input required maxLength={150} value={modelName} disabled={busy}
         placeholder="Название часов" onChange={e=>setModelName(e.target.value)}/></label>}
     <label>Пол<select value={gender} disabled={busy}
       onChange={e=>setGender(e.target.value as typeof gender)}>
       {WATCH_OPTIONS.genders.map(x=><option value={x.value} key={x.value}>{x.label}</option>)}
     </select></label>
     <label>Механизм<select required value={selectedMovement} disabled={busy||loading}
       onChange={e=>setMovement(e.target.value)}>
       {movements.map(x=><option value={x} key={x}>{watchReferenceLabel('movements',x)}</option>)}
     </select></label>
     <label>Браслет<select required value={selectedBracelet} disabled={busy||loading}
       onChange={e=>setBraceletMaterial(e.target.value)}>
       {bracelets.map(x=><option value={x} key={x}>{watchReferenceLabel('bracelets',x)}</option>)}
     </select></label>
     <label>Цвет циферблата<select required value={selectedDial} disabled={busy||loading}
       onChange={e=>setDialColor(e.target.value)}>
       {dials.map(x=><option value={x} key={x}>{watchReferenceLabel('dials',x)}</option>)}
     </select></label>
     {selectedBracelet==='leather'&&<label>Цвет кожаного ремешка
       <select required value={selectedLeatherColor} disabled={busy||loading}
         onChange={e=>setBraceletColor(e.target.value)}>
         {leatherColors.map(x=><option value={x} key={x}>{watchReferenceLabel('leatherColors',x)}</option>)}
       </select>
       <small>Дополнительные цвета можно внести во вкладке «Справочники».</small>
     </label>}
     <div className="client3-stock-inline-actions">
       <button className="primary" type="submit" disabled={!ready}>
         {busy?'Создаём…':'Добавить комплектацию к операции'}</button>
       <small>При создании комплектации фактические остатки не изменяются.</small>
     </div>
   </form>
 </section>
}
