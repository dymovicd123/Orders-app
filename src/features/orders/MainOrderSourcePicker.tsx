import {useEffect,useMemo,useState} from 'react'
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

/** Source-first browsing inspired by Client3, adapted to Main's warehouse/boutique/workshop. */
export function MainOrderSourcePicker({allocated,onPick,onManual,initialVariants}:Props){
 const [source,setSource]=useState<SourceKey>('warehouse')
 const [intent,setIntent]=useState<'stock'|'all'>('stock')
 const [query,setQuery]=useState('')
 const [gender,setGender]=useState('')
 const [material,setMaterial]=useState('')
 const [open,setOpen]=useState<number|null>(null)
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
  const byId=new Map<number,{id:number;name:string;lines:OrderPickerChoice[];free:number}>()
  for(const item of shown){
    let group=byId.get(item.productId)
    if(!group){group={id:item.productId,name:item.productName,lines:[],free:0};byId.set(item.productId,group)}
    group.lines.push(item);group.free+=freeAfterDraft(item,source,allocated)
  }
  return [...byId.values()].sort((a,b)=>a.name.localeCompare(b.name,'ru'))
 },[shown,source,allocated])
 const genders=[...new Set(variants.map(x=>x.gender).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ru'))
 const materials=[...new Set(variants.map(x=>x.material).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ru'))
 return <div className="main-order-picker" data-order-source-picker="main">
  <div className="main-order-picker-top">
   <div className="main-order-picker-section">
    <span className="main-order-picker-caption">Источник товара</span>
    <div className="main-order-picker-tabs" role="group" aria-label="Источник товара">
      {(['warehouse','boutique'] as const).map(key=><button key={key} type="button"
       className={source===key?'active':''} aria-pressed={source===key}
       onClick={()=>{setSource(key);setOpen(null)}}>{key==='warehouse'?'Склад':'Бутик'}</button>)}
    </div>
   </div>
   <div className="main-order-picker-section">
    <span className="main-order-picker-caption">Показывать</span>
    <div className="main-order-picker-tabs" role="group" aria-label="Товары по наличию">
      <button type="button" className={intent==='stock'?'active':''} aria-pressed={intent==='stock'} onClick={()=>{setIntent('stock');setOpen(null)}}>Свободные</button>
      <button type="button" className={intent==='all'?'active':''} aria-pressed={intent==='all'} onClick={()=>{setIntent('all');setOpen(null)}}>Весь каталог</button>
    </div>
   </div>
   <button type="button" className="main-order-picker-manual" onClick={onManual}>+ Индивидуальный заказ в цех</button>
  </div>
  <div className="main-order-picker-filters">
    <input type="search" placeholder="Найти товар, цвет, размер…" aria-label="Поиск товара и характеристик"
      value={query} onChange={e=>setQuery(e.target.value)}/>
    <select aria-label="Пол" value={gender} onChange={e=>setGender(e.target.value)}>
      <option value="">Любой пол</option>{genders.map(x=><option key={x} value={x}>{x}</option>)}
    </select>
    <select aria-label="Материал" value={material} onChange={e=>setMaterial(e.target.value)}>
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
  {!loading&&!error&&<div className="main-order-picker-groups">
    {groups.map(group=><section className="main-order-picker-product" key={group.id}>
      <button type="button" className="main-order-picker-product-head"
        aria-expanded={open===group.id} onClick={()=>setOpen(old=>old===group.id?null:group.id)}>
        <span className="main-order-picker-product-name"><strong>{group.name}</strong><small>{group.lines.length} вариантов</small></span>
        <span className="main-order-picker-product-stat">{group.free} шт. свободно</span>
        <span className="main-order-picker-chevron">{open===group.id?'Свернуть −':'Выбрать +'}</span>
      </button>
      {open===group.id&&<div className="main-order-picker-variants">
        {group.lines.map(choice=>{
          const balance=choice[source]
          const free=freeAfterDraft(choice,source,allocated)
          const selected=allocated.get(pickerKey(source,choice.variantId))||0
          return <div className="main-order-picker-variant" key={choice.variantId}>
            <div className="main-order-picker-variant-details">
              <strong>{labels(choice).join(' · ')||'Без характеристик'}</strong>
              <span className={free>0?'main-order-picker-free':'main-order-picker-zero'}>
                {balance.free} из {balance.physical} свободно по системе
                {selected>0?` · ${selected} выбрано в этот заказ`:''}
              </span>
              <small>{balance.reserved>0?`${balance.reserved} шт. занято резервами`:'Резервов нет'}
                {balance.cachedReserved!==balance.reserved?' · В учёте резервов есть расхождение':''}
                {choice.salePrice===null?' · Цена не задана':' · '+money(choice.salePrice)}
              </small>
              {free===0&&<small className="main-order-picker-shortage">
                Свободного остатка нет. Можно оформить из источника с отметкой нехватки или передать этот вариант в цех.
              </small>}
            </div>
            <div className="main-order-picker-actions">
              <button type="button" className={free>0?'primary compact':'secondary compact'}
                onClick={()=>onPick(choice,source,free<1)}>
                {free>0?'+ В заказ':'Оформить из источника'}
              </button>
              <button type="button" className="secondary compact"
                onClick={()=>onPick(choice,'workshop',false)}>В цех</button>
            </div>
          </div>
        })}
      </div>}
    </section>)}
  </div>}
 </div>
}
