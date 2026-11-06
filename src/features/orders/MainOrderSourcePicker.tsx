import {Fragment,useEffect,useMemo,useState,type KeyboardEvent} from 'react'
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
export const pickerKey=(source:SourceKey,id:number)=>source+':'+id
export const freeAfterDraft=(choice:OrderPickerChoice,source:SourceKey,allocated:ReadonlyMap<string,number>)=>
 Math.max(0,choice[source].free-(allocated.get(pickerKey(source,choice.variantId))||0))
const clean=(s:string)=>String(s||'').toLocaleLowerCase('ru-RU').replace(/ё/g,'е').trim()
const money=(n:number)=>n.toLocaleString('ru-RU')+' ₸'
export type ProductGroup={id:number;name:string;lines:OrderPickerChoice[];free:number;price:number|null}
export type ExecutionGroup={key:string;name:string;lines:OrderPickerChoice[];free:number}
const normalized=(value:string)=>String(value||'').trim().toLocaleUpperCase('ru-RU')
export function groupOrderPickerExecutions(lines:readonly OrderPickerChoice[],source:SourceKey,allocated:ReadonlyMap<string,number>){
 const map=new Map<string,ExecutionGroup>()
 for(const item of lines){
   const key=[item.category,item.gender,item.material,item.length].map(normalized).join('¦')
   let group=map.get(key)
   if(!group){
     const name=[item.category==='child'?'ДЕТСКИЙ':'',item.gender,item.material,item.length]
       .filter(part=>part&&normalized(part)!=='СТАНДАРТ').join(' · ')||'Основное исполнение'
     group={key,name,lines:[],free:0};map.set(key,group)
   }
   group.lines.push(item);group.free+=freeAfterDraft(item,source,allocated)
 }
 return [...map.values()].sort((a,b)=>Number(b.free>0)-Number(a.free>0)||a.name.localeCompare(b.name,'ru'))
}
export function suggestOrderPickerModels(groups:readonly ProductGroup[],query:string,limit=8){
 const q=clean(query)
 if(!q)return []
 return groups.filter(x=>clean(x.name).includes(q))
  .sort((a,b)=>Number(clean(b.name).startsWith(q))-Number(clean(a.name).startsWith(q))
    ||a.name.localeCompare(b.name,'ru',{numeric:true})).slice(0,limit)
}
export const PRODUCT_PAGE_SIZE=12
export const VARIANT_PAGE_SIZE=6
export const paginate=<T,>(values:readonly T[],page:number,perPage:number)=>values.slice(page*perPage,(page+1)*perPage)

/** Source-first browsing inspired by Client3, adapted to Main's warehouse/boutique/workshop. */
export function MainOrderSourcePicker({allocated,onPick,onManual,initialVariants,initialSelectedId,initialIntent,initialQuery}:Props){
 const [source,setSource]=useState<SourceKey>('warehouse')
 const [intent,setIntent]=useState<'stock'|'all'>(initialIntent??'stock')
 const [query,setQuery]=useState(initialQuery??'')
 const [searchOpen,setSearchOpen]=useState(false)
 const [suggestionIndex,setSuggestionIndex]=useState(0)
 const [selectedId,setSelectedId]=useState<number|null>(initialSelectedId??null)
 const [executionKey,setExecutionKey]=useState('')
 const [color,setColor]=useState('')
 const [productPage,setProductPage]=useState(0)
 const [variantPage,setVariantPage]=useState(0)
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

 const allGroups=useMemo(()=>{
   const byId=new Map<number,ProductGroup>()
   for(const item of variants){
     if(item.variantId<=0||item.productId<=0)continue
     let group=byId.get(item.productId)
     if(!group){group={id:item.productId,name:item.productName,lines:[],free:0,price:null};byId.set(item.productId,group)}
     group.lines.push(item)
     group.free+=freeAfterDraft(item,source,allocated)
     if(item.salePrice!==null)group.price=group.price===null?item.salePrice:Math.min(group.price,item.salePrice)
   }
   return [...byId.values()].sort((a,b)=>a.name.localeCompare(b.name,'ru',{numeric:true}))
 },[variants,source,allocated])
 const groups=useMemo(()=>{
   const q=clean(query)
   return allGroups.filter(group=>(intent==='all'||group.free>0)&&(!q||clean(group.name).includes(q)))
 },[allGroups,intent,query])
 const suggestions=useMemo(()=>suggestOrderPickerModels(allGroups,query),[allGroups,query])
 const totalPages=Math.max(1,Math.ceil(groups.length/PRODUCT_PAGE_SIZE))
 const safePage=Math.min(productPage,totalPages-1)
 const pageGroups=paginate(groups,safePage,PRODUCT_PAGE_SIZE)
 const gridRows=Array.from({length:Math.ceil(pageGroups.length/2)},(_,i)=>pageGroups.slice(i*2,i*2+2))
 const selectedGroup=pageGroups.find(g=>g.id===selectedId)
 const availableLines=selectedGroup?.lines.filter(item=>intent==='all'||freeAfterDraft(item,source,allocated)>0)||[]
 const executions=groupOrderPickerExecutions(availableLines,source,allocated)
 const activeExecution=executions.find(x=>x.key===executionKey)||executions[0]||null
 const colors=activeExecution?[...new Set(activeExecution.lines.map(x=>x.color||'Без цвета'))]
   .sort((a,b)=>a.localeCompare(b,'ru',{numeric:true})):[]
 const matched=activeExecution?.lines.filter(item=>!color||normalized(item.color||'Без цвета')===normalized(color))
   .sort((a,b)=>Number(freeAfterDraft(b,source,allocated)>0)-Number(freeAfterDraft(a,source,allocated)>0)
     ||(a.color||'').localeCompare(b.color||'','ru')
     ||a.size.localeCompare(b.size,'ru',{numeric:true}))||[]
 const variantPages=Math.max(1,Math.ceil(matched.length/VARIANT_PAGE_SIZE))
 const safeVariantPage=Math.min(variantPage,variantPages-1)
 const visibleVariants=paginate(matched,safeVariantPage,VARIANT_PAGE_SIZE)
 const resetView=()=>{setSelectedId(null);setExecutionKey('');setColor('');setVariantPage(0);setProductPage(0)}
 const chooseModel=(id:number)=>{
   setSelectedId(old=>old===id?null:id)
   setExecutionKey('');setColor('');setVariantPage(0)
   setSearchOpen(false)
 }
 const chooseSuggestion=(group:ProductGroup)=>{
   setQuery(group.name)
   if(group.free<=0)setIntent('all')
   setSelectedId(group.id);setExecutionKey('');setColor('');setVariantPage(0);setProductPage(0)
   setSearchOpen(false)
 }
 const searchKeyDown=(event:KeyboardEvent<HTMLInputElement>)=>{
   if(event.key==='Escape'){setSearchOpen(false);return}
   if(!suggestions.length)return
   if(event.key==='ArrowDown'){event.preventDefault();setSearchOpen(true);setSuggestionIndex(i=>(i+1)%suggestions.length)}
   else if(event.key==='ArrowUp'){event.preventDefault();setSearchOpen(true);setSuggestionIndex(i=>(i+suggestions.length-1)%suggestions.length)}
   else if(event.key==='Enter'){event.preventDefault();chooseSuggestion(suggestions[Math.min(suggestionIndex,suggestions.length-1)])}
 }
 const showAllVariants=()=>{
   if(!selectedGroup)return
   setQuery(selectedGroup.name);setIntent('all');setProductPage(0);setVariantPage(0);setColor('');setExecutionKey('')
 }
 const shownByColor=[...visibleVariants.reduce((byColor,choice)=>{
   const key=choice.color||'Без цвета'
   let array=byColor.get(key)
   if(!array){array=[];byColor.set(key,array)}
   array.push(choice)
   return byColor
 },new Map<string,OrderPickerChoice[]>())]

 return <div className="main-order-picker" data-order-source-picker="main">
  <div className="main-order-picker-top">
   <div className="main-order-picker-section">
    <span className="main-order-picker-caption">Источник товара</span>
    <div className="main-order-picker-tabs" role="group" aria-label="Источник товара">
      {(['warehouse','boutique'] as const).map(key=><button key={key} type="button"
       className={source===key?'active':''} aria-pressed={source===key}
       onClick={()=>{setSource(key);resetView()}}>{key==='warehouse'?'Склад':'Бутик'}</button>)}
    </div>
   </div>
   <div className="main-order-picker-section">
    <span className="main-order-picker-caption">Показывать</span>
    <div className="main-order-picker-tabs" role="group" aria-label="Товары по наличию">
      <button type="button" className={intent==='stock'?'active':''} aria-pressed={intent==='stock'} onClick={()=>{setIntent('stock');resetView()}}>Свободные</button>
      <button type="button" className={intent==='all'?'active':''} aria-pressed={intent==='all'} onClick={()=>{setIntent('all');resetView()}}>Весь каталог</button>
    </div>
   </div>
   <button type="button" className="main-order-picker-manual" onClick={onManual}>+ Индивидуальный заказ в цех</button>
  </div>

  <div className="main-order-picker-filters">
    <div className="main-order-picker-name-search">
      <input id="main-order-model-query" type="search" placeholder="Начните вводить название товара…"
       aria-label="Поиск по названию товара" role="combobox"
       aria-expanded={searchOpen&&suggestions.length>0} aria-controls="main-order-model-suggestions"
       autoComplete="off" value={query} onKeyDown={searchKeyDown} onFocus={()=>setSearchOpen(true)}
       onChange={e=>{setQuery(e.target.value);setSuggestionIndex(0);setSearchOpen(true);resetView()}}/>
      {query&&<button className="main-order-search-clear" aria-label="Очистить поиск" type="button"
        onClick={()=>{setQuery('');setSearchOpen(false);resetView()}}>×</button>}
      {searchOpen&&suggestions.length>0&&<div id="main-order-model-suggestions"
        className="main-order-name-suggestions" role="listbox" aria-label="Подсказки названий товаров">
        {suggestions.map((group,index)=><button type="button" role="option"
          aria-selected={index===suggestionIndex} key={group.id} className={index===suggestionIndex?'active':''}
          onMouseDown={event=>event.preventDefault()} onClick={()=>chooseSuggestion(group)}>
          <strong>{group.name}</strong>
          <small>{group.free>0?group.free+' свободно':'Нет свободного остатка'}</small>
        </button>)}
      </div>}
    </div>
    <button type="button" className="secondary compact" onClick={()=>setReload(x=>x+1)}>Обновить остатки</button>
  </div>
  <div className="main-order-picker-meta">
    {loading?'Загрузка каталога…':error?error:`${groups.length} товаров · ${source==='warehouse'?'Склад':'Бутик'} · ${intent==='stock'?'со свободным остатком':'все варианты'}`}
  </div>
  {!loading&&!error&&!groups.length&&<div className="main-order-picker-empty">
    <strong>{intent==='stock'?'В выбранном источнике нет свободных товаров по этим условиям.':'Товары не найдены.'}</strong>
    <p>Проверьте другой источник, посмотрите весь каталог или создайте индивидуальную позицию для цеха.</p>
    <button type="button" className="secondary compact" onClick={()=>setIntent('all')}>Весь каталог</button>
  </div>}
  {!loading&&!error&&groups.length>0&&<>
    <div className="main-order-picker-catalog">
      {gridRows.map((pair,index)=><Fragment key={'row-'+safePage+'-'+index}>
        <div className="main-order-picker-model-row">
          {pair.map(group=><button type="button" key={group.id}
            className={'main-order-picker-model'+(selectedId===group.id?' selected':'')}
            aria-expanded={selectedId===group.id}
            onClick={()=>chooseModel(group.id)}>
            <span className="main-order-picker-model-mark" aria-hidden="true">{group.name.trim().slice(0,1)}</span>
            <span className="main-order-picker-model-main">
              <strong>{group.name}</strong>
              <small>{group.lines.length} вариантов{group.price===null?'':' · от '+money(group.price)}</small>
            </span>
            <span className="main-order-picker-model-right">
              <span className={'main-order-picker-product-stat'+(group.free===0?' empty':'')}>{group.free} свободно</span>
              <span className="main-order-picker-chevron">{selectedId===group.id?'Свернуть −':'Выбрать +'}</span>
            </span>
          </button>)}
        </div>

        {selectedGroup&&pair.some(group=>group.id===selectedGroup.id)&&
         <div className="main-order-picker-detail" data-picker-product-detail={selectedGroup.id}>
          <div className="main-order-picker-detail-head">
           <div><strong>{selectedGroup.name}</strong>
            <span>{selectedGroup.lines.length} вариантов · {selectedGroup.free} шт. свободно</span></div>
           <button className="main-order-picker-close" type="button" onClick={()=>setSelectedId(null)}>Закрыть ×</button>
          </div>
          {intent==='stock'&&selectedGroup.lines.length>availableLines.length&&
           <button className="main-order-picker-show-all" type="button" onClick={showAllVariants}>
             Нужного варианта нет? Показать остальные {selectedGroup.lines.length-availableLines.length} без свободного остатка
           </button>}
          {executions.length>0&&<>
           <div className="main-order-picker-execution-header">
             <strong>Исполнение</strong><small>Выберите нужный материал, длину и пол</small>
           </div>
           {executions.length<=6?
             <div className="main-order-picker-executions" role="group" aria-label="Исполнение товара">
              {executions.map(execution=><button type="button" key={execution.key}
                className={activeExecution?.key===execution.key?'active':''}
                aria-pressed={activeExecution?.key===execution.key}
                onClick={()=>{setExecutionKey(execution.key);setColor('');setVariantPage(0)}}>
                <strong>{execution.name}</strong><small>{execution.lines.length} вариантов{execution.free>0?' · '+execution.free+' свободно':''}</small>
              </button>)}
             </div>:
             <select className="main-order-picker-execution-select" aria-label="Исполнение товара"
              value={activeExecution?.key||''}
              onChange={e=>{setExecutionKey(e.target.value);setColor('');setVariantPage(0)}}>
              {executions.map(x=><option key={x.key} value={x.key}>{x.name} · {x.free} свободно</option>)}
             </select>}
           {colors.length>1&&<div className="main-order-picker-colors" role="group" aria-label="Цвет товара">
             <button type="button" className={!color?'active':''} aria-pressed={!color}
              onClick={()=>{setColor('');setVariantPage(0)}}>Все цвета</button>
             {colors.map(value=><button key={value} type="button" className={color===value?'active':''}
              aria-pressed={color===value}
              onClick={()=>{setColor(value);setVariantPage(0)}}>
              {value}
             </button>)}
           </div>}
           <div className="main-order-picker-detail-count">
            <span><strong>{matched.length}</strong> подходящих вариантов</span>
            {matched.length>VARIANT_PAGE_SIZE&&<span>Показаны {safeVariantPage*VARIANT_PAGE_SIZE+1}–{Math.min((safeVariantPage+1)*VARIANT_PAGE_SIZE,matched.length)}</span>}
           </div>
           {shownByColor.map(([name,choices])=><section className="main-order-picker-color-group" key={name}>
              {(!color||colors.length>1)&&<div className="main-order-picker-color-heading"><strong>{name}</strong><small>{choices.length} вариантов на странице</small></div>}
              <div className="main-order-picker-variants-grid">
                {choices.map(choice=>{
                  const balance=choice[source]
                  const free=freeAfterDraft(choice,source,allocated)
                  const chosen=allocated.get(pickerKey(source,choice.variantId))||0
                  return <article className="main-order-picker-variant" key={choice.variantId}>
                   <div className="main-order-picker-variant-top">
                    <strong>{choice.category==='child'?'Возраст':'Размер'} {choice.size||'—'}</strong>
                    <span className={free>0?'main-order-picker-free':'main-order-picker-zero'}>{free>0?free+' свободно':'Нет свободных'}</span>
                   </div>
                   <div className="main-order-picker-variant-stocks">
                    <span>{balance.free} из {balance.physical} свободно · {balance.reserved} в резерве</span>
                    {chosen>0&&<small>Уже добавлено в заказ: {chosen}</small>}
                    {balance.cachedReserved!==balance.reserved&&<small>Есть расхождение в учёте резервов</small>}
                    {(balance.physical<0||balance.reserved>balance.physical)&&<small className="main-order-picker-stock-warning">Остатки требуют сверки</small>}
                    <strong>{choice.salePrice===null?'Цена не указана':money(choice.salePrice)}</strong>
                   </div>
                   <div className="main-order-picker-actions">
                    <button type="button" className={free>0?'primary compact':'secondary compact'}
                      onClick={()=>onPick(choice,source,free<1)}>{free>0?'+ В заказ':'Из источника'}</button>
                    <button type="button" className="secondary compact" onClick={()=>onPick(choice,'workshop',false)}>В цех</button>
                   </div>
                  </article>
                })}
              </div>
            </section>)}
           {matched.length>VARIANT_PAGE_SIZE&&<div className="main-order-picker-pagination">
            <button type="button" className="secondary compact" disabled={safeVariantPage===0}
             onClick={()=>setVariantPage(page=>Math.max(0,page-1))}>Назад</button>
            <span>{safeVariantPage+1} / {variantPages}</span>
            <button type="button" className="secondary compact" disabled={safeVariantPage>=variantPages-1}
             onClick={()=>setVariantPage(page=>Math.min(variantPages-1,page+1))}>Далее</button>
           </div>}
           <small className="main-order-picker-detail-note">Даже при нулевом свободном остатке товар можно оформить из источника или направить в цех. Остатки при выборе не меняются.</small>
          </>}
         </div>}
      </Fragment>)}
    </div>
    {groups.length>PRODUCT_PAGE_SIZE&&<div className="main-order-picker-pagination main-order-picker-products-pages">
      <button type="button" className="secondary compact" disabled={safePage===0}
        onClick={()=>{setProductPage(p=>Math.max(0,p-1));setSelectedId(null);setFacets(emptyFacets());setVariantPage(0)}}>
        Предыдущие
      </button>
      <span>Страница {safePage+1} из {totalPages} · {groups.length} товаров</span>
      <button type="button" className="secondary compact" disabled={safePage>=totalPages-1}
        onClick={()=>{setProductPage(p=>Math.min(totalPages-1,p+1));setSelectedId(null);setFacets(emptyFacets());setVariantPage(0)}}>
        Следующие
      </button>
    </div>}
  </>}
 </div>
}
