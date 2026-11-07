import {useEffect,useMemo,useState,type FormEvent} from 'react'
import type {OrderItem} from '../../app/types'
import {pickerKey,type OrderPickerChoice,type SourceKey} from './MainOrderSourcePicker'
import {parseSaleSearch,foldSaleName} from './MainSalePicker'
import '../../styles/main-clothing-source-picker.css'

type Origin=SourceKey|'workshop'
type SaleFields={quantity:number;unitPrice:number;comment:string;urgent:boolean;dueDate:string;dueTime:string}
type Props={
 allocated:ReadonlyMap<string,number>
 onCommit:(choice:OrderPickerChoice,source:Origin,fields:SaleFields,insufficient:boolean)=>void
 onManual:(source:Origin,preset?:Partial<{productName:string;audienceType:string;gender:string;color:string;material:string;length:string;size:string}>)=>void
 editing?:{index:number;item:OrderItem}|null
 onCancelEdit?:()=>void
 onPendingChange?:(pending:boolean)=>void
 initialVariants?:OrderPickerChoice[]
}
type Model={id:number;name:string;rows:OrderPickerChoice[]}
type ColorGroup={name:string;rows:OrderPickerChoice[]}
const stockName=(source:SourceKey)=>source==='warehouse'?'Склад':'Бутик'
const money=(value:number)=>value.toLocaleString('ru-RU')+' ₸'
const norm=(value:unknown)=>String(value??'').trim().toLocaleUpperCase('ru-RU')
const marker=(value:OrderPickerChoice)=>[value.category,value.gender,value.material,value.color,value.length,value.size].map(norm).join('¦')
const gender=(value:string)=>norm(value)==='ЖЕН'?'Женский':norm(value)==='МУЖ'?'Мужской':value||'Пол не указан'
const length=(value:string)=>!value?'Длина не указана':norm(value)==='СТАНДАРТ'?'Обычная длина':value
const material=(value:string)=>!value?'Материал не указан':norm(value)==='СТАНДАРТ'?'Стандарт':value
const age=(value:OrderPickerChoice)=>value.category==='child'?'Возраст':'Размер'
const fullName=(value:OrderPickerChoice)=>[
 value.productName,material(value.material),value.color||'Цвет не указан',
 gender(value.gender),length(value.length),age(value)+' '+(value.size||'не указан')
].join(' · ')
const listed=(value:OrderPickerChoice,source:SourceKey)=>{
 const data=value[source]
 return data.listed===true||(data.listed===undefined&&(data.physical!==0||data.reserved!==0||data.cachedReserved!==0))
}
const sortName=(a:string,b:string)=>a.localeCompare(b,'ru',{numeric:true})
const sortSize=(a:OrderPickerChoice,b:OrderPickerChoice)=>sortName(a.size,b.size)
export function sourceModelCatalog(variants:readonly OrderPickerChoice[],source:SourceKey,showAll:boolean){
 const index=new Map<number,Model>()
 for(const item of variants){
  if(!item.productId||!item.variantId||(!showAll&&!listed(item,source)))continue
  let group=index.get(item.productId)
  if(!group){group={id:item.productId,name:item.productName,rows:[]};index.set(item.productId,group)}
  group.rows.push(item)
 }
 return [...index.values()].sort((a,b)=>sortName(a.name,b.name))
}
export function sourceFree(item:OrderPickerChoice,source:SourceKey,allocated:ReadonlyMap<string,number>,editing?:OrderItem|null){
 const draft=allocated.get(pickerKey(source,item.variantId))||0
 const own=editing?.sourceType===source&&Number(editing.catalogVariantId)===item.variantId
  ?Math.max(0,Number(editing.quantity)||0):0
 return Math.max(0,item[source].free-draft+own)
}
export function sourceColorGroups(variants:readonly OrderPickerChoice[]){
 const byColor=new Map<string,OrderPickerChoice[]>()
 for(const item of variants){
  const key=item.color||'ЦВЕТ НЕ УКАЗАН'
  byColor.set(key,[...(byColor.get(key)||[]),item])
 }
 return [...byColor].sort((a,b)=>sortName(a[0],b[0]))
  .map(([name,rows]):ColorGroup=>({name,rows}))
}

export function MainClothingSourcePicker({allocated,onCommit,onManual,editing,onCancelEdit,onPendingChange,initialVariants}:Props){
 const [source,setSource]=useState<SourceKey>('warehouse')
 const [showAll,setShowAll]=useState(false)
 const [variants,setVariants]=useState<OrderPickerChoice[]>(initialVariants||[])
 const [loading,setLoading]=useState(!initialVariants)
 const [loadError,setLoadError]=useState('')
 const [refresh,setRefresh]=useState(0)
 const [query,setQuery]=useState('')
 const [openId,setOpenId]=useState<number|null>(null)
 const [activeMaterial,setActiveMaterial]=useState<string|null>(null)
 const [colorLimit,setColorLimit]=useState(6)
 const [filterColor,setFilterColor]=useState('')
 const [filterSize,setFilterSize]=useState('')
 const [filterGender,setFilterGender]=useState('')
 const [filterLength,setFilterLength]=useState('')
 const [modelLimit,setModelLimit]=useState(20)
 const [pickedId,setPickedId]=useState<number|null>(null)
 const [itemSource,setItemSource]=useState<Origin>('warehouse')
 const [quantity,setQuantity]=useState('1')
 const [price,setPrice]=useState('')
 const [comment,setComment]=useState('')
 const [urgent,setUrgent]=useState(false)
 const [dueDate,setDueDate]=useState('')
 const [dueTime,setDueTime]=useState('')
 const [error,setError]=useState('')

 useEffect(()=>{
  if(initialVariants)return
  const controller=new AbortController()
  setLoading(true);setLoadError('')
  fetch('/api/orders/source-picker',{credentials:'same-origin',cache:'no-store',signal:controller.signal})
   .then(async response=>{
    const data=await response.json() as {ok:boolean;variants?:OrderPickerChoice[];message?:string}
    if(!response.ok||!data.ok||!Array.isArray(data.variants))throw Error(data.message||'Каталог недоступен')
    return data.variants
   })
   .then(rows=>{if(!controller.signal.aborted)setVariants(rows)})
   .catch(reason=>{if(!controller.signal.aborted)setLoadError(reason instanceof Error?reason.message:'Ошибка загрузки')})
   .finally(()=>{if(!controller.signal.aborted)setLoading(false)})
  return ()=>controller.abort()
 },[initialVariants,refresh])

 const models=useMemo(()=>sourceModelCatalog(variants,source,showAll),[variants,source,showAll])
 const allColors=useMemo(()=>[...new Set(variants.map(row=>row.color).filter(Boolean))],[variants])
 const search=useMemo(()=>parseSaleSearch(query,allColors),[query,allColors])
 const matchingModels=models.filter(model=>{
  const words=foldSaleName(model.name).split(' ')
  return search.modelTokens.every(token=>words.some(word=>word.startsWith(token)))&&
   (!search.size&&!search.color||model.rows.some(row=>
    (!search.size||row.size===search.size&&(!search.isChild||row.category==='child'))&&
    (!search.color||row.color===search.color)))
 })
 const visibleModels=matchingModels.slice(0,modelLimit)
 const activeModel=models.find(model=>model.id===openId)||null
 const selected=variants.find(row=>row.variantId===pickedId)||null
 const chosenGroup=activeModel?.rows||[]
 const materials=[...new Set(chosenGroup.map(row=>norm(row.material)))]
  .sort((a,b)=>sortName(a,b))
 const selectedMaterial=materials.length===1?materials[0]:activeMaterial
 const materialRows=selectedMaterial===null?[]:chosenGroup.filter(row=>norm(row.material)===selectedMaterial)
 const materialColors=[...new Set(materialRows.map(row=>row.color))].sort(sortName)
 const materialSizes=[...new Set(materialRows.map(row=>row.size))].sort(sortName)
 const materialGenders=[...new Set(materialRows.map(row=>row.gender))].sort(sortName)
 const materialLengths=[...new Set(materialRows.map(row=>row.length))].sort(sortName)
 const shownRows=materialRows.filter(row=>
  (!filterColor||row.color===filterColor)&&(!filterSize||row.size===filterSize)&&
  (!filterGender||row.gender===filterGender)&&(!filterLength||row.length===filterLength))
 const colorGroups=sourceColorGroups(shownRows)
 const visibleColors=colorGroups.slice(0,colorLimit)
 const draftItem=editing?.item||null
 const available=selected?sourceFree(selected,source,allocated,draftItem):0
 const missing=selected?!listed(selected,source):false
 const conflict=selected?variants.filter(item=>item.productId===selected.productId&&marker(item)===marker(selected)).length>1:false
 const blocked=selected&&!selected.size?'Не указан размер или возраст. Сверьте карточку товара.':
  conflict?'Несколько SKU имеют одинаковые характеристики. Сначала уточните вариант в каталоге.':''
 const shortage=selected&&itemSource!=='workshop'?Math.max(0,Number(quantity||0)-available):0

 const clearFilters=()=>{setFilterColor('');setFilterSize('');setFilterGender('');setFilterLength('')}
 const discardSelection=()=>{
  setPickedId(null);setPrice('');setQuantity('1');setComment('');setUrgent(false)
  setDueDate('');setDueTime('');setError('');setItemSource(source)
 }
 const changeSource=(next:SourceKey)=>{
  setSource(next);setShowAll(false);setModelLimit(20);setColorLimit(6)
  setActiveMaterial(null);clearFilters();setError('');discardSelection()
  // Leave the opened model in place, if it exists at the new source.
 }
 const toggleAll=()=>{
  setShowAll(value=>!value);setActiveMaterial(null);clearFilters();setColorLimit(6);discardSelection()
 }
 const selectModel=(id:number)=>{
  if(openId===id){setOpenId(null);setActiveMaterial(null)}
  else {
   setOpenId(id);setActiveMaterial(null);clearFilters();setColorLimit(6)
   const model=models.find(item=>item.id===id)
   const queryMatches=model?.rows.filter(row=>
    (!search.color||row.color===search.color)&&(!search.size||row.size===search.size))||[]
   const found=[...new Set(queryMatches.map(item=>norm(item.material)))]
   if((search.color||search.size)&&found.length===1)setActiveMaterial(found[0])
  }
  discardSelection()
 }
 const selectVariant=(row:OrderPickerChoice)=>{
  if(pickedId===row.variantId){discardSelection();return}
  setPickedId(row.variantId);setItemSource(editing?.item?.sourceType==='workshop'?'workshop':source)
  setQuantity(editing?String(editing.item.quantity||1):'1')
  setPrice(editing&&editing.item.unitPrice!=null?String(editing.item.unitPrice):row.salePrice==null?'':String(row.salePrice))
  setComment(String(editing?.item?.workshopComment||''))
  setUrgent(Boolean(editing?.item?.workshopUrgent))
  setDueDate(String(editing?.item?.workshopDueDate||''));setDueTime(String(editing?.item?.workshopDueTime||''))
  setError('')
 }
 const cancelEdit=()=>{discardSelection();onCancelEdit?.()}
 useEffect(()=>{onPendingChange?.(pickedId!==null)},[pickedId,onPendingChange])
 useEffect(()=>{
  if(!editing?.item||!variants.length)return
  const item=variants.find(row=>row.variantId===Number(editing.item.catalogVariantId))
  if(!item)return
  const place:SourceKey=editing.item.sourceType==='boutique'?'boutique':'warehouse'
  setSource(place);setShowAll(!listed(item,place));setOpenId(item.productId)
  setActiveMaterial(norm(item.material));clearFilters();setColorLimit(30)
  setPickedId(item.variantId);setItemSource(editing.item.sourceType as Origin)
  setQuantity(String(editing.item.quantity||1));setPrice(editing.item.unitPrice==null?'':String(editing.item.unitPrice))
  setComment(String(editing.item.workshopComment||''));setUrgent(Boolean(editing.item.workshopUrgent))
  setDueDate(String(editing.item.workshopDueDate||''));setDueTime(String(editing.item.workshopDueTime||''))
  setError('')
 },[editing?.index,editing?.item?.catalogVariantId,variants])

 const openManualForModel=(model:Model)=>{
  discardSelection()
  const rows=selectedMaterial===null?model.rows:materialRows
  const unique=(get:(row:OrderPickerChoice)=>string)=>{
    const values=[...new Set(rows.map(get).filter(Boolean))]
    return values.length===1?values[0]:''
  }
  onManual(source,{
    productName:model.name,
    audienceType:unique(row=>row.category)==='child'?'ДЕТСКИЙ':'ВЗРОСЛЫЙ',
    material:selectedMaterial!==null?(rows[0]?.material||selectedMaterial):'',
    color:filterColor,
    size:filterSize,
    gender:filterGender||unique(row=>row.gender),
    length:filterLength||unique(row=>row.length),
  })
 }

 const save=(event:FormEvent)=>{
  event.preventDefault()
  if(!selected||blocked)return
  const amount=Number(price),qty=Number(quantity)
  if(!Number.isSafeInteger(qty)||qty<1){setError('Укажите целое количество от 1.');return}
  if(!price.trim()||!Number.isFinite(amount)||amount<0){setError('Укажите цену продажи.');return}
  if(itemSource==='workshop'&&!comment.trim()){setError('Для Цеха необходимо задание.');return}
  if(itemSource==='workshop'&&urgent&&!dueDate){setError('Укажите дату срочного изготовления.');return}
  onCommit(selected,itemSource,{quantity:qty,unitPrice:amount,comment,
   urgent:itemSource==='workshop'&&urgent,dueDate:itemSource==='workshop'?dueDate:'',
   dueTime:itemSource==='workshop'?dueTime:''},itemSource!=='workshop'&&qty>available)
  discardSelection()
 }

 return <section className="clothing-source-picker" aria-label="Каталог одежды для заказа">
  <div className="clothing-source-top">
   <div className="clothing-source-tabs" role="group" aria-label="Источник товара">
    {(['warehouse','boutique'] as SourceKey[]).map(key=>
     <button type="button" key={key} className={source===key?'is-active':''}
      aria-pressed={source===key} onClick={()=>changeSource(key)}>{stockName(key)}</button>)}
    <button type="button" className="clothing-source-workshop-tab"
      onClick={()=>{discardSelection();onManual('workshop')}} aria-label="Товар в цех">
      <strong>Цех</strong><small>Товар в цех</small>
    </button>
   </div>
   <button className="clothing-source-reload" type="button" onClick={()=>setRefresh(value=>value+1)}>Обновить остатки</button>
  </div>
  <div className="clothing-source-head">
   <div><h3>Выберите проданную вещь</h3>
    <small>{showAll?'Весь каталог, источник остаётся '+stockName(source):'Позиции '+(source==='warehouse'?'Склада':'Бутика')+', включая нулевой остаток'}</small>
   </div>
   </div>
  {loading&&<p className="clothing-source-info">Загрузка товаров…</p>}
  {loadError&&<p className="clothing-source-alert" role="alert">{loadError} <button type="button" onClick={()=>setRefresh(x=>x+1)}>Повторить</button></p>}
  {!loading&&!loadError&&<>
   <div className="clothing-source-search">
    <label className="clothing-source-search-label">
     <span className="clothing-source-search-icon" aria-hidden="true">⌕</span>
     <input type="search" aria-label="Поиск модели" placeholder="Название модели, например Баян" value={query}
      onChange={event=>{setQuery(event.target.value);setModelLimit(20);setOpenId(null);clearFilters();discardSelection()}}/>
    </label>
    <small>{matchingModels.length} моделей</small>
   </div>
   {showAll&&<p className="clothing-source-alert">Показан также каталог вне {source==='warehouse'?'Склада':'Бутика'}. Выбранный источник не меняется автоматически.</p>}
   {!matchingModels.length&&<div className="clothing-source-empty">
    <strong>{query?'Не нашли эту модель':'В этом источнике нет моделей каталога'}</strong>
    <span>Можно открыть весь каталог или вручную указать отсутствующую модель.</span>
    <button type="button" className="clothing-source-manual-fallback"
     onClick={()=>{discardSelection();onManual(source,{productName:query.trim()})}}>
      + Вписать модель вручную в {stockName(source)}
    </button>
   </div>}
   <div className="clothing-source-model-grid">
    {Array.from({length:Math.ceil(visibleModels.length/2)},(_,n)=>{
     const pair=visibleModels.slice(n*2,n*2+2)
     const model=pair.find(value=>value.id===openId)
     return <div className="clothing-source-model-row" key={'row-'+n}>
      <div className="clothing-source-model-pair">{pair.map(value=>{
       const sum=value.rows.reduce((total,row)=>total+sourceFree(row,source,allocated,draftItem),0)
       return <button type="button" key={value.id} className={'clothing-source-model'+(openId===value.id?' is-open':'')}
        aria-expanded={openId===value.id} onClick={()=>selectModel(value.id)}>
        <span className="clothing-source-model-mark" aria-hidden="true">{value.name.slice(0,1)}</span>
        <span className="clothing-source-model-body"><strong>{value.name}</strong>
         <small>{value.rows.length} вариантов {showAll?'в каталоге':'в источнике'}</small></span>
        <span className="clothing-source-model-right"><small>{sum>0?sum+' свободно':'Нет свободных'}</small>
         <span>{openId===value.id?'Свернуть −':'Выбрать +'}</span></span>
       </button>
      })}</div>
      {model&&<section className="clothing-source-detail" aria-label={'Варианты '+model.name}>
       <div className="clothing-source-detail-title">
        <div><h4>{model.name}</h4><small>Выберите материал и нужный размер в своём цвете</small></div>
        <button type="button" onClick={()=>{setOpenId(null);discardSelection()}}>Закрыть ×</button>
       </div>
       {materials.length>1?<div className="clothing-source-materials" role="group" aria-label="Материал">
        {materials.map(key=>{
         const rows=model.rows.filter(value=>norm(value.material)===key)
         return <button type="button" key={key} aria-pressed={selectedMaterial===key}
          className={selectedMaterial===key?'is-active':''}
          onClick={()=>{setActiveMaterial(key);clearFilters();setColorLimit(6);discardSelection()}}>
          <strong>{material(rows[0].material)}</strong><small>{rows.length} вариантов</small>
         </button>
        })}
       </div>:materials.length===1?<div className="clothing-source-single-material">Материал: <strong>{material(model.rows[0].material)}</strong></div>:null}
       <div className="clothing-source-own-variant">
        <div>
         <strong>{selectedMaterial===null?'Не нашли нужный материал?':'Нет нужного цвета, длины или размера?'}</strong>
         <small>Свой вариант этой модели · {stockName(source)} · без перехода в Цех</small>
        </div>
        <button type="button" onClick={()=>openManualForModel(model)}>
         + Свой вариант
        </button>
       </div>
       {selectedMaterial===null&&<p className="clothing-source-info">Выберите материал или добавьте свой вариант этой модели.</p>}
       {selectedMaterial!==null&&<>
        {materialRows.length>12&&<div className="clothing-source-refinements" aria-label="Фильтры внутри материала">
          <div className="clothing-source-refinement-head"><strong>Уточнить вариант</strong>
            <span>Показано {shownRows.length} из {materialRows.length}</span></div>
          <div className="clothing-source-refinement-controls">
            {materialColors.length>1&&<label>Цвет
              <select aria-label="Фильтр по цвету" value={filterColor} onChange={event=>{setFilterColor(event.target.value);setColorLimit(6);discardSelection()}}>
                <option value="">Все цвета</option>
                {materialColors.map(value=><option value={value} key={value}>{value||'Без цвета'}</option>)}
              </select></label>}
            {materialSizes.length>1&&<label>Размер
              <select aria-label="Фильтр по размеру" value={filterSize} onChange={event=>{setFilterSize(event.target.value);setColorLimit(6);discardSelection()}}>
                <option value="">Все размеры</option>
                {materialSizes.map(value=><option value={value} key={value}>{value||'Без размера'}</option>)}
              </select></label>}
            {materialGenders.length>1&&<label>Пол
              <select aria-label="Фильтр по полу" value={filterGender} onChange={event=>{setFilterGender(event.target.value);setColorLimit(6);discardSelection()}}>
                <option value="">Любой</option>
                {materialGenders.map(value=><option value={value} key={value}>{gender(value)}</option>)}
              </select></label>}
            {materialLengths.length>1&&<label>Длина
              <select aria-label="Фильтр по длине" value={filterLength} onChange={event=>{setFilterLength(event.target.value);setColorLimit(6);discardSelection()}}>
                <option value="">Любая</option>
                {materialLengths.map(value=><option value={value} key={value}>{length(value)}</option>)}
              </select></label>}
            {(filterColor||filterSize||filterGender||filterLength)&&
              <button className="clothing-source-link" type="button" onClick={()=>{clearFilters();setColorLimit(6);discardSelection()}}>Сбросить</button>}
          </div>
        </div>}
        {shownRows.length===0&&<div className="clothing-source-empty">Нет вариантов с этими характеристиками. Измените фильтры.</div>}
        <div className="clothing-source-color-list">
         {visibleColors.map(group=>{
          const lines=new Map<string,OrderPickerChoice[]>()
          for(const value of group.rows){
           const key=[value.category,value.gender,value.length].map(norm).join('¦')
           lines.set(key,[...(lines.get(key)||[]),value])
          }
          return <div className="clothing-source-color" key={group.name}>
           <div className="clothing-source-color-title">
            <strong>{group.name}</strong>
            <small>{group.rows.length} вариантов</small>
           </div>
           {[...lines].map(([key,items])=>{
            const first=items[0]
            const lineLabel=(first.category==='child'?'Детский · ':'')+gender(first.gender)+' · '+length(first.length)
            return <div className="clothing-source-size-row" key={key}>
             <div className="clothing-source-size-name"><strong>{lineLabel}</strong></div>
             <div className="clothing-source-sizes">{items.slice().sort(sortSize).map(item=>{
              const free=sourceFree(item,source,allocated,draftItem)
              const bad=!item.size||group.rows.filter(v=>marker(v)===marker(item)).length>1
              return <button type="button" key={item.variantId} disabled={bad}
               aria-label={fullName(item)+(bad?' · требуется уточнение':' · '+free+' свободно')}
               aria-pressed={pickedId===item.variantId} onClick={()=>selectVariant(item)}
               className={'clothing-source-size'+(pickedId===item.variantId?' is-selected':'')+(free===0?' is-zero':'')}>
               <strong>{item.size||'—'}</strong><small>{bad?'Сверить':free===0?'0 шт.':free+' шт.'}</small>
              </button>
             })}</div>
             {items.some(item=>!item.size)&&<small className="clothing-source-hint">Записи без размера требуют уточнения каталога.</small>}
             {selected&&items.some(item=>item.variantId===selected.variantId)&&<form className="clothing-source-inline" onSubmit={save}>
              <div className="clothing-source-picked">
               <div><strong>{fullName(selected)}</strong>
                {editing&&<small>Изменение существующей позиции · данные заказа будут сохранены</small>}</div>
               <button type="button" onClick={discardSelection} aria-label="Отменить выбор">×</button>
              </div>
              {blocked&&<p className="clothing-source-alert" role="alert">{blocked}</p>}
              {!blocked&&<>
               {missing&&itemSource!=='workshop'&&<p className="clothing-source-alert">Товар не числится в {source==='warehouse'?'Складе':'Бутике'}. Можно оформить только с уточнением.</p>}
               <div className="clothing-source-fields">
                <label>Количество<input type="number" min="1" step="1" value={quantity} onChange={event=>setQuantity(event.target.value)}/></label>
                <label>Цена за шт., ₸<input type="number" min="0" step="1" placeholder="Цена" value={price} onChange={event=>setPrice(event.target.value)}/></label>
               </div>
               {selected.salePrice===null?<small className="clothing-source-hint">В каталоге цена не задана. Укажите цену продажи.</small>:
                price!==String(selected.salePrice)&&<button type="button" className="clothing-source-link" onClick={()=>setPrice(String(selected.salePrice))}>Цена каталога: {money(selected.salePrice)} · Подставить</button>}
               <div className="clothing-source-fulfillment">
                <label><input type="radio" checked={itemSource===source} onChange={()=>setItemSource(source)}/> {stockName(source)}</label>
                <label><input type="radio" checked={itemSource==='workshop'} onChange={()=>setItemSource('workshop')}/> Изготовить в Цехе</label>
               </div>
               {itemSource==='workshop'&&<div className="clothing-source-workshop">
                <label>Задание Цеху<textarea value={comment} onChange={event=>setComment(event.target.value)} placeholder="Что нужно изготовить"/></label>
                <label className="clothing-source-urgent"><input type="checkbox" checked={urgent} onChange={event=>setUrgent(event.target.checked)}/> Срочно</label>
                {urgent&&<div className="clothing-source-fields">
                 <label>Нужно до<input type="date" value={dueDate} onChange={event=>setDueDate(event.target.value)}/></label>
                 <label>Время<input type="time" value={dueTime} onChange={event=>setDueTime(event.target.value)}/></label>
                </div>}
               </div>}
               {itemSource!=='workshop'&&<details className="clothing-source-stock-facts">
                <summary>Остаток и резервы</summary>
                <p>Учтено: {selected[source].physical} · в резерве: {selected[source].reserved} · доступно для заказа: {available}</p>
               </details>}
               {shortage>0&&itemSource!=='workshop'&&<p className="clothing-source-alert">Нужно уточнить наличие {shortage} шт. · {stockName(source)}. Оформление разрешено.</p>}
               {error&&<p className="clothing-source-error" role="alert">{error}</p>}
               <button type="submit" className="clothing-source-add">{editing?'Сохранить изменение':itemSource!=='workshop'&&shortage>0?'Добавить с уточнением':'+ В заказ'}</button>
               {editing&&<button type="button" className="clothing-source-link" onClick={cancelEdit}>Отменить изменение</button>}
              </>}
             </form>}
            </div>
           })}
          </div>
         })}
        </div>
        {colorGroups.length>visibleColors.length&&<button type="button" className="clothing-source-show-more"
         onClick={()=>setColorLimit(x=>x+8)}>Ещё цвета ({colorGroups.length-visibleColors.length})</button>}
       </>}
      </section>}
     </div>
    })}
   </div>
   {matchingModels.length>visibleModels.length&&<button type="button" className="clothing-source-show-more" onClick={()=>setModelLimit(x=>x+20)}>Показать ещё модели ({matchingModels.length-visibleModels.length})</button>}
   <div className="clothing-source-bottom">
    <button type="button" className="clothing-source-link" onClick={toggleAll}>
     {showAll?'← Только товары '+(source==='warehouse'?'Склада':'Бутика'):'Нужного варианта нет? Весь каталог'}
    </button>
    {editing&&<button type="button" className="clothing-source-link" onClick={cancelEdit}>Отменить изменение позиции</button>}
   </div>
  </>}
 </section>
}
