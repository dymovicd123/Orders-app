import {Fragment,useEffect,useMemo,useState} from 'react'
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
}
export const pickerKey=(source:SourceKey,id:number)=>source+':'+id
export const freeAfterDraft=(choice:OrderPickerChoice,source:SourceKey,allocated:ReadonlyMap<string,number>)=>
 Math.max(0,choice[source].free-(allocated.get(pickerKey(source,choice.variantId))||0))
const clean=(s:string)=>String(s||'').toLocaleLowerCase('ru-RU').replace(/ё/g,'е').trim()
const labels=(x:OrderPickerChoice)=>[x.gender,x.color,x.material,x.length,x.size].filter(Boolean)
const money=(n:number)=>n.toLocaleString('ru-RU')+' ₸'
type FacetKey='gender'|'color'|'material'|'length'|'size'
type Facets=Record<FacetKey,string>
type ProductGroup={id:number;name:string;lines:OrderPickerChoice[];free:number;price:number|null}
const facetKeys:FacetKey[]=['color','size','gender','material','length']
const facetNames:Record<FacetKey,string>={color:'Цвет',size:'Размер',gender:'Пол',material:'Материал',length:'Длина'}
const emptyFacets=():Facets=>({color:'',size:'',gender:'',material:'',length:''})
export const PRODUCT_PAGE_SIZE=12
export const VARIANT_PAGE_SIZE=6
export const paginate=<T,>(values:readonly T[],page:number,perPage:number)=>values.slice(page*perPage,(page+1)*perPage)
export const filterOrderPickerVariants=(items:readonly OrderPickerChoice[],filters:Facets)=>
 items.filter(x=>facetKeys.every(key=>!filters[key]||clean(x[key])===clean(filters[key])))

/** Source-first browsing inspired by Client3, adapted to Main's warehouse/boutique/workshop. */
export function MainOrderSourcePicker({allocated,onPick,onManual,initialVariants}:Props){
 const [source,setSource]=useState<SourceKey>('warehouse')
 const [intent,setIntent]=useState<'stock'|'all'>('all')
 const [query,setQuery]=useState('')
 const [gender,setGender]=useState('')
 const [material,setMaterial]=useState('')
 const [selectedId,setSelectedId]=useState<number|null>(null)
 const [facets,setFacets]=useState<Facets>(emptyFacets)
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
 const shown=useMemo(()=>{
   const q=clean(query)
   return variants.filter(v=>v.variantId>0&&v.productId>0)
     .filter(v=>intent==='all'||freeAfterDraft(v,source,allocated)>0)
     .filter(v=>!gender||clean(v.gender)===clean(gender))
     .filter(v=>!material||clean(v.material)===clean(material))
     .filter(v=>!q||clean([v.productName,...labels(v)].join(' ')).includes(q))
 },[variants,source,intent,query,gender,material,allocated])
 const groups=useMemo(()=>{
  const byId=new Map<number,ProductGroup>()
  for(const item of shown){
    let group=byId.get(item.productId)
    if(!group){group={id:item.productId,name:item.productName,lines:[],free:0,price:null};byId.set(item.productId,group)}
    group.lines.push(item);group.free+=freeAfterDraft(item,source,allocated)
    if(item.salePrice!==null)group.price=group.price===null?item.salePrice:Math.min(group.price,item.salePrice)
  }
  return [...byId.values()].sort((a,b)=>a.name.localeCompare(b.name,'ru'))
 },[shown,source,allocated])
 const genders=[...new Set(variants.map(x=>x.gender).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ru'))
 const materials=[...new Set(variants.map(x=>x.material).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ru'))
 const totalPages=Math.max(1,Math.ceil(groups.length/PRODUCT_PAGE_SIZE))
 const safePage=Math.min(productPage,totalPages-1)
 const pageGroups=paginate(groups,safePage,PRODUCT_PAGE_SIZE)
 const gridRows=Array.from({length:Math.ceil(pageGroups.length/2)},(_,i)=>pageGroups.slice(i*2,i*2+2))
 const selectedGroup=pageGroups.find(g=>g.id===selectedId)
 const resetView=()=>{setSelectedId(null);setFacets(emptyFacets());setVariantPage(0);setProductPage(0)}
 const chooseModel=(id:number)=>{setSelectedId(old=>old===id?null:id);setFacets(emptyFacets());setVariantPage(0)}
 const facetOptions=selectedGroup?Object.fromEntries(facetKeys.map(key=>[
   key,[...new Set(selectedGroup.lines.map(x=>x[key]).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ru'))
 ])) as Record<FacetKey,string[]>:null
 const matched=selectedGroup?filterOrderPickerVariants(selectedGroup.lines,facets):[]
 const variantPages=Math.max(1,Math.ceil(matched.length/VARIANT_PAGE_SIZE))
 const safeVariantPage=Math.min(variantPage,variantPages-1)
 const visibleVariants=paginate(matched,safeVariantPage,VARIANT_PAGE_SIZE)
 const setFacet=(key:FacetKey,value:string)=>{setFacets(f=>({...f,[key]:value}));setVariantPage(0)}

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
    <input type="search" placeholder="Найти товар, цвет, размер…" aria-label="Поиск товара и характеристик"
      value={query} onChange={e=>{setQuery(e.target.value);resetView()}}/>
    <select aria-label="Пол" value={gender} onChange={e=>{setGender(e.target.value);resetView()}}>
      <option value="">Любой пол</option>{genders.map(x=><option key={x} value={x}>{x}</option>)}
    </select>
    <select aria-label="Материал" value={material} onChange={e=>{setMaterial(e.target.value);resetView()}}>
      <option value="">Любой материал</option>{materials.map(x=><option key={x} value={x}>{x}</option>)}
    </select>
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
              <div>
                <strong>Характеристики · {selectedGroup.name}</strong>
                <span>{selectedGroup.lines.length} вариантов · {selectedGroup.free} шт. свободно по системе</span>
              </div>
              <button type="button" className="main-order-picker-close" onClick={()=>setSelectedId(null)}>
                Закрыть <span aria-hidden="true">×</span>
              </button>
            </div>
            <div className="main-order-picker-facets" aria-label="Уточнить характеристики">
              {facetKeys.map(key=>facetOptions&&facetOptions[key].length>1&&
                <label key={key}>
                  <span>{facetNames[key]}</span>
                  <select aria-label={facetNames[key]} value={facets[key]}
                    onChange={e=>setFacet(key,e.target.value)}>
                    <option value="">Все {facetNames[key].toLocaleLowerCase('ru-RU')}</option>
                    {facetOptions[key].map(value=><option value={value} key={value}>{value}</option>)}
                  </select>
                </label>
              )}
              {facetKeys.some(key=>Boolean(facets[key]))&&
                <button type="button" className="main-order-picker-clear"
                  onClick={()=>{setFacets(emptyFacets());setVariantPage(0)}}>Сбросить фильтры</button>}
            </div>
            <div className="main-order-picker-detail-count" aria-live="polite">
              <span>Подходящих вариантов: <strong>{matched.length}</strong></span>
              {matched.length>VARIANT_PAGE_SIZE&&<span>
                Показаны {safeVariantPage*VARIANT_PAGE_SIZE+1}–{Math.min((safeVariantPage+1)*VARIANT_PAGE_SIZE,matched.length)}
              </span>}
            </div>
            {!matched.length&&<p className="main-order-picker-no-variants">Таких характеристик вместе нет. Измените фильтры.</p>}
            <div className="main-order-picker-variants-grid">
              {visibleVariants.map(choice=>{
                const balance=choice[source]
                const free=freeAfterDraft(choice,source,allocated)
                const selected=allocated.get(pickerKey(source,choice.variantId))||0
                return <article className="main-order-picker-variant" key={choice.variantId}>
                  <div className="main-order-picker-variant-top">
                    <strong>{[choice.gender,choice.color].filter(Boolean).join(' · ')||'Вариант каталога'}</strong>
                    <span className={free>0?'main-order-picker-free':'main-order-picker-zero'}>{free>0?free+' свободно':'Нет свободных'}</span>
                  </div>
                  <div className="main-order-picker-variant-tags">
                    {choice.material&&<span>{choice.material}</span>}
                    {choice.length&&<span>{choice.length}</span>}
                    {choice.size&&<span>Размер {choice.size}</span>}
                  </div>
                  <div className="main-order-picker-variant-stocks">
                    <span>{balance.free} из {balance.physical} свободно · {balance.reserved} в резерве</span>
                    {selected>0&&<small>В этот заказ добавлено: {selected}</small>}
                    {balance.cachedReserved!==balance.reserved&&<small>В учёте резервов есть расхождение</small>}
                    <strong>{choice.salePrice===null?'Цена не задана':money(choice.salePrice)}</strong>
                  </div>
                  <div className="main-order-picker-actions">
                    <button type="button" className={free>0?'primary compact':'secondary compact'}
                      onClick={()=>onPick(choice,source,free<1)}>
                      {free>0?'+ В заказ':'Из источника'}
                    </button>
                    <button type="button" className="secondary compact"
                      onClick={()=>onPick(choice,'workshop',false)}>В цех</button>
                  </div>
                </article>
              })}
            </div>
            {matched.length>VARIANT_PAGE_SIZE&&<div className="main-order-picker-pagination">
              <button type="button" className="secondary compact" disabled={safeVariantPage===0}
                onClick={()=>setVariantPage(p=>Math.max(0,p-1))}>Назад</button>
              <span>{safeVariantPage+1} / {variantPages}</span>
              <button type="button" className="secondary compact" disabled={safeVariantPage>=variantPages-1}
                onClick={()=>setVariantPage(p=>Math.min(variantPages-1,p+1))}>Далее</button>
            </div>}
            <small className="main-order-picker-detail-note">
              Если свободного остатка нет, товар всё равно можно оформить из источника или направить в цех. Остаток при выборе не меняется.
            </small>
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
