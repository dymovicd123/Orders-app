import { useEffect, useRef, useState, type FormEvent } from 'react'
import { WATCH_OPTIONS, watchReferenceLabel, type WatchBrand, type WatchVariantInput } from '../../../shared/client3/watch-domain'
import {WatchCatalogDeleteAction} from './WatchCatalogDeleteAction'
import {WatchCatalogVariantEditAction} from './WatchCatalogVariantEditAction'
import {WatchModelAliases} from './WatchModelAliases'
import '../../styles/w6-catalog-browse.css'
import '../../styles/w6-2-catalog-master-detail.css'
import '../../styles/w6-2-catalog-density.css'
import '../../styles/w6-3-catalog-polish.css'
import '../../styles/w6-4-catalog-sku-card.css'
import '../../styles/w6-4a-variant-editor-visibility.css'
import '../../styles/w9-warehouse-catalog-cleanup.css'
import '../../styles/client3-watch-main-catalog.css'
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
  catalogPriceSnapshot:number|null
  officePhysical:number
  officeReserved:number
  showcasePhysical:number
  showcaseReserved:number
}
type Api={ok:boolean;message?:string;attention?:string;rows?:CatalogRow[];watchProductId?:number;watchVariantId?:number;
  catalogVariantId?:number;stockLinked?:boolean;partial?:boolean;alreadyExists?:boolean}
class WatchCatalogRequestError extends Error {
  readonly partial:boolean
  constructor(message:string,partial:boolean){super(message);this.partial=partial}
}
async function callApi(url:string,init?:RequestInit):Promise<Api> {
  const response=await fetch(url,{credentials:'include',cache:'no-store',...init})
  const value=await response.json() as Api
  if(!response.ok||!value.ok)
    throw new WatchCatalogRequestError(value.message||'Не удалось сохранить изменения',Boolean(value.partial))
  return value
}
function textFor(choices:readonly {value:string;label:string}[],code:string|null) {
  const raw=choices.find(item=>item.value===code)?.label||code||'—'
  return raw.toLocaleUpperCase('ru-RU')
}

/** An unmapped watch is a draft. It cannot be sold or counted as physical stock. */
export function WatchCatalogEditor({brand,view='catalog',onStockChanged,onOpenReferences,canEditPrices=true}:{brand:WatchBrand;view?:'catalog'|'warehouse';onStockChanged?:()=>void;onOpenReferences?:()=>void;canEditPrices?:boolean}) {
  const [rows,setRows]=useState<CatalogRow[]>([])
  const [operation,setOperation]=useState<'arrival'|'transfer'|'writeoff'|'count'>('arrival')
  const [modelName,setModelName]=useState('')
  const [catalogSearch,setCatalogSearch]=useState('')
  const [catalogGender,setCatalogGender]=useState<'all'|'male'|'female'>('all')
  const [showNewModel,setShowNewModel]=useState(false)
  const [showNewVariant,setShowNewVariant]=useState(false)
  const [editingModel,setEditingModel]=useState(false)
  const [modelRename,setModelRename]=useState('')

  const [modelId,setModelId]=useState(0)
  const [gender,setGender]=useState<WatchVariantInput['gender']>('male')
  const [movement,setMovement]=useState<WatchVariantInput['movement']>('quartz')
  const [braceletMaterial,setBraceletMaterial]=useState<WatchVariantInput['braceletMaterial']>('steel')
  const [dialColor,setDialColor]=useState<WatchVariantInput['dialColor']>('black')
  const [braceletColor,setBraceletColor]=useState('')
  const [strapColors,setStrapColors]=useState<string[]>([])
  const [choices,setChoices]=useState<{movements:string[];bracelets:string[];dials:string[]}>({
    movements:WATCH_OPTIONS.movements.map(x=>x.value),
    bracelets:WATCH_OPTIONS.braceletMaterials.map(x=>x.value),
    dials:WATCH_OPTIONS.dialColors.map(x=>x.value),
  })
  const [busy,setBusy]=useState(false)
  const [loading,setLoading]=useState(false)
  const [error,setError]=useState('')
  const [notice,setNotice]=useState('')
  const [reload,setReload]=useState(0)
  const [countVariantId,setCountVariantId]=useState(0)
  const [countSource,setCountSource]=useState<'office'|'showcase'>('office')
  const [countedQuantity,setCountedQuantity]=useState('')
  const [countConfirmed,setCountConfirmed]=useState(false)
  const [shortageConfirmed,setShortageConfirmed]=useState(false)
  const countRequest=useRef<{fingerprint:string;requestId:string}|null>(null)
  const [priceVariantId,setPriceVariantId]=useState<number|null>(null)
  const [priceDraft,setPriceDraft]=useState('')
  const [arrivalVariantId,setArrivalVariantId]=useState(0)
  const [arrivalSource,setArrivalSource]=useState<'office'|'showcase'>('office')
  const [arrivalQuantity,setArrivalQuantity]=useState('1')
  const [arrivalComment,setArrivalComment]=useState('')
  const arrivalRequest=useRef<{fingerprint:string;requestId:string}|null>(null)
  const [transferVariantId,setTransferVariantId]=useState(0)
  const [transferSource,setTransferSource]=useState<'office'|'showcase'>('office')
  const [transferQuantity,setTransferQuantity]=useState('1')
  const [transferComment,setTransferComment]=useState('')
  const transferRequest=useRef<{fingerprint:string;requestId:string}|null>(null)
  const [writeoffVariantId,setWriteoffVariantId]=useState(0)
  const [writeoffSource,setWriteoffSource]=useState<'office'|'showcase'>('office')
  const [writeoffQuantity,setWriteoffQuantity]=useState('1')
  const [writeoffReason,setWriteoffReason]=useState('')
  const [writeoffConfirmed,setWriteoffConfirmed]=useState(false)
  const writeoffRequest=useRef<{fingerprint:string;requestId:string}|null>(null)
  useEffect(()=>{
    const controller=new AbortController()
    void fetch('/api/client3/watches/references',{
      credentials:'include',cache:'no-store',signal:controller.signal,
    }).then(async response=>{
      const data=await response.json() as {ok:boolean;rows?:Array<{kind:string;value:string}>;message?:string}
      if(!response.ok||!data.ok)throw new Error(data.message||'Справочник недоступен')
      if(!controller.signal.aborted){
        const by=(kind:string)=>(data.rows||[]).filter(row=>row.kind===kind).map(row=>row.value)
        setStrapColors(by('leatherColors'))
        setChoices({
          movements:[...new Set([...WATCH_OPTIONS.movements.map(x=>x.value),...by('movements')])],
          bracelets:[...new Set([...WATCH_OPTIONS.braceletMaterials.map(x=>x.value),...by('bracelets')])],
          dials:[...new Set([...WATCH_OPTIONS.dialColors.map(x=>x.value),...by('dials')])],
        })
      }
    }).catch(cause=>{if(!controller.signal.aborted)setError(
      cause instanceof Error?cause.message:'Не удалось загрузить цвета ремешков')})
    return ()=>controller.abort()
  },[])
  const linked=rows.filter(row=>row.watchVariantId && row.catalogProductId && row.catalogVariantId && row.productActive===1 && row.variantActive===1)
  const selectedCount=linked.find(row=>row.watchVariantId===countVariantId)
  const countExpected=Number(countSource==='office'?selectedCount?.officePhysical:selectedCount?.showcasePhysical)||0
  const countReserved=Number(countSource==='office'?selectedCount?.officeReserved:selectedCount?.showcaseReserved)||0
  const hasCountShortage=countedQuantity!==''&&Number(countedQuantity)<countReserved
  const selectedTransfer=linked.find(row=>row.watchVariantId===transferVariantId)
  const transferPhysical=Math.max(0,Number(transferSource==='office'?selectedTransfer?.officePhysical:selectedTransfer?.showcasePhysical)||0)
  const transferReserved=Math.max(0,Number(transferSource==='office'?selectedTransfer?.officeReserved:selectedTransfer?.showcaseReserved)||0)
  const transferFree=Math.max(0,transferPhysical-transferReserved)
  const selectedWriteoff=linked.find(row=>row.watchVariantId===writeoffVariantId)
  const writeoffPhysical=Math.max(0,Number(writeoffSource==='office'?selectedWriteoff?.officePhysical:selectedWriteoff?.showcasePhysical)||0)
  const writeoffReserved=Math.max(0,Number(writeoffSource==='office'?selectedWriteoff?.officeReserved:selectedWriteoff?.showcaseReserved)||0)
  const writeoffFree=Math.max(0,writeoffPhysical-writeoffReserved)
  const models=Array.from(new Map<number,{id:number;name:string}>(
    rows.filter(row=>row.productActive===1).map(row=>[row.watchProductId,{id:row.watchProductId,name:row.modelName}])
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
      return true
    }catch(cause){setError(cause instanceof Error?cause.message:'Не удалось добавить модель');return false}
    finally{setBusy(false)}
  }
  const renameModel=async(e:FormEvent<HTMLFormElement>)=>{
    e.preventDefault()
    const selected=rows.find(row=>row.watchProductId===modelId&&row.productActive===1)
    if(!selected||busy)return
    setBusy(true);setError('');setNotice('')
    try{
      await callApi('/api/client3/watches/catalog/models',{
        method:'PATCH',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({brand,watchProductId:modelId,expectedName:selected.modelName,modelName:modelRename}),
      })
      setEditingModel(false)
      setNotice('Название модели изменено. Складские SKU, заказы и остатки не менялись.')
      setReload(v=>v+1)
    }catch(e){setError(e instanceof Error?e.message:'Не удалось изменить название')}
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
  const createArrival=async(e:FormEvent<HTMLFormElement>)=>{
    e.preventDefault()
    const quantity=Number(arrivalQuantity)
    if(busy || !linked.some(x=>x.watchVariantId===arrivalVariantId) ||
      !Number.isSafeInteger(quantity)||quantity<1||quantity>1000){
      setError('Выберите подготовленные часы и количество от 1 до 1000.');return
    }
    const payload={watchVariantId:arrivalVariantId,quantity,source:arrivalSource,comment:arrivalComment.trim()}
    const fingerprint=JSON.stringify([brand,payload])
    if(arrivalRequest.current?.fingerprint!==fingerprint)
      arrivalRequest.current={fingerprint,requestId:'arrival-'+crypto.randomUUID()}
    setBusy(true);setError('');setNotice('')
    try{
      await post('/api/client3/watches/stock/arrival',
        {...payload,requestId:arrivalRequest.current.requestId})
      arrivalRequest.current=null
      setNotice('Физический приход сохранён. Наличие обновлено в складском учёте.')
      setReload(x=>x+1)
      onStockChanged?.()
    }catch(cause){setError(cause instanceof Error?cause.message:'Не удалось сохранить приход')}
    finally{setBusy(false)}
  }
  const createTransfer=async(e:FormEvent<HTMLFormElement>)=>{
    e.preventDefault()
    const quantity=Number(transferQuantity)
    if(busy||!selectedTransfer||!Number.isSafeInteger(quantity)||quantity<1||quantity>transferFree){
      setError('Недостаточно свободных часов для перемещения. Обновите остатки.');return
    }
    const payload={watchVariantId:transferVariantId,source:transferSource,quantity,
      expectedPhysical:transferPhysical,comment:transferComment.trim()}
    const fingerprint=JSON.stringify([brand,payload])
    if(transferRequest.current?.fingerprint!==fingerprint)
      transferRequest.current={fingerprint,requestId:'transfer-'+crypto.randomUUID()}
    setBusy(true);setError('');setNotice('')
    try{
      const result=await post('/api/client3/watches/stock/transfer',{
        ...payload,requestId:transferRequest.current.requestId
      })
      transferRequest.current=null
      setNotice(result.attention ? 'Перемещение записано. '+result.attention : (result.message||'Часы перемещены. Остатки офиса и витрины обновлены.'))
      setReload(x=>x+1)
      onStockChanged?.()
    }catch(cause){setError(cause instanceof Error?cause.message:'Не удалось переместить часы')}
    finally{setBusy(false)}
  }
  const createWriteoff=async(e:FormEvent<HTMLFormElement>)=>{
    e.preventDefault()
    const quantity=Number(writeoffQuantity)
    if(busy||!writeoffConfirmed||!writeoffReason.trim()||!selectedWriteoff||
      !Number.isSafeInteger(quantity)||quantity<1||quantity>writeoffFree){
      setError('Проверьте свободный остаток, причину и подтверждение списания.');return
    }
    const payload={watchVariantId:writeoffVariantId,source:writeoffSource,quantity,
      expectedPhysical:writeoffPhysical,comment:writeoffReason.trim()}
    const fingerprint=JSON.stringify([brand,payload])
    if(writeoffRequest.current?.fingerprint!==fingerprint)
      writeoffRequest.current={fingerprint,requestId:'writeoff-'+crypto.randomUUID()}
    setBusy(true);setError('');setNotice('')
    try {
      const result=await post('/api/client3/watches/stock/writeoff',{
        ...payload,requestId:writeoffRequest.current.requestId
      })
      writeoffRequest.current=null
      setWriteoffConfirmed(false)
      setNotice(result.attention?'Списание сохранено. '+result.attention:'Списание сохранено в истории склада.')
      setReload(x=>x+1)
      onStockChanged?.()
    }catch(cause){setError(cause instanceof Error?cause.message:'Не удалось списать часы')}
    finally{setBusy(false)}
  }
  const savePrice=async(row:CatalogRow)=>{
    if(busy||!row.watchVariantId)return
    const salePrice=Number(priceDraft)
    if(priceDraft.trim()===''||!Number.isSafeInteger(salePrice)||salePrice<0||salePrice>1000000000){
      setError('Цена каталога должна быть целым числом тенге от 0.');return
    }
    setBusy(true);setError('');setNotice('')
    try{
      await post('/api/client3/watches/catalog/prices',{
        watchVariantId:row.watchVariantId,salePrice,expectedPrice:row.catalogPriceSnapshot??null,
      })
      setPriceVariantId(null)
      setNotice('Цена по каталогу сохранена. Она будет подставляться при создании новых заказов.')
      setReload(x=>x+1)
      onStockChanged?.()
    }catch(cause){setError(cause instanceof Error?cause.message:'Не удалось сохранить цену')}
    finally{setBusy(false)}
  }
  const savePhysicalCount=async(e:FormEvent<HTMLFormElement>)=>{
    e.preventDefault()
    const actual=Number(countedQuantity)
    if(busy||!selectedCount||!countConfirmed||countedQuantity.trim()===''||
       !Number.isSafeInteger(actual)||actual<0||
       (actual<countReserved&&!shortageConfirmed)){
      setError('Укажите фактическое количество, подтвердите пересчёт и возможную недостачу.');return
    }
    const payload={watchVariantId:countVariantId,source:countSource,
      expectedPhysical:countExpected,countedQuantity:actual,
      confirmed:true,allowShortage:shortageConfirmed}
    const fingerprint=JSON.stringify([brand,payload])
    if(countRequest.current?.fingerprint!==fingerprint)
      countRequest.current={fingerprint,requestId:'watch-count-'+crypto.randomUUID()}
    setBusy(true);setError('');setNotice('')
    try{
      const result=await post('/api/client3/watches/stock/count',{
        ...payload,requestId:countRequest.current.requestId
      })
      countRequest.current=null
      setCountConfirmed(false);setShortageConfirmed(false);setCountedQuantity('')
      setNotice(result.attention?'Пересчёт сохранён. '+result.attention:'Фактическое количество сохранено в истории склада.')
      setReload(n=>n+1)
      onStockChanged?.()
    }catch(cause){setError(cause instanceof Error?cause.message:'Не удалось сохранить пересчёт')}
    finally{setBusy(false)}
  }
  const createVariant=async(e:FormEvent<HTMLFormElement>)=>{
    e.preventDefault();if(busy||modelId<=0)return
    setBusy(true);setError('');setNotice('')
    try{
      const result=await post('/api/client3/watches/catalog/variants',{
        watchProductId:modelId,gender,movement,braceletMaterial,dialColor,
        braceletColor:braceletMaterial==='leather'?braceletColor:'',
      })
      // Server creates/reuses watch variant and provisions its stock SKU in
      // the SAME request. Never report success for an unlinked draft.
      if(!result.watchVariantId||!result.stockLinked||!result.catalogVariantId)
        throw Error('Комплектация не была привязана к складскому SKU. Повторите сохранение.')
      setNotice(result.alreadyExists?
        'Комплектация уже существует и доступна на складе.':
        'Комплектация добавлена в товары и склад. На месте пока 0 — количество добавляется приходом.')
      setCatalogSearch('')
      setCatalogGender('all')
      setReload(x=>x+1)
      onStockChanged?.()
      return true
    }catch(cause){
      setError(cause instanceof Error?cause.message:'Не удалось добавить комплектацию')
      if(cause instanceof WatchCatalogRequestError&&cause.partial){
        // A retry uses the same variant identity rather than making a duplicate.
        setReload(x=>x+1)
        onStockChanged?.()
      }
      return false
    }
    finally{setBusy(false)}
  }
  if(view==='catalog'){
    const query=catalogSearch.trim().toLocaleLowerCase('ru')
    const catalogModels=models.filter(model=>{
      if(!model.name.toLocaleLowerCase('ru').includes(query))return false
      if(catalogGender==='all')return true
      return rows.some(row=>row.watchProductId===model.id&&row.gender===catalogGender)
    })
    const selected=models.find(model=>model.id===modelId)
    const variants=rows.filter(row=>row.watchProductId===modelId&&row.productActive===1&&row.variantActive===1&&row.watchVariantId)
    const positionCount=rows.filter(row=>row.productActive===1&&row.variantActive===1&&row.watchVariantId).length
    const hasExplicitDetail=Boolean(selected)||showNewModel
    const variantLabel=(row:CatalogRow)=>[
      textFor(WATCH_OPTIONS.genders,row.gender),
      textFor(WATCH_OPTIONS.movements,row.movement),
      textFor(WATCH_OPTIONS.braceletMaterials,row.braceletMaterial),
      textFor(WATCH_OPTIONS.dialColors,row.dialColor),
      row.braceletColor?'Ремешок: '+row.braceletColor:''
    ].filter(Boolean).join(' · ')
    return <div className="inventory-catalog-panel w6-catalog-panel client3-watch-catalog-main"
      id="catalog" data-catalog-view="main-master-detail">
      <div className="inventory-panel-headline w6-catalog-headline catalog-clean-headline">
        <div><h3>Товары</h3><p>Каталог моделей часов, комплектации и цены.</p></div>
        <div className="w6-catalog-head-actions">
          <button type="button" className="secondary compact" disabled={loading}
            onClick={()=>setReload(x=>x+1)}>Обновить</button>
        </div>
      </div>
      <div className="catalog-clean-taskbar" aria-label="Настройки каталога">
        <div className="catalog-clean-taskbar-main"><span className="catalog-clean-taskbar-label">
          {brand} · Модели, исполнение и цена</span></div>
        <button type="button" className="catalog-clean-settings"
          onClick={()=>{setShowNewModel(false);setShowNewVariant(true);if(!selected&&models.length)setModelId(models[0].id)}}>
          Характеристики часов</button>
      </div>
      <div className="w6-catalog-toolbar">
        <label className="w6-catalog-search"><span>Поиск</span>
          <input value={catalogSearch} onChange={e=>setCatalogSearch(e.target.value)}
            placeholder="Название модели…"/></label>
        <div className="catalog-category-switcher w6-catalog-category-switcher">
          {([['all','Все'],['male','Мужские'],['female','Женские']] as const).map(([key,label])=>
            <button key={key} type="button" className={catalogGender===key?'is-active':''}
              onClick={()=>setCatalogGender(key)}>{label}</button>)}
        </div>
        <div className="w6-catalog-toolbar-actions">
          <button className="primary w6-toolbar-new-product" type="button"
            onClick={()=>{setShowNewModel(true);setShowNewVariant(false);setModelName('')}}>
            + Новый товар</button>
        </div>
        <div className="w6-catalog-stats" aria-label="Сводка каталога">
          <span>Всего: <b>{models.length}</b> моделей</span>
          <span><b>{positionCount}</b> комплектаций</span>
          <span><b>{rows.filter(row=>row.watchVariantId&&!row.catalogVariantId).length}</b> без складского SKU</span>
        </div>
      </div>
      {error&&<p role="alert" className="watch-catalog-editor-error">{error}</p>}
      {notice&&<p role="status" className="watch-catalog-editor-notice">{notice}</p>}
      <div className={'catalog-master-detail '+(hasExplicitDetail?'has-explicit-selection ':'')+
        (showNewModel?'is-new-product':'')}>
        <aside className="catalog-master-pane" aria-label="Список товаров">
          <div className="catalog-master-pane-head"><strong>{catalogModels.length} моделей</strong>
            <span>в текущем фильтре</span></div>
          <div className="catalog-master-list">
            {catalogModels.map(model=><button key={model.id} type="button"
              className={'catalog-master-row '+(!showNewModel&&modelId===model.id?'is-selected':'')}
              onClick={()=>{setModelId(model.id);setShowNewModel(false);setShowNewVariant(false);setEditingModel(false);setError('')}}>
              <span><strong>{model.name}</strong>
                <em>{rows.filter(row=>row.watchProductId===model.id&&row.watchVariantId).length} позиций</em>
              </span><b aria-hidden="true">›</b>
            </button>)}
            {catalogModels.length===0&&<div className="empty-state compact-empty">
              {loading?'Загружаем каталог…':'Моделей нет. Добавьте новую модель или измените фильтр.'}</div>}
          </div>
        </aside>
        <section className="catalog-detail-pane" aria-label="Карточка товара">
          <button className="catalog-detail-back secondary compact" type="button"
            onClick={()=>{setShowNewModel(false);setShowNewVariant(false);setModelId(0)}}>
            ← К товарам</button>
          {showNewModel?<div className="catalog-detail-editor catalog-new-product-editor">
            <div className="catalog-detail-editor-head">
              <div><span className="catalog-detail-eyebrow">Новый товар</span>
                <h3>Добавить модель часов</h3>
                <p>Добавьте название. Комплектации создаются в карточке модели.</p></div>
              <button type="button" className="secondary compact"
                onClick={()=>setShowNewModel(false)}>Отмена</button>
            </div>
            <form className="catalog-product-form catalog-product-form-v2 w6-new-product-form"
              onSubmit={async e=>{if(await createModel(e))setShowNewModel(false)}}>
              <label className="wide-field"><span>Название модели</span>
                <input required maxLength={150} value={modelName}
                  onChange={e=>setModelName(e.target.value)} placeholder="Название часов"/></label>
              <button type="submit" className="primary" disabled={busy||!modelName.trim()}>
                {busy?'Сохраняю…':'Добавить товар'}</button>
            </form>
          </div>:selected?<div>
            <header className="catalog-detail-head">
              <div className="catalog-detail-title">
                <span className="catalog-detail-eyebrow">Товар</span><h2>{selected.name}</h2>
                {editingModel&&<form className="client3-watch-model-rename" onSubmit={e=>void renameModel(e)}>
                  <label>Название модели
                    <input autoFocus required maxLength={150} value={modelRename}
                      onChange={e=>setModelRename(e.target.value)} placeholder="Название модели"/>
                  </label>
                  <button type="submit" className="primary compact" disabled={busy||!modelRename.trim()}>
                    {busy?'Сохраняю…':'Сохранить'}</button>
                  <button type="button" className="secondary compact" disabled={busy}
                    onClick={()=>setEditingModel(false)}>Отмена</button>
                </form>}
                <div className="catalog-detail-meta catalog-product-commercial-anchor">
                  <span><b>{variants.length}</b> комплектаций</span>
                  <span><b>{variants.filter(v=>v.catalogVariantId).length}</b> складских SKU</span>
                </div>
              </div>
              <div className="catalog-detail-actions">
                <button type="button" className="secondary compact" onClick={()=>{
                  setModelRename(selected.name);setEditingModel(true)
                }}>Изменить название</button>
                <button type="button" className="primary compact"
                  onClick={()=>setShowNewVariant(true)}>+ Позиция</button>
                <WatchCatalogDeleteAction brand={brand} kind="product"
                  watchProductId={selected.id} label="Удалить товар"
                  onDeleted={()=>{setModelId(0);setShowNewVariant(false);setReload(v=>v+1)}}/>
              </div>
            </header>
            <WatchModelAliases key={brand+'-aliases-'+selected.id}
              brand={brand} modelId={selected.id}/>
            {showNewVariant&&<section className="catalog-detail-editor catalog-variant-editor-v2 w6-variant-editor catalog-clean-editor">
              <div className="catalog-detail-editor-head">
                <div><span className="catalog-detail-eyebrow">Новая позиция</span>
                  <h3>Добавить комплектацию</h3>
                  <p>Пол, механизм, браслет и цвета часов. Размеры и длина не используются.</p></div>
                <button type="button" className="secondary compact"
                  onClick={()=>setShowNewVariant(false)}>Закрыть</button>
              </div>
              <form className="subgrid inventory-subgrid catalog-variant-form-grid w6-variant-form-grid"
                onSubmit={async e=>{if(await createVariant(e))setShowNewVariant(false)}}>
                <label>Пол<select value={gender} onChange={e=>setGender(e.target.value as typeof gender)}>
                  {WATCH_OPTIONS.genders.map(x=><option key={x.value} value={x.value}>{x.label}</option>)}
                </select></label>
                <label>Механизм<select value={movement} onChange={e=>setMovement(e.target.value as typeof movement)}>
                  {choices.movements.map(value=><option key={value} value={value}>{watchReferenceLabel('movements',value)}</option>)}
                </select></label>
                <label>Браслет<select value={braceletMaterial}
                  onChange={e=>setBraceletMaterial(e.target.value as typeof braceletMaterial)}>
                  {choices.bracelets.map(value=><option key={value} value={value}>{watchReferenceLabel('bracelets',value)}</option>)}
                </select></label>
                <label>Цвет циферблата<select value={dialColor}
                  onChange={e=>setDialColor(e.target.value as typeof dialColor)}>
                  {choices.dials.map(value=><option key={value} value={value}>{watchReferenceLabel('dials',value)}</option>)}
                </select></label>
                {braceletMaterial==='leather'&&<label>Цвет кожаного ремешка
                  <select required value={strapColors.includes(braceletColor)?braceletColor:''}
                    onChange={e=>setBraceletColor(e.target.value)}>
                    <option value="">Выберите цвет из справочника</option>
                    {strapColors.map(value=><option value={value} key={value}>{watchReferenceLabel('leatherColors',value)}</option>)}
                  </select>
                  <small>Новые цвета добавляются в общих справочниках, не в карточке товара.</small>
                  {onOpenReferences&&<button type="button" className="secondary compact"
                    onClick={onOpenReferences}>Открыть справочники</button>}
                </label>}
                <button className="primary" type="submit" disabled={busy||!modelId||!choices.movements.includes(movement)||!choices.bracelets.includes(braceletMaterial)||!choices.dials.includes(dialColor)}>
                  {busy?'Сохраняю…':'Добавить позицию'}</button>
              </form>
            </section>}
            <div className="client3-watch-executions">
              {Array.from(new Map(variants.map(row=>[
                row.movement+'|'+row.braceletMaterial,
                {movement:row.movement!,braceletMaterial:row.braceletMaterial!},
              ])).values()).map(execution=><div className="client3-watch-execution-control"
                key={execution.movement+'|'+execution.braceletMaterial}>
                <span>Исполнение: {textFor(WATCH_OPTIONS.movements,execution.movement)} · {textFor(WATCH_OPTIONS.braceletMaterials,execution.braceletMaterial)}</span>
                <WatchCatalogDeleteAction brand={brand} kind="execution"
                  watchProductId={selected.id} movement={execution.movement}
                  braceletMaterial={execution.braceletMaterial} label="Удалить исполнение"
                  onDeleted={()=>setReload(v=>v+1)}/>
              </div>)}
            </div>
            <div className="client3-main-catalog-variants">
              {variants.map(row=>{
                const office=Number(row.officePhysical)||0
                const showcase=Number(row.showcasePhysical)||0
                return <article className="client3-main-catalog-variant" key={row.watchVariantId}>
                  <div className="client3-main-catalog-variant-head">
                    <div><span className="catalog-detail-eyebrow">ИСПОЛНЕНИЕ</span>
                      <h4>{variantLabel(row)}</h4>
                      <small>Офис: {office} · Витрина: {showcase}</small></div>
                    <strong>{office+showcase} <small>на месте</small></strong>
                  </div>
                  {row.watchVariantId&&row.catalogProductId&&row.catalogVariantId?
                  <div className="client3-main-catalog-variant-price">
                    <span>Цена продажи по каталогу, ₸</span>
                    {priceVariantId===row.watchVariantId?<div className="client3-main-catalog-price-editor">
                      <input type="number" min={0} max={1000000000} step={1}
                        aria-label="Новая цена по каталогу" value={priceDraft}
                        onChange={e=>setPriceDraft(e.target.value)}/>
                      <button type="button" className="primary compact" disabled={busy}
                        onClick={()=>void savePrice(row)}>Сохранить</button>
                      <button type="button" className="secondary compact" disabled={busy}
                        onClick={()=>setPriceVariantId(null)}>Отмена</button>
                    </div>:<div className="client3-main-catalog-price-editor">
                      <strong>{row.catalogPriceSnapshot==null?'Не задана':Number(row.catalogPriceSnapshot).toLocaleString('ru-RU')+' ₸'}</strong>
                      {canEditPrices&&<button type="button" className="secondary compact"
                        onClick={()=>{setPriceVariantId(row.watchVariantId);setPriceDraft(row.catalogPriceSnapshot==null?'':String(row.catalogPriceSnapshot))}}>
                        Изменить цену</button>}
                    </div>}
                  </div>:<div className="client3-main-catalog-variant-price">
                    <span>Складская позиция ещё не подготовлена — продажа недоступна</span>
                    {row.watchVariantId&&<button type="button" className="primary compact" disabled={busy}
                      onClick={()=>void provisionVariant(row.watchVariantId!)}>Подготовить складской SKU</button>}
                  </div>}
                  {row.watchVariantId&&<div className="client3-watch-variant-delete">
                    <WatchCatalogVariantEditAction brand={brand} row={{
                      watchProductId:row.watchProductId,watchVariantId:row.watchVariantId,
                      catalogVariantId:row.catalogVariantId,gender:row.gender,
                      movement:row.movement,braceletMaterial:row.braceletMaterial,
                      dialColor:row.dialColor,braceletColor:row.braceletColor,
                    }} choices={choices} strapColors={strapColors}
                      onSaved={()=>{setNotice('Характеристики позиции сохранены.');setReload(v=>v+1)}}
                      onCreateReplacement={draft=>{
                        setModelId(row.watchProductId)
                        setGender(draft.gender);setMovement(draft.movement)
                        setBraceletMaterial(draft.braceletMaterial)
                        setDialColor(draft.dialColor);setBraceletColor(draft.braceletColor||'')
                        setShowNewVariant(true)
                        setNotice('Заполнена форма новой комплектации. Проверьте и сохраните её.')
                      }}/>
                    <WatchCatalogDeleteAction brand={brand} kind="variant"
                      watchProductId={selected.id} watchVariantId={row.watchVariantId}
                      label="Удалить позицию" onDeleted={()=>setReload(v=>v+1)}/>
                  </div>}
                </article>
              })}
              {!variants.length&&<div className="empty-state">Комплектаций ещё нет. Нажмите «+ Позиция».</div>}
            </div>
          </div>:<div className="empty-state">Выберите модель слева или добавьте новый товар.</div>}
        </section>
      </div>
    </div>
  }
  return <section className="watch-catalog-editor watch-catalog-editor-warehouse">
    <header><h3>Складские операции · {brand}</h3>
      <p>Выберите операцию и сохраните фактическое движение часов.</p></header>
    {error&&<p role="alert" className="watch-catalog-editor-error">{error}</p>}
    {notice&&<p role="status" className="watch-catalog-editor-notice">{notice}</p>}
    <div className="watch-warehouse-operation-tabs" role="group" aria-label="Складская операция">
      {([['arrival','Приход'],['transfer','Перемещение'],['writeoff','Списание'],['count','Пересчёт']] as const)
        .map(([value,label])=><button key={value} type="button" aria-pressed={operation===value}
          onClick={()=>{setOperation(value);setError('');setNotice('')}}>{label}</button>)}
    </div>
    {view==='warehouse'&&operation==='arrival'&&<form className="watch-catalog-editor-arrival" onSubmit={e=>void createArrival(e)}>
      <h4>Физический приход часов</h4>
      <p>Только реальные полученные часы. Эта операция увеличивает остаток и записывается в складскую историю.</p>
      <label>Комплектация
        <select value={arrivalVariantId} onChange={e=>setArrivalVariantId(Number(e.target.value))} required>
          <option value={0}>Выберите подготовленный SKU</option>
          {linked.map(row=><option key={row.watchVariantId!} value={row.watchVariantId!}>
            {row.modelName} · {textFor(WATCH_OPTIONS.braceletMaterials,row.braceletMaterial)} · {textFor(WATCH_OPTIONS.dialColors,row.dialColor)}
            {row.braceletColor?' · '+row.braceletColor:''}
          </option>)}
        </select>
      </label>
      <label>Место хранения<select value={arrivalSource} onChange={e=>setArrivalSource(e.target.value as 'office'|'showcase')}>
        <option value="office">Офис</option><option value="showcase">Витрина</option>
      </select></label>
      <label>Количество<input type="number" min={1} max={1000} step={1} required
        value={arrivalQuantity} onChange={e=>setArrivalQuantity(e.target.value)}/></label>
      <label>Комментарий<input maxLength={300} value={arrivalComment}
        onChange={e=>setArrivalComment(e.target.value)} placeholder="Например, номер накладной"/></label>
      <button type="submit" disabled={busy||!arrivalVariantId||!linked.length}>Сохранить приход</button>
    </form>}
    {view==='warehouse'&&operation==='transfer'&&<form className="watch-catalog-editor-arrival" onSubmit={e=>void createTransfer(e)}>
      <h4>Переместить часы</h4>
      <p>Перемещаются только свободные часы — товары с активными резервами остаются на исходной точке.</p>
      <label>Комплектация<select required value={transferVariantId} onChange={e=>setTransferVariantId(Number(e.target.value))}>
        <option value={0}>Выберите подготовленный SKU</option>
        {linked.map(row=><option key={row.watchVariantId!} value={row.watchVariantId!}>
          {row.modelName} · {textFor(WATCH_OPTIONS.braceletMaterials,row.braceletMaterial)} · {textFor(WATCH_OPTIONS.dialColors,row.dialColor)}{row.braceletColor?' · '+row.braceletColor:''}
        </option>)}
      </select></label>
      <label>Откуда<select value={transferSource} onChange={e=>setTransferSource(e.target.value as 'office'|'showcase')}>
        <option value="office">Из офиса → на витрину</option>
        <option value="showcase">С витрины → в офис</option>
      </select></label>
      <p>По системе: {transferPhysical} шт. · Резерв: {transferReserved} шт. · Доступно: {transferFree} шт.</p>
      <label>Количество<input type="number" min={1} max={transferFree} step={1} required
        value={transferQuantity} onChange={e=>setTransferQuantity(e.target.value)}/></label>
      <label>Комментарий<input maxLength={300} value={transferComment}
        onChange={e=>setTransferComment(e.target.value)} placeholder="Например, передали на витрину"/></label>
      <button type="submit" disabled={busy||!selectedTransfer||transferFree<1}>Переместить часы</button>
    </form>}
    {view==='warehouse'&&operation==='writeoff'&&<form className="watch-catalog-editor-arrival" onSubmit={e=>void createWriteoff(e)}>
      <h4>Списание часов</h4>
      <p>Списать можно только свободные часы. Резервы покупателей защищены, причина обязательна.</p>
      <label>Комплектация<select required value={writeoffVariantId}
        onChange={e=>{setWriteoffVariantId(Number(e.target.value));setWriteoffConfirmed(false)}}>
        <option value={0}>Выберите подготовленный SKU</option>
        {linked.map(row=><option key={row.watchVariantId!} value={row.watchVariantId!}>
          {row.modelName} · {textFor(WATCH_OPTIONS.braceletMaterials,row.braceletMaterial)} · {textFor(WATCH_OPTIONS.dialColors,row.dialColor)}{row.braceletColor?' · '+row.braceletColor:''}
        </option>)}
      </select></label>
      <label>Откуда<select value={writeoffSource}
        onChange={e=>{setWriteoffSource(e.target.value as 'office'|'showcase');setWriteoffConfirmed(false)}}>
        <option value="office">Офис</option><option value="showcase">Витрина</option>
      </select></label>
      <p>По системе: {writeoffPhysical} шт. · Резерв: {writeoffReserved} шт. · Свободно: {writeoffFree} шт.</p>
      <label>Количество<input type="number" min={1} max={writeoffFree} step={1} required
        value={writeoffQuantity} onChange={e=>{setWriteoffQuantity(e.target.value);setWriteoffConfirmed(false)}}/></label>
      <label>Причина списания<input value={writeoffReason} maxLength={300} required
        onChange={e=>{setWriteoffReason(e.target.value);setWriteoffConfirmed(false)}}
        placeholder="Например, повреждение при перевозке"/></label>
      <label className="watch-catalog-editor-confirm"><input type="checkbox"
        checked={writeoffConfirmed} disabled={busy}
        onChange={e=>setWriteoffConfirmed(e.target.checked)}/>
        Подтверждаю физическое списание {writeoffQuantity||'0'} шт. из {writeoffSource==='office'?'офиса':'витрины'}
      </label>
      <button type="submit" disabled={busy||!selectedWriteoff||writeoffFree<1||!writeoffConfirmed||!writeoffReason.trim()}>
        Списать часы
      </button>
    </form>}
    {view==='warehouse'&&operation==='count'&&<form className="watch-catalog-editor-arrival" onSubmit={e=>void savePhysicalCount(e)}>
      <h4>Пересчёт фактического количества</h4>
      <p>Если количество отличается от системы, запишите реально пересчитанные часы. Резервы клиентов сохраняются.</p>
      <label>Комплектация<select required value={countVariantId}
        onChange={e=>{setCountVariantId(Number(e.target.value));setCountConfirmed(false);setShortageConfirmed(false)}}>
        <option value={0}>Выберите подготовленные часы</option>
        {linked.map(row=><option key={row.watchVariantId!} value={row.watchVariantId!}>
          {row.modelName} · {textFor(WATCH_OPTIONS.braceletMaterials,row.braceletMaterial)} · {textFor(WATCH_OPTIONS.dialColors,row.dialColor)}
          {row.braceletColor?' · '+row.braceletColor:''}
        </option>)}
      </select></label>
      <label>Место<select value={countSource} onChange={e=>{setCountSource(e.target.value as 'office'|'showcase');setCountConfirmed(false);setShortageConfirmed(false)}}>
        <option value="office">Офис</option><option value="showcase">Витрина</option>
      </select></label>
      <p>По системе: {countExpected} шт. · Резерв: {countReserved} шт.</p>
      <label>Фактически пересчитано<input type="number" min={0} step={1} required
        value={countedQuantity} onChange={e=>{setCountedQuantity(e.target.value);setCountConfirmed(false);setShortageConfirmed(false)}}/></label>
      {hasCountShortage&&<label className="watch-catalog-editor-confirm"><input type="checkbox"
        checked={shortageConfirmed} onChange={e=>setShortageConfirmed(e.target.checked)}/>
        Подтверждаю недостачу: фактическое количество меньше зарезервированного
      </label>}
      <label className="watch-catalog-editor-confirm"><input type="checkbox" checked={countConfirmed}
        onChange={e=>setCountConfirmed(e.target.checked)}/>
        Подтверждаю, что пересчитал(а) указанные часы физически
      </label>
      <button type="submit" disabled={busy||!selectedCount||!countConfirmed||(hasCountShortage&&!shortageConfirmed)}>Сохранить пересчёт</button>
    </form>}
  </section>
}
