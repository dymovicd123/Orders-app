import {useEffect,useMemo,useState,type FormEvent} from 'react'
import type {OrderItem} from '../../app/types'
import {pickerKey,type OrderPickerChoice,type SourceKey} from './MainOrderSourcePicker'
import {parseSaleSearch,foldSaleName} from './MainSalePicker'
import type {ManualOrderPreset} from './MainWorkshopOrderModal'
import '../../styles/main-clothing-source-picker.css'

type Origin=SourceKey|'workshop'
type SaleFields={quantity:number;unitPrice:number;comment:string;urgent:boolean;dueDate:string;dueTime:string}
type Props={
 allocated:ReadonlyMap<string,number>
 onCommit:(choice:OrderPickerChoice,source:Origin,fields:SaleFields,insufficient:boolean)=>void
 onManual:(source:Origin,preset?:ManualOrderPreset)=>void
 editing?:{index:number;item:OrderItem}|null
 onCancelEdit?:()=>void
 onPendingChange?:(pending:boolean)=>void
 onVariantsLoaded?:(rows:OrderPickerChoice[])=>void
 initialVariants?:OrderPickerChoice[]
}
type Model={id:number;name:string;rows:OrderPickerChoice[]}
type ColorGroup={name:string;rows:OrderPickerChoice[]}
const stockName=(source:SourceKey)=>source==='warehouse'?'Склад':'Бутик'
const money=(value:number)=>value.toLocaleString('ru-RU')+' ₸'
const norm=(value:unknown)=>String(value??'').trim().toLocaleUpperCase('ru-RU')
const noSize=(value:unknown)=>['','БЕЗ РАЗМЕРА','БЕЗРАЗМЕРА','Б/Р'].includes(norm(value))
const sizeIdentity=(value:unknown)=>noSize(value)?'@NO_SIZE':norm(value)
const marker=(value:OrderPickerChoice)=>[
 value.category,value.gender,value.material,value.color,value.length,sizeIdentity(value.size)
].map(norm).join('¦')
const EMPTY_SIZE_FILTER='@EMPTY_CATALOG_SIZE'
const gender=(value:string)=>norm(value)==='ЖЕН'?'Женский':norm(value)==='МУЖ'?'Мужской':value||'Пол не указан'
const length=(value:string)=>!value?'Длина не указана':norm(value)==='СТАНДАРТ'?'Обычная длина':value
const material=(value:string)=>!value?'Материал не указан':norm(value)==='СТАНДАРТ'?'Стандарт':value
export function formatClothingSize(value:OrderPickerChoice,allVariants:readonly OrderPickerChoice[]){
 const actual=norm(value.size)
 // Actual SKU sizes are not converted in the payload: in particular literal
 // СТАНДАРТ is a size, different from default material/length or from no-size.
 if(actual==='СТАНДАРТ')return 'Стандарт'
 if(noSize(actual))return 'Без размера'
 // Legacy adult size 0 can be displayed humanly only if its exact execution,
 // color and sex has NO competing catalog size. Its actual size remains "0".
 if(value.category==='adult'&&actual==='0'){
  const sameExecution=allVariants.filter(row=>row.productId===value.productId
   &&row.category===value.category&&norm(row.gender)===norm(value.gender)
   &&norm(row.color)===norm(value.color)&&norm(row.material)===norm(value.material)
   &&norm(row.length)===norm(value.length))
  if(sameExecution.length>0&&sameExecution.every(row=>norm(row.size)==='0'))return 'Без размера'
 }
 return value.size
}
const fullName=(value:OrderPickerChoice,variants:readonly OrderPickerChoice[])=>[
 value.productName,material(value.material),value.color||'Цвет не указан',
 gender(value.gender),length(value.length),
 (value.category==='child'?'Возраст ':'Размер ')+formatClothingSize(value,variants)
].join(' · ')

// Queries can specify an exact STANDARD size without confusing it with
// material or length. Unqualified "стандарт" narrows to any such characteristic.
export function parseClothingSearch(query:string,colors:readonly string[]){
 const terms=foldSaleName(query).split(' ').filter(Boolean)
 const consume=(phrase:readonly string[])=>{
  const start=terms.findIndex((word,index)=>word===phrase[0]&&
   phrase.every((part,offset)=>terms[index+offset]===part))
  if(start<0)return false
  terms.splice(start,phrase.length)
  return true
 }
 // JS \\b is not a Cyrillic word boundary. Operate on normalized tokens so
 // «размер стандарт» and «без размера» work with Russian and Kazakh names.
 let sizeMode:'no_size'|'standard'|'loose_standard'|'regular'='regular'
 if(consume(['без','размера']))sizeMode='no_size'
 else if(consume(['размер','стандарт']))sizeMode='standard'
 else if(consume(['стандарт']))sizeMode='loose_standard'
 const parsed=parseSaleSearch(terms.join(' '),colors)
 return {...parsed,sizeMode}
}
export function matchesClothingSize(row:OrderPickerChoice,search:ReturnType<typeof parseClothingSearch>,variants:readonly OrderPickerChoice[]){
 if(search.sizeMode==='no_size')return noSize(row.size)||
  (norm(row.size)==='0'&&formatClothingSize(row,variants)==='Без размера')
 if(search.sizeMode==='standard')return norm(row.size)==='СТАНДАРТ'
 if(search.sizeMode==='loose_standard')return norm(row.size)==='СТАНДАРТ'
  ||norm(row.length)==='СТАНДАРТ'||norm(row.material)==='СТАНДАРТ'
 return !search.size||norm(row.size)===norm(search.size)&&(!search.isChild||row.category==='child')
}
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
export function clothingRefinementPlan(rows:readonly OrderPickerChoice[]){
 const count=(get:(row:OrderPickerChoice)=>string)=>new Set(rows.map(get)).size
 const colors=count(row=>norm(row.color))
 const sizes=count(row=>sizeIdentity(row.size))
 const genders=count(row=>norm(row.gender))
 const lengths=count(row=>norm(row.length))
 const dense=rows.length>12
 // Offer a filter whenever ONE attribute makes browsing hard, not just
 // when there are many SKU combinations. 7 colors among 9 SKUs needs a
 // color picker; 9 sizes among 11 SKUs needs a size picker.
 const color=colors>=5||(dense&&colors>=3)
 const size=sizes>=7||(dense&&sizes>=3)
 const gender=genders>1&&(dense||genders>2)
 const length=lengths>1&&(dense||lengths>2)
 return {color,size,gender,length,visible:color||size||gender||length,
  colors,sizes,genders,lengths}
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

export function MainClothingSourcePicker({allocated,onCommit,onManual,editing,onCancelEdit,onPendingChange,onVariantsLoaded,initialVariants}:Props){
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

 useEffect(()=>{onVariantsLoaded?.(variants)},[variants,onVariantsLoaded])
 const models=useMemo(()=>sourceModelCatalog(variants,source,showAll),[variants,source,showAll])
 const allColors=useMemo(()=>[...new Set(variants.map(row=>row.color).filter(Boolean))],[variants])
 const search=useMemo(()=>parseClothingSearch(query,allColors),[query,allColors])
 const matchingModels=models.filter(model=>{
  const words=foldSaleName(model.name).split(' ')
  return search.modelTokens.every(token=>words.some(word=>word.startsWith(token)))&&
   (!search.size&&search.sizeMode==='regular'&&!search.color||model.rows.some(row=>
    matchesClothingSize(row,search,variants)&&(!search.color||row.color===search.color)))
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
 const materialSizes=[...new Set(materialRows.map(row=>noSize(row.size)?EMPTY_SIZE_FILTER:row.size))].sort(sortName)
 const materialGenders=[...new Set(materialRows.map(row=>row.gender))].sort(sortName)
 const materialLengths=[...new Set(materialRows.map(row=>row.length))].sort(sortName)
 const refinements=clothingRefinementPlan(materialRows)
 const shownRows=materialRows.filter(row=>
  matchesClothingSize(row,search,variants)
  &&(!search.color||row.color===search.color)
  &&(!filterColor||row.color===filterColor)
  &&(!filterSize||(filterSize===EMPTY_SIZE_FILTER?noSize(row.size):row.size===filterSize))
  &&(!filterGender||row.gender===filterGender)&&(!filterLength||row.length===filterLength))
 const colorGroups=sourceColorGroups(shownRows)
 const comparisonRows=filterSize&&new Set(shownRows.map(row=>norm(row.length))).size>1 ? shownRows : []
 // Small color palettes are all visible immediately. Larger ones still
 // expose every color through the selector, with progressive card browsing.
 const visibleColors=colorGroups.length<=10?colorGroups:colorGroups.slice(0,colorLimit)
 const draftItem=editing?.item||null
 const available=selected?sourceFree(selected,source,allocated,draftItem):0
 const missing=selected?!listed(selected,source):false
 const conflict=selected?variants.filter(item=>item.productId===selected.productId&&marker(item)===marker(selected)).length>1:false
 const blocked=conflict?'Есть несколько одинаково описанных товаров. Попросите администратора проверить карточки.':''
 const shortage=selected&&itemSource!=='workshop'?Math.max(0,Number(quantity||0)-available):0

 const clearFilters=()=>{setFilterColor('');setFilterSize('');setFilterGender('');setFilterLength('')}
 const discardSelection=()=>{
  setPickedId(null);setPrice('');setQuantity('1');setComment('');setUrgent(false)
  setDueDate('');setDueTime('');setError('');setItemSource(source)
 }
 const changeSource=(next:SourceKey)=>{
  if(next===source)return
  const keepModel=openId!==null&&variants.some(row=>row.productId===openId)
  const exactVisible=selected?listed(selected,next):
   !keepModel||variants.some(row=>row.productId===openId&&listed(row,next)
     &&(selectedMaterial===null||norm(row.material)===selectedMaterial)
     &&(!filterColor||row.color===filterColor)
     &&(!filterSize||(filterSize===EMPTY_SIZE_FILTER?noSize(row.size):row.size===filterSize))
     &&(!filterLength||row.length===filterLength)
     &&(!filterGender||row.gender===filterGender))
  setSource(next);setShowAll(keepModel&&!exactVisible)
  setModelLimit(20);setColorLimit(30);setError('')
  setItemSource(next)
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
    (!search.color||row.color===search.color)&&matchesClothingSize(row,search,variants))||[]
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
    size:filterSize===EMPTY_SIZE_FILTER?'БЕЗ РАЗМЕРА':filterSize,
    gender:filterGender||unique(row=>row.gender),
    length:filterLength||unique(row=>row.length),
  })
 }

 const openManualForVariant=(row:OrderPickerChoice,change:'size'|'color',explicitBase=true)=>{
  discardSelection()
  const hasDetails=Boolean(row.productName&&row.gender&&row.color&&row.material&&row.length&&
   (change==='size'||row.size))
  onManual(source,{
   productName:row.productName,
   audienceType:row.category==='child'?'ДЕТСКИЙ':'ВЗРОСЛЫЙ',
   gender:row.gender,
   color:change==='color'?'':row.color,
   material:row.material,
   length:row.length,
   size:change==='size'?'':noSize(row.size)?'БЕЗ РАЗМЕРА':row.size,
   quantity:1,
   unitPrice:row.salePrice??undefined,
   quickChange:hasDetails?change:undefined,
   previousValue:explicitBase?(change==='size'?row.size:row.color):undefined,
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
   {showAll&&<p className="clothing-source-alert">Здесь показаны также товары из других мест. Вы добавляете товар из {source==='warehouse'?'Склада':'Бутика'}; если его там нет, потребуется проверить наличие.</p>}
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
         <strong>{selectedMaterial===null?'Нет нужного материала?':'Не нашли подходящий вариант?'}</strong>
         <small>Для другого размера используйте кнопку ниже. Для другого цвета сначала выберите размер похожего товара.</small>
        </div>
        <button type="button" onClick={()=>openManualForModel(model)}>
         Указать вручную
        </button>
       </div>
       {selectedMaterial===null&&<p className="clothing-source-info">Выберите материал или добавьте свой вариант этой модели.</p>}
       {selectedMaterial!==null&&<>
        {refinements.visible&&<div className="clothing-source-refinements" aria-label="Фильтры внутри материала">
          <div className="clothing-source-refinement-head"><strong>Уточнить вариант</strong>
            <span>Показано {shownRows.length} из {materialRows.length}</span></div>
          <div className="clothing-source-refinement-controls">
            {refinements.color&&<label>Цвет
              <select aria-label="Фильтр по цвету" value={filterColor} onChange={event=>{setFilterColor(event.target.value);setColorLimit(6);discardSelection()}}>
                <option value="">Все цвета</option>
                {materialColors.map(value=><option value={value} key={value}>{value||'Без цвета'}</option>)}
              </select></label>}
            {refinements.size&&<label>Размер
              <select aria-label="Фильтр по размеру" value={filterSize} onChange={event=>{setFilterSize(event.target.value);setColorLimit(6);discardSelection()}}>
                <option value="">Все размеры</option>
                {materialSizes.map(value=>{
                  const row=materialRows.find(item=>(noSize(item.size)?EMPTY_SIZE_FILTER:item.size)===value)!
                  return <option value={value} key={value}>
                    {value===EMPTY_SIZE_FILTER?'Без размера':formatClothingSize(row,variants)}
                  </option>
                })}
              </select></label>}
            {refinements.gender&&<label>Пол
              <select aria-label="Фильтр по полу" value={filterGender} onChange={event=>{setFilterGender(event.target.value);setColorLimit(6);discardSelection()}}>
                <option value="">Любой</option>
                {materialGenders.map(value=><option value={value} key={value}>{gender(value)}</option>)}
              </select></label>}
            {refinements.length&&<label>Длина
              <select aria-label="Фильтр по длине" value={filterLength} onChange={event=>{setFilterLength(event.target.value);setColorLimit(6);discardSelection()}}>
                <option value="">Любая</option>
                {materialLengths.map(value=><option value={value} key={value}>{length(value)}</option>)}
              </select></label>}
            {(filterColor||filterSize||filterGender||filterLength)&&
              <button className="clothing-source-link" type="button" onClick={()=>{clearFilters();setColorLimit(6);discardSelection()}}>Сбросить</button>}
          </div>
        </div>}
        {comparisonRows.length>1&&<div className="clothing-source-comparison">
         <strong>Размер {filterSize===EMPTY_SIZE_FILTER?'Без размера':filterSize}: сравните длину</strong>
         <div className="clothing-source-comparison-options">
          {comparisonRows.slice(0,12).map(row=><button type="button" key={row.variantId}
           onClick={()=>{setFilterLength(row.length);setFilterColor(row.color);setFilterGender(row.gender);discardSelection()}}>
           <strong>{length(row.length)}</strong>
           <span>{gender(row.gender)} · {row.color||'Без цвета'}</span>
           <small>{sourceFree(row,source,allocated,draftItem)} шт. доступно · Показать</small>
          </button>)}
         </div>
         {comparisonRows.length>12&&<small>Показаны первые 12 вариантов. Выберите цвет для остальных.</small>}
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
              const bad=group.rows.filter(v=>marker(v)===marker(item)).length>1
              return <button type="button" key={item.variantId} disabled={bad}
               aria-label={fullName(item,variants)+(bad?' · требуется уточнение':' · '+free+' свободно')}
               aria-pressed={pickedId===item.variantId} onClick={()=>selectVariant(item)}
               className={'clothing-source-size'+(formatClothingSize(item,variants)==='Без размера'?' is-nosize':'')+(pickedId===item.variantId?' is-selected':'')+(free===0?' is-zero':'')}>
               <strong>{formatClothingSize(item,variants)}</strong><small>{bad?'Сверить':free===0?'0 шт.':free+' шт.'}</small>
              </button>
             })}</div>
             {!editing&&<button type="button" className="clothing-source-quick-link"
              onClick={()=>openManualForVariant(first,'size',false)}>+ Другой размер{first.category==='child'?' / возраст':''}</button>}
             {items.some(item=>noSize(item.size))&&<small className="clothing-source-hint">«Без размера» — это отдельный вариант товара. Выбирайте его только если такой вариант продан.</small>}
             {selected&&items.some(item=>item.variantId===selected.variantId)&&<form className="clothing-source-inline" onSubmit={save}>
              <div className="clothing-source-picked">
               <div><strong>{fullName(selected,variants)}</strong>
                {editing&&<small>Сейчас вы меняете этот товар в заказе.</small>}</div>
               <button type="button" onClick={discardSelection} aria-label="Отменить выбор">×</button>
              </div>
              {blocked&&<p className="clothing-source-alert" role="alert">{blocked}</p>}
              {!blocked&&<>
               {!editing&&<div className="clothing-source-quick-actions">
                <span>Нужен такой же товар, но с другим размером или цветом?</span>
                <button type="button" onClick={()=>openManualForVariant(selected,'size')}>Другой размер</button>
                <button type="button" onClick={()=>openManualForVariant(selected,'color')}>Другой цвет</button>
               </div>}
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
