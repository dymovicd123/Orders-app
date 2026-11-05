import {useEffect,useRef,type KeyboardEvent} from 'react'
import {createPortal} from 'react-dom'
import {SmartPickerInput} from '../../components/inputs/SmartPickerInput'
import '../../styles/client3-watch-line-editor.css'
import {WATCH_OPTIONS} from '../../../shared/client3/watch-domain'
import type {DraftLine,WatchOrderChoice} from './WatchOrderForm'
import {watchLabels} from './WatchOrderSourcePicker'

type Suggestions={
 models:string[];movements:string[];bracelets:string[];dials:string[];leatherColors:string[]
}
type Props={
 line:DraftLine;choice?:WatchOrderChoice;suggestions:Suggestions;
 available:number;allocated:number;
 onUpdate:(patch:Partial<DraftLine>)=>void;onClose:()=>void
}
const readable=(options:readonly {value:string;label:string}[],value:string)=>
 options.find(x=>x.value===value)?.label||value
const canonical=(options:readonly {value:string;label:string}[],raw:string)=>{
 const value=raw.trim().replace(/\s+/g,' ')
 const hit=options.find(x=>x.value.toLocaleLowerCase('ru')===value.toLocaleLowerCase('ru')||
   x.label.toLocaleLowerCase('ru')===value.toLocaleLowerCase('ru'))
 return hit?.value||value
}
const money=(n:number)=>n.toLocaleString('ru-RU')+' ₸'

export function WatchOrderLineEditor({line,choice,suggestions,available,allocated,onUpdate,onClose}:Props){
 const panelRef=useRef<HTMLDivElement>(null)
 useEffect(()=>{
   const previouslyFocused=document.activeElement instanceof HTMLElement?document.activeElement:null
   const target=panelRef.current?.querySelector<HTMLElement>('.watch-line-modal-fields input, .watch-line-modal-fields select')
   target?.focus()
   return ()=>previouslyFocused?.focus()
 },[])
 const isManual=line.kind==='manual'
 const sourceName=line.source==='office'?'Офис':'Витрина'
 const title=isManual?line.manual.modelName.trim()||'Новая комплектация':choice?.modelName||'Комплектация'
 const shortage=line.kind==='stock'&&allocated>available
 const status=isManual?'Свои характеристики':line.kind==='preorder'?'Без свободного остатка':'Из наличия'
 const onKeyboard=(event:KeyboardEvent<HTMLDivElement>)=>{
   if(event.key==='Escape'){event.stopPropagation();onClose();return}
   if(event.key!=='Tab')return
   const nodes=[...(panelRef.current?.querySelectorAll<HTMLElement>(
     'button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex="0"]'
   )||[])].filter(x=>x.offsetParent!==null)
   if(!nodes.length)return
   const first=nodes[0],last=nodes[nodes.length-1]
   if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}
   else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
 }
 if(typeof document==='undefined')return null
 return createPortal(
   <div className="watch-line-modal-overlay" onMouseDown={e=>{
     if(e.target===e.currentTarget)onClose()
   }}>
     <div className="watch-line-modal" ref={panelRef} role="dialog" aria-modal="true"
       aria-labelledby="watch-line-modal-heading" onKeyDown={onKeyboard}>
       <header className="watch-line-modal-header">
         <div>
           <span className="watch-line-modal-kicker">Позиция заказа · {sourceName} · {status}</span>
           <h3 id="watch-line-modal-heading">{title}</h3>
           {!isManual&&choice&&<p>{watchLabels(choice).join(' · ')}</p>}
         </div>
         <button type="button" className="watch-line-modal-close" onClick={onClose}
           aria-label="Закрыть редактирование" title="Закрыть">×</button>
       </header>
       <div className="watch-line-modal-content">
         {isManual&&<section className="watch-line-modal-section">
           <h4>Модель и характеристики</h4>
           <p>Можно выбрать подсказку или ввести своё значение. Доступность остатка не ограничивает создание этой позиции.</p>
           <div className="watch-line-modal-fields manual">
             <label className="wide">Название модели *
               <SmartPickerInput value={line.manual.modelName} options={suggestions.models}
                 placeholder="Название часов" onChange={value=>onUpdate({manual:{...line.manual,modelName:value}})}/>
             </label>
             <label>Пол *
               <select value={line.manual.gender} onChange={e=>onUpdate({
                 manual:{...line.manual,gender:e.target.value as 'male'|'female'}})}>
                 {WATCH_OPTIONS.genders.map(x=><option key={x.value} value={x.value}>{x.label}</option>)}
               </select>
             </label>
             <label>Механизм *
               <SmartPickerInput value={readable(WATCH_OPTIONS.movements,line.manual.movement)}
                 options={suggestions.movements} placeholder="Кварцевый, механический…"
                 onChange={value=>onUpdate({manual:{...line.manual,movement:canonical(WATCH_OPTIONS.movements,value)}})}/>
             </label>
             <label>Материал браслета *
               <SmartPickerInput value={readable(WATCH_OPTIONS.braceletMaterials,line.manual.braceletMaterial)}
                 options={suggestions.bracelets} placeholder="Сталь, кожа, каучук…"
                 onChange={value=>{
                   const braceletMaterial=canonical(WATCH_OPTIONS.braceletMaterials,value)
                   onUpdate({manual:{...line.manual,braceletMaterial,
                     braceletColor:braceletMaterial==='leather'?line.manual.braceletColor:''}})
                 }}/>
             </label>
             <label>Цвет циферблата *
               <SmartPickerInput value={readable(WATCH_OPTIONS.dialColors,line.manual.dialColor)}
                 options={suggestions.dials} placeholder="Цвет"
                 onChange={value=>onUpdate({manual:{...line.manual,dialColor:canonical(WATCH_OPTIONS.dialColors,value)}})}/>
             </label>
             {canonical(WATCH_OPTIONS.braceletMaterials,line.manual.braceletMaterial)==='leather'&&
               <label className="wide">Цвет кожаного ремешка *
                 <SmartPickerInput value={line.manual.braceletColor}
                   options={suggestions.leatherColors} placeholder="Цвет ремешка"
                   onChange={value=>onUpdate({manual:{...line.manual,braceletColor:value}})}/>
               </label>}
           </div>
         </section>}
         <section className="watch-line-modal-section">
           <h4>Количество и цена</h4>
           <div className="watch-line-modal-fields">
             <label>Количество, шт. *
               <input type="number" min={1} max={1000} value={line.quantity}
                 onChange={e=>onUpdate({quantity:Number(e.target.value)})}/>
             </label>
             <label>Цена продажи за штуку, ₸ *
               <input type="text" inputMode="numeric" placeholder="Введите цену"
                 pattern="[0-9]*" value={line.unitPrice}
                 onChange={e=>{if(/^\d{0,10}$/.test(e.target.value))onUpdate({unitPrice:e.target.value})}}/>
             </label>
           </div>
           <div className="watch-line-modal-price-hint">
             <span>Цена по каталогу: {choice?.catalogPriceSnapshot==null?'не задана':money(choice.catalogPriceSnapshot)}</span>
             <strong>Итого: {line.unitPrice.trim()!==''?money(Number(line.unitPrice)*Math.max(0,line.quantity)):'укажите цену'}</strong>
           </div>
           {shortage&&<div className="watch-line-modal-warning">
             В выбранном источнике свободно {available} шт., в заказе выбрано {allocated} шт.
             Измените количество или выберите оформление без свободного остатка в составе заказа.
           </div>}
           {line.kind==='preorder'&&<p className="watch-line-modal-note">
             Сейчас свободного остатка нет. Позиция будет ожидать поступления или резервирования; это не заказ на изготовление часов.
           </p>}
         </section>
         <section className="watch-line-modal-section">
           <h4>Гравировка и комментарий логисту</h4>
           <p>Полное сообщение видно во время ввода. Оно сохранится именно для этой позиции.</p>
           <label className="watch-line-modal-comment">
             <textarea rows={6} maxLength={500} value={line.engravingText}
               onChange={e=>onUpdate({engravingText:e.target.value})}
               placeholder="Например: гравировка на задней крышке, текст, оформление и пожелания клиента"/>
             <small>{line.engravingText.length} / 500 символов</small>
           </label>
         </section>
       </div>
       <footer className="watch-line-modal-footer">
         <span>Изменения сохраняются в составе заказа. Сам заказ будет создан позже.</span>
         <button type="button" className="primary" onClick={onClose}>Готово</button>
       </footer>
     </div>
   </div>,document.body)
}
