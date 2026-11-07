import {useEffect,useMemo,useState,type FormEvent} from 'react'
import type {OrderItem} from '../../app/types'
import type {OrderPickerChoice,SourceKey} from './MainOrderSourcePicker'
import {pickerKey} from './MainOrderSourcePicker'
import '../../styles/main-sale-picker.css'

type Origin=SourceKey|'workshop'
type SaleFields={
 quantity:number
 unitPrice:number
 comment:string
 urgent:boolean
 dueDate:string
 dueTime:string
}
type Props={
 allocated:ReadonlyMap<string,number>
 onCommit:(choice:OrderPickerChoice,source:Origin,fields:SaleFields,insufficient:boolean)=>void
 onManual:()=>void
 editing?:{index:number;item:OrderItem}|null
 onCancelEdit?:()=>void
 initialVariants?:OrderPickerChoice[]
}
const text=(value:unknown)=>String(value??'')
const letters:Record<string,string>={'ё':'е','қ':'к','ө':'о','ұ':'у','ү':'у','ә':'а','і':'и','ң':'н','ғ':'г','һ':'х'}
export const foldSaleName=(value:string)=>text(value).toLocaleLowerCase('ru-RU')
 .replace(/[ёқөұүәіңғһ]/g,character=>letters[character]||character)
 .replace(/[^\p{L}\p{N}]+/gu,' ').trim()
const money=(value:number)=>value.toLocaleString('ru-RU')+' ₸'
const audience=(choice:OrderPickerChoice)=>choice.category==='child'?'Детский':'Взрослый'
const details=(choice:OrderPickerChoice)=>[
 choice.color||'Цвет не указан',choice.material||'Материал не указан',
 choice.category==='child'?'Возраст '+(choice.size||'не указан'):'Размер '+(choice.size||'не указан'),
 choice.gender||'Пол не указан',choice.length||'Длина не указана'
].join(' · ')
const groupsKey=(choice:OrderPickerChoice)=>[
 choice.category,choice.gender,choice.color,choice.material,choice.length
].join('\u00a6')
const sortVariants=(a:OrderPickerChoice,b:OrderPickerChoice)=>a.size.localeCompare(b.size,'ru',{numeric:true})
const sourceName=(source:Origin)=>source==='warehouse'?'Склад':source==='boutique'?'Бутик':'Цех'

export function parseSaleSearch(query:string,availableColors:readonly string[]){
 const terms=foldSaleName(query).split(' ').filter(Boolean)
 const sorted=[...availableColors].sort((a,b)=>foldSaleName(b).length-foldSaleName(a).length)
 let color=''
 for(const candidate of sorted){
  const words=foldSaleName(candidate).split(' ')
  const start=terms.findIndex((_,index)=>words.every((word,offset)=>terms[index+offset]===word))
  if(start>=0){terms.splice(start,words.length);color=candidate;break}
 }
 const numberIndex=terms.findIndex(value=>/^\d+$/.test(value))
 const size=numberIndex>=0?terms.splice(numberIndex,1)[0]:''
 const isChild=terms.some(value=>['год','года','лет','возраст'].includes(value))
 return {modelTokens:terms.filter(value=>!['размер','год','года','лет','возраст'].includes(value)),
  size,color,isChild}
}

export function MainSalePicker({allocated,onCommit,onManual,editing,onCancelEdit,initialVariants}:Props){
 const [variants,setVariants]=useState<OrderPickerChoice[]>(initialVariants||[])
 const [loading,setLoading]=useState(!initialVariants)
 const [error,setError]=useState('')
 const [reload,setReload]=useState(0)
 const [query,setQuery]=useState('')
 const [modelId,setModelId]=useState<number|null>(null)
 const [size,setSize]=useState('')
 const [color,setColor]=useState('')
 const [expanded,setExpanded]=useState(false)
 const [visibleCount,setVisibleCount]=useState(20)
 const [chosenId,setChosenId]=useState<number|null>(null)
 const [source,setSource]=useState<Origin|''>('')
 const [quantity,setQuantity]=useState('1')
 const [price,setPrice]=useState('')
 const [comment,setComment]=useState('')
 const [urgent,setUrgent]=useState(false)
 const [dueDate,setDueDate]=useState('')
 const [dueTime,setDueTime]=useState('')
 const [formError,setFormError]=useState('')

 useEffect(()=>{
  if(initialVariants)return
  const controller=new AbortController()
  setLoading(true);setError('')
  fetch('/api/orders/source-picker',{credentials:'same-origin',signal:controller.signal})
   .then(async response=>{
    const data=await response.json() as {ok:boolean;variants?:OrderPickerChoice[];message?:string}
    if(!response.ok||!data.ok||!Array.isArray(data.variants))throw Error(data.message||'Не удалось получить каталог')
    return data.variants
   })
   .then(rows=>{if(!controller.signal.aborted)setVariants(rows)})
   .catch(err=>{if(!controller.signal.aborted)setError(err instanceof Error?err.message:'Ошибка загрузки')})
   .finally(()=>{if(!controller.signal.aborted)setLoading(false)})
  return ()=>controller.abort()
 },[reload,initialVariants])

 const models=useMemo(()=>{
  const index=new Map<number,{id:number;name:string;variants:OrderPickerChoice[]}>()
  for(const choice of variants){
   if(choice.variantId<=0||choice.productId<=0)continue
   let model=index.get(choice.productId)
   if(!model){model={id:choice.productId,name:choice.productName,variants:[]};index.set(model.id,model)}
   model.variants.push(choice)
  }
  return [...index.values()].sort((a,b)=>a.name.localeCompare(b.name,'ru',{numeric:true}))
 },[variants])
 const availableColors=useMemo(()=>[...new Set(variants.map(choice=>choice.color).filter(Boolean))],[variants])
 const search=useMemo(()=>parseSaleSearch(query,availableColors),[query,availableColors])
 const selectedModel=models.find(model=>model.id===modelId)||null
 const chosen=variants.find(choice=>choice.variantId===chosenId)||null

 useEffect(()=>{
  if(!editing?.item)return
  const choice=variants.find(value=>value.variantId===Number(editing.item.catalogVariantId))
  if(!choice)return
  setModelId(choice.productId);setChosenId(choice.variantId);setSize('')
  setColor('');setQuery('');setSource(editing.item.sourceType as Origin)
  setQuantity(String(editing.item.quantity||1))
  setPrice(editing.item.unitPrice==null?'':String(editing.item.unitPrice))
  setComment(text(editing.item.workshopComment||''))
  setUrgent(Boolean(editing.item.workshopUrgent))
  setDueDate(text(editing.item.workshopDueDate||''))
  setDueTime(text(editing.item.workshopDueTime||''))
  setFormError('')
 },[editing?.index,editing?.item?.catalogVariantId,variants])

 const searchMatches=models.filter(model=>{
  const words=foldSaleName(model.name).split(' ')
  if(!search.modelTokens.every(token=>words.some(word=>word.startsWith(token))))return false
  if(!search.color&&!search.size)return true
  return model.variants.some(choice=>
   (!search.color||choice.color===search.color)&&
   (!search.size||(choice.size===search.size&&(!search.isChild||choice.category==='child'))))
 })
 const shownModels=searchMatches.slice(0,visibleCount)
 const allSizes=selectedModel?[...new Map(selectedModel.variants.map(choice=>[
   (choice.category==='child'?'Д:':'В:')+choice.size,
   {value:(choice.category==='child'?'Д:':'В:')+choice.size,
    label:(choice.category==='child'?'Возраст ':'Размер ')+(choice.size||'не указан')}
  ])).values()].sort((a,b)=>a.label.localeCompare(b.label,'ru',{numeric:true})):[]
 const modelColors=selectedModel?[...new Set(selectedModel.variants.map(choice=>choice.color))]
  .sort((a,b)=>a.localeCompare(b,'ru')):[]
 const filtered=selectedModel?.variants.filter(choice=>
  (!size||((choice.category==='child'?'Д:':'В:')+choice.size)===size)&&(!color||choice.color===color))||[]
 const grouped=new Map<string,OrderPickerChoice[]>()
 for(const choice of filtered){
  const key=groupsKey(choice)
  const arr=grouped.get(key)||[]
  arr.push(choice);grouped.set(key,arr)
 }
 const sortedGroups=[...grouped.values()].sort((a,b)=>(
  a[0].color.localeCompare(b[0].color,'ru')||
  a[0].material.localeCompare(b[0].material,'ru')||
  a[0].length.localeCompare(b[0].length,'ru')))
 const shownGroups=size||color||expanded?sortedGroups:sortedGroups.slice(0,6)
 const editItem=editing?.item
 const availability=(choice:OrderPickerChoice,place:SourceKey)=>{
  const current=allocated.get(pickerKey(place,choice.variantId))||0
  const own=editItem&&Number(editItem.catalogVariantId)===choice.variantId&&editItem.sourceType===place
   ?Math.max(0,Number(editItem.quantity)||0):0
  return Math.max(0,choice[place].free-current+own)
 }
 const duplicates=chosen?variants.filter(choice=>choice.productId===chosen.productId&&
  groupsKey(choice)===groupsKey(chosen)&&choice.size===chosen.size).length>1:false
 const blocked=chosen&&!chosen.size?'В каталоге у варианта не указан размер или возраст. Уточните карточку товара.'
  :duplicates?'Несколько SKU имеют одинаковые характеристики. Уточните карточку или маркировку.':''
 const available=chosen&&source!=='workshop'&&source?availability(chosen,source):0
 const shortage=source&&source!=='workshop'&&chosen?Math.max(0,Number(quantity||0)-available):0
 const reset=()=>{
  setModelId(null);setChosenId(null);setQuery('');setSize('');setColor('')
  setExpanded(false);setVisibleCount(20);setSource('');setQuantity('1');setPrice('')
  setComment('');setUrgent(false);setDueDate('');setDueTime('');setFormError('')
 }
 const openModel=(id:number)=>{
  const model=models.find(value=>value.id===id)
  if(!model)return
  setModelId(id);setChosenId(null);setSource('');setExpanded(false)
  setSize(search.size?(search.isChild?'Д:':'В:')+search.size:'')
  setColor(search.color);setFormError('')
 }
 const choose=(choice:OrderPickerChoice)=>{
  setChosenId(choice.variantId);setSource(editItem?.sourceType as Origin||'')
  setQuantity(editItem?String(editItem.quantity||1):'1')
  setPrice(editItem&&editItem.unitPrice!=null?String(editItem.unitPrice):choice.salePrice==null?'':String(choice.salePrice))
  setComment(text(editItem?.workshopComment||''))
  setUrgent(Boolean(editItem?.workshopUrgent));setDueDate(text(editItem?.workshopDueDate||''))
  setDueTime(text(editItem?.workshopDueTime||''));setFormError('')
 }
 const save=(event:FormEvent)=>{
  event.preventDefault()
  if(!chosen||blocked)return
  const qty=Number(quantity)
  const amount=Number(price)
  if(!source){setFormError('Выберите источник товара.');return}
  if(!Number.isSafeInteger(qty)||qty<1){setFormError('Укажите целое количество от 1.');return}
  if(price.trim()===''||!Number.isFinite(amount)||amount<0){setFormError('Укажите цену продажи в тенге.');return}
  if(source==='workshop'&&!comment.trim()){setFormError('Укажите задание для Цеха.');return}
  if(source==='workshop'&&urgent&&!dueDate){setFormError('Для срочного заказа укажите дату готовности.');return}
  onCommit(chosen,source,{quantity:qty,unitPrice:amount,comment,urgent:source==='workshop'&&urgent,dueDate,dueTime},
   source!=='workshop'&&qty>available)
  reset()
 }

 return <section className="main-sale-picker" aria-label="Выбор товара">
  <header className="main-sale-picker-header">
   <div><small>{editing?'Изменение позиции':'Добавить товар'}</small><h3>{chosen?'Проверьте выбранную вещь':selectedModel?selectedModel.name:'Модели одежды'}</h3></div>
   <button type="button" className="secondary compact" onClick={()=>setReload(n=>n+1)}>Обновить остатки</button>
  </header>
  {loading&&<p role="status">Загрузка каталога…</p>}
  {error&&<div role="alert">{error} <button type="button" onClick={()=>setReload(x=>x+1)}>Повторить</button></div>}
  {!loading&&!error&&!selectedModel&&<div className="main-sale-stack">
   <label className="main-sale-label">Найти модель
    <input type="search" value={query} onChange={event=>{setQuery(event.target.value);setVisibleCount(20)}}
      placeholder="Например, Баян белый 44" aria-label="Поиск модели, цвета и размера"/>
   </label>
   {query&&<small className="main-sale-hint">Поиск учитывает русское написание казахских букв. Цвет и размер — точные признаки.</small>}
   <div className="main-sale-models">
    {shownModels.map(model=><button key={model.id} className="main-sale-model" type="button" onClick={()=>openModel(model.id)}>
     <strong>{model.name}</strong><small>{model.variants.length} вариантов</small><span aria-hidden="true">›</span>
    </button>)}
   </div>
   {!searchMatches.length&&<div className="main-sale-empty">По указанным признакам моделей не найдено. Уберите цвет или размер либо проверьте название.</div>}
   {searchMatches.length>shownModels.length&&<button type="button" className="secondary compact" onClick={()=>setVisibleCount(x=>x+20)}>Показать ещё модели</button>}
   <div className="main-sale-footer"><small>{searchMatches.length} моделей из {models.length}</small>
    <button type="button" className="secondary compact" onClick={onManual}>Индивидуальное изделие в Цех</button></div>
   {editing&&<button type="button" className="secondary compact" onClick={onCancelEdit}>Отменить изменение</button>}
  </div>}
  {!loading&&!error&&selectedModel&&!chosen&&<div className="main-sale-stack">
   <button type="button" className="main-sale-link" onClick={reset}>← Все модели</button>
   <div className="main-sale-filter-grid">
    <label className="main-sale-label">Размер / возраст
     <select value={size} onChange={event=>{setSize(event.target.value);setExpanded(false)}}>
      <option value="">Любой</option>
      {allSizes.map(item=><option value={item.value} key={item.value}>{item.label}</option>)}
     </select>
    </label>
    <label className="main-sale-label">Цвет
     <select value={color} onChange={event=>{setColor(event.target.value);setExpanded(false)}}>
      <option value="">Любой</option>
      {modelColors.map(value=><option value={value} key={value}>{value||'Цвет не указан'}</option>)}
     </select>
    </label>
   </div>
   <div className="main-sale-row"><strong>Реальные сочетания</strong><span>{filtered.length} вариантов</span></div>
   {!sortedGroups.length&&<div className="main-sale-empty">Такого сочетания в каталоге нет. Измените цвет или размер. Нулевые остатки не скрыты.</div>}
   <div className="main-sale-combinations">
    {shownGroups.map(group=><article className="main-sale-combination" key={groupsKey(group[0])}>
     <div className="main-sale-combination-heading">
      <strong>{group[0].color||'Цвет не указан'} · {group[0].material||'Материал не указан'}</strong>
      <small>{audience(group[0])} · {group[0].gender||'Пол не указан'} · {group[0].length||'Длина не указана'}</small>
     </div>
     <div className="main-sale-sizes">{group.slice().sort(sortVariants).map(choice=>
      <button className="main-sale-size" type="button" key={choice.variantId}
       aria-label={details(choice)} onClick={()=>choose(choice)}>{choice.size||'Без размера'}</button>)}</div>
    </article>)}
   </div>
   {shownGroups.length<sortedGroups.length&&<button type="button" className="main-sale-link" onClick={()=>setExpanded(true)}>Показать ещё сочетания ({sortedGroups.length-shownGroups.length})</button>}
   {editing&&<button type="button" className="secondary compact" onClick={onCancelEdit}>Отменить изменение</button>}
  </div>}
  {!loading&&!error&&chosen&&<form className="main-sale-stack" onSubmit={save}>
   <button type="button" className="main-sale-link" onClick={()=>{setChosenId(null);setFormError('')}}>← Другой вариант</button>
   {editing&&<div className="main-sale-existing"><strong>Сейчас в заказе</strong><small>{editing.item.productName} · {editing.item.color} · {editing.item.size} · {sourceName(editing.item.sourceType as Origin)}</small></div>}
   <div className="main-sale-chosen"><strong>{chosen.productName}</strong><span>{details(chosen)}</span></div>
   {blocked?<p className="main-sale-warning" role="alert">{blocked}</p>:<>
    <fieldset className="main-sale-source-field">
     <legend>Источник товара</legend>
     <div className="main-sale-source-grid">{(['warehouse','boutique','workshop'] as Origin[]).map(place=>
      <label className={'main-sale-source'+(source===place?' selected':'')} key={place}>
       <input type="radio" name="sale-source" value={place} checked={source===place}
        onChange={()=>{setSource(place);setFormError('')}}/>
       <span><strong>{sourceName(place)}</strong>
        <small>{place==='workshop'?'Изготовление':availability(chosen,place)+' доступно'}</small></span>
      </label>)}</div>
    </fieldset>
    <details className="main-sale-stock-details"><summary>Из чего складывается наличие</summary>
     {(['warehouse','boutique'] as SourceKey[]).map(place=>
      <p key={place}>{sourceName(place)}: на месте {chosen[place].physical}, в резервах {chosen[place].reserved}, в других строках {allocated.get(pickerKey(place,chosen.variantId))||0}</p>)}
    </details>
    <div className="main-sale-filter-grid">
     <label className="main-sale-label">Количество
      <input type="number" min="1" step="1" value={quantity} onChange={e=>setQuantity(e.target.value)}/>
     </label>
     <label className="main-sale-label">Цена за штуку, ₸
      <input type="number" min="0" step="0.01" value={price} onChange={e=>setPrice(e.target.value)}
       placeholder="Введите цену"/>
     </label>
    </div>
    {chosen.salePrice==null?<small className="main-sale-hint">В каталоге нет цены. Укажите цену продажи.</small>:
     price!==String(chosen.salePrice)?<div className="main-sale-row"><small>Цена каталога: {money(chosen.salePrice)}</small>
      <button type="button" className="main-sale-link" onClick={()=>setPrice(String(chosen.salePrice))}>Подставить</button></div>:null}
    {source==='workshop'?<div className="main-sale-stack">
     <label className="main-sale-label">Что нужно изготовить
      <textarea value={comment} onChange={e=>setComment(e.target.value)} placeholder="Задание для Цеха"/>
     </label>
     <label className="main-sale-check"><input type="checkbox" checked={urgent} onChange={e=>setUrgent(e.target.checked)}/> Срочно</label>
     {urgent&&<div className="main-sale-filter-grid"><label className="main-sale-label">Нужно до
      <input type="date" value={dueDate} onChange={e=>setDueDate(e.target.value)}/></label>
      <label className="main-sale-label">Время
       <input type="time" value={dueTime} onChange={e=>setDueTime(e.target.value)}/></label></div>}
    </div>:<details><summary>Комментарий к позиции</summary>
     <textarea className="main-sale-note" value={comment} onChange={e=>setComment(e.target.value)} placeholder="Необязательно"/></details>}
    {shortage>0&&<p className="main-sale-warning" role="status">Нужно уточнить наличие {shortage} шт. · {sourceName(source as Origin)}. Товар всё равно можно добавить.</p>}
    {formError&&<p role="alert" className="main-sale-error">{formError}</p>}
    <button type="submit" className="primary">{editing?'Сохранить изменение':shortage>0?'Добавить с уточнением':'Добавить в заказ'}</button>
   </>}
   {editing&&<button type="button" className="secondary compact" onClick={onCancelEdit}>Отменить изменение</button>}
  </form>}
 </section>
}
