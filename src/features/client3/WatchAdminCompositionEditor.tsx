import {useEffect,useMemo,useRef,useState,type FormEvent} from 'react'
import {WatchOrderSourcePicker,sourceAvailable,stockKey,watchLabels} from './WatchOrderSourcePicker'
import {WatchOrderLineEditor} from './WatchOrderLineEditor'
import '../../styles/client3-watch-source-picker.css'
import '../../styles/client3-watch-source-picker-refine.css'
import type {DraftLine,ManualFields,WatchOrderChoice} from './WatchOrderForm'
import {WATCH_OPTIONS,type WatchBrand,type WatchSource} from '../../../shared/client3/watch-domain'

type Existing={
 id:number;watchVariantId:number;productName:string;gender:string;movement:string;
 braceletMaterial:string;dialColor:string;braceletColor:string;quantity:number;
 unitPrice:number;source:string;engravingText:string;catalogPriceSnapshot:number|null;
 shippedQuantity?:number;returnedQuantity?:number;pendingReturnQuantity?:number;
 stockWriteoffStatus?:string
}
type Line=DraftLine&{orderItemId:number|null}
const parse=(raw:string):Existing[]=>{
 try{
   const rows=JSON.parse(raw) as Existing[]
   return Array.isArray(rows)?rows.filter(x=>Number(x.id)>0&&Number(x.quantity)>0):[]
 }catch{return []}
}
const money=(value:number)=>value.toLocaleString('ru-RU')+' ₸'
const read=(opts:readonly {value:string;label:string}[],raw:string)=>
 opts.find(x=>x.value.toLocaleLowerCase('ru')===raw.toLocaleLowerCase('ru'))?.label||raw
const sourceOf=(raw:string):WatchSource=>raw==='boutique'?'showcase':'office'
const manualOf=(entry:Existing):ManualFields=>({
 modelName:entry.productName||'',
 gender:entry.gender==='female'?'female':'male',
 movement:entry.movement||'quartz',
 braceletMaterial:entry.braceletMaterial||'steel',
 dialColor:entry.dialColor||'black',
 braceletColor:entry.braceletColor||'',
})
const fromExisting=(entry:Existing):Line=>({
 id:'existing-'+entry.id,orderItemId:entry.id,kind:'stock',
 watchVariantId:entry.watchVariantId,catalogVariantId:0,
 source:sourceOf(entry.source),quantity:entry.quantity,
 unitPrice:String(entry.unitPrice),engravingText:entry.engravingText||'',
 manual:manualOf(entry),
})
const fresh=(source:WatchSource):Line=>({
 id:crypto.randomUUID(),orderItemId:null,kind:'manual',watchVariantId:0,
 catalogVariantId:0,source,quantity:1,unitPrice:'',engravingText:'',
 manual:{modelName:'',gender:'male',movement:'quartz',braceletMaterial:'steel',
 dialColor:'black',braceletColor:''},
})
type Props={
 brand:WatchBrand;orderId:number;itemLines:string;receivedAmount:number;
 onDone:()=>void;onCancel:()=>void
}
export function WatchAdminCompositionEditor({
 brand,orderId,itemLines,receivedAmount,onDone,onCancel,
}:Props){
 const original=useMemo(()=>parse(itemLines),[itemLines])
 const [lines,setLines]=useState<Line[]>(()=>original.map(fromExisting))
 const [catalog,setCatalog]=useState<WatchOrderChoice[]>([])
 const [references,setReferences]=useState<{models:string[];movements:string[];
   bracelets:string[];dials:string[];leatherColors:string[]}>({
     models:[],movements:[],bracelets:[],dials:[],leatherColors:[],
   })
 const [loading,setLoading]=useState(true)
 const [chooser,setChooser]=useState<string|null>(null)
 const [source,setSource]=useState<WatchSource>('office')
 const [editingId,setEditingId]=useState<string|null>(null)
 const [busy,setBusy]=useState(false)
 const [error,setError]=useState('')
 const request=useRef<{fingerprint:string;id:string}|null>(null)
 useEffect(()=>{
   const controller=new AbortController()
   const get=async(url:string)=>{
     const response=await fetch(url,{credentials:'include',signal:controller.signal,cache:'no-store'})
     const result=await response.json() as {ok?:boolean;message?:string;models?:WatchOrderChoice[];
       rows?:Array<{kind:string;value:string}>}
     if(!response.ok||result.ok===false)throw Error(result.message||'Каталог недоступен')
     return result
   }
   void Promise.all([
     get('/api/client3/watches/models?brand='+encodeURIComponent(brand)),
     get('/api/client3/watches/references'),
   ]).then(([models,refs])=>{
     if(controller.signal.aborted)return
     const all=(models.models||[]).map(item=>({...item,brand}))
     setCatalog(all)
     const values=(kind:string)=>(refs.rows||[]).filter(row=>row.kind===kind).map(row=>row.value)
     setReferences({
       models:[...new Set(all.map(x=>x.modelName))],
       movements:values('movements'),bracelets:values('bracelets'),
       dials:values('dials'),leatherColors:values('leatherColors'),
     })
   }).catch(cause=>{
     if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'Не удалось загрузить варианты')
   }).finally(()=>{if(!controller.signal.aborted)setLoading(false)})
   return ()=>controller.abort()
 },[brand])
 const update=(id:string,patch:Partial<Line>)=>{
   setLines(all=>all.map(line=>line.id===id?{...line,...patch}:line))
   request.current=null
 }
 const allocated=useMemo(()=>{
   const result=new Map<string,number>()
   for(const line of lines.filter(x=>x.kind==='stock'&&x.watchVariantId>0&&
     (!x.orderItemId||original.find(y=>y.id===x.orderItemId)?.watchVariantId!==x.watchVariantId||
       sourceOf(original.find(y=>y.id===x.orderItemId)?.source||'')!==x.source))){
     const key=stockKey(line.source,line.watchVariantId)
     result.set(key,(result.get(key)||0)+line.quantity)
   }
   return result
 },[lines,original])
 const choose=(selected:WatchOrderChoice,kind:'stock'|'preorder',selectedSource:WatchSource)=>{
   if(!chooser)return
   const current=lines.find(x=>x.id===chooser)
   const draft:Line={
     id:current?.id||crypto.randomUUID(),orderItemId:current?.orderItemId??null,
     kind,watchVariantId:selected.watchVariantId,catalogVariantId:selected.catalogVariantId,
     source:selectedSource,quantity:current?.quantity||1,
     unitPrice:current?.unitPrice||String(selected.catalogPriceSnapshot??''),
     engravingText:current?.engravingText||'',
     manual:{modelName:selected.modelName,gender:selected.gender,movement:selected.movement,
       braceletMaterial:selected.braceletMaterial,dialColor:selected.dialColor,
       braceletColor:selected.braceletColor||''},
   }
   setLines(old=>current?old.map(x=>x.id===current.id?draft:x):[...old,draft])
   setChooser(null);request.current=null;setError('')
 }
 const addManual=(selectedSource:WatchSource)=>{
   if(!chooser)return
   const current=lines.find(x=>x.id===chooser)
   const draft:Line=current?{
     ...current,kind:'manual',watchVariantId:0,catalogVariantId:0,source:selectedSource,
   }:fresh(selectedSource)
   setLines(old=>current?old.map(x=>x.id===current.id?draft:x):[...old,draft])
   setChooser(null);setEditingId(draft.id);request.current=null;setError('')
 }
 const startChoose=(id:string)=>{
   const current=lines.find(x=>x.id===id)
   setSource(current?.source||'office');setChooser(id);setEditingId(null)
 }
 const currentEdit=lines.find(x=>x.id===editingId)
 const currentChoice=currentEdit&&currentEdit.kind!=='manual'
   ?catalog.find(x=>x.watchVariantId===currentEdit.watchVariantId):undefined
 const total=lines.reduce((sum,line)=>sum+Math.max(0,line.quantity)*(Number(line.unitPrice)||0),0)
 const preview=lines.reduce((sum,line)=>{
   const previous=original.find(x=>x.id===line.orderItemId)
   return sum+(previous&&previous.watchVariantId===line.watchVariantId&&
     sourceOf(previous.source)===line.source&&previous.quantity===line.quantity?0:1)
 },0)+original.filter(x=>!lines.some(line=>line.orderItemId===x.id)).length
 const hasLifecycle=original.some(x=>Number(x.shippedQuantity||0)>0||
   Number(x.returnedQuantity||0)>0||Number(x.pendingReturnQuantity||0)>0||
   ['fulfilled','written_off','negative'].includes(x.stockWriteoffStatus||''))
 const send=async(event:FormEvent<HTMLFormElement>)=>{
   event.preventDefault()
   if(busy||loading)return
   if(!lines.length||lines.length>20){setError('В заказе должно быть от 1 до 20 товаров.');return}
   if(hasLifecycle){setError('У заказа есть отправка, выдача или возврат. Изменение состава заблокировано для защиты склада.');return}
   if(!lines.every(x=>x.manual.modelName.trim()&&x.quantity>=1&&Number.isSafeInteger(x.quantity)&&
     x.quantity<=1000&&x.unitPrice.trim()!==''&&Number.isSafeInteger(Number(x.unitPrice))&&
     Number(x.unitPrice)>=0&&(x.kind==='manual'||x.watchVariantId>0))){
     setError('Проверьте комплектации, количество и цены.');return
   }
   if(total<receivedAmount){setError('Новая сумма меньше уже проведённых оплат ('+money(receivedAmount)+').');return}
   const expected=original.map(x=>({
     orderItemId:x.id,watchVariantId:x.watchVariantId,quantity:x.quantity,
     unitPrice:x.unitPrice,source:sourceOf(x.source),engravingText:x.engravingText||'',
     catalogPriceSnapshot:x.catalogPriceSnapshot,
   }))
   const items=lines.map(x=>({
     orderItemId:x.orderItemId,source:x.source,quantity:x.quantity,
     unitPrice:Number(x.unitPrice),engravingText:x.engravingText,
     ...(x.kind==='manual'?{manual:x.manual}:{watchVariantId:x.watchVariantId}),
   }))
   const body={brand,expected,items}
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
     if(!response.ok||!result.ok)throw Error(result.message||'Не удалось заменить состав.')
     onDone()
   }catch(cause){setError(cause instanceof Error?cause.message:'Заказ изменился. Обновите редактор.')}
   finally{setBusy(false)}
 }
 return <form className="watch-editor-composition" onSubmit={event=>void send(event)}>
   <div className="watch-editor-section-title">
     <div><h3>Состав заказа</h3><p>Выберите товар из наличия либо создайте нужную комплектацию.</p></div>
     <button type="button" className="secondary compact" onClick={onCancel} disabled={busy}>Вернуться</button>
   </div>
   {hasLifecycle&&<p className="watch-editor-warning" role="alert">
     В заказе уже есть выдача, отправка или возврат. Автоматическая перезапись состава могла бы
     создать ложный остаток. Изменить такие товары можно только через отдельную операцию
     с подтверждённым фактическим движением.
   </p>}
   {error&&<p className="watch-orders-error" role="alert">{error}</p>}
   <div className="watch-editor-product-list">
     {lines.map((line,index)=>{
       const match=catalog.find(x=>x.watchVariantId===line.watchVariantId)
       const title=line.kind==='manual'?line.manual.modelName:match?.modelName||line.manual.modelName
       const details=line.kind==='manual'?
         [read(WATCH_OPTIONS.genders,line.manual.gender),
           read(WATCH_OPTIONS.movements,line.manual.movement),
           read(WATCH_OPTIONS.braceletMaterials,line.manual.braceletMaterial),
           read(WATCH_OPTIONS.dialColors,line.manual.dialColor),line.manual.braceletColor].filter(Boolean):
         match?watchLabels(match):[
           read(WATCH_OPTIONS.genders,line.manual.gender),
           read(WATCH_OPTIONS.movements,line.manual.movement),
           read(WATCH_OPTIONS.braceletMaterials,line.manual.braceletMaterial),
           read(WATCH_OPTIONS.dialColors,line.manual.dialColor),line.manual.braceletColor].filter(Boolean)
       return <article className="watch-editor-product" key={line.id}>
         <div className="watch-editor-product-top">
           <div><small>Позиция {index+1} · {line.source==='office'?'Офис':'Витрина'}</small>
             <strong>{title||'Новая комплектация'}</strong>
             <p>{details.join(' · ')}</p></div>
           {!hasLifecycle&&<div className="watch-editor-product-actions">
             <button type="button" onClick={()=>startChoose(line.id)} disabled={busy}>Заменить</button>
             <button type="button" onClick={()=>{
               update(line.id,{kind:'manual',watchVariantId:0,catalogVariantId:0})
               setEditingId(line.id)
             }} disabled={busy}>Характеристики</button>
             <button type="button" className="danger-link" disabled={busy||lines.length===1}
               onClick={()=>{setLines(current=>current.filter(x=>x.id!==line.id));request.current=null}}>Удалить</button>
           </div>}
         </div>
         <div className="watch-editor-product-fields">
           <label>Количество<input type="number" min={1} max={1000} value={line.quantity}
             disabled={busy||hasLifecycle} onChange={e=>update(line.id,{quantity:Number(e.target.value)})}/></label>
           <label>Цена, ₸<input type="number" min={0} max={1000000000}
             value={line.unitPrice} disabled={busy||hasLifecycle}
             onChange={e=>update(line.id,{unitPrice:e.target.value})}/></label>
           <label className="watch-editor-engraving">Гравировка / логисту
             <input value={line.engravingText} maxLength={500} disabled={busy||hasLifecycle}
               onChange={e=>update(line.id,{engravingText:e.target.value})}/></label>
         </div>
       </article>
     })}
   </div>
   {!hasLifecycle&&<>
     <button type="button" className="watch-editor-add-product" disabled={busy||lines.length>=20}
       onClick={()=>{setChooser('add');setSource('office')}}>+ Добавить товар</button>
     {chooser&&<div className="watch-editor-chooser">
       <div className="watch-editor-chooser-head">
         <strong>{chooser==='add'?'Добавить товар':'Выбрать замену'}</strong>
         <button type="button" onClick={()=>setChooser(null)}>Закрыть</button>
       </div>
       {loading?<p>Загрузка склада…</p>:
         <WatchOrderSourcePicker brand={brand} source={source} onSourceChange={setSource}
           catalog={catalog} allocated={allocated} onAdd={choose} onManual={addManual}/>}
     </div>}
   </>}
   <div className="watch-editor-composition-footer">
     <span><small>Новая сумма</small><strong>{money(total)}</strong>
       <small>{preview>0?'Изменено позиций: '+preview:'Состав без изменений'}</small></span>
     <button type="submit" className="primary" disabled={busy||loading||hasLifecycle||Boolean(chooser)||Boolean(editingId)||preview===0}>
       {busy?'Сохранение…':'Подтвердить изменение состава'}
     </button>
   </div>
   {currentEdit&&<WatchOrderLineEditor line={currentEdit} choice={currentChoice}
     suggestions={references}
     available={currentChoice?sourceAvailable(currentChoice,currentEdit.source):0}
     allocated={allocated.get(stockKey(currentEdit.source,currentEdit.watchVariantId))||0}
     onUpdate={patch=>update(currentEdit.id,patch)} onClose={()=>setEditingId(null)}/>}
 </form>
}
