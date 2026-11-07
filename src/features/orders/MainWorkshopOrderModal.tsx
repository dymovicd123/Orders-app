import {useEffect,useId,useMemo,useRef,useState,type FormEvent} from 'react'
import type {OrderPickerChoice} from './MainOrderSourcePicker'
import {findExactExistingManualVariant} from './manualOrderCatalogPreview'
import {MainManualChoiceInput} from './MainManualChoiceInput'
import '../../styles/main-sale-picker.css'

export type ManualSource='warehouse'|'boutique'|'workshop'
export type WorkshopOrderFields={
 productName:string;audienceType:string;gender:string;color:string;material:string;length:string;size:string;
 sourceType:ManualSource;quantity:number;unitPrice:number;shortageAcknowledged:boolean;
 workshopComment:string;workshopUrgent:boolean;workshopDueDate:string;workshopDueTime:string;
 priceOrigin:'manual';catalogVariantId:undefined;manualCatalogEntry:true;catalogPriceSnapshot:null;priceNeedsConfirmation:false
}
export type ManualOrderPreset=Partial<WorkshopOrderFields>&{quickChange?:'size'|'color';previousValue?:string}
type Props={
 onSave:(item:WorkshopOrderFields)=>void;onClose:()=>void;source?:ManualSource
 initial?:Partial<WorkshopOrderFields>|null
 preset?:ManualOrderPreset|null
 catalogVariants?:readonly OrderPickerChoice[]
 suggestions?:{products?:readonly string[];colors?:readonly string[];materials?:readonly string[];lengths?:readonly string[];sizes?:readonly string[];childAges?:readonly string[]}
}
const clean=(value:unknown)=>String(value??'')
const sourceTitle=(source:ManualSource)=>source==='warehouse'?'Товар со Склада':source==='boutique'?'Товар из Бутика':'Товар в цех'

export function MainWorkshopOrderModal({onSave,onClose,source='workshop',initial,preset,suggestions,catalogVariants=[]}:Props){
 const titleId=useId()
 const first=useRef<HTMLInputElement>(null)
 const defaults=initial||preset
 const mode=initial?.sourceType||source
 const isWorkshop=mode==='workshop'
 const [item,setItem]=useState({
  productName:clean(defaults?.productName),audienceType:clean(defaults?.audienceType),
  gender:clean(defaults?.gender),color:clean(defaults?.color),material:clean(defaults?.material),
  length:clean(defaults?.length),size:clean(defaults?.size),
  quantity:clean(defaults?.quantity??1),unitPrice:defaults?.unitPrice==null?'':clean(defaults.unitPrice),
  workshopComment:clean(defaults?.workshopComment),workshopUrgent:!!defaults?.workshopUrgent,
  workshopDueDate:clean(defaults?.workshopDueDate),workshopDueTime:clean(defaults?.workshopDueTime),
 })
 const [error,setError]=useState('')
 const quickChange=!initial&&!isWorkshop?preset?.quickChange:null
 const [editAll,setEditAll]=useState(false)
 const filled=Boolean(item.productName.trim()&&item.audienceType&&item.gender&&item.color.trim()&&item.material.trim()&&item.length.trim()&&item.size.trim())
 const catalogMatch=useMemo(()=>filled?findExactExistingManualVariant(item,catalogVariants):null,[item,filled,catalogVariants])
 const set=(key:keyof typeof item,value:string|boolean)=>{setItem(previous=>({...previous,[key]:value}));setError('')}
 useEffect(()=>{
  first.current?.focus()
  const onKey=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();onClose()}}
  document.addEventListener('keydown',onKey)
  const before=document.body.style.overflow
  document.body.style.overflow='hidden'
  return ()=>{document.removeEventListener('keydown',onKey);document.body.style.overflow=before}
 },[])
 const save=(event:FormEvent)=>{
  event.preventDefault()
  const qty=Number(item.quantity),price=Number(item.unitPrice)
  if(!item.productName.trim()){setError('Укажите название товара.');return}
  const missing=[
   [item.audienceType,'тип'],[item.gender,'пол'],[item.color,'цвет'],
   [item.material,'материал'],[item.length,'длину'],[item.size,'размер или возраст'],
  ].filter(([value])=>!value.trim()).map(([,name])=>name)
  if(missing.length){
   setError('Укажите '+missing.join(', ')+'. Если нет цвета или размера, выберите соответствующее значение явно.')
   return
  }
  if(quickChange&&preset?.previousValue!==undefined&&item[quickChange].trim().toLocaleUpperCase('ru-RU')===
   String(preset?.previousValue||'').trim().toLocaleUpperCase('ru-RU')){
   setError('Выберите другой '+(quickChange==='size'?'размер или возраст':'цвет')+'. Для прежнего варианта используйте его карточку.');return
  }
  if(!Number.isSafeInteger(qty)||qty<1){setError('Количество должно быть целым числом больше нуля.');return}
  if(!item.unitPrice.trim()||!Number.isFinite(price)||price<0){setError('Укажите цену продажи в тенге.');return}
  if(isWorkshop&&item.workshopUrgent&&!item.workshopDueDate){setError('Для срочного заказа укажите дату готовности.');return}
  onSave({
   productName:item.productName.trim(),audienceType:item.audienceType,gender:item.gender,
   color:item.color.trim(),material:item.material.trim(),length:item.length.trim(),size:item.size.trim(),
   sourceType:mode,quantity:qty,unitPrice:price,shortageAcknowledged:!isWorkshop,
   workshopComment:isWorkshop?item.workshopComment.trim():'',
   workshopUrgent:isWorkshop&&item.workshopUrgent,
   workshopDueDate:isWorkshop&&item.workshopUrgent?item.workshopDueDate:'',
   workshopDueTime:isWorkshop&&item.workshopUrgent?item.workshopDueTime:'',
   priceOrigin:'manual',catalogVariantId:undefined,manualCatalogEntry:true,catalogPriceSnapshot:null,priceNeedsConfirmation:false
  })
 }
 return <div className="main-workshop-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)onClose()}}>
  <section className="main-workshop-modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
   <header className="main-workshop-head">
    <div><small>{initial?'Редактирование позиции':quickChange?'Другой вариант той же модели':isWorkshop?'Новая позиция Цеха':'Нет в показанных вариантах'}</small>
     <h2 id={titleId}>{quickChange?'Другой '+(quickChange==='size'?'размер':'цвет'):initial?'Изменить '+sourceTitle(mode).toLowerCase():sourceTitle(mode)}</h2>
     <p>{isWorkshop?'Оформите товар для изготовления. Он появится в заказе только после сохранения.':
      quickChange?'Другие характеристики уже заполнены по выбранному товару. Укажите '+(quickChange==='size'?'нужный размер.':'нужный цвет.'):'Укажите характеристики проданного товара. Он будет оформлен из '+(mode==='warehouse'?'Склада.':'Бутика.')}</p></div>
    <button type="button" className="main-workshop-close" onClick={onClose} aria-label="Закрыть окно">×</button>
   </header>
   <form onSubmit={save} className="main-workshop-form">
    <div className="main-workshop-content">
     {!isWorkshop&&<p className="main-workshop-source-notice">
      <strong>Товар будет оформлен из {mode==='warehouse'?'Склада':'Бутика'}.</strong>
      {' '}Если такой вариант уже есть в системе, он будет найден автоматически.
      Если его ещё нет, позиция останется в заказе для проверки наличия.
      Новый товар на складе сам не появится.
     </p>}
     <fieldset className="main-workshop-section">
      <legend>1. Какой товар {isWorkshop?'изготовить':'продан'}</legend>
      {quickChange&&!editAll?<div className="main-workshop-quick">
       <div className="main-workshop-quick-base">
        <strong>{item.productName}</strong>
        <span>{[
         item.audienceType==='ДЕТСКИЙ'?'Детский':'Взрослый',
         item.gender==='ЖЕН'?'Женский':item.gender==='МУЖ'?'Мужской':item.gender,
         item.material==='СТАНДАРТ'?'':item.material,
         item.length==='СТАНДАРТ'?'':item.length,
         quickChange==='size'?item.color:'Размер '+item.size,
        ].filter(Boolean).join(' · ')}</span>
       </div>
       <MainManualChoiceInput label={quickChange==='size'?(item.audienceType==='ДЕТСКИЙ'?'Новый возраст':'Новый размер'):'Новый цвет'}
        required inputRef={first} value={item[quickChange]} onChange={value=>set(quickChange,value)}
        options={quickChange==='color'?['БЕЗ ЦВЕТА',...(suggestions?.colors||[])]:
         item.audienceType==='ДЕТСКИЙ'?[...(suggestions?.childAges||[])]:
         ['БЕЗ РАЗМЕРА',...(suggestions?.sizes||[])]}
        placeholder={quickChange==='color'?'Выберите или впишите цвет':'Выберите или впишите размер'}/>
       <button type="button" className="main-workshop-expand" onMouseDown={event=>event.preventDefault()} onClick={()=>setEditAll(true)}>
        Изменить другие характеристики
       </button>
      </div>:<>
      <MainManualChoiceInput label="Название товара" required value={item.productName}
       inputRef={first} onChange={value=>set('productName',value)}
       options={suggestions?.products} placeholder="Например, Баян Сұлу шапан"/>
      <div className="main-workshop-grid">
       <label className="main-workshop-field">Тип
        <select value={item.audienceType} onChange={e=>set('audienceType',e.target.value)}>
         <option value="" disabled>Выберите тип</option><option value="ВЗРОСЛЫЙ">Взрослый</option><option value="ДЕТСКИЙ">Детский</option>
        </select>
       </label>
       <MainManualChoiceInput label={item.audienceType==='ДЕТСКИЙ'?'Возраст':'Размер'} required
        value={item.size} onChange={value=>set('size',value)}
        options={item.audienceType==='ДЕТСКИЙ'?suggestions?.childAges:['БЕЗ РАЗМЕРА',...(suggestions?.sizes||[])]}
        placeholder={item.audienceType==='ДЕТСКИЙ'?'Например, 5 лет':'Например, 46'}/>
       <label className="main-workshop-field">Пол *
        <select value={item.gender} onChange={e=>set('gender',e.target.value)}>
         <option value="" disabled>Выберите пол</option><option value="ЖЕН">Женский</option><option value="МУЖ">Мужской</option><option value="БЕЗ ПОЛА">Без пола</option>
        </select>
       </label>
       <MainManualChoiceInput label="Цвет" required value={item.color}
        onChange={value=>set('color',value)} options={['БЕЗ ЦВЕТА',...(suggestions?.colors||[])]} placeholder="Выберите цвет или «Без цвета»"/>
       <MainManualChoiceInput label="Материал" required value={item.material}
        onChange={value=>set('material',value)} options={suggestions?.materials} placeholder="Например, Замша велюр"/>
       <MainManualChoiceInput label="Длина" required value={item.length}
        onChange={value=>set('length',value)} options={suggestions?.lengths} placeholder="Например, Стандарт"/>
      </div>
      </>}
      <small className="main-workshop-hint">{quickChange&&!editAll
       ?'Если нужного варианта пока нет, его можно добавить в заказ для проверки. На склад он автоматически не поступит.'
       :'Выбирайте «Без цвета» или «Без размера» только если это действительно характеристика проданного товара. Если нужного значения нет, впишите его — наличие потребуется проверить.'}</small>
      {!isWorkshop&&filled&&<p className="main-workshop-match" aria-live="polite">
       {catalogVariants.length===0?'Наличие подходящего товара проверим при сохранении.':
        catalogMatch
         ?(mode==='warehouse'?catalogMatch.warehouse.free:catalogMatch.boutique.free)>0
          ?'Такой вариант уже есть. Доступно в '+(mode==='warehouse'?'Складе: ':'Бутике: ')+catalogMatch[mode].free+' шт.'
          :'Такой вариант уже есть, но свободного остатка в '+(mode==='warehouse'?'Складе':'Бутике')+' сейчас нет. Потребуется уточнить наличие.'
         :'Такого точного варианта пока не нашли. Заказ можно сохранить для уточнения; новый товар на складе не появится.'}
      </p>}
     </fieldset>
     <fieldset className="main-workshop-section">
      <legend>2. Количество и цена</legend>
      {quickChange&&preset?.unitPrice!=null&&<small className="main-workshop-hint">Цена подставлена по выбранному товару. Проверьте, подходит ли она для нового варианта.</small>}
      <div className="main-workshop-grid">
       <label className="main-workshop-field">Количество *
        <input type="number" min="1" step="1" value={item.quantity} onChange={e=>set('quantity',e.target.value)}/>
       </label>
       <label className="main-workshop-field">Цена за штуку, ₸ *
        <input type="number" min="0" step="1" value={item.unitPrice} onChange={e=>set('unitPrice',e.target.value)} placeholder="Цена продажи"/>
       </label>
      </div>
     </fieldset>
     {isWorkshop&&<>
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
       </div>:<p className="main-workshop-hint">Для обычного заказа дата не требуется.</p>}
      </fieldset>
     </>}
    </div>
    {error&&<p role="alert" className="main-workshop-error">{error}</p>}
    <footer className="main-workshop-actions">
     <button type="button" className="secondary" onClick={onClose}>Отмена</button>
     <button type="submit" className="primary">{initial?'Сохранить изменения':'+ Добавить в заказ'}</button>
    </footer>
   </form>
  </section>
 </div>
}
