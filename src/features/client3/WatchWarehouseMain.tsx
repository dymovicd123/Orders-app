import {useCallback,useEffect,useMemo,useRef,useState} from 'react'
import {StocktakeProductChoice,StocktakeSizeCountCell} from '../inventory/views/StocktakeSharedInputs'
import {WATCH_OPTIONS,type WatchBrand} from '../../../shared/client3/watch-domain'
import '../../styles/182-inventory-stocktake-human.css'
import '../../styles/183-inventory-stocktake-workflow.css'
import '../../styles/185-inventory-stocktake-state.css'
import '../../styles/188e-inventory-stocktake-sessions.css'
import '../../styles/188e4-stocktake-usability.css'
import '../../styles/193-unified-inventory-operations.css'
import '../../styles/client3-watch-main-warehouse.css'

type Source='office'|'showcase'
type Operation='arrival'|'transfer'|'writeoff'|'count'
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
  transfer:{name:'Перемещение',hint:'Перенести свободные часы между точками',input:'Переместить'},
  writeoff:{name:'Списание',hint:'Списать свободный остаток с указанием причины',input:'Списать'},
  count:{name:'Корректировка',hint:'Установить фактическое количество по результатам пересчёта',input:'Фактически'},
}
const field=(list:readonly {value:string;label:string}[],v:string|null)=>list.find(x=>x.value===v)?.label||v||'—'
const location=(source:Source)=>source==='office'?'Офис':'Витрина'
const number=(n:unknown)=>Number.isFinite(Number(n))?Math.max(0,Number(n)):0
const sourceSnapshot=(row:Row,source:Source)=>{
  const physical=number(source==='office'?row.officePhysical:row.showcasePhysical)
  const reserved=number(source==='office'?row.officeReserved:row.showcaseReserved)
  return {physical,reserved,free:Math.max(0,physical-reserved)}
}
const exactName=(r:Row)=>[field(WATCH_OPTIONS.genders,r.gender),field(WATCH_OPTIONS.movements,r.movement),
  field(WATCH_OPTIONS.braceletMaterials,r.braceletMaterial),field(WATCH_OPTIONS.dialColors,r.dialColor),
  r.braceletColor?'Ремешок: '+r.braceletColor:''].filter(Boolean).join(' · ')
const val=(v:string)=>v.trim()!==''&&/^\d{1,6}$/.test(v)?Number(v):NaN

/**
 * Client3 adapter of Main's stocktake/operations UI. The picker and quantity
 * cell ARE the same components as Main. Only exact watch SKUs are accepted.
 * One physical SKU per transaction: no partially applied client-side batches.
 */
export function WatchWarehouseMain({brand,onStockChanged}:{brand:WatchBrand;onStockChanged?:()=>void}){
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
  const [selectedModel,setSelectedModel]=useState<number|null>(null)
  const [selectedVariant,setSelectedVariant]=useState<number|null>(null)
  const [quantity,setQuantity]=useState('')
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
    }).catch(cause=>{if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'Ошибка склада')})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false)})
    return ()=>controller.abort()
  },[brand,reload])
  const variants=useMemo(()=>rows.filter(r=>
    r.watchVariantId&&r.catalogVariantId&&r.catalogProductId&&r.variantActive===1&&r.productActive===1
  ),[rows])
  const models=useMemo(()=>Array.from(new Map(variants.map(r=>[r.watchProductId,r.modelName])).entries()),[variants])
  const current=variants.filter(v=>v.watchProductId===selectedModel)
  const selected=variants.find(v=>v.watchVariantId===selectedVariant)||null
  const before=selected?sourceSnapshot(selected,source):{physical:0,reserved:0,free:0}
  const target=selected?sourceSnapshot(selected,source==='office'?'showcase':'office'):{physical:0,reserved:0,free:0}
  const entered=val(quantity)
  const after=mode==='arrival'?before.physical+entered:
    mode==='count'?entered:before.physical-entered
  const shortage=mode==='count'&&Number.isFinite(entered)&&entered<before.reserved
  const allowed=Number.isSafeInteger(entered)&&entered>=(mode==='count'?0:1)&&
    entered<=(mode==='count'?1000000:1000)&&
    (mode==='arrival'||mode==='count'||entered<=before.free)&&
    (mode!=='writeoff'||reason.trim().length>0)&&!loading
  const changed=mode==='count'&&Number.isFinite(entered)&&entered===before.physical
  const rowsPhysical=variants.reduce((sum,r)=>sum+number(r.officePhysical)+number(r.showcasePhysical),0)
  const rowsReserved=variants.reduce((sum,r)=>sum+number(r.officeReserved)+number(r.showcaseReserved),0)
  const reset=()=>{
    setStage('select');setSelectedModel(null);setSelectedVariant(null)
    setQuantity('');setReason('');setConfirmed(false);setShortageConfirmed(false);setError('');setNotice('')
    requestRef.current=null
  }
  const selectMode=(modeNext:Operation)=>{
    if(saving)return
    if(quantity.trim()&&!window.confirm('Отменить несохранённые числа и выбрать другую операцию?'))return
    reset();setMode(modeNext)
  }
  const selectSource=(next:Source)=>{
    if(next===source)return
    if(quantity.trim()&&!window.confirm('Сменить точку и очистить введённое количество?'))return
    reset();setSource(next)
  }
  const review=()=>{
    if(!selected||!allowed||changed){setError('Проверьте точный вариант часов, количество и свободный остаток.');return}
    setError('');setStage('review');setConfirmed(false)
  }
  const save=async()=>{
    if(!confirmed||!selected||!allowed||changed||saving||
      (shortage&&!shortageConfirmed))return
    const payload:Record<string,unknown>={
      brand,source,watchVariantId:selected.watchVariantId,
    }
    if(mode==='count'){
      Object.assign(payload,{expectedPhysical:before.physical,countedQuantity:entered,
        confirmed:true,allowShortage:shortageConfirmed})
    }else{
      Object.assign(payload,{quantity:entered,comment:reason.trim()})
      if(mode!=='arrival')payload.expectedPhysical=before.physical
    }
    const fingerprint=JSON.stringify([mode,payload])
    if(requestRef.current?.fingerprint!==fingerprint)
      requestRef.current={fingerprint,id:'watch-main-ui-'+crypto.randomUUID()}
    setSaving(true);setError('')
    try{
      const route=mode==='count'?'count':mode
      const response=await fetch('/api/client3/watches/stock/'+route,{
        method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({...payload,requestId:requestRef.current.id}),
      })
      const result=await response.json() as Api
      if(!response.ok||!result.ok)throw new Error(result.message||'Операция не была подтверждена складом.')
      requestRef.current=null
      setNotice(result.attention||'Операция сохранена. Остатки обновлены.')
      setStage('select');setSelectedModel(null);setSelectedVariant(null);setQuantity('')
      setReason('');setConfirmed(false);setShortageConfirmed(false)
      refresh();onStockChanged?.()
    }catch(cause){setError(cause instanceof Error?cause.message:'Не удалось сохранить операцию.')}
    finally{setSaving(false)}
  }
  return <div className="client3-main-stock">
    <div className="inventory-calm-head">
      <div><h3>Остатки</h3><p>Фактическое количество, резервы и свободные часы по обеим точкам.</p></div>
      <button type="button" className="secondary compact" disabled={loading||saving} onClick={refresh}>Обновить</button>
    </div>
    <div className="inventory-calm-summary client3-main-stock-totals">
      <div><small>В офисе</small><strong>{variants.reduce((s,r)=>s+number(r.officePhysical),0)}</strong></div>
      <div><small>На витрине</small><strong>{variants.reduce((s,r)=>s+number(r.showcasePhysical),0)}</strong></div>
      <div><small>В резерве</small><strong>{rowsReserved}</strong></div>
      <div><small>Свободно</small><strong>{Math.max(0,rowsPhysical-rowsReserved)}</strong></div>
    </div>
    <div className="inventory-stocktake-panel stocktake-human-panel stocktake-session-v188e stocktake-reused-operations client3-main-stock-operation">
      <div className="stocktake-e-head"><div><h3>Складские операции</h3><p>Порядок тот же, что в Main: выбор → количество → проверка → сохранение.</p></div></div>
      <div className="stocktake-e-start stocktake-e-start-v5 w6-operation-switch">
        <div className="stocktake-start-modes stocktake-start-modes-v5">
          {(['arrival','writeoff','count','transfer'] as const).map(value=>
            <button key={value} type="button" disabled={saving} className={'stocktake-start-mode '+(mode===value?'is-active':'')}
              onClick={()=>selectMode(value)}><strong>{titles[value].name}</strong><span>{titles[value].hint}</span></button>)}
        </div>
      </div>
      <div className="w7-operation-location">
        <div><strong>{mode==='transfer'?'Перемещаем из':'Точка операции'}</strong><small>{mode==='transfer'?'Только свободные часы.':'Офис и витрина учитываются отдельно.'}</small></div>
        <div className="stocktake-source-switch stocktake-source-switch-v5" role="tablist" aria-label="Источник">
          {(['office','showcase'] as const).map(src=><button role="tab" type="button" key={src}
            aria-selected={source===src} disabled={saving}
            className={source===src?'is-active':''} onClick={()=>selectSource(src)}>{location(src)}</button>)}
        </div>
        {mode==='transfer'&&<div className="w7-transfer-target"><span aria-hidden="true">→</span><strong>{location(source==='office'?'showcase':'office')}</strong></div>}
      </div>
      {error&&<div className="stocktake-inline-notice w6-notice-error" role="alert">{error}</div>}
      {notice&&<div className="stocktake-inline-notice" role="status">{notice}</div>}
      {loading?<div className="stocktake-inline-notice">Загружаем каталог и остатки…</div>:
        stage==='select'?<section className="stocktake-e-start stocktake-e-start-v5">
          <div className="stocktake-start-intro"><span className="stocktake-step-kicker">Шаг 1</span>
            <h4>Какую модель часов хотите {mode==='arrival'?'принять':mode==='writeoff'?'списать':mode==='transfer'?'переместить':'пересчитать'}?</h4>
            <p>Выберите модель и затем точную комплектацию. Нет размера и длины, только характеристики часов.</p>
          </div>
          <div className="stocktake-selective-picker stocktake-selective-picker-v5">
            <div className="stocktake-selective-head"><label><span>Найдите модель</span>
              <input placeholder="Название модели…" value={search} onChange={e=>setSearch(e.target.value)}/></label>
              <div className="stocktake-selective-count"><strong>{models.length} моделей</strong><span>{variants.length} комплектаций</span></div>
            </div>
            <div className="stocktake-selective-list stocktake-selective-list-v5">
              {models.filter(([,name])=>name.toLowerCase().includes(search.toLowerCase())).map(([id,name])=>
                <StocktakeProductChoice key={id} checked={selectedModel===id}
                  onToggle={()=>{setSelectedModel(id);setSelectedVariant(null);setQuantity('');setStage('quantities')}}
                  name={name} description={variants.filter(v=>v.watchProductId===id).length+' вариантов'}/>)}
              {!models.length&&<div className="stocktake-product-list-empty">Нет подготовленных комплектаций. Создайте их в каталоге.</div>}
            </div>
          </div>
        </section>:stage==='quantities'?<section className="client3-main-stock-step">
          <div className="stocktake-e-product-nav stocktake-e-product-nav-v5">
            <div><span>Шаг 2 · Комплектация</span><h4>{models.find(([id])=>id===selectedModel)?.[1]||'Модель'}</h4>
              <small>Выберите точные часы, затем введите количество.</small></div>
            <button type="button" className="ghost compact" disabled={saving} onClick={()=>setStage('select')}>← Выбрать другую модель</button>
          </div>
          <div className="client3-main-stock-skus">
            {current.map(row=>{
              const snapshot=sourceSnapshot(row,source)
              return <button type="button" key={row.watchVariantId} disabled={saving}
                className={'client3-main-stock-sku '+(row.watchVariantId===selectedVariant?'is-selected':'')}
                aria-pressed={row.watchVariantId===selectedVariant}
                onClick={()=>{setSelectedVariant(row.watchVariantId);setQuantity('');setConfirmed(false)}}>
                <strong>{exactName(row)}</strong>
                <span>По системе: {snapshot.physical} · Резерв: {snapshot.reserved} · Свободно: {snapshot.free}</span>
              </button>
            })}
          </div>
          {selected&&<div className="client3-main-stock-quantity">
            <StocktakeSizeCountCell cellId={selected.watchVariantId!} size={titles[mode].input}
              currentQuantity={before.physical} value={quantity} disabled={saving}
              ariaLabel={'Количество · '+exactName(selected)}
              onChange={raw=>{if(raw!==''&&!/^\d{1,6}$/.test(raw))return;setQuantity(raw);setConfirmed(false)}}
              onClear={()=>setQuantity('')}/>
            <div className="client3-main-stock-quantity-info">
              <strong>{exactName(selected)}</strong>
              <span>Резерв: {before.reserved} · Свободно: {before.free}</span>
              {Number.isFinite(entered)&&<span>После операции: <b>{after}</b>
                {mode==='transfer'&&' · '+location(source==='office'?'showcase':'office')+': '+(target.physical+entered)}</span>}
            </div>
          </div>}
          {mode==='writeoff'&&<label className="w6-stocktake-reason">Причина списания (обязательно)
            <input value={reason} maxLength={300} placeholder="Почему списываем часы" onChange={e=>setReason(e.target.value)}/></label>}
          {(mode==='arrival'||mode==='transfer')&&<label className="w6-stocktake-reason">Комментарий (необязательно)
            <input value={reason} maxLength={300} onChange={e=>setReason(e.target.value)}/></label>}
          {shortage&&<div className="stocktake-inline-notice w6-notice-error">Введённое количество ниже активного резерва. При сохранении потребуется отдельное подтверждение недостачи.</div>}
          <div className="stocktake-e-footer stocktake-e-footer-v4">
            <span>{selected?'Выбрана точная комплектация':'Выберите комплектацию'}</span>
            <button type="button" className="primary compact stocktake-review-button"
              disabled={!selected||!allowed||changed||saving} onClick={review}>Проверить результат</button>
          </div>
        </section>:<section className="client3-main-stock-step">
          <div className="stocktake-e-review-head">
            <div><span className="stocktake-step-kicker">Шаг 3</span><h4>Проверка перед сохранением</h4>
              <p>Склад ещё не изменён. Сверьте товар, точку и количество.</p></div>
            <button type="button" className="secondary compact" disabled={saving} onClick={()=>setStage('quantities')}>← Исправить</button>
          </div>
          <div className="stocktake-e-review-list">
            <div className="stocktake-e-review-row">
              <div className="stocktake-e-review-name"><strong>{selected?.modelName}</strong>
                <span>{selected&&exactName(selected)} · {location(source)}</span></div>
              <div className="stocktake-e-review-quantity"><span>По системе</span><strong>{before.physical}</strong></div>
              <div className="stocktake-e-review-quantity"><span>{titles[mode].input}</span><strong>{entered}</strong></div>
              <div className="stocktake-e-review-quantity"><span>После</span><strong>{after}</strong>
                {mode==='transfer'&&<small>{location(source==='office'?'showcase':'office')}: {target.physical+entered}</small>}
              </div>
            </div>
          </div>
          {mode==='writeoff'&&<p>Причина: <strong>{reason}</strong></p>}
          {shortage&&<label className="client3-main-stock-confirm">
            <input type="checkbox" checked={shortageConfirmed} onChange={e=>setShortageConfirmed(e.target.checked)}/>
            Подтверждаю недостачу: пересчёт меньше зарезервированного количества
          </label>}
          <label className="client3-main-stock-confirm"><input type="checkbox" checked={confirmed}
            onChange={e=>setConfirmed(e.target.checked)}/>
            {mode==='count'?'Подтверждаю, что лично пересчитал(а) эти часы.':'Подтверждаю складскую операцию и указанные количества.'}
          </label>
          <div className="stocktake-e-review-actions">
            <button className="secondary compact" type="button" disabled={saving} onClick={()=>setStage('quantities')}>Вернуться</button>
            <button className="primary compact" type="button" disabled={!confirmed||!allowed||changed||saving||(shortage&&!shortageConfirmed)}
              onClick={()=>void save()}>{saving?'Сохраняю…':'Подтвердить '+titles[mode].name.toLowerCase()}</button>
          </div>
        </section>}
    </div>
  </div>
}
