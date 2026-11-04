import {useEffect,useMemo,useState,type CSSProperties} from 'react'
import {watchReferenceLabel,type WatchBrand} from '../../../shared/client3/watch-domain'
import '../inventory/views/inventory-demand-statistics.css'
import '../../styles/client3-watch-demand-main.css'

type RawRow={
 variantId:number;model:string;gender:string;movement:string;bracelet:string;
 dialColor:string;braceletColor:string;orderCount:number;
 sold:number;returned:number;net:number;amount:number;pricedQuantity:number;
 minPrice:number;maxPrice:number
}
type DisplayRow=RawRow&{
 modelLabel:string;dialLabel:string;braceletLabel:string;
 movementLabel:string;genderLabel:string;strapColorLabel:string
}
type Dimension='modelLabel'|'dialLabel'|'braceletLabel'|'movementLabel'|'genderLabel'|'strapColorLabel'
type Scope='orders'|'shipped'
type Selection={kind:Dimension;name:string}
type Summary={name:string;sold:number;net:number;returned:number;amount:number;priced:number}
type Report={ok:boolean;message?:string;rows:RawRow[];truncated?:boolean;
 totals:{orderCount:number;sold:number;returned:number;net:number;amount:number;variants:number}}
type OrderLine={itemId:number;orderId:number;externalId:string;orderDate:string;
 shippedAt:string|null;orderTotal:number;sold:number;returned:number;net:number;
 unitPrice:number;amount:number;sentAll:number}
type Detail={ok:boolean;message?:string;orders:OrderLine[];hasMore:boolean}
const count=(n:number)=>Number(n||0).toLocaleString('ru-RU')
const money=(n:number)=>Math.round(Number(n||0)).toLocaleString('ru-RU')+' ₸'
const pct=(value:number,total:number)=>total?Math.round(value/total*100)+'%':'—'
const labels:Record<Dimension,string>={
 modelLabel:'Модели',dialLabel:'Цвета циферблата',braceletLabel:'Браслеты',
 movementLabel:'Механизмы',genderLabel:'Тип часов',strapColorLabel:'Цвет ремешка'
}
const date=(d:Date)=>[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')
const thisMonth=()=>date(new Date()).slice(0,7)
const datesForMonth=(m:string)=>{
 const [y,month]=m.split('-').map(Number)
 return {start:date(new Date(y,month-1,1)),end:date(new Date(y,month,0))}
}
const adjacentMonth=(m:string,delta:number)=>{
 const [y,month]=m.split('-').map(Number)
 return date(new Date(y,month-1+delta,1)).slice(0,7)
}
const prettyMonth=(m:string)=>{
 const [y,month]=m.split('-').map(Number)
 return new Intl.DateTimeFormat('ru-RU',{month:'long',year:'numeric'}).format(new Date(y,month-1,1))
}
const readable=(kind:'movements'|'bracelets'|'dials'|'leatherColors',raw:string)=>{
 if(!raw)return 'Не указано'
 return watchReferenceLabel(kind,raw)||raw
}
const project=(raw:RawRow):DisplayRow=>({
 ...raw,
 modelLabel:raw.model||'Без названия',
 dialLabel:readable('dials',raw.dialColor),
 braceletLabel:readable('bracelets',raw.bracelet),
 movementLabel:readable('movements',raw.movement),
 genderLabel:raw.gender==='male'?'Мужские':raw.gender==='female'?'Женские':'Без типа',
 strapColorLabel:raw.braceletColor?readable('leatherColors',raw.braceletColor):'Без дополнительного цвета'
})
const empty=():Summary=>({name:'Всего',sold:0,returned:0,net:0,amount:0,priced:0})
const total=(rows:DisplayRow[]):Summary=>rows.reduce((t,r)=>({
 name:'Всего',sold:t.sold+Number(r.sold||0),returned:t.returned+Number(r.returned||0),
 net:t.net+Number(r.net||0),amount:t.amount+Number(r.amount||0),
 priced:t.priced+Number(r.pricedQuantity||0)
}),empty())
const ranking=(rows:DisplayRow[],kind:Dimension):Summary[]=>{
 const map=new Map<string,Summary>()
 for(const row of rows){
   const name=row[kind]
   const item=map.get(name)||{...empty(),name}
   item.sold+=Number(row.sold||0)
   item.returned+=Number(row.returned||0)
   item.net+=Number(row.net||0)
   item.amount+=Number(row.amount||0)
   item.priced+=Number(row.pricedQuantity||0)
   map.set(name,item)
 }
 return [...map.values()].sort((a,b)=>b.net-a.net||b.sold-a.sold||a.name.localeCompare(b.name,'ru'))
}
const avg=(s:Summary)=>s.priced?money(s.amount/s.priced):'Нет цены'
const attrs=(r:DisplayRow)=>[
 r.dialLabel,r.braceletLabel,r.movementLabel,r.genderLabel,
 ...(r.braceletColor?[r.strapColorLabel]:[])
].join(' · ')

/** Client3 version of Main's InventoryDemandStatistics.
 * All ranking metrics are computed from complete, brand-scoped variant rows;
 * genuine logistics dispatches are the only source for the 'shipped' scope.
 */
export function WatchDemandMainPanel({brand}:{brand:WatchBrand}){
 const [month,setMonth]=useState(thisMonth)
 const [period,setPeriod]=useState(()=>datesForMonth(thisMonth()))
 const [custom,setCustom]=useState(false)
 const [customStart,setCustomStart]=useState(()=>datesForMonth(thisMonth()).start)
 const [customEnd,setCustomEnd]=useState(()=>date(new Date()))
 const [scope,setScope]=useState<Scope>('orders')
 const [gender,setGender]=useState('all')
 const [movement,setMovement]=useState('all')
 const [query,setQuery]=useState('')
 const [showAll,setShowAll]=useState<Dimension|null>(null)
 const [selection,setSelection]=useState<Selection|null>(null)
 const [pickedModel,setPickedModel]=useState<string|null>(null)
 const [pickedVariant,setPickedVariant]=useState<DisplayRow|null>(null)
 const [result,setResult]=useState<Report|null>(null)
 const [loading,setLoading]=useState(true)
 const [error,setError]=useState('')
 const [refresh,setRefresh]=useState(0)
 const [orders,setOrders]=useState<OrderLine[]>([])
 const [orderPage,setOrderPage]=useState(0)
 const [orderMore,setOrderMore]=useState(false)
 const [orderBusy,setOrderBusy]=useState(false)
 const [orderError,setOrderError]=useState('')
 const clearDetail=()=>{
   setSelection(null);setPickedModel(null);setPickedVariant(null)
   setOrders([]);setOrderPage(0);setOrderError('')
 }
 const changeMonth=(m:string)=>{setMonth(m);setPeriod(datesForMonth(m));setCustom(false);clearDetail()}
 const openGroup=(kind:Dimension,name:string)=>{
   setSelection({kind,name});setPickedModel(null);setPickedVariant(null)
   setOrders([]);setOrderPage(0)
 }
 const back=()=>{
   if(pickedVariant){setPickedVariant(null);setOrders([]);setOrderPage(0)}
   else if(pickedModel!==null&&selection?.kind!=='modelLabel')setPickedModel(null)
   else clearDetail()
 }
 useEffect(()=>{
   const ctrl=new AbortController()
   const params=new URLSearchParams({brand,start:period.start,end:period.end,scope})
   setLoading(true);setResult(null);setError('')
   void fetch('/api/client3/watches/stock/demand-report?'+params,{
     credentials:'include',cache:'no-store',signal:ctrl.signal
   }).then(async r=>{
     const j=await r.json() as Report
     if(!r.ok||!j.ok)throw Error(j.message||'Не удалось загрузить статистику часов.')
     if(!ctrl.signal.aborted)setResult(j)
   }).catch(e=>{if(!ctrl.signal.aborted)setError(e instanceof Error?e.message:'Ошибка расчёта статистики.')})
     .finally(()=>{if(!ctrl.signal.aborted)setLoading(false)})
   return ()=>ctrl.abort()
 },[brand,period.start,period.end,scope,refresh])
 const rows=useMemo(()=>(result?.rows||[]).map(project),[result])
 const options=useMemo(()=>[...new Set(rows.map(r=>r.movement))].filter(Boolean),[rows])
 const filtered=useMemo(()=>rows.filter(row=>
   (gender==='all'||row.gender===gender)&&
   (movement==='all'||row.movement===movement)),[rows,gender,movement])
 const totals=useMemo(()=>total(filtered),[filtered])
 const models=useMemo(()=>ranking(filtered,'modelLabel'),[filtered])
 const dialColors=useMemo(()=>ranking(filtered,'dialLabel'),[filtered])
 const bracelets=useMemo(()=>ranking(filtered,'braceletLabel'),[filtered])
 const mechanisms=useMemo(()=>ranking(filtered,'movementLabel'),[filtered])
 const genders=useMemo(()=>ranking(filtered,'genderLabel'),[filtered])
 const strapColors=useMemo(()=>ranking(filtered.filter(row=>Boolean(row.braceletColor)),'strapColorLabel'),[filtered])
 const visibleModels=useMemo(()=>models.filter(m=>m.name.toLocaleLowerCase('ru-RU')
   .includes(query.trim().toLocaleLowerCase('ru-RU'))),[models,query])
 const focus=useMemo(()=>selection?filtered.filter(row=>row[selection.kind]===selection.name):[],[selection,filtered])
 const focusModels=useMemo(()=>ranking(focus,'modelLabel'),[focus])
 const detailModel=selection?.kind==='modelLabel'?selection.name:
   pickedModel||(focusModels.length===1?focusModels[0].name:null)
 const variants=useMemo(()=>detailModel===null?[]:
   focus.filter(r=>r.modelLabel===detailModel)
     .sort((a,b)=>b.net-a.net||a.dialLabel.localeCompare(b.dialLabel,'ru')),[focus,detailModel])
 const focusSummary=useMemo(()=>total(focus),[focus])

 useEffect(()=>{
   if(!pickedVariant)return
   const ctrl=new AbortController()
   const params=new URLSearchParams({
     brand,start:period.start,end:period.end,scope,
     mode:'orders',variantId:String(pickedVariant.variantId),offset:String(orderPage*50)
   })
   setOrderBusy(true);setOrderError('')
   if(orderPage===0)setOrders([])
   void fetch('/api/client3/watches/stock/demand-report?'+params,{
     credentials:'include',cache:'no-store',signal:ctrl.signal
   }).then(async r=>{
     const j=await r.json() as Detail
     if(!r.ok||!j.ok)throw Error(j.message||'Не удалось получить позиции заказов.')
     if(!ctrl.signal.aborted){
       setOrders(old=>orderPage?[...old,...(j.orders||[])]:j.orders||[])
       setOrderMore(Boolean(j.hasMore))
     }
   }).catch(e=>{if(!ctrl.signal.aborted)setOrderError(e instanceof Error?e.message:'Ошибка детализации.')})
     .finally(()=>{if(!ctrl.signal.aborted)setOrderBusy(false)})
   return ()=>ctrl.abort()
 },[brand,period.start,period.end,scope,pickedVariant?.variantId,orderPage])

 function analysisCard(kind:Dimension,items:Summary[],limit:number){
   const visible=showAll===kind?items:items.slice(0,limit)
   const max=Math.max(1,...items.map(x=>x.net))
   return <section className="demand-card" key={kind}>
     <header className="demand-card-heading"><h3>{labels[kind]}</h3>
       <span>{items.length} {kind==='modelLabel'?'моделей':'значений'}</span></header>
     <div className="demand-card-list">
       {visible.length===0?<p className="demand-empty">Нет данных за выбранный период</p>:
         visible.map((item,i)=><button type="button" key={item.name}
           className="demand-rank-row" onClick={()=>openGroup(kind,item.name)}>
           <span className="demand-rank-id">{i+1}</span>
           <span className="demand-rank-info">
             <strong>{item.name}</strong>
             <span className="demand-progress"><span
               style={{'--demand-width':Math.max(0,item.net)/max*100+'%'} as CSSProperties}/></span>
             <small>{count(item.net)} шт. · {pct(item.net,totals.net)} · средняя {avg(item)}</small>
           </span>
           <span className="demand-rank-action">Подробнее →</span>
         </button>)}
     </div>
     {items.length>limit&&<button type="button" className="demand-show-more"
       onClick={()=>setShowAll(showAll===kind?null:kind)}>
       {showAll===kind?'Свернуть':'Показать все '+items.length} ↓
     </button>}
   </section>
 }
 return <section className="demand-page watch-demand-main" aria-label={'Подробная статистика часов '+brand}>
   <header className="demand-top"><div>
     <span className="demand-eyebrow">СТАТИСТИКА СКЛАДА · {brand}</span>
     <h2>Какие часы пользуются спросом</h2>
     <p>Рейтинги моделей, характеристик и цен по образцу Main. Все показатели относятся только к выбранному бренду.</p>
   </div>
     <button className="demand-refresh" type="button" disabled={loading}
       onClick={()=>setRefresh(v=>v+1)}>↻ Обновить</button>
   </header>
   <div className="demand-scope" aria-label="Что учитывается">
     <button type="button" aria-pressed={scope==='orders'}
       className={scope==='orders'?'is-active':''} onClick={()=>{setScope('orders');clearDetail()}}>
       <span className="demand-scope-title">Все оформленные заказы</span>
       <span className="demand-scope-note">Спрос по дате заказа, в том числе часы, ожидающие логистику</span>
     </button>
     <button type="button" aria-pressed={scope==='shipped'}
       className={scope==='shipped'?'is-active':''} onClick={()=>{setScope('shipped');clearDetail()}}>
       <span className="demand-scope-title">Только фактически отправленные часы</span>
       <span className="demand-scope-note">По дате и количеству отправки в логистике, за вычетом отменённых отправок</span>
     </button>
   </div>
   <div className="demand-period">
     <div className="demand-month">
       <button type="button" aria-label="Предыдущий месяц" onClick={()=>changeMonth(adjacentMonth(month,-1))}>←</button>
       <strong>{custom?'Выбранный период':prettyMonth(month)}</strong>
       <button type="button" aria-label="Следующий месяц" onClick={()=>changeMonth(adjacentMonth(month,1))}>→</button>
     </div>
     <div className="demand-period-buttons">
       <button type="button" onClick={()=>changeMonth(thisMonth())}>Этот месяц</button>
       <button type="button" className={custom?'is-current':''} onClick={()=>setCustom(v=>!v)}>Свой период</button>
     </div>
     {custom&&<form className="demand-custom-dates" onSubmit={e=>{
       e.preventDefault()
       if(customStart<=customEnd&&/^\d{4}-\d{2}-\d{2}$/.test(customStart)&&/^\d{4}-\d{2}-\d{2}$/.test(customEnd)){
         setPeriod({start:customStart,end:customEnd});setError('');clearDetail()
       }else setError('Проверьте период.')
     }}>
       <label>Начало<input type="date" value={customStart} onChange={e=>setCustomStart(e.target.value)}/></label>
       <label>Конец<input type="date" value={customEnd} onChange={e=>setCustomEnd(e.target.value)}/></label>
       <button type="submit">Применить</button>
     </form>}
     <span className="demand-date-caption">{period.start} — {period.end}</span>
   </div>
   {loading&&<div role="status" className="demand-notice">Загружаем рейтинги часов…</div>}
   {error&&<div role="alert" className="demand-notice">{error}</div>}
   {result?.truncated&&<div role="alert" className="demand-notice">
     Комплектаций больше 2000. Рейтинг скрыт, чтобы не показывать неполные данные. Сократите период.
   </div>}
   {result&&!result.truncated&&!loading&&<>
     <div className="demand-explain"><span className="demand-explain-dot" aria-hidden="true"/>
       {scope==='orders'?
         'Все позиции действующих заказов по дате оформления, включая неотправленные часы.':
         'Только фактические отправки по данным логистики. Отменённые отправки исключаются.'}
       <span className="demand-explain-counter">Заказов в выборке: {count(result.totals.orderCount||0)}</span>
     </div>
     <div className="demand-kpis">
       <div><small>{scope==='orders'?'Заказано часов':'Отправлено часов'}</small><strong>{count(totals.sold)} шт.</strong></div>
       <div><small>После товарных возвратов</small><strong>{count(totals.net)} шт.</strong></div>
       <div><small>Стоимость по ценам позиций</small><strong>{money(totals.amount)}</strong></div>
       <div><small>Средняя цена часов</small><strong>{totals.priced?avg(totals):'Нет данных'}</strong></div>
     </div>
     <div className="demand-smallprint">
       Возвращено товаров: {count(totals.returned)} шт. ·
       Сохранённая цена позиции учитывается для {count(totals.priced)} шт.
       {' '}<details><summary>Как рассчитываем?</summary><p>
         Суммы — стоимость товарных позиций по записанным ценам после товарных возвратов,
         а не кассовые поступления или прибыль. Отменённые возвраты исключаются.
         В режиме отправки учитываются исключительно подтверждённые в логистике движения;
         состояние возвратов берётся на момент просмотра и может менять исторические итоги.
         После обменов текущий состав заказа может отличаться от первоначального.
       </p></details>
     </div>
     <details className="demand-filters">
       <summary><strong>Уточнить выборку</strong><span>Тип часов и механизм</span></summary>
       <p>Фильтры пересчитывают все цифры, рейтинги и суммы на этой странице. Для Client3 источник один — офис.</p>
       <div className="demand-filter-fields">
         <label>Тип часов
           <select value={gender} onChange={e=>{setGender(e.target.value);clearDetail()}}>
             <option value="all">Мужские и женские</option><option value="male">Мужские</option>
             <option value="female">Женские</option>
           </select>
         </label>
         <label>Механизм
           <select value={movement} onChange={e=>{setMovement(e.target.value);clearDetail()}}>
             <option value="all">Все механизмы</option>
             {options.map(o=><option key={o} value={o}>{readable('movements',o)}</option>)}
           </select>
         </label>
         {(gender!=='all'||movement!=='all')&&
           <button type="button" onClick={()=>{setGender('all');setMovement('all');clearDetail()}}>Сбросить</button>}
       </div>
     </details>
     <div className="demand-section-title"><div>
       <h3>{scope==='orders'?'Что чаще всего заказывают':'Какие часы фактически отправляют'}</h3>
       <p>«Подробнее» открывает характеристики, комплектации и конкретные позиции заказов.</p>
     </div></div>
     <div className="demand-main-grid">
       <div className="demand-main-left">
         <label className="demand-model-search">Найти модель в рейтинге
           <input type="search" value={query} placeholder="Введите название модели"
             onChange={e=>setQuery(e.target.value)}/>
         </label>
         {analysisCard('modelLabel',visibleModels,10)}
         <p className="demand-search-help">Поиск меняет только список моделей, не общие показатели.</p>
       </div>
       <div className="demand-secondary">
         {analysisCard('dialLabel',dialColors,5)}
         {analysisCard('braceletLabel',bracelets,5)}
       </div>
     </div>
     <div className="demand-subsection"><h3>Другие характеристики часов</h3>
       <p>Механизм, тип часов и цвет кожаного ремешка — дополнительная структура спроса.</p>
     </div>
     <div className="demand-other-grid">
       {analysisCard('movementLabel',mechanisms,5)}
       {analysisCard('genderLabel',genders,5)}
       {analysisCard('strapColorLabel',strapColors,5)}
     </div>
   </>}
   {selection&&<div className="demand-dialog-root">
     <button type="button" className="demand-dialog-scrim" aria-label="Закрыть статистику" onClick={clearDetail}/>
     <aside className="demand-dialog" role="dialog" aria-modal="true" aria-label="Детализация статистики часов">
       <div className="demand-dialog-toolbar">
         <button type="button" className="demand-back" onClick={back}>
           {pickedVariant?'← К комплектациям':pickedModel!==null?'← К моделям':'← К статистике'}
         </button>
         <button type="button" className="demand-close" aria-label="Закрыть подробности" onClick={clearDetail}>×</button>
       </div>
       <div className="demand-dialog-body">
         {pickedVariant?<>
           <span className="demand-eyebrow">ПОЗИЦИИ ЗАКАЗОВ · {brand}</span>
           <h2>{pickedVariant.modelLabel}</h2>
           <p className="demand-dialog-sub">{attrs(pickedVariant)}</p>
           {orderError&&<p role="alert">{orderError}</p>}
           {orderBusy&&!orders.length&&<p role="status">Загружаем позиции…</p>}
           {orders.map(item=><article key={item.itemId} className="demand-order">
             <strong>{item.externalId||'Заказ №'+item.orderId}</strong>
             <small>{scope==='shipped'?'Отправлено '+(item.shippedAt||'без даты'):'Оформлено '+item.orderDate}</small>
             <div><b>{count(item.net)} шт. после возвратов</b>
               <span>{money(item.unitPrice)} / шт.</span></div>
             <small>Учитываемая стоимость: {money(item.amount)} · Возвращено: {count(item.returned)} шт.</small>
           </article>)}
           {!orderBusy&&orders.length===0&&!orderError&&<p>Позиции не найдены.</p>}
           {orderMore&&<button type="button" className="demand-download" disabled={orderBusy}
             onClick={()=>setOrderPage(v=>v+1)}>Показать ещё позиции</button>}
         </>:<>
           <span className="demand-eyebrow">{labels[selection.kind].toUpperCase()} · {brand}</span>
           <h2>{detailModel||selection.name}</h2>
           {selection.kind!=='modelLabel'&&
             <p className="demand-dialog-sub">Выбрано: {selection.name}{detailModel?' · '+detailModel:''}</p>}
           <div className="demand-dialog-metrics">
             <span><b>{count(focusSummary.net)}</b> часов без возвратов</span>
             <span><b>{count(focusSummary.returned)}</b> возвратов</span>
             <span><b>{money(focusSummary.amount)}</b> стоимость позиций</span>
           </div>
           {detailModel===null?<><h3>В каких моделях встречается {selection.name.toLowerCase()}?</h3>
             <div className="demand-dialog-models">
               {focusModels.map(m=><button type="button" key={m.name} onClick={()=>setPickedModel(m.name)}>
                 <span><strong>{m.name}</strong><small>Средняя цена: {avg(m)}</small></span>
                 <b>{count(m.net)} шт. →</b></button>)}
             </div>
           </>:<>
             <h3>Какие комплектации выбирали</h3>
             <p className="demand-dialog-hint">Откройте комплектацию, чтобы увидеть конкретные заказы и цены.</p>
             <div className="demand-dialog-variants">
               {variants.map(row=><button type="button" key={row.variantId} onClick={()=>{
                 setPickedVariant(row);setOrders([]);setOrderPage(0)
               }}>
                 <span><strong>{row.dialLabel} · {row.braceletLabel}</strong>
                   <small>{row.movementLabel} · {row.genderLabel}{row.braceletColor?' · '+row.strapColorLabel:''}</small>
                   <small>Средняя цена: {row.pricedQuantity?money(row.amount/row.pricedQuantity):'—'}
                     {' · '}от {money(row.minPrice)} до {money(row.maxPrice)}</small>
                 </span>
                 <b>{count(row.net)} шт. →</b>
               </button>)}
             </div>
             <small className="demand-dialog-hint">* Суммы — цены товарных позиций, не поступившие оплаты.</small>
           </>}
         </>}
       </div>
     </aside>
   </div>}
 </section>
}
