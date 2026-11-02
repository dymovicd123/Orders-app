import {useCallback,useEffect,useMemo,useRef,useState} from 'react'
import {StocktakeProductChoice,StocktakeSizeCountCell} from '../inventory/views/StocktakeSharedInputs'
import {WatchOperationInlineCatalog} from './WatchOperationInlineCatalog'
import {WATCH_OPTIONS,type WatchBrand} from '../../../shared/client3/watch-domain'
import '../../styles/182-inventory-stocktake-human.css'
import '../../styles/183-inventory-stocktake-workflow.css'
import '../../styles/185-inventory-stocktake-state.css'
import '../../styles/188e-inventory-stocktake-sessions.css'
import '../../styles/188e4-stocktake-usability.css'
import '../../styles/188k1-stocktake-inline-add.css'
import '../../styles/193-unified-inventory-operations.css'
import '../../styles/client3-watch-main-warehouse.css'

type Source='office'|'showcase'
type Operation='arrival'|'writeoff'|'count'|'transfer'
type Stage='select'|'quantities'|'review'
type Row={
  watchProductId:number;modelName:string;watchVariantId:number|null;
  catalogVariantId:number|null;catalogProductId:number|null;productActive:number;variantActive:number;
  gender:string|null;movement:string|null;braceletMaterial:string|null;dialColor:string|null;braceletColor:string|null;
  officePhysical:number;officeReserved:number;showcasePhysical:number;showcaseReserved:number
}
type Api={ok:boolean;rows?:Row[];message?:string;attention?:string;code?:string}
const titles:Record<Operation,{name:string;hint:string;input:string}>={
  arrival:{name:'Приход',hint:'Добавить фактически полученные часы',input:'Поступило'},
  writeoff:{name:'Списание',hint:'Списать свободный остаток с указанием причины',input:'Списать'},
  count:{name:'Корректировка',hint:'Установить фактическое количество по результатам пересчёта',input:'Фактически'},
  transfer:{name:'Перемещение',hint:'Перенести свободные часы между точками',input:'Переместить'},
}
const field=(list:readonly {value:string;label:string}[],v:string|null)=>
  list.find(x=>x.value===v)?.label||v||'—'
const location=(source:Source)=>source==='office'?'Офис':'Витрина'
const number=(n:unknown)=>Number.isFinite(Number(n))?Math.max(0,Number(n)):0
const sourceSnapshot=(row:Row,source:Source)=>{
  const physical=number(source==='office'?row.officePhysical:row.showcasePhysical)
  const reserved=number(source==='office'?row.officeReserved:row.showcaseReserved)
  return {physical,reserved,free:Math.max(0,physical-reserved)}
}
const exactName=(r:Row)=>[
  field(WATCH_OPTIONS.genders,r.gender),field(WATCH_OPTIONS.movements,r.movement),
  field(WATCH_OPTIONS.braceletMaterials,r.braceletMaterial),field(WATCH_OPTIONS.dialColors,r.dialColor),
  r.braceletColor?'Ремешок: '+r.braceletColor:'',
].filter(Boolean).join(' · ')
const validQuantity=(raw:string,mode:Operation)=>{
  if(!/^\d{1,7}$/.test(raw))return false
  const value=Number(raw)
  return Number.isSafeInteger(value)&&value>=(mode==='count'?0:1)&&
    value<=(mode==='count'?1_000_000:1000)
}

/**
 * Client3 adapter of Main's ONE unified stock operations workspace.
 * Like Main, a single mode/source picker can collect multiple exact SKU quantities
 * across different models, review them together and commit ONE atomic transaction.
 * No separate "bulk operations" screen or duplicate revision form.
 */
export function WatchWarehouseMain({brand,onStockChanged}:{
  brand:WatchBrand;onStockChanged?:()=>void
}){
  const [rows,setRows]=useState<Row[]>([])
  const [loading,setLoading]=useState(true)
  const [saving,setSaving]=useState(false)
  const [error,setError]=useState('')
  const [notice,setNotice]=useState('')
  const [reload,setReload]=useState(0)
  const [mode,setMode]=useState<Operation>('arrival')
  const [source,setSource]=useState<Source>('office')
  const [stage,setStage]=useState<Stage>('select')
  const [search,setSearch]=useState('')
  const [showInlineAdd,setShowInlineAdd]=useState(false)
  // Main's selected-product queue is separate from the active product editor.
  // A checkbox NEVER opens the quantity step, for any operation mode.
  const [selectedModelIdsBySource,setSelectedModelIdsBySource]=useState<Record<Source,number[]>>({
    office:[],showcase:[],
  })
  const selectedModelIds=selectedModelIdsBySource[source]
  const [selectedModel,setSelectedModel]=useState<number|null>(null)
  const [draftBySource,setDraftBySource]=useState<Record<Source,Record<number,string>>>({
    office:{},showcase:{},
  })
  const draft=draftBySource[source]
  const [reason,setReason]=useState('')
  const [confirmed,setConfirmed]=useState(false)
  const [shortageConfirmed,setShortageConfirmed]=useState(false)
  const requestRef=useRef<{fingerprint:string;id:string}|null>(null)
  const refresh=useCallback(()=>setReload(n=>n+1),[])
  useEffect(()=>{
    const controller=new AbortController()
    setLoading(true);setError('')
    void fetch('/api/client3/watches/catalog?brand='+encodeURIComponent(brand),{
      credentials:'include',cache:'no-store',signal:controller.signal,
    }).then(async response=>{
      const result=await response.json() as Api
      if(!response.ok||!result.ok)throw new Error(result.message||'Не удалось загрузить склад')
      if(!controller.signal.aborted)setRows(result.rows||[])
    }).catch(cause=>{if(!controller.signal.aborted)
      setError(cause instanceof Error?cause.message:'Ошибка склада')})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false)})
    return ()=>controller.abort()
  },[brand,reload])
  const variants=useMemo(()=>rows.filter(r=>
    r.watchVariantId&&r.catalogVariantId&&r.catalogProductId&&
    r.variantActive===1&&r.productActive===1
  ),[rows])
  // Main includes all active catalog products, even with ZERO registered variants.
  // Model-only rows must remain visible in arrival / correction workflows.
  const models=useMemo(()=>
    Array.from(new Map(rows.filter(r=>r.productActive===1)
      .map(r=>[r.watchProductId,r.modelName])).entries()),[rows])
  const current=variants.filter(v=>v.watchProductId===selectedModel)
  const selected=variants.filter(v=>selectedModelIds.includes(v.watchProductId)&&
    v.watchVariantId!==null&&draft[v.watchVariantId]!==undefined&&draft[v.watchVariantId]!=='')
  const selectedModels=models.filter(([id])=>selectedModelIds.includes(id))
  const selectedPositionCount=selectedModels.reduce((sum,[id])=>
    sum+variants.filter(v=>v.watchProductId===id).length,0)
  const chosenIndex=selectedModels.findIndex(([id])=>id===selectedModel)
  const toggleModel=(modelId:number)=>{
    if(saving)return
    const wasSelected=selectedModelIds.includes(modelId)
    setSelectedModelIdsBySource(prev=>({...prev,[source]:wasSelected?
      prev[source].filter(id=>id!==modelId):[...prev[source],modelId]}))
    if(wasSelected){
      // Never submit hidden quantities for a model removed from Main's queue.
      const ids=new Set(variants.filter(v=>v.watchProductId===modelId)
        .map(v=>v.watchVariantId).filter((id):id is number=>id!==null))
      setDraftBySource(prev=>({...prev,[source]:Object.fromEntries(
        Object.entries(prev[source]).filter(([id])=>!ids.has(Number(id)))
      )}))
      if(selectedModel===modelId)setSelectedModel(null)
    }
    setConfirmed(false);setShortageConfirmed(false);requestRef.current=null
  }
  const clearModels=()=>{
    setSelectedModelIdsBySource(prev=>({...prev,[source]:[]}))
    setDraftBySource(prev=>({...prev,[source]:{}}))
    setSelectedModel(null);setConfirmed(false);setShortageConfirmed(false)
    requestRef.current=null
  }
  const beginSelected=()=>{
    if(saving||selectedModels.length===0)return
    setSelectedModel(selectedModels[0][0])
    setShowInlineAdd(false);setError('');setNotice('')
    setStage('quantities')
  }
  const invalid=selected.some(v=>{
    const value=draft[v.watchVariantId!]
    return !validQuantity(value,mode)||(mode==='writeoff'||mode==='transfer')&&
      Number(value)>sourceSnapshot(v,source).free
  })
  const shortages=mode==='count'?selected.filter(v=>
    Number(draft[v.watchVariantId!])<sourceSnapshot(v,source).reserved):[]
  const ready=selected.length>0&&selected.length<=30&&!invalid&&
    (mode!=='writeoff'||reason.trim().length>0)&&!loading&&!saving
  const rowPhysical=variants.reduce((s,v)=>s+number(v.officePhysical)+number(v.showcasePhysical),0)
  const rowReserved=variants.reduce((s,v)=>s+number(v.officeReserved)+number(v.showcaseReserved),0)
  const reset=()=>{
    setStage('select');setSelectedModel(null);
    setDraftBySource({office:{},showcase:{}})
    setSelectedModelIdsBySource({office:[],showcase:[]});setSearch('')
    setReason('');setConfirmed(false);setShortageConfirmed(false);setError('');setNotice('')
    setShowInlineAdd(false)
    requestRef.current=null
  }
  const selectMode=(next:Operation)=>{
    if(saving||next===mode)return
    if((selected.length||selectedModelIdsBySource.office.length||selectedModelIdsBySource.showcase.length)&&
      !window.confirm('Сменить операцию и очистить выбранные товары и количества?'))return
    reset();setMode(next)
  }
  const selectSource=(next:Source)=>{
    if(saving||next===source)return
    // Same Main UX: numbers entered for the other point stay in its own draft.
    // Backend transactions are still one source at a time, never mixed.
    setSource(next);setStage('select');setSelectedModel(null)
    setShowInlineAdd(false);setConfirmed(false);setShortageConfirmed(false)
    setError('');setNotice('');requestRef.current=null
  }
  const setQuantity=(id:number,value:string)=>{
    if(value!==''&&!/^\d{0,7}$/.test(value))return
    setDraftBySource(prev=>{
      const next={...prev[source]}
      if(value==='')delete next[id]
      else next[id]=value
      return {...prev,[source]:next}
    })
    setConfirmed(false);setShortageConfirmed(false)
    requestRef.current=null
  }
  const review=()=>{
    if(!ready){setError('Проверьте выбранные комплектации, количество и свободный остаток.');return}
    setError('');setStage('review');setConfirmed(false)
  }
  const save=async()=>{
    if(!ready||!confirmed||(shortages.length>0&&!shortageConfirmed))return
    const items=selected.map(v=>{
      const original=sourceSnapshot(v,source)
      return {
        watchVariantId:v.watchVariantId,
        expectedPhysical:original.physical,
        ...(mode==='count'?{countedQuantity:Number(draft[v.watchVariantId!])}:
          {quantity:Number(draft[v.watchVariantId!])}),
      }
    })
    const endpoint=mode==='count'?'count-batch':'bulk'
    const payload=mode==='count'?
      {brand,source,confirmed:true,allowShortage:shortageConfirmed,items}:
      {brand,source,kind:mode,comment:reason.trim(),items}
    const fingerprint=JSON.stringify([endpoint,payload])
    if(requestRef.current?.fingerprint!==fingerprint)
      requestRef.current={fingerprint,id:'watch-main-operation-'+crypto.randomUUID()}
    setSaving(true);setError('')
    try{
      const response=await fetch('/api/client3/watches/stock/'+endpoint,{
        method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({...payload,requestId:requestRef.current.id}),
      })
      const result=await response.json() as Api
      if(!response.ok||!result.ok)
        throw new Error(result.message||'Складская операция не была подтверждена.')
      const total=selected.length
      setDraftBySource(prev=>({...prev,[source]:{}}))
      setSelectedModelIdsBySource(prev=>({...prev,[source]:[]}))
      setStage('select');setSelectedModel(null);setSearch('');setReason('')
      setConfirmed(false);setShortageConfirmed(false);setShowInlineAdd(false)
      requestRef.current=null
      setNotice(result.attention||'Операция сохранена: '+total+' комплектаций.')
      refresh();onStockChanged?.()
    }catch(cause){setError(cause instanceof Error?cause.message:'Не удалось сохранить операцию.')}
    finally{setSaving(false)}
  }
  return <div className="client3-main-stock">
    <div className="inventory-calm-head">
      <div><h3>Остатки</h3><p>Фактическое количество, резервы и свободные часы по обеим точкам.</p></div>
      <button type="button" className="secondary compact" disabled={loading||saving}
        onClick={refresh}>Обновить</button>
    </div>
    <div className="inventory-calm-summary client3-main-stock-totals">
      <div><small>В офисе</small><strong>{variants.reduce((s,v)=>s+number(v.officePhysical),0)}</strong></div>
      <div><small>На витрине</small><strong>{variants.reduce((s,v)=>s+number(v.showcasePhysical),0)}</strong></div>
      <div><small>В резерве</small><strong>{rowReserved}</strong></div>
      <div><small>Свободно</small><strong>{Math.max(0,rowPhysical-rowReserved)}</strong></div>
    </div>
    <div className="inventory-stocktake-panel stocktake-human-panel stocktake-session-v188e stocktake-reused-operations client3-main-stock-operation"
      data-unified-operation={mode==='count'?'manual_set':mode}>
      <div className="stocktake-e-head"><div><h3>Складские операции</h3>
        <p>Выберите операцию, укажите количество для нужных часов и сохраните всё вместе.</p></div></div>
      <div className="stocktake-e-start stocktake-e-start-v5 w6-operation-switch">
        <div className="stocktake-start-modes stocktake-start-modes-v5">
          {(['arrival','writeoff','count','transfer'] as const).map(value=>
            <button key={value} type="button" disabled={saving}
              data-operation={value==='count'?'manual_set':value}
              className={'stocktake-start-mode '+(mode===value?'is-active':'')}
              onClick={()=>selectMode(value)}><strong>{titles[value].name}</strong><span>{titles[value].hint}</span></button>)}
        </div>
      </div>
      <div className="w7-operation-location">
        <div><strong>{mode==='transfer'?'Перемещаем из':'Точка операции'}</strong>
          <small>Офис и витрина учитываются отдельно.</small></div>
        <div className="stocktake-source-switch stocktake-source-switch-v5" role="tablist"
          aria-label="Источник">
          {(['office','showcase'] as const).map(src=><button role="tab" type="button" key={src}
            aria-selected={source===src} disabled={saving}
            className={source===src?'is-active':''} onClick={()=>selectSource(src)}>{location(src)}</button>)}
        </div>
        {Object.keys(draftBySource[source==='office'?'showcase':'office']).length>0&&
          <small>В другой точке сохранены несохранённые числа. Они не будут потеряны при переключении.</small>}
        {mode==='transfer'&&<div className="w7-transfer-target"><span aria-hidden="true">→</span>
          <strong>{location(source==='office'?'showcase':'office')}</strong></div>}
      </div>
      {error&&<div className="stocktake-inline-notice w6-notice-error" role="alert">{error}</div>}
      {notice&&<div className="stocktake-inline-notice" role="status">{notice}</div>}
      {loading?<div className="stocktake-inline-notice">Загружаем каталог и остатки…</div>:
      stage==='select'?<section className="stocktake-e-start stocktake-e-start-v5">
        <div className="stocktake-start-intro">
          <span className="stocktake-step-kicker">Шаг 1 · Выбор товаров</span>
          <h4>Какие часы хотите {mode==='arrival'?'принять':mode==='writeoff'?'списать':
            mode==='transfer'?'переместить':'пересчитать'}?</h4>
          <p>Можно выбрать несколько моделей и комплектаций. Все выбранные позиции сохраняются одной операцией.</p>
        </div>
        <div className="stocktake-selective-picker stocktake-selective-picker-v5">
          <div className="stocktake-selective-head">
            <label><span>Найдите модель</span><input placeholder="Название модели…"
              value={search} onChange={e=>setSearch(e.target.value)}/></label>
            <div className="stocktake-selective-count">
              <strong>{selectedModels.length?
                selectedModels.length+' товаров выбрано':'Выберите товары'}</strong>
              <span>{selectedModels.length?
                selectedPositionCount+' комплектаций':'Можно выбрать один или несколько товаров'}</span>
            </div>
          </div>
          {selectedModels.length>0&&<div className="stocktake-selective-queue">
            <div className="stocktake-selective-queue-head">
              <div><strong>Вы будете изменять</strong>
                <span>{selectedModels.length} товаров · {selectedPositionCount} комплектаций</span></div>
              <button className="ghost compact" type="button" disabled={saving}
                onClick={clearModels}>Очистить</button>
            </div>
            <div className="stocktake-selective-chips">
              {selectedModels.map(([id,name])=><button key={id} type="button"
                className="stocktake-selective-chip" disabled={saving}
                title="Убрать товар из операции" onClick={()=>toggleModel(id)}>
                <span>{name}</span>
                <small>{variants.filter(v=>v.watchProductId===id).length} поз.</small>
                <b aria-hidden="true">×</b>
              </button>)}
            </div>
          </div>}
          <div className="stocktake-selective-list stocktake-selective-list-v5">
            {[...models].filter(([,name])=>name.toLocaleLowerCase('ru-RU')
              .includes(search.trim().toLocaleLowerCase('ru-RU')))
              .sort((a,b)=>Number(selectedModelIds.includes(b[0]))-
                Number(selectedModelIds.includes(a[0]))||
                a[1].localeCompare(b[1],'ru'))
              .map(([id,name])=>{
                const count=variants.filter(v=>v.watchProductId===id).length
                const checked=selectedModelIds.includes(id)
                return <StocktakeProductChoice key={id} checked={checked}
                  onToggle={()=>toggleModel(id)}
                  name={name} description={count?
                    count+' поз.'+(checked?' · выбрано':''):
                    'Комплектаций пока нет'+(checked?' · выбрано':'')}/>
              })}
            {!models.length?<div className="stocktake-product-list-empty">
              В каталоге нет моделей часов выбранного бренда.
              {mode==='arrival'||mode==='count'?' Добавьте новую модель прямо здесь.':''}
            </div>:!models.some(([,name])=>name.toLocaleLowerCase('ru-RU')
              .includes(search.trim().toLocaleLowerCase('ru-RU')))&&
              <div className="stocktake-product-list-empty">
                По поиску ничего не найдено. Выбранные товары остаются в списке выше.
              </div>}
          </div>
          {(mode==='arrival'||mode==='count')&&<div className="client3-main-stock-missing">
            <button className="secondary compact" type="button" disabled={saving}
              onClick={()=>setShowInlineAdd(v=>!v)}>
              + Нужного товара или варианта нет в каталоге
            </button>
          </div>}
          {showInlineAdd&&(mode==='arrival'||mode==='count')&&
            <WatchOperationInlineCatalog key={brand+'-new-'+String(selectedModel)}
              brand={brand} models={models} selectedModelId={null}
              onCancel={()=>setShowInlineAdd(false)}
              onCreated={(modelId)=>{
                // Newly created product is added to the selection queue;
                // it must NOT launch the quantity editor automatically.
                setSelectedModelIdsBySource(prev=>({...prev,
                  [source]:Array.from(new Set([...prev[source],modelId]))}))
                setShowInlineAdd(false);setError('');refresh()
              }}/>}
        </div>
        <div className="stocktake-start-submit">
          <div>{selectedModels.length?
            'Выбрано: '+selectedModels.length+' товаров · '+selectedPositionCount+' комплектаций':
            'Выберите хотя бы один товар'}</div>
          <button className="primary stocktake-e-start-button" type="button"
            disabled={saving||!selectedModels.length} onClick={beginSelected}>
            Начать работу с выбранными товарами
          </button>
        </div>
      </section>:stage==='quantities'?<section className="client3-main-stock-step">
        <div className="stocktake-e-product-nav stocktake-e-product-nav-v5">
          <div><span>Шаг 2 · Количество</span>
            <h4>{models.find(([id])=>id===selectedModel)?.[1]||'Модель'}</h4>
            <small>Заполните нужные комплектации. Остальные оставьте пустыми.</small></div>
          <button type="button" className="ghost compact" disabled={saving}
            onClick={()=>{setShowInlineAdd(false);setStage('select')}}>← К выбору моделей</button>
        </div>
        <div className="client3-main-stock-model-navigation">
          <div className="client3-main-stock-model-navigation-head">
            <strong>Выбранные товары</strong>
            <span>{Math.max(0,chosenIndex+1)} из {selectedModels.length}</span>
          </div>
          <div className="client3-main-stock-model-navigation-list">
            {selectedModels.map(([id,name])=><button type="button" key={id}
              disabled={saving} aria-pressed={selectedModel===id}
              className={selectedModel===id?'is-active':''}
              onClick={()=>{setSelectedModel(id);setShowInlineAdd(false);setError('')}}>
              {name}
              <small>{variants.filter(v=>v.watchProductId===id).length} поз.</small>
            </button>)}
          </div>
        </div>
        {!current.length&&<div className="stocktake-product-list-empty">
          У этой модели пока нет складских комплектаций.
          {mode==='arrival'||mode==='count'?
            ' Создайте нужную комплектацию здесь, чтобы затем ввести количество.':
            ' Для этой операции нужны уже существующие часы со свободным остатком.'}
        </div>}
        <div className="client3-main-stock-skus client3-main-stock-skus-multi">
          {current.map(row=>{
            const original=sourceSnapshot(row,source)
            const id=row.watchVariantId!
            return <div className="client3-main-stock-sku client3-main-stock-sku-edit" key={id}>
              <strong>{exactName(row)}</strong>
              <span>По системе: {original.physical} · Резерв: {original.reserved} · Свободно: {original.free}</span>
              <StocktakeSizeCountCell cellId={id} size={titles[mode].input}
                currentQuantity={original.physical} value={draft[id]||''} disabled={saving}
                ariaLabel={titles[mode].input+' · '+row.modelName+' · '+exactName(row)}
                onChange={raw=>setQuantity(id,raw)}
                onClear={()=>setQuantity(id,'')}/>
            </div>
          })}
        </div>
        {(mode==='arrival'||mode==='count')&&<div className="client3-main-stock-missing">
          <button className="secondary compact" type="button" disabled={saving}
            onClick={()=>setShowInlineAdd(v=>!v)}>+ Добавить комплектацию этой модели</button>
        </div>}
        {showInlineAdd&&(mode==='arrival'||mode==='count')&&
          <WatchOperationInlineCatalog key={brand+'-variant-'+String(selectedModel)}
            brand={brand} models={models} selectedModelId={selectedModel}
            onCancel={()=>setShowInlineAdd(false)}
            onCreated={(modelId)=>{
              setSelectedModelIdsBySource(prev=>({...prev,
                [source]:Array.from(new Set([...prev[source],modelId]))}))
              setSelectedModel(modelId);setShowInlineAdd(false);setError('')
              refresh()
            }}/>}
        {mode==='writeoff'&&<label className="w6-stocktake-reason">
          Причина списания (обязательно)
          <input value={reason} maxLength={300} placeholder="Почему списываем часы"
            onChange={e=>{setReason(e.target.value);setConfirmed(false)}}/>
        </label>}
        {(mode==='arrival'||mode==='transfer')&&<label className="w6-stocktake-reason">
          Комментарий (необязательно)
          <input value={reason} maxLength={300}
            onChange={e=>{setReason(e.target.value);setConfirmed(false)}}/>
        </label>}
        <div className="stocktake-e-footer stocktake-e-footer-v4">
          <span>{selected.length} из 30 позиций{invalid?' · Проверьте количество и свободный остаток':''}</span>
          <button type="button" className="secondary compact" disabled={saving}
            onClick={()=>{setShowInlineAdd(false);setStage('select')}}>Изменить выбранные товары</button>
          {chosenIndex>=0&&chosenIndex<selectedModels.length-1&&
            <button type="button" className="secondary compact" disabled={saving}
              onClick={()=>{setSelectedModel(selectedModels[chosenIndex+1][0]);setShowInlineAdd(false)}}>
              Следующий товар →
            </button>}
          <button type="button" className="primary compact stocktake-review-button"
            disabled={!ready} onClick={review}>Проверить {selected.length} позиций</button>
        </div>
      </section>:<section className="client3-main-stock-step">
        <div className="stocktake-e-review-head">
          <div><span className="stocktake-step-kicker">Шаг 3 · Проверка</span>
            <h4>{titles[mode].name} · {selected.length} позиций</h4>
            <p>Склад ещё не изменён. Сверьте все комплектации и количества.</p></div>
          <button type="button" className="secondary compact" disabled={saving}
            onClick={()=>{setStage('select');setConfirmed(false)}}>← Исправить</button>
        </div>
        <div className="stocktake-e-review-list">
          {selected.map(row=>{
            const original=sourceSnapshot(row,source)
            const entered=Number(draft[row.watchVariantId!])
            const after=mode==='arrival'?original.physical+entered:
              mode==='count'?entered:original.physical-entered
            const target=sourceSnapshot(row,source==='office'?'showcase':'office')
            return <div className="stocktake-e-review-row" key={row.watchVariantId}>
              <div className="stocktake-e-review-name"><strong>{row.modelName}</strong>
                <span>{exactName(row)} · {location(source)}</span></div>
              <div className="stocktake-e-review-quantity"><span>По системе</span>
                <strong>{original.physical}</strong></div>
              <div className="stocktake-e-review-quantity"><span>{titles[mode].input}</span>
                <strong>{entered}</strong></div>
              <div className="stocktake-e-review-quantity"><span>После</span><strong>{after}</strong>
                {mode==='transfer'&&<small>{location(source==='office'?'showcase':'office')}:
                  {target.physical+entered}</small>}</div>
            </div>
          })}
        </div>
        {mode==='writeoff'&&<p>Причина: <strong>{reason}</strong></p>}
        {shortages.length>0&&<label className="client3-main-stock-confirm">
          <input type="checkbox" checked={shortageConfirmed} disabled={saving}
            onChange={e=>setShortageConfirmed(e.target.checked)}/>
          Подтверждаю недостачу по {shortages.length} позициям: фактическое количество ниже резерва
        </label>}
        <label className="client3-main-stock-confirm">
          <input type="checkbox" checked={confirmed} disabled={saving}
            onChange={e=>setConfirmed(e.target.checked)}/>
          {mode==='count'?'Подтверждаю физический пересчёт всех выбранных часов.':
            'Подтверждаю складскую операцию и количество всех выбранных часов.'}
        </label>
        <div className="stocktake-e-review-actions">
          <button type="button" className="secondary compact" disabled={saving}
            onClick={()=>setStage('select')}>Вернуться</button>
          <button type="button" className="primary compact"
            disabled={!ready||!confirmed||(shortages.length>0&&!shortageConfirmed)}
            onClick={()=>void save()}>{saving?'Сохраняю…':
              'Подтвердить '+titles[mode].name.toLowerCase()}</button>
        </div>
      </section>}
    </div>
  </div>
}
