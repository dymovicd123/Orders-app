import { useEffect, useState, type FormEvent } from 'react'
import { WATCH_OPTIONS, type WatchBrand, type WatchVariantInput } from '../../../shared/client3/watch-domain'
import '../../styles/client3-watch-catalog-editor.css'

type CatalogRow={
  watchProductId:number
  modelName:string
  catalogProductId:number|null
  productActive:number
  watchVariantId:number|null
  catalogVariantId:number|null
  gender:string|null
  movement:string|null
  braceletMaterial:string|null
  dialColor:string|null
  braceletColor:string|null
  variantActive:number|null
}
type Api={ok:boolean;message?:string;rows?:CatalogRow[];watchProductId?:number;watchVariantId?:number;alreadyExists?:boolean}
async function callApi(url:string,init?:RequestInit):Promise<Api> {
  const response=await fetch(url,{credentials:'include',cache:'no-store',...init})
  const value=await response.json() as Api
  if(!response.ok||!value.ok)throw new Error(value.message||'Не удалось сохранить изменения')
  return value
}
function textFor(choices:readonly {value:string;label:string}[],code:string|null) {
  return choices.find(item=>item.value===code)?.label||code||'—'
}

/** An unmapped watch is a draft. It cannot be sold or counted as physical stock. */
export function WatchCatalogEditor({brand}:{brand:WatchBrand}) {
  const [rows,setRows]=useState<CatalogRow[]>([])
  const [modelName,setModelName]=useState('')
  const [modelId,setModelId]=useState(0)
  const [gender,setGender]=useState<WatchVariantInput['gender']>('male')
  const [movement,setMovement]=useState<WatchVariantInput['movement']>('quartz')
  const [braceletMaterial,setBraceletMaterial]=useState<WatchVariantInput['braceletMaterial']>('steel')
  const [dialColor,setDialColor]=useState<WatchVariantInput['dialColor']>('black')
  const [braceletColor,setBraceletColor]=useState('')
  const [busy,setBusy]=useState(false)
  const [loading,setLoading]=useState(false)
  const [error,setError]=useState('')
  const [notice,setNotice]=useState('')
  const [reload,setReload]=useState(0)
  const models=Array.from(new Map<number,{id:number;name:string}>(
    rows.map(row=>[row.watchProductId,{id:row.watchProductId,name:row.modelName}])
  ).values())
  useEffect(()=>{
    const controller=new AbortController()
    setLoading(true);setRows([]);setError('')
    void callApi('/api/client3/watches/catalog?brand='+encodeURIComponent(brand),{signal:controller.signal})
      .then(data=>{if(!controller.signal.aborted){
        setRows(data.rows||[])
        setModelId(current=>(data.rows||[]).some(x=>x.watchProductId===current)?current:data.rows?.[0]?.watchProductId||0)
      }}).catch(cause=>{
        if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'Не удалось загрузить каталог')
      }).finally(()=>{if(!controller.signal.aborted)setLoading(false)})
    return ()=>controller.abort()
  },[brand,reload])
  const post=async(path:string,payload:Record<string,unknown>)=>
    callApi(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...payload,brand})})
  const createModel=async(e:FormEvent<HTMLFormElement>)=>{
    e.preventDefault();if(busy)return
    setBusy(true);setError('');setNotice('')
    try{
      const result=await post('/api/client3/watches/catalog/models',{modelName})
      setModelName('')
      setModelId(result.watchProductId||0)
      setNotice(result.alreadyExists?'Модель уже существует.':'Модель добавлена. Теперь укажите комплектацию.')
      setReload(x=>x+1)
    }catch(cause){setError(cause instanceof Error?cause.message:'Не удалось добавить модель')}
    finally{setBusy(false)}
  }
  const provisionVariant=async(variantId:number)=>{
    if(busy)return
    setBusy(true);setError('');setNotice('')
    try{
      const result=await post('/api/client3/watches/catalog/provision',{watchVariantId:variantId})
      if(!result.ok)throw new Error(result.message||'Не удалось подготовить SKU')
      setNotice('Складской SKU подготовлен. Физическое количество не изменилось. Для наличия оформите приход.')
      setReload(x=>x+1)
    }catch(cause){
      setError(cause instanceof Error?cause.message:'Не удалось подготовить SKU')
    }finally{setBusy(false)}
  }
  const createVariant=async(e:FormEvent<HTMLFormElement>)=>{
    e.preventDefault();if(busy||modelId<=0)return
    setBusy(true);setError('');setNotice('')
    try{
      const result=await post('/api/client3/watches/catalog/variants',{
        watchProductId:modelId,gender,movement,braceletMaterial,dialColor,
        braceletColor:braceletMaterial==='leather'?braceletColor:'',
      })
      setNotice(result.alreadyExists?'Такая комплектация уже существует.':'Комплектация зарегистрирована без изменения остатков.')
      setReload(x=>x+1)
    }catch(cause){setError(cause instanceof Error?cause.message:'Не удалось добавить комплектацию')}
    finally{setBusy(false)}
  }
  return <section className="watch-catalog-editor">
    <header><h3>Управление моделями · {brand}</h3>
      <p>Новые часы сначала регистрируются в каталоге. До связи с точным складским SKU они не доступны для продажи или прихода.</p>
    </header>
    {error&&<p role="alert" className="watch-catalog-editor-error">{error}</p>}
    {notice&&<p role="status" className="watch-catalog-editor-notice">{notice}</p>}
    <div className="watch-catalog-editor-forms">
      <form onSubmit={e=>void createModel(e)}>
        <h4>Новая модель</h4>
        <label>Название модели<input value={modelName} maxLength={150}
          onChange={e=>setModelName(e.target.value)} placeholder="Название часов" required/></label>
        <button type="submit" disabled={busy||!modelName.trim()}>Добавить модель</button>
      </form>
      <form onSubmit={e=>void createVariant(e)}>
        <h4>Комплектация</h4>
        <label>Модель<select value={modelId} onChange={e=>setModelId(Number(e.target.value))} required>
          <option value={0}>Выберите модель</option>
          {models.map(model=><option key={model.id} value={model.id}>{model.name}</option>)}
        </select></label>
        <label>Пол<select value={gender} onChange={e=>setGender(e.target.value as typeof gender)}>
          {WATCH_OPTIONS.genders.map(x=><option key={x.value} value={x.value}>{x.label}</option>)}
        </select></label>
        <label>Механизм<select value={movement} onChange={e=>setMovement(e.target.value as typeof movement)}>
          {WATCH_OPTIONS.movements.map(x=><option key={x.value} value={x.value}>{x.label}</option>)}
        </select></label>
        <label>Браслет<select value={braceletMaterial} onChange={e=>setBraceletMaterial(e.target.value as typeof braceletMaterial)}>
          {WATCH_OPTIONS.braceletMaterials.map(x=><option key={x.value} value={x.value}>{x.label}</option>)}
        </select></label>
        <label>Цвет циферблата<select value={dialColor} onChange={e=>setDialColor(e.target.value as typeof dialColor)}>
          {WATCH_OPTIONS.dialColors.map(x=><option key={x.value} value={x.value}>{x.label}</option>)}
        </select></label>
        {braceletMaterial==='leather'&&<label>Цвет кожаного ремешка
          <input required value={braceletColor} maxLength={80} onChange={e=>setBraceletColor(e.target.value)}
            placeholder="Чёрный, коричневый…"/></label>}
        <button type="submit" disabled={busy||!modelId}>Добавить комплектацию</button>
      </form>
    </div>
    <h4>Зарегистрированные часы</h4>
    {loading?<p>Загрузка…</p>:models.length===0?<p>Для бренда пока не зарегистрированы модели.</p>:
      <div className="watch-catalog-editor-list">
        {rows.map(row=><article key={row.watchVariantId||'model-'+row.watchProductId}>
          <strong>{row.modelName}</strong>
          <span>{row.watchVariantId
            ? [textFor(WATCH_OPTIONS.genders,row.gender),textFor(WATCH_OPTIONS.movements,row.movement),
                textFor(WATCH_OPTIONS.braceletMaterials,row.braceletMaterial),
                textFor(WATCH_OPTIONS.dialColors,row.dialColor),
                ...(row.braceletColor?['Ремешок: '+row.braceletColor]:[])].join(' · ')
            : 'Без комплектаций'}</span>
          <small>{row.catalogProductId&&row.catalogVariantId?'Связан со складом':'Не привязан к складу — продажа недоступна'}</small>
          {row.watchVariantId&&row.productActive===1&&row.variantActive===1&&(!row.catalogProductId||!row.catalogVariantId)&&
            <button type="button" disabled={busy} onClick={()=>void provisionVariant(row.watchVariantId!)}>
              Подготовить складской SKU
            </button>}
        </article>)}
      </div>}
  </section>
}
