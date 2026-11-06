import {useEffect,useMemo,useState,type KeyboardEvent} from 'react'
import {buildStockBrowseLayout} from '../inventory/stockBrowseLayout'
import '../../styles/main-order-source-picker.css'

export type SourceKey='warehouse'|'boutique'
export type StockCount={physical:number;reserved:number;free:number;cachedReserved:number}
export type OrderPickerChoice={
 variantId:number;productId:number;productName:string;category:string;gender:string;
 color:string;material:string;length:string;size:string;salePrice:number|null;
 warehouse:StockCount;boutique:StockCount;
}
type PickerReply={ok:boolean;variants:OrderPickerChoice[]}
type Props={
 allocated:ReadonlyMap<string,number>
 onPick:(choice:OrderPickerChoice,source:SourceKey|'workshop',insufficient:boolean)=>void
 onManual:()=>void
 initialVariants?:OrderPickerChoice[]
 initialSelectedId?:number
 initialIntent?:'stock'|'all'
 initialQuery?:string
}
type Model={id:number;name:string;variants:OrderPickerChoice[];free:number;physical:number;reserved:number}
type Execution=ReturnType<typeof buildStockBrowseLayout<OrderPickerChoice>>[number]
export const pickerKey=(source:SourceKey,id:number)=>source+':'+id
export const freeAfterDraft=(choice:OrderPickerChoice,source:SourceKey,allocated:ReadonlyMap<string,number>)=>
 Math.max(0,choice[source].free-(allocated.get(pickerKey(source,choice.variantId))||0))
const clean=(s:string)=>String(s||'').toLocaleLowerCase('ru-RU').replace(/ё/g,'е').trim()
const money=(n:number)=>n.toLocaleString('ru-RU')+' ₸'
export const PRODUCT_PAGE_SIZE=12
export const VARIANT_PAGE_SIZE=6
export const paginate=<T,>(items:readonly T[],page:number,pageSize:number)=>items.slice(page*pageSize,(page+1)*pageSize)
type Facets={gender:string;color:string;material:string;length:string;size:string}
export const filterOrderPickerVariants=(lines:readonly OrderPickerChoice[],facets:Facets)=>
 lines.filter(x=>(Object.keys(facets) as Array<keyof Facets>).every(key=>!facets[key]||clean(x[key])===clean(facets[key])))
export const suggestOrderModels=(models:readonly Model[],query:string,limit=8)=>{
 const q=clean(query)
 if(!q)return []
 return models.filter(x=>clean(x.name).includes(q))
  .sort((a,b)=>Number(clean(b.name).startsWith(q))-Number(clean(a.name).startsWith(q))||
    a.name.localeCompare(b.name,'ru',{numeric:true})).slice(0,limit)
}
export function groupPickerExecutions(lines:OrderPickerChoice[]):Execution[]{
 return buildStockBrowseLayout(lines)
}

export function MainOrderSourcePicker({allocated,onPick,onManual,initialVariants,initialSelectedId,initialIntent,initialQuery}:Props){
 const [source,setSource]=useState<SourceKey>('warehouse')
 const [intent,setIntent]=useState<'stock'|'all'>(initialIntent??'stock')
 const [query,setQuery]=useState(initialQuery??'')
 const [searchOpen,setSearchOpen]=useState(false)
 const [suggestionIndex,setSuggestionIndex]=useState(0)
 const [selectedId,setSelectedId]=useState<number|null>(initialSelectedId??null)
 const [executionKey,setExecutionKey]=useState('')
 const [selectedVariantId,setSelectedVariantId]=useState<number|null>(null)
 const [reload,setReload]=useState(0)
 const [variants,setVariants]=useState<OrderPickerChoice[]>(initialVariants||[])
 const [loading,setLoading]=useState(!initialVariants)
 const [error,setError]=useState('')
 useEffect(()=>{
   if(initialVariants)return
   const controller=new AbortController()
   setLoading(true);setError('')
   fetch('/api/orders/source-picker',{credentials:'same-origin',signal:controller.signal})
     .then(async response=>{
       const data=await response.json() as PickerReply&{message?:string}
       if(!response.ok||!data.ok||!Array.isArray(data.variants))throw Error(data.message||'Не удалось загрузить каталог.')
       return data.variants
     }).then(rows=>{if(!controller.signal.aborted)setVariants(rows)})
     .catch(err=>{if(!controller.signal.aborted)setError(err instanceof Error?err.message:'Ошибка загрузки.')})
     .finally(()=>{if(!controller.signal.aborted)setLoading(false)})
   return()=>controller.abort()
 },[reload,initialVariants])
 const allModels=useMemo(()=>{
   const byId=new Map<number,Model>()
   for(const choice of variants){
     if(choice.variantId<=0||choice.productId<=0)continue
     let group=byId.get(choice.productId)
     if(!group){
       group={id:choice.productId,name:choice.productName,variants:[],free:0,physical:0,reserved:0}
       byId.set(choice.productId,group)
     }
     group.variants.push(choice)
     group.free+=freeAfterDraft(choice,source,allocated)
     group.physical+=choice[source].physical
     group.reserved+=choice[source].reserved
   }
   return [...byId.values()].sort((a,b)=>a.name.localeCompare(b.name,'ru',{numeric:true}))
 },[variants,source,allocated])
 const visibleModels=useMemo(()=>allModels
   .filter(model=>intent==='all'||model.free>0)
   .filter(model=>!query.trim()||clean(model.name).includes(clean(query))),[allModels,intent,query])
 const suggestions=useMemo(()=>suggestOrderModels(allModels,query),[allModels,query])
 const model=allModels.find(x=>x.id===selectedId)||null
 const shownVariants=(model?.variants||[]).filter(x=>intent==='all'||freeAfterDraft(x,source,allocated)>0)
 const executions=groupPickerExecutions(shownVariants)
 const activeExecution=executions.find(x=>x.key===executionKey)||executions[0]||null
 const selectedVariant=shownVariants.find(x=>x.variantId===selectedVariantId)||null
 const pickModel=(item:Model)=>{
   setSelectedId(item.id)
   setExecutionKey('')
   setSelectedVariantId(null)
   setQuery(item.name)
   if(item.free<=0)setIntent('all')
   setSearchOpen(false)
 }
 const changeSource=(value:SourceKey)=>{
   setSource(value);setIntent('stock');setQuery('');setSelectedId(null)
   setExecutionKey('');setSelectedVariantId(null);setSearchOpen(false)
 }
 const changeIntent=(value:'stock'|'all')=>{
   setIntent(value);setSelectedVariantId(null);setExecutionKey('')
 }
 const searchKeyDown=(event:KeyboardEvent<HTMLInputElement>)=>{
   if(event.key==='Escape'){setSearchOpen(false);return}
   if(!suggestions.length)return
   if(event.key==='ArrowDown'){
     event.preventDefault();setSearchOpen(true)
     setSuggestionIndex(index=>(index+1)%suggestions.length)
   }else if(event.key==='ArrowUp'){
     event.preventDefault();setSearchOpen(true)
     setSuggestionIndex(index=>(index+suggestions.length-1)%suggestions.length)
   }else if(event.key==='Enter'){
     event.preventDefault();pickModel(suggestions[Math.min(suggestionIndex,suggestions.length-1)])
   }
 }
 const renderSize=(choice:OrderPickerChoice)=>{
   const free=freeAfterDraft(choice,source,allocated)
   const active=selectedVariantId===choice.variantId
   return <button type="button" key={choice.variantId}
     className={'main-order-size'+(active?' selected':'')+(free<=0?' no-free':'')}
     aria-pressed={active}
     aria-label={['Размер '+(choice.size||'—'),free+' свободно','выбрать вариант'].join(', ')}
     onClick={()=>setSelectedVariantId(choice.variantId)}>
     <strong>{choice.size||'—'}</strong>
     <small>{free>0?free+' свободно':'0 свободно'}</small>
   </button>
 }
 const renderColors=(execution:Execution,onlyZero:boolean)=>{
   return execution.colors.map(group=>{
     const items=group.rows.filter(x=>onlyZero?freeAfterDraft(x,source,allocated)<=0:freeAfterDraft(x,source,allocated)>0)
     if(!items.length)return null
     return <div className="main-order-exec-color" key={group.key}>
       <div className="main-order-exec-color-name"><strong>{group.color}</strong><small>{items.length} размеров</small></div>
       <div className="main-order-size-grid">{items.map(renderSize)}</div>
     </div>
   })
 }
 const zeroCount=activeExecution?.colors.reduce((sum,color)=>sum+
   color.rows.filter(x=>freeAfterDraft(x,source,allocated)<=0).length,0)||0
 const positiveCount=activeExecution?.colors.reduce((sum,color)=>sum+
   color.rows.filter(x=>freeAfterDraft(x,source,allocated)>0).length,0)||0
 return <div className="main-order-picker v3" data-order-source-picker="main">
   <div className="main-order-picker-top">
     <div className="main-order-picker-section">
       <span className="main-order-picker-caption">Источник товара</span>
       <div className="main-order-picker-tabs" role="group" aria-label="Источник товара">
         {(['warehouse','boutique'] as const).map(key=><button key={key} type="button"
           className={source===key?'active':''} aria-pressed={source===key}
           onClick={()=>changeSource(key)}>{key==='warehouse'?'Склад':'Бутик'}</button>)}
       </div>
     </div>
     <div className="main-order-picker-section">
       <span className="main-order-picker-caption">Показывать</span>
       <div className="main-order-picker-tabs" role="group" aria-label="Товары по наличию">
         <button type="button" className={intent==='stock'?'active':''} aria-pressed={intent==='stock'}
           onClick={()=>changeIntent('stock')}>Со свободным остатком</button>
         <button type="button" className={intent==='all'?'active':''} aria-pressed={intent==='all'}
           onClick={()=>changeIntent('all')}>Весь каталог</button>
       </div>
     </div>
     <button type="button" className="main-order-picker-manual" onClick={onManual}>+ Индивидуальный заказ в цех</button>
   </div>
   <div className="main-order-picker-searchbar">
     <div className="main-order-picker-name-search">
       <label htmlFor="main-order-model-query">Название товара</label>
       <input id="main-order-model-query" type="search" value={query}
         autoComplete="off" role="combobox" aria-expanded={searchOpen&&suggestions.length>0}
         aria-controls="main-order-model-suggestions"
         aria-label="Поиск по названию товара" placeholder="Начните вводить название…"
         onFocus={()=>setSearchOpen(true)} onKeyDown={searchKeyDown}
         onChange={e=>{
           setQuery(e.target.value);setSearchOpen(true);setSuggestionIndex(0)
           setSelectedId(null);setExecutionKey('');setSelectedVariantId(null)
         }}/>
       {query&&<button type="button" className="main-order-search-clear" aria-label="Очистить поиск"
         onClick={()=>{setQuery('');setSelectedId(null);setSearchOpen(false);setExecutionKey('');setSelectedVariantId(null)}}>×</button>}
       {searchOpen&&suggestions.length>0&&<div id="main-order-model-suggestions"
         className="main-order-name-suggestions" role="listbox" aria-label="Подсказки названий товаров">
         {suggestions.map((item,i)=><button type="button" role="option" key={item.id}
           aria-selected={i===suggestionIndex} className={i===suggestionIndex?'active':''}
           onMouseDown={e=>e.preventDefault()} onClick={()=>pickModel(item)}>
           <strong>{item.name}</strong>
           <small>{item.free>0?item.free+' свободно':'Нет свободных · есть в каталоге'}</small>
         </button>)}
       </div>}
     </div>
     <button type="button" className="secondary compact" onClick={()=>setReload(x=>x+1)}>
       Обновить остатки
     </button>
   </div>
   <div className="main-order-picker-meta">
     {loading?'Загрузка каталога…':error?error:visibleModels.length+
       ' моделей · '+(source==='warehouse'?'Склад':'Бутик')+' · '+
       (intent==='stock'?'со свободным остатком':'весь каталог')}
   </div>
   {!loading&&!error&&<div className="main-order-picker-workspace">
     <aside className="main-order-model-list" aria-label="Названия товаров">
       {visibleModels.length>0?visibleModels.map(item=><button type="button" key={item.id}
         className={'main-order-model-row'+(selectedId===item.id?' selected':'')}
         aria-pressed={selectedId===item.id} onClick={()=>pickModel(item)}>
         <span className="main-order-model-title"><strong>{item.name}</strong>
           <small>{item.variants.length} вариантов</small>
         </span>
         <span className={'main-order-model-count'+(item.free>0?'':' empty')}>
           {item.free>0?item.free+' своб.':'0'}
         </span>
       </button>):<div className="main-order-model-empty">
         <strong>Товары не найдены</strong>
         <span>Попробуйте другое название или переключитесь на весь каталог.</span>
         <button type="button" className="secondary compact" onClick={()=>{setQuery('');changeIntent('all')}}>Весь каталог</button>
       </div>}
     </aside>
     <div className="main-order-picker-detail-panel">
       {!model?<div className="main-order-pick-placeholder">
         <strong>Выберите товар</strong>
         <span>Введите название сверху или выберите модель слева. После этого появятся исполнения, цвета и размеры.</span>
         <span>Не нашли в наличии? Поиск также подсказывает товары из всего каталога.</span>
       </div>:<>
         <div className="main-order-pick-detail-header">
           <div>
             <span>Выбор варианта · {source==='warehouse'?'Склад':'Бутик'}</span>
             <h3>{model.name}</h3>
             <small>{model.variants.length} вариантов · На месте {model.physical} · В резерве {model.reserved}</small>
           </div>
           <div className="main-order-pick-overview">
             <strong>{model.free}</strong><span>свободно</span>
           </div>
         </div>
         {intent==='stock'&&model.variants.length>shownVariants.length&&
           <button type="button" className="main-order-show-absent"
             onClick={()=>changeIntent('all')}>
             Показать варианты без свободного остатка ({model.variants.length-shownVariants.length})
           </button>}
         {executions.length>0?<>
           <div className="main-order-exec-tabs" role="group" aria-label="Исполнения">
             {executions.map(execution=>{
               const count=execution.colors.reduce((sum,color)=>sum+color.rows.length,0)
               return <button type="button" key={execution.key}
                 className={activeExecution?.key===execution.key?'active':''}
                 aria-pressed={activeExecution?.key===execution.key}
                 onClick={()=>{setExecutionKey(execution.key);setSelectedVariantId(null)}}>
                 <strong>{execution.title}</strong><small>{count} вариантов</small>
               </button>
             })}
           </div>
           {activeExecution&&<div className="main-order-exec-detail" data-picker-execution={activeExecution.key}>
             <div className="main-order-exec-section-title">
               <strong>{activeExecution.title}</strong>
               <span>{positiveCount} с остатком{intent==='all'?' · '+zeroCount+' без свободного остатка':''}</span>
             </div>
             {renderColors(activeExecution,false)}
             {intent==='all'&&zeroCount>0&&<details className="main-order-exec-zero" open={positiveCount===0}>
               <summary>Нет свободного остатка · {zeroCount} вариантов</summary>
               <div className="main-order-exec-zero-list">{renderColors(activeExecution,true)}</div>
             </details>}
           </div>}
         </>:<div className="main-order-model-empty">
           <strong>В этом источнике нет свободных вариантов</strong>
           <button type="button" className="secondary compact" onClick={()=>changeIntent('all')}>Показать весь каталог</button>
         </div>}
         {selectedVariant&&<div className="main-order-pick-selection" aria-live="polite">
           <div className="main-order-pick-selection-summary">
             <strong>{selectedVariant.color||'Без цвета'} · размер {selectedVariant.size||'—'}</strong>
             <small>{selectedVariant.material} · {selectedVariant.length} · {selectedVariant.gender}</small>
             <span>{selectedVariant[source].free} из {selectedVariant[source].physical} свободно · {selectedVariant[source].reserved} в резерве
               {selectedVariant.salePrice!==null?' · '+money(selectedVariant.salePrice):''}</span>
             {(selectedVariant[source].physical<0||selectedVariant[source].reserved>selectedVariant[source].physical)&&
               <small className="main-order-stock-warning">По системе остаток или резервы требуют сверки. Заказ можно оформить, но наличие не подтверждено.</small>}
             {selectedVariant[source].cachedReserved!==selectedVariant[source].reserved&&
               <small>В учёте резервов есть расхождение</small>}
           </div>
           <div className="main-order-pick-selection-actions">
             <button type="button" className="primary compact"
               onClick={()=>onPick(selectedVariant,source,freeAfterDraft(selectedVariant,source,allocated)<=0)}>
               {freeAfterDraft(selectedVariant,source,allocated)>0?'+ В заказ':'Оформить из источника'}
             </button>
             <button type="button" className="secondary compact"
               onClick={()=>onPick(selectedVariant,'workshop',false)}>В цех</button>
           </div>
         </div>}
         {!selectedVariant&&<p className="main-order-pick-help">Выберите нужный размер. Для выбранного варианта появятся действия «В заказ» и «В цех».</p>}
       </>}
     </div>
   </div>}
 </div>
}
