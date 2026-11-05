import {useMemo,useState} from 'react'
import {WATCH_OPTIONS,type WatchBrand,type WatchSource} from '../../../shared/client3/watch-domain'
import type {WatchOrderChoice} from './WatchOrderForm'

type Intent='stock'|'preorder'
type Props={
 brand:WatchBrand;source:WatchSource;onSourceChange:(value:WatchSource)=>void;
 catalog:readonly WatchOrderChoice[];allocated:ReadonlyMap<string,number>;
 onAdd:(choice:WatchOrderChoice,intent:Intent,source:WatchSource)=>void;
 onManual:(source:WatchSource)=>void;
}
export const stockKey=(source:WatchSource,variantId:number)=>source+':'+variantId
export const sourceAvailable=(choice:WatchOrderChoice,source:WatchSource)=>
 Math.max(0,Number(source==='office'?choice.officePhysical-choice.officeReserved:
   choice.showcasePhysical-choice.showcaseReserved)||0)
export const watchLabels=(x:WatchOrderChoice)=>[
 WATCH_OPTIONS.genders.find(y=>y.value===x.gender)?.label||x.gender,
 WATCH_OPTIONS.movements.find(y=>y.value===x.movement)?.label||x.movement,
 WATCH_OPTIONS.braceletMaterials.find(y=>y.value===x.braceletMaterial)?.label||x.braceletMaterial,
 WATCH_OPTIONS.dialColors.find(y=>y.value===x.dialColor)?.label||x.dialColor,
 ...(x.braceletColor?[x.braceletColor]:[]),
]
const compact=(s:string)=>s.toLocaleLowerCase('ru-RU').replace(/ё/g,'е').trim()
const money=(n:number)=>n.toLocaleString('ru-RU')+' ₸'

export function WatchOrderSourcePicker({brand,source,onSourceChange,catalog,allocated,onAdd,onManual}:Props){
 const [intent,setIntent]=useState<Intent>('stock')
 const [search,setSearch]=useState('')
 const [gender,setGender]=useState('all')
 const [material,setMaterial]=useState('all')
 const [expanded,setExpanded]=useState<number|null>(null)
 const list=useMemo(()=>{
   const q=compact(search)
   return catalog.filter(x=>x.brand===brand&&x.catalogVariantId>0&&x.watchVariantId>0)
    .filter(x=>intent==='preorder'||sourceAvailable(x,source)>0)
    .filter(x=>gender==='all'||x.gender===gender)
    .filter(x=>material==='all'||x.braceletMaterial===material)
    .filter(x=>!q||compact([x.modelName,...watchLabels(x)].join(' ')).includes(q))
 },[brand,catalog,source,intent,search,gender,material])
 const models=useMemo(()=>{
   const groups=new Map<number,{id:number;name:string;variants:WatchOrderChoice[];available:number;price:number|null}>()
   for(const x of list){
     let g=groups.get(x.watchProductId)
     if(!g){g={id:x.watchProductId,name:x.modelName,variants:[],available:0,price:null};groups.set(x.watchProductId,g)}
     g.variants.push(x)
     g.available+=Math.max(0,sourceAvailable(x,source)-(allocated.get(stockKey(source,x.watchVariantId))||0))
     if(x.catalogPriceSnapshot!=null)g.price=g.price===null?x.catalogPriceSnapshot:Math.min(g.price,x.catalogPriceSnapshot)
   }
   return [...groups.values()].sort((a,b)=>a.name.localeCompare(b.name,'ru'))
 },[list,source,allocated])
 return <div className="watch-pick" data-client3-stock-picker="true">
   <div className="watch-pick-top">
     <div className="watch-pick-source">
       <span className="watch-pick-eyebrow">Откуда берём часы</span>
       <div className="watch-pick-segment" role="group" aria-label="Источник товара">
         {(['office','showcase'] as const).map(key=><button key={key} type="button"
           aria-pressed={source===key} className={source===key?'selected':''}
           onClick={()=>{onSourceChange(key);setExpanded(null)}}>
           {key==='office'?'Офис':'Витрина'}</button>)}
       </div>
     </div>
     <div className="watch-pick-intents" role="group" aria-label="Способ выбора товара">
       <button type="button" aria-pressed={intent==='stock'} className={intent==='stock'?'selected':''}
         onClick={()=>{setIntent('stock');setExpanded(null)}}>Из наличия</button>
       <button type="button" aria-pressed={intent==='preorder'} className={intent==='preorder'?'selected':''}
         onClick={()=>{setIntent('preorder');setExpanded(null)}}>Под заказ</button>
     </div>
   </div>
   <div className="watch-pick-toolbar">
     <label className="watch-pick-search">
       <span className="sr-only">Поиск модели или характеристик</span>
       <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 5 5"/></svg>
       <input type="search" placeholder="Поиск модели, цвета, браслета…" value={search}
         onChange={e=>setSearch(e.target.value)}/>
     </label>
     <label className="watch-pick-filter"><span>Пол</span>
       <select value={gender} onChange={e=>setGender(e.target.value)}>
         <option value="all">Любой</option>
         {WATCH_OPTIONS.genders.map(x=><option key={x.value} value={x.value}>{x.label}</option>)}
       </select>
     </label>
     <label className="watch-pick-filter"><span>Браслет</span>
       <select value={material} onChange={e=>setMaterial(e.target.value)}>
         <option value="all">Любой</option>
         {WATCH_OPTIONS.braceletMaterials.map(x=><option key={x.value} value={x.value}>{x.label}</option>)}
       </select>
     </label>
   </div>
   <div className="watch-pick-results" aria-live="polite">
     <span>{intent==='stock'?'Модели с доступными часами':'Известные комплектации'}: <strong>{models.length}</strong></span>
     <span>{source==='office'?'Офис':'Витрина'} · {intent==='stock'?'только свободный остаток':'можно заказать без остатка'}</span>
   </div>
   {!models.length?<div className="watch-pick-empty">
     <strong>{intent==='stock'?'По выбранным условиям свободных часов нет':'Не нашли подходящую комплектацию?'}</strong>
     <p>{intent==='stock'?'Выберите другой источник или оформите под заказ. Отсутствующие варианты не показываются как доступные.':'Можно вручную указать модель и все характеристики — заказ сохранится без выдуманного остатка.'}</p>
     <button type="button" className="secondary" onClick={()=>intent==='stock'?setIntent('preorder'):onManual(source)}>
       {intent==='stock'?'Посмотреть варианты под заказ':'Ввести характеристики вручную'}</button>
   </div>:<div className="watch-pick-models">
     {models.map(group=><section className={'watch-pick-model'+(expanded===group.id?' expanded':'')} key={group.id}>
       <button type="button" className="watch-pick-model-head"
         onClick={()=>setExpanded(old=>old===group.id?null:group.id)}
         aria-expanded={expanded===group.id}>
         <span className="watch-pick-watch" aria-hidden="true"><span className="watch-pick-watch-face"><span/></span></span>
         <span className="watch-pick-model-main">
           <strong>{group.name}</strong>
           <small>{group.variants.length} {group.variants.length===1?'комплектация':'комплектации'} · {intent==='stock'?'в наличии':'каталог'}</small>
           {group.price!==null&&<span className="watch-pick-price">от {money(group.price)}</span>}
         </span>
         <span className="watch-pick-model-right">
           {intent==='stock'&&<span className="watch-pick-balance">{group.available} свободно</span>}
           <span className="watch-pick-reveal">{expanded===group.id?'Свернуть':'Выбрать'} <span aria-hidden="true">{expanded===group.id?'−':'+'}</span></span>
         </span>
       </button>
       {expanded===group.id&&<div className="watch-pick-variants">
         {group.variants.map(x=>{
           const remaining=Math.max(0,sourceAvailable(x,source)-(allocated.get(stockKey(source,x.watchVariantId))||0))
           const canAdd=intent==='preorder'||remaining>0
           return <div className="watch-pick-variant" key={x.watchVariantId}>
             <div className="watch-pick-variant-copy">
               <strong>{watchLabels(x).slice(0,2).join(' · ')}</strong>
               <span>{watchLabels(x).slice(2).join(' · ')}</span>
               <small>{intent==='stock'?remaining+' шт. доступно':remaining>0?'Свободно '+remaining+' шт.':'Нет свободного остатка'}{x.catalogPriceSnapshot==null?'':' · '+money(x.catalogPriceSnapshot)}</small>
             </div>
             <button type="button" className={intent==='stock'?'primary compact':'secondary compact'}
               disabled={!canAdd} onClick={()=>onAdd(x,intent,source)}>
               {intent==='stock'?remaining>0?'+ В заказ':'Уже выбрано':'+ Под заказ'}
             </button>
           </div>
         })}
       </div>}
     </section>)}
   </div>}
   <div className="watch-pick-footer">
     <span>Нет нужной модели или характеристик?</span>
     <button type="button" className="secondary compact" onClick={()=>onManual(source)}>
       + Ввести вручную</button>
   </div>
 </div>
}
