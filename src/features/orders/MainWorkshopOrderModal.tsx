import {useEffect,useId,useRef,useState,type FormEvent} from 'react'
import '../../styles/main-sale-picker.css'

export type WorkshopOrderFields={
 productName:string;audienceType:string;gender:string;color:string;material:string;length:string;size:string;
 sourceType:'workshop';quantity:number;unitPrice:number;
 workshopComment:string;workshopUrgent:boolean;workshopDueDate:string;workshopDueTime:string;
 priceOrigin:'manual';catalogVariantId:undefined;catalogPriceSnapshot:null;priceNeedsConfirmation:false
}
type Props={
 onSave:(item:WorkshopOrderFields)=>void
 onClose:()=>void
 initial?:Partial<WorkshopOrderFields>|null
 suggestions?:{products?:readonly string[];colors?:readonly string[];materials?:readonly string[];lengths?:readonly string[]}
}
const clean=(value:unknown)=>String(value??'')
export function MainWorkshopOrderModal({onSave,onClose,initial,suggestions}:Props){
 const titleId=useId()
 const first=useRef<HTMLInputElement>(null)
 const [item,setItem]=useState({
  productName:clean(initial?.productName),audienceType:clean(initial?.audienceType)||'ВЗРОСЛЫЙ',
  gender:clean(initial?.gender),color:clean(initial?.color),material:clean(initial?.material),
  length:clean(initial?.length),size:clean(initial?.size),
  quantity:clean(initial?.quantity??1),unitPrice:initial?.unitPrice==null?'':clean(initial.unitPrice),
  workshopComment:clean(initial?.workshopComment),workshopUrgent:!!initial?.workshopUrgent,
  workshopDueDate:clean(initial?.workshopDueDate),workshopDueTime:clean(initial?.workshopDueTime),
 })
 const [error,setError]=useState('')
 const set=(key:keyof typeof item,value:string|boolean)=>{setItem(previous=>({...previous,[key]:value}));setError('')}
 useEffect(()=>{
  first.current?.focus()
  const onKey=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();onClose()}}
  document.addEventListener('keydown',onKey)
  const before=document.body.style.overflow
  document.body.style.overflow='hidden'
  return ()=>{document.removeEventListener('keydown',onKey);document.body.style.overflow=before}
 },[onClose])
 const save=(event:FormEvent)=>{
  event.preventDefault()
  const qty=Number(item.quantity),price=Number(item.unitPrice)
  if(!item.productName.trim()){setError('Укажите название товара для Цеха.');return}
  if(!item.size.trim()){setError('Укажите размер или возраст.');return}
  if(!Number.isSafeInteger(qty)||qty<1){setError('Количество должно быть целым числом больше нуля.');return}
  if(!item.unitPrice.trim()||!Number.isFinite(price)||price<0){setError('Укажите цену продажи в тенге.');return}
  if(item.workshopUrgent&&!item.workshopDueDate){setError('Для срочного заказа укажите дату готовности.');return}
  onSave({
   productName:item.productName.trim(),audienceType:item.audienceType,gender:item.gender,
   color:item.color.trim(),material:item.material.trim(),length:item.length.trim(),size:item.size.trim(),
   sourceType:'workshop',quantity:qty,unitPrice:price,
   workshopComment:item.workshopComment.trim(),workshopUrgent:item.workshopUrgent,
   workshopDueDate:item.workshopUrgent?item.workshopDueDate:'',workshopDueTime:item.workshopUrgent?item.workshopDueTime:'',
   priceOrigin:'manual',catalogVariantId:undefined,catalogPriceSnapshot:null,priceNeedsConfirmation:false
  })
 }
 return <div className="main-workshop-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)onClose()}}>
  <section className="main-workshop-modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
   <header className="main-workshop-head">
    <div><small>Новая позиция</small><h2 id={titleId}>{initial?'Изменить товар для Цеха':'Товар в цех'}</h2>
     <p>Укажите изделие и характеристики. Товар появится в заказе после сохранения.</p></div>
    <button type="button" className="main-workshop-close" onClick={onClose} aria-label="Закрыть окно">×</button>
   </header>
   <form onSubmit={save} className="main-workshop-form">
    <div className="main-workshop-content">
     <fieldset className="main-workshop-section">
      <legend>1. Какой товар изготовить</legend>
      <label className="main-workshop-field main-workshop-wide">Название товара *
       <input ref={first} value={item.productName} onChange={e=>set('productName',e.target.value)} list="main-workshop-products" placeholder="Например, Баян Сұлу шапан"/>
      </label>
      <datalist id="main-workshop-products">{(suggestions?.products||[]).map((name,index)=><option value={name} key={name+'-'+index}/>)}</datalist>
      <div className="main-workshop-grid">
       <label className="main-workshop-field">Тип
        <select value={item.audienceType} onChange={e=>set('audienceType',e.target.value)}>
         <option value="ВЗРОСЛЫЙ">Взрослый</option><option value="ДЕТСКИЙ">Детский</option>
        </select>
       </label>
       <label className="main-workshop-field">{item.audienceType==='ДЕТСКИЙ'?'Возраст *':'Размер *'}
        <input value={item.size} onChange={e=>set('size',e.target.value)} placeholder={item.audienceType==='ДЕТСКИЙ'?'Например, 5 лет':'Например, 46'}/>
       </label>
       <label className="main-workshop-field">Пол
        <select value={item.gender} onChange={e=>set('gender',e.target.value)}>
         <option value="">Не указан</option><option value="ЖЕН">Женский</option><option value="МУЖ">Мужской</option>
        </select>
       </label>
       <label className="main-workshop-field">Цвет
        <input value={item.color} onChange={e=>set('color',e.target.value)} list="main-workshop-colors" placeholder="Цвет"/>
       </label>
       <label className="main-workshop-field">Материал
        <input value={item.material} onChange={e=>set('material',e.target.value)} list="main-workshop-materials" placeholder="Например, Замша велюр"/>
       </label>
       <label className="main-workshop-field">Длина
        <input value={item.length} onChange={e=>set('length',e.target.value)} list="main-workshop-lengths" placeholder="Например, Стандарт"/>
       </label>
      </div>
      <datalist id="main-workshop-colors">{(suggestions?.colors||[]).map((value,index)=><option value={value} key={index}/>)}</datalist>
      <datalist id="main-workshop-materials">{(suggestions?.materials||[]).map((value,index)=><option value={value} key={index}/>)}</datalist>
      <datalist id="main-workshop-lengths">{(suggestions?.lengths||[]).map((value,index)=><option value={value} key={index}/>)}</datalist>
     </fieldset>
     <fieldset className="main-workshop-section">
      <legend>2. Количество и цена</legend>
      <div className="main-workshop-grid">
       <label className="main-workshop-field">Количество *
        <input type="number" min="1" step="1" value={item.quantity} onChange={e=>set('quantity',e.target.value)}/>
       </label>
       <label className="main-workshop-field">Цена за штуку, ₸ *
        <input type="number" min="0" step="1" value={item.unitPrice} onChange={e=>set('unitPrice',e.target.value)} placeholder="Цена продажи"/>
       </label>
      </div>
     </fieldset>
     <fieldset className="main-workshop-section">
      <legend>3. Задание и комментарий для Цеха</legend>
      <label className="main-workshop-field">Что нужно изготовить или учесть
       <textarea rows={3} value={item.workshopComment} onChange={e=>set('workshopComment',e.target.value)} placeholder="Пожелания, изменения, детали пошива"/>
      </label>
     </fieldset>
     <fieldset className="main-workshop-section">
      <legend>4. Срок изготовления</legend>
      <label className="main-workshop-checkbox"><input type="checkbox" checked={item.workshopUrgent} onChange={e=>set('workshopUrgent',e.target.checked)}/> Срочно — указать срок</label>
      {item.workshopUrgent?<div className="main-workshop-grid">
       <label className="main-workshop-field">Нужно до *
        <input type="date" value={item.workshopDueDate} onChange={e=>set('workshopDueDate',e.target.value)}/>
       </label>
       <label className="main-workshop-field">Время (необязательно)
        <input type="time" value={item.workshopDueTime} onChange={e=>set('workshopDueTime',e.target.value)}/>
       </label>
      </div>:<p className="main-workshop-hint">Если заказ обычный, дату указывать не нужно.</p>}
     </fieldset>
    </div>
    {error&&<p role="alert" className="main-workshop-error">{error}</p>}
    <footer className="main-workshop-actions">
     <button type="button" className="secondary" onClick={onClose}>Отмена</button>
     <button type="submit" className="primary">{initial?'Сохранить изменения':'+ Добавить товар в заказ'}</button>
    </footer>
   </form>
  </section>
 </div>
}
