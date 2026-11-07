import {useId,useMemo,useState,type KeyboardEvent,type Ref} from 'react'
import '../../styles/main-sale-picker.css'

type Props={
 label:string;value:string;onChange:(next:string)=>void;options?:readonly string[];
 placeholder?:string;required?:boolean;inputRef?:Ref<HTMLInputElement>
}
const normalize=(value:string)=>value.toLocaleLowerCase('ru-RU')
 .replace(/[ёқөұүәіңғһ]/g,ch=>({'ё':'е','қ':'к','ө':'о','ұ':'у','ү':'у','ә':'а','і':'и','ң':'н','ғ':'г','һ':'х'}[ch]||ch))
 .replace(/[^\p{L}\p{N}]+/gu,' ').trim()

export function MainManualChoiceInput({label,value,onChange,options=[],placeholder,required,inputRef}:Props){
 const id=useId(),listId=useId()
 const [open,setOpen]=useState(false)
 const [active,setActive]=useState(0)
 const matches=useMemo(()=>{
  const unique=[...new Set(options.filter(Boolean))]
  const query=normalize(value)
  const filtered=query?unique.filter(s=>normalize(s).includes(query)):unique
  return filtered.slice(0,8)
 },[value,options])
 const choose=(name:string)=>{onChange(name);setOpen(false);setActive(0)}
 const onKeys=(event:KeyboardEvent<HTMLInputElement>)=>{
  if(event.key==='Escape'){setOpen(false);return}
  if(event.key==='ArrowDown'){event.preventDefault();setOpen(true);setActive(n=>Math.min(n+1,Math.max(0,matches.length-1)));return}
  if(event.key==='ArrowUp'){event.preventDefault();setActive(n=>Math.max(0,n-1));return}
  if(event.key==='Enter'&&open&&matches.length&&active>=0){
   event.preventDefault();choose(matches[Math.min(active,matches.length-1)])
  }
 }
 return <div className="main-workshop-field">
  <label htmlFor={id}>{label}{required?' *':''}</label>
  <div className="main-manual-lookup">
   <input id={id} ref={inputRef} value={value} placeholder={placeholder}
    autoComplete="off" role="combobox" aria-autocomplete="list"
    aria-controls={listId} aria-expanded={open&&matches.length>0}
    onFocus={()=>{setOpen(true);setActive(0)}} onBlur={()=>setOpen(false)}
    onKeyDown={onKeys} onChange={event=>{onChange(event.target.value);setOpen(true);setActive(0)}}/>
   {open&&matches.length>0&&<div className="main-manual-options" id={listId} role="listbox">
    {matches.map((name,index)=><button type="button" role="option"
     aria-selected={index===active} className={index===active?'is-current':''}
     key={name} onMouseDown={event=>event.preventDefault()} onClick={()=>choose(name)}>
     {name}
    </button>)}
    <small>Можно ввести своё значение</small>
   </div>}
  </div>
 </div>
}
