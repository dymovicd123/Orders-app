import {useId,useMemo,useState,type KeyboardEvent,type Ref} from 'react'
import '../../styles/main-sale-picker.css'

type Props={
 label:string;value:string;onChange:(next:string)=>void;options?:readonly string[];
 placeholder?:string;required?:boolean;inputRef?:Ref<HTMLInputElement>
}
const letters:Record<string,string>={'ё':'е','қ':'к','ө':'о','ұ':'у','ү':'у','ә':'а','і':'и','ң':'н','ғ':'г','һ':'х'}
const normalize=(value:string)=>value.toLocaleLowerCase('ru-RU')
 .replace(/[ёқөұүәіңғһі]/g,ch=>letters[ch]||ch)
 .replace(/[^\p{L}\p{N}]+/gu,' ').trim()

export function MainManualChoiceInput({label,value,onChange,options=[],placeholder,required,inputRef}:Props){
 const id=useId(),listId=useId()
 const [open,setOpen]=useState(false)
 const [active,setActive]=useState(-1)
 const [fullList,setFullList]=useState(false)
 const matches=useMemo(()=>{
  const unique=[...new Map(options.filter(Boolean).map(name=>[normalize(name),name])).values()]
  const query=normalize(value)
  const found=fullList||!query?unique:unique.filter(name=>normalize(name).includes(query))
  return found.slice(0,60)
 },[value,options,fullList])
 const shown=matches.slice(0,fullList?60:12)
 const unknownValue=Boolean(value.trim()&&options.length&&
  !options.some(option=>normalize(option)===normalize(value)))
 const choose=(name:string)=>{onChange(name);setOpen(false);setActive(-1);setFullList(false)}
 const onKeys=(event:KeyboardEvent<HTMLInputElement>)=>{
  if(event.key==='Escape'){setOpen(false);setFullList(false);return}
  if(event.key==='ArrowDown'){
   event.preventDefault();setOpen(true);setFullList(true)
   setActive(n=>Math.min(n+1,Math.max(0,matches.length-1)));return
  }
  if(event.key==='ArrowUp'){event.preventDefault();setActive(n=>Math.max(0,n-1));return}
  if(event.key==='Enter'&&open&&shown.length&&active>=0){
   event.preventDefault();choose(shown[Math.min(active,shown.length-1)])
  }
 }
 const toggle=()=>{setOpen(current=>!current);setFullList(true);setActive(-1)}
 return <div className="main-workshop-field" onBlur={event=>{
  if(!event.currentTarget.contains(event.relatedTarget as Node|null)){
   setOpen(false);setFullList(false);setActive(-1)
  }
 }}>
  <label htmlFor={id}>{label}{required?' *':''}</label>
  <div className="main-manual-lookup">
   <div className="main-manual-input-line">
    <input id={id} ref={inputRef} value={value} placeholder={placeholder}
     autoComplete="off" role="combobox" aria-autocomplete="list" aria-controls={listId}
     aria-expanded={open&&shown.length>0}
     onFocus={()=>setActive(-1)}
     onClick={()=>{setOpen(true);setFullList(true)}}
     onKeyDown={onKeys} onChange={event=>{
      onChange(event.target.value);setOpen(true);setFullList(false);setActive(-1)
     }}/>
    <button type="button" className="main-manual-arrow"
      aria-label={'Показать варианты: '+label} aria-expanded={open}
      onMouseDown={event=>event.preventDefault()} onClick={toggle}>⌄</button>
   </div>
   {open&&<div className="main-manual-options" id={listId} role="listbox">
    {shown.length?shown.map((name,index)=><button type="button" role="option"
      aria-selected={index===active} className={index===active?'is-current':''}
      key={name} onMouseDown={event=>event.preventDefault()} onClick={()=>choose(name)}>
      {name}
     </button>):<p className="main-manual-no-match">Нет совпадений. Можно вписать своё значение.</p>}
    {matches.length>shown.length&&<button type="button" className="main-manual-show-all" onMouseDown={event=>event.preventDefault()}
      onClick={()=>setFullList(true)}>Показать другие варианты</button>}
    <small>Можно выбрать из списка или вписать своё значение</small>
   </div>}
   {unknownValue&&<small className="main-manual-unrecognized">
    Нового значения нет в подсказках. Заказ можно оформить на уточнение, но каталог не пополнится автоматически.
   </small>}
  </div>
 </div>
}
