import {useEffect,useRef,useState,type FormEvent} from 'react'
import {SmartPickerInput} from '../../components/inputs/SmartPickerInput'
import {WATCH_OPTIONS,type WatchBrand,type WatchGender,type WatchSource} from '../../../shared/client3/watch-domain'
type Existing={
 id:number;watchVariantId:number;productName:string;gender:string;
 movement:string;braceletMaterial:string;dialColor:string;braceletColor:string;
 quantity:number;unitPrice:number;source:string;engravingText:string;
 catalogPriceSnapshot:number|null
}
type Draft={key:string;orderItemId:number|null;modelName:string;gender:WatchGender;
 movement:string;braceletMaterial:string;dialColor:string;braceletColor:string;
 source:WatchSource;quantity:string;unitPrice:string;engravingText:string}
const parse=(s:string):Existing[]=>{
 try{const x=JSON.parse(s||'[]') as Existing[];return Array.isArray(x)?x.filter(a=>a.id>0&&a.quantity>0):[]}catch{return []}
}
const readable=(options:readonly {value:string;label:string}[],value:string)=>
 options.find(v=>v.value===value)?.label||value
const canonical=(options:readonly {value:string;label:string}[],value:string)=>
 options.find(v=>v.label.toLocaleLowerCase('ru-RU')===value.toLocaleLowerCase('ru-RU'))?.value||value
const row=(item:Existing):Draft=>({
 key:'existing-'+item.id,orderItemId:item.id,modelName:item.productName||'',
 gender:item.gender==='female'?'female':'male',movement:item.movement||'quartz',
 braceletMaterial:item.braceletMaterial||'steel',dialColor:item.dialColor||'black',
 braceletColor:item.braceletColor||'',
 source:item.source==='boutique'?'showcase':'office',
 quantity:String(item.quantity),unitPrice:String(item.unitPrice),
 engravingText:item.engravingText||'',
})
const blank=():Draft=>({
 key:crypto.randomUUID(),orderItemId:null,modelName:'',gender:'male',movement:'quartz',
 braceletMaterial:'steel',dialColor:'black',braceletColor:'',
 source:'office',quantity:'1',unitPrice:'',engravingText:'',
})
type Props={brand:WatchBrand;orderId:number;itemLines:string;receivedAmount:number;
 onDone:()=>void;onCancel:()=>void}
export function WatchAdminCompositionEditor({
 brand,orderId,itemLines,receivedAmount,onDone,onCancel,
}:Props){
 const existing=parse(itemLines)
 const [items,setItems]=useState<Draft[]>(()=>existing.map(row))
 const [opts,setOpts]=useState<{models:string[];movements:string[];bracelets:string[];
   dials:string[];leatherColors:string[]}>({
     models:[],movements:[],bracelets:[],dials:[],leatherColors:[],
   })
 const [busy,setBusy]=useState(false)
 const [error,setError]=useState('')
 const request=useRef<{fingerprint:string;id:string}|null>(null)
 useEffect(()=>{
   const controller=new AbortController()
   void Promise.all([
     fetch('/api/client3/watches/references',{credentials:'include',signal:controller.signal}),
     fetch('/api/client3/watches/models?brand='+brand,{credentials:'include',signal:controller.signal}),
   ]).then(async ([r,m])=>{
     const refs=await r.json() as {rows?:Array<{kind:string;value:string}>}
     const models=await m.json() as {models?:Array<{modelName:string}>}
     if(controller.signal.aborted)return
     const values=(kind:string)=>(refs.rows||[]).filter(x=>x.kind===kind).map(x=>x.value)
     setOpts({
       models:[...new Set((models.models||[]).map(x=>x.modelName))],
       movements:values('movements'),bracelets:values('bracelets'),
       dials:values('dials'),leatherColors:values('leatherColors'),
     })
   }).catch(()=>{})
   return ()=>controller.abort()
 },[brand])
 const edit=(key:string,update:Partial<Draft>)=>{
   setItems(list=>list.map(item=>item.key===key?{...item,...update}:item))
   request.current=null;setError('')
 }
 const submit=async(e:FormEvent<HTMLFormElement>)=>{
   e.preventDefault();if(busy)return
   if(!items.length||items.length>20){setError('В заказе должно быть от 1 до 20 позиций.');return}
   const next=items.map(i=>({
     orderItemId:i.orderItemId,
     source:i.source,quantity:Number(i.quantity),unitPrice:Number(i.unitPrice),
     engravingText:i.engravingText,
     manual:{
       modelName:i.modelName.trim().replace(/\s+/g,' '),gender:i.gender,
       movement:canonical(WATCH_OPTIONS.movements,i.movement.trim()),
       braceletMaterial:canonical(WATCH_OPTIONS.braceletMaterials,i.braceletMaterial.trim()),
       dialColor:canonical(WATCH_OPTIONS.dialColors,i.dialColor.trim()),
       braceletColor:i.braceletColor.trim(),
     },
   }))
   if(next.some(x=>!x.manual.modelName||!x.manual.movement||!x.manual.braceletMaterial||
     !x.manual.dialColor||!Number.isSafeInteger(x.quantity)||x.quantity<1||x.quantity>1000||
     !Number.isSafeInteger(x.unitPrice)||x.unitPrice<0||
     (x.manual.braceletMaterial==='leather'&&!x.manual.braceletColor))){
     setError('Заполните название, характеристики, количество и цену всех часов.');return
   }
   const total=next.reduce((n,x)=>n+x.quantity*x.unitPrice,0)
   if(!Number.isSafeInteger(total)||total<receivedAmount){
     setError('Новая сумма меньше проведённых оплат ('+receivedAmount.toLocaleString('ru-RU')+' ₸).');return
   }
   const expected=existing.map(x=>({
     orderItemId:x.id,watchVariantId:x.watchVariantId,quantity:x.quantity,
     unitPrice:x.unitPrice,source:x.source==='boutique'?'showcase':'office',
     engravingText:x.engravingText||'',
     catalogPriceSnapshot:x.catalogPriceSnapshot,
   }))
   const body={brand,expected,items:next}
   const fingerprint=JSON.stringify(body)
   if(request.current?.fingerprint!==fingerprint)
     request.current={fingerprint,id:'watch-compose-'+crypto.randomUUID()}
   setBusy(true);setError('')
   try{
     const response=await fetch('/api/client3/watches/orders/'+orderId+'/items',{
       method:'PATCH',credentials:'include',cache:'no-store',
       headers:{'Content-Type':'application/json'},
       body:JSON.stringify({...body,requestId:request.current.id}),
     })
     const result=await response.json() as {ok?:boolean;message?:string}
     if(!response.ok||!result.ok)throw new Error(result.message||'Не удалось сохранить состав.')
     onDone()
   }catch(cause){setError(cause instanceof Error?cause.message:'Заказ изменился. Обновите таблицу.')}
   finally{setBusy(false)}
 }
 const choices=(base:readonly {value:string;label:string}[],other:string[])=>
   [...new Set([...base.map(x=>x.label),...other])].filter(Boolean)
 const total=items.reduce((n,x)=>n+(Number(x.quantity)||0)*(Number(x.unitPrice)||0),0)
 return <form className="watch-admin-composition" onSubmit={e=>void submit(e)}>
   <p className="watch-corrections-hint">
     Состав редактируется по правилам Main. Прежние позиции остаются в истории,
     резервы пересчитываются. Отправленные товары и возвраты блокируют изменение.
     Выбор существующего SKU не обязателен: новые характеристики можно вводить свободно.
   </p>
   {items.map((item,index)=><section key={item.key} className="watch-admin-composition-line">
     <div className="watch-admin-composition-heading">
       <strong>Позиция {index+1}</strong>
       <button type="button" className="secondary compact" disabled={busy||items.length===1}
         onClick={()=>{setItems(list=>list.filter(x=>x.key!==item.key));request.current=null}}>
         Удалить позицию
       </button>
     </div>
     <div className="watch-corrections-grid">
       <label>Название модели *
         <SmartPickerInput value={item.modelName}
           options={[...new Set([...existing.map(x=>x.productName),...opts.models])]}
           placeholder="Введите название модели"
           onChange={v=>edit(item.key,{modelName:v})}/>
       </label>
       <label>Пол *
         <select value={item.gender} onChange={e=>edit(item.key,{gender:e.target.value as WatchGender})}>
           {WATCH_OPTIONS.genders.map(x=><option key={x.value} value={x.value}>{x.label}</option>)}
         </select>
       </label>
       <label>Механизм *
         <SmartPickerInput value={readable(WATCH_OPTIONS.movements,item.movement)}
           options={choices(WATCH_OPTIONS.movements,opts.movements)}
           onChange={v=>edit(item.key,{movement:canonical(WATCH_OPTIONS.movements,v)})}/>
       </label>
       <label>Материал браслета *
         <SmartPickerInput value={readable(WATCH_OPTIONS.braceletMaterials,item.braceletMaterial)}
           options={choices(WATCH_OPTIONS.braceletMaterials,opts.bracelets)}
           onChange={v=>edit(item.key,{braceletMaterial:canonical(WATCH_OPTIONS.braceletMaterials,v)})}/>
       </label>
       <label>Цвет циферблата *
         <SmartPickerInput value={readable(WATCH_OPTIONS.dialColors,item.dialColor)}
           options={choices(WATCH_OPTIONS.dialColors,opts.dials)}
           onChange={v=>edit(item.key,{dialColor:canonical(WATCH_OPTIONS.dialColors,v)})}/>
       </label>
       {item.braceletMaterial==='leather'&&<label>Цвет ремешка *
         <SmartPickerInput value={item.braceletColor} options={opts.leatherColors}
           onChange={v=>edit(item.key,{braceletColor:v})}/>
       </label>}
       <label>Источник
         <select value={item.source}
           onChange={e=>edit(item.key,{source:e.target.value as WatchSource})}>
           {WATCH_OPTIONS.sources.map(x=><option key={x.value} value={x.value}>{x.label}</option>)}
         </select>
       </label>
       <label>Количество
         <input type="number" required min={1} max={1000} step={1}
           value={item.quantity} onChange={e=>edit(item.key,{quantity:e.target.value})}/>
       </label>
       <label>Цена продажи, ₸
         <input type="number" required min={0} max={1000000000} step={1}
           value={item.unitPrice} onChange={e=>edit(item.key,{unitPrice:e.target.value})}/>
       </label>
       <label className="watch-corrections-wide">Гравировка / комментарий логисту
         <textarea maxLength={500} rows={2} value={item.engravingText}
           onChange={e=>edit(item.key,{engravingText:e.target.value})}/>
       </label>
     </div>
   </section>)}
   <div className="watch-admin-composition-bottom">
     <button type="button" className="secondary" disabled={busy||items.length>=20}
       onClick={()=>setItems(list=>[...list,blank()])}>+ Добавить товар</button>
     <span>Новая сумма: <strong>{Number.isFinite(total)?total.toLocaleString('ru-RU'):'—'} ₸</strong></span>
   </div>
   {error&&<p role="alert" className="watch-orders-error">{error}</p>}
   <div className="watch-corrections-actions">
     <button type="submit" className="primary" disabled={busy||!items.length}>
       {busy?'Сохранение…':'Сохранить новый состав'}</button>
     <button type="button" className="secondary" disabled={busy} onClick={onCancel}>Отмена</button>
   </div>
 </form>
}
