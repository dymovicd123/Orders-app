import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import './inventory-demand-statistics.css'

type DemandRow = {
  product: string; color: string; size: string; material: string; length: string
  gender: string; category: string; source: string
  sold: number; returned: number; net: number; pricedQuantity: number
  knownRevenue: number; priceDiscrepancyQuantity: number
  minPrice: number | null; maxPrice: number | null
}
type DemandResponse = {
  ok: boolean; message?: string; truncated?: boolean; rows?: DemandRow[]
  periodOrderCount?: number; periodShippedOrderCount?: number
}
type OrderLine = {
  itemId: number; orderId: number; externalId: string; shippedAt: string; orderedAt: string
  sold: number; returned: number; net: number
  unitPrice: number | null; orderTotal: number; priceDiscrepancy: boolean
}
type OrdersResponse = { ok: boolean; message?: string; orders?: OrderLine[]; hasMore?: boolean }
type Dimension = 'product' | 'color' | 'size' | 'material' | 'length' | 'gender'
type Scope = 'orders' | 'shipped'
type Summary = { name: string; sold: number; net: number; returned: number; amount: number; priced: number }
type Selection = { kind: Dimension; name: string }
const count = (n: number) => new Intl.NumberFormat('ru-RU').format(n)
const money = (n: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Math.round(n)) + ' ₸'
const pct = (n: number, total: number) => total ? Math.round(n / total * 100) + '%' : '—'
const fieldsForOrders = ['product','color','size','material','length','gender','category','source'] as const
const sourceLabels: Record<string,string> = { warehouse:'Склад', boutique:'Бутик', workshop:'Цех' }
const dimensionLabels: Record<Dimension,string> = {
  product:'Модели', color:'Цвета', size:'Размеры', material:'Материалы', length:'Длина', gender:'Пол'
}
function day(date: Date) {
  const p = (v: number) => String(v).padStart(2,'0')
  return date.getFullYear() + '-' + p(date.getMonth()+1) + '-' + p(date.getDate())
}
function thisMonth() { return day(new Date()).slice(0,7) }
function monthDates(value: string) {
  const [year,month] = value.split('-').map(Number)
  return { start:day(new Date(year,month-1,1)), end:day(new Date(year,month,0)) }
}
function moveMonth(value: string, delta: number) {
  const [year,month] = value.split('-').map(Number)
  return day(new Date(year,month-1+delta,1)).slice(0,7)
}
function prettyMonth(value: string) {
  const [year,month] = value.split('-').map(Number)
  return new Intl.DateTimeFormat('ru-RU',{month:'long',year:'numeric'}).format(new Date(year,month-1,1))
}
function sum(rows: DemandRow[]): Summary {
  return rows.reduce((a,r)=>({
    name:'Всего',sold:a.sold+r.sold,net:a.net+r.net,returned:a.returned+r.returned,
    amount:a.amount+r.knownRevenue,priced:a.priced+r.pricedQuantity,
  }),{name:'Всего',sold:0,net:0,returned:0,amount:0,priced:0})
}
function rank(rows: DemandRow[], by: Dimension): Summary[] {
  const map = new Map<string,DemandRow[]>()
  for(const row of rows) {
    const name = row[by]
    map.set(name,[...(map.get(name)||[]),row])
  }
  return [...map].map(([name,items])=>({...sum(items),name}))
    .sort((a,b)=>b.net-a.net || b.sold-a.sold || a.name.localeCompare(b.name,'ru'))
}
function variantKey(row: DemandRow) { return fieldsForOrders.map(field=>row[field]).join('\u001f') }
function priceSummary(row: Summary) {
  return row.priced ? money(row.amount/row.priced) : 'Нет цены'
}

export function InventoryDemandStatistics({active}:{active:boolean}) {
  const [month,setMonth]=useState(thisMonth)
  const [period,setPeriod]=useState(()=>monthDates(thisMonth()))
  const [custom,setCustom]=useState(false)
  const [customStart,setCustomStart]=useState(()=>monthDates(thisMonth()).start)
  const [customEnd,setCustomEnd]=useState(()=>day(new Date()))
  const [scope,setScope]=useState<Scope>('orders')
  const [source,setSource]=useState('all')
  const [category,setCategory]=useState('all')
  const [query,setQuery]=useState('')
  const [showAll,setShowAll]=useState<Dimension|null>(null)
  const [selection,setSelection]=useState<Selection|null>(null)
  const [pickedModel,setPickedModel]=useState<string|null>(null)
  const [pickedVariant,setPickedVariant]=useState<DemandRow|null>(null)
  const [response,setResponse]=useState<DemandResponse|null>(null)
  const [loading,setLoading]=useState(false)
  const [error,setError]=useState('')
  const [refresh,setRefresh]=useState(0)
  const [orders,setOrders]=useState<OrderLine[]>([])
  const [orderPage,setOrderPage]=useState(0)
  const [orderLoading,setOrderLoading]=useState(false)
  const [orderError,setOrderError]=useState('')
  const [orderMore,setOrderMore]=useState(false)

  const isSent = scope==='shipped'
  function clearDetail() {setSelection(null);setPickedModel(null);setPickedVariant(null);setOrders([]);setOrderPage(0)}
  function chooseMonth(value:string) {setMonth(value);setPeriod(monthDates(value));setCustom(false);clearDetail()}
  function openGroup(kind:Dimension,name:string) {
    setSelection({kind,name});setPickedModel(null);setPickedVariant(null);setOrders([]);setOrderPage(0)
  }
  function closeOneLevel() {
    if(pickedVariant){setPickedVariant(null);setOrders([]);setOrderPage(0)}
    else if(pickedModel!==null && selection?.kind!=='product')setPickedModel(null)
    else clearDetail()
  }

  useEffect(()=>{
    if(!active) return
    const ctrl=new AbortController()
    setLoading(true);setError('');setResponse(null)
    const params=new URLSearchParams({start:period.start,end:period.end,scope})
    void fetch('/api/reports/warehouse-demand?'+params,{credentials:'same-origin',cache:'no-store',signal:ctrl.signal})
      .then(async r=>{const j=await r.json() as DemandResponse;if(!r.ok||!j.ok)throw Error(j.message||'Не удалось загрузить статистику.');return j})
      .then(setResponse).catch(e=>{if(!ctrl.signal.aborted)setError(e instanceof Error?e.message:'Ошибка получения данных.')})
      .finally(()=>{if(!ctrl.signal.aborted)setLoading(false)})
    return ()=>ctrl.abort()
  },[active,period.start,period.end,scope,refresh])

  const filtered=useMemo(()=>(response?.rows||[]).filter(row=>
    (source==='all'||row.source===source) && (category==='all'||row.category===category)),
    [response,source,category])
  const totals=useMemo(()=>sum(filtered),[filtered])
  const models=useMemo(()=>rank(filtered,'product'),[filtered])
  const colors=useMemo(()=>rank(filtered,'color'),[filtered])
  const sizes=useMemo(()=>rank(filtered,'size'),[filtered])
  const materials=useMemo(()=>rank(filtered,'material'),[filtered])
  const lengths=useMemo(()=>rank(filtered,'length'),[filtered])
  const genders=useMemo(()=>rank(filtered,'gender'),[filtered])
  const displayedModels=useMemo(()=>models.filter(m=>m.name.toLocaleLowerCase('ru').includes(query.trim().toLocaleLowerCase('ru'))),[models,query])
  const focusRows=useMemo(()=>!selection?[]:filtered.filter(row=>row[selection.kind]===selection.name),[filtered,selection])
  const focusModels=useMemo(()=>rank(focusRows,'product'),[focusRows])
  const detailModel=selection?.kind==='product'?selection.name : (pickedModel || (focusModels.length===1?focusModels[0].name:null))
  const variants=useMemo(()=>detailModel===null?[]:focusRows.filter(row=>row.product===detailModel).sort((a,b)=>b.net-a.net || a.color.localeCompare(b.color,'ru')),[focusRows,detailModel])
  const focusSummary=useMemo(()=>sum(focusRows),[focusRows])
  const variantId=pickedVariant?variantKey(pickedVariant):''

  useEffect(()=>{
    if(!active||!pickedVariant)return
    const ctrl=new AbortController()
    const params=new URLSearchParams({start:period.start,end:period.end,scope,mode:'orders',offset:String(orderPage*50)})
    for(const key of fieldsForOrders)params.set(key,pickedVariant[key])
    setOrderLoading(true);setOrderError('')
    if(orderPage===0)setOrders([])
    void fetch('/api/reports/warehouse-demand?'+params,{credentials:'same-origin',signal:ctrl.signal,cache:'no-store'})
      .then(async r=>{const j=await r.json() as OrdersResponse;if(!r.ok||!j.ok)throw Error(j.message||'Не удалось загрузить позиции.');return j})
      .then(j=>{if(!ctrl.signal.aborted){setOrders(old=>orderPage?[...old,...(j.orders||[])]:j.orders||[]);setOrderMore(Boolean(j.hasMore))}})
      .catch(e=>{if(!ctrl.signal.aborted)setOrderError(e instanceof Error?e.message:'Ошибка получения позиций.')})
      .finally(()=>{if(!ctrl.signal.aborted)setOrderLoading(false)})
    return ()=>ctrl.abort()
  },[active,variantId,period.start,period.end,scope,orderPage])

  function exportModels() {
    const quote=(v:string|number)=>'"'+String(v).replace(/"/g,'""')+'"'
    const data=[['Модель','Количество','Возврат','Количество без возвратов','Стоимость по ценам позиций','Средняя цена','С известной ценой'],
      ...models.map(m=>[m.name,m.sold,m.returned,m.net,m.amount,m.priced?Number((m.amount/m.priced).toFixed(2)):'',m.priced])]
    const csv='\uFEFF'+data.map(row=>row.map(quote).join(';')).join('\r\n')
    const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}))
    const a=document.createElement('a');a.href=url;a.download='spros-modeli-'+period.start+'.csv';a.click();URL.revokeObjectURL(url)
  }

  function analysisCard(kind:Dimension,items:Summary[],limit:number) {
    const visible=showAll===kind?items:items.slice(0,limit)
    const max=Math.max(1,...items.map(item=>item.net))
    return <section className="demand-card" key={kind}>
      <header className="demand-card-heading"><h3>{dimensionLabels[kind]}</h3>
        <span>{items.length} {kind==='product'?'моделей':'значений'}</span></header>
      <div className="demand-card-list">
        {!visible.length?<p className="demand-empty">Данных за этот период нет</p>:visible.map((item,i)=><button type="button" key={item.name} className="demand-rank-row" onClick={()=>openGroup(kind,item.name)}>
          <span className="demand-rank-id">{i+1}</span>
          <span className="demand-rank-info">
            <strong>{item.name}</strong>
            <span className="demand-progress"><span style={{'--demand-width':Math.max(0,item.net)/max*100+'%'} as CSSProperties}/></span>
            <small>{item.net} шт. · {pct(item.net,totals.net)} · {item.priced?'средняя '+priceSummary(item):'цена неизвестна'}</small>
          </span>
          <span className="demand-rank-action">Подробнее <span aria-hidden="true">→</span></span>
        </button>)}
      </div>
      {items.length>limit && <button type="button" className="demand-show-more" onClick={()=>setShowAll(showAll===kind?null:kind)}>
        {showAll===kind?'Свернуть':'Показать все '+items.length} <span aria-hidden="true">↓</span>
      </button>}
    </section>
  }
  return <section className="demand-page" aria-label="Статистика спроса">
    <header className="demand-top"><div><span className="demand-eyebrow">СТАТИСТИКА ТОВАРОВ</span><h2>Какие товары пользуются спросом</h2>
      <p>Посмотрите, какие модели, цвета и размеры выбирают покупатели.</p></div>
      <button className="demand-refresh" type="button" onClick={()=>setRefresh(v=>v+1)} disabled={loading}>↻ Обновить</button>
    </header>
    <div className="demand-scope" aria-label="Что учитывается">
      <button type="button" aria-pressed={!isSent} className={!isSent?'is-active':''} onClick={()=>{setScope('orders');clearDetail()}}>
        <span className="demand-scope-title">Все оформленные заказы</span>
        <span className="demand-scope-note">Показывает интерес покупателей, даже если товар ещё не отправлен</span>
      </button>
      <button type="button" aria-pressed={isSent} className={isSent?'is-active':''} onClick={()=>{setScope('shipped');clearDetail()}}>
        <span className="demand-scope-title">Только отправленные товары</span>
        <span className="demand-scope-note">Фактические выдачи клиентам — без ожидающих отправки</span>
      </button>
    </div>
    <div className="demand-period">
      <div className="demand-month">
        <button type="button" onClick={()=>chooseMonth(moveMonth(month,-1))} aria-label="Предыдущий месяц">←</button>
        <strong>{custom?'Выбранный период':prettyMonth(month)}</strong>
        <button type="button" onClick={()=>chooseMonth(moveMonth(month,1))} aria-label="Следующий месяц">→</button>
      </div>
      <div className="demand-period-buttons">
        <button type="button" onClick={()=>chooseMonth(thisMonth())}>Этот месяц</button>
        <button type="button" className={custom?'is-current':''} onClick={()=>setCustom(v=>!v)}>Свой период</button>
      </div>
      {custom&&<form className="demand-custom-dates" onSubmit={e=>{e.preventDefault();if(customStart&&customEnd&&customStart<=customEnd){setPeriod({start:customStart,end:customEnd});clearDetail();setError('')}else setError('Проверьте даты периода.')}}><label>Начало <input type="date" value={customStart} onChange={e=>setCustomStart(e.target.value)}/></label><label>Конец <input type="date" value={customEnd} onChange={e=>setCustomEnd(e.target.value)}/></label><button type="submit">Применить</button></form>}
      <span className="demand-date-caption">Данные с {period.start} по {period.end}</span>
    </div>

    {loading&&<div className="demand-notice" role="status">Загружаем данные…</div>}
    {error&&<div className="demand-notice" role="alert">{error}</div>}
    {response?.truncated&&<div className="demand-notice" role="alert">Слишком много сочетаний товаров — сократите период, чтобы рейтинг был полным.</div>}
    {response&&!response.truncated&&!loading&&<>
      <div className="demand-explain"><span className="demand-explain-dot" aria-hidden="true"/>
        {isSent?'Считаем только товары из заказов, отмеченных «Отправлен», по дате отправки.':'Считаем товары из всех оформленных заказов по дате создания, включая ожидающие отправки.'}
        {source==='all'&&category==='all'&&response.periodOrderCount!==undefined&&<span className="demand-explain-counter">За период оформлено {count(response.periodOrderCount)} заказов · отправлено {count(response.periodShippedOrderCount||0)}</span>}
      </div>
      <div className="demand-kpis">
        <div><small>{isSent?'Отправлено товаров':'Заказано товаров'}</small><strong>{count(totals.sold)} шт.</strong></div>
        <div><small>Без возвратов</small><strong>{count(totals.net)} шт.</strong></div>
        <div><small>Стоимость по ценам позиций</small><strong>{totals.priced?money(totals.amount):'Нет данных'}</strong></div>
        <div><small>Средняя цена товара</small><strong>{totals.priced?money(totals.amount/totals.priced):'Нет данных'}</strong></div>
      </div>
      <div className="demand-smallprint">
        {totals.returned>0?'Возвращено: '+count(totals.returned)+' шт. · ':''}
        Сохранённая цена есть для {count(totals.priced)} из {count(totals.net)} шт.
        {totals.priced<totals.net?' Поэтому суммы могут быть неполными.':''}
        {' '}<details><summary>Как рассчитываем?</summary><p>Сумма рассчитывается по сохранённым ценам каждой позиции — это не поступившие оплаты и не прибыль. Обмены могут менять текущий состав старого заказа, поэтому исторические данные пока не являются неизменяемым журналом событий.</p></details>
      </div>
      <details className="demand-filters">
        <summary><strong>Уточнить выборку</strong> <span>Источник товара, взрослые/детские</span></summary>
        <p>Эти два фильтра меняют все показатели, суммы и рейтинги на этой странице.</p>
        <div className="demand-filter-fields">
          <label>Откуда товар <select value={source} onChange={e=>{setSource(e.target.value);clearDetail()}}>
            <option value="all">Все: склад, бутик и цех</option><option value="warehouse">Со склада</option>
            <option value="boutique">Из бутика</option><option value="workshop">Из цеха</option>
          </select></label>
          <label>Для кого <select value={category} onChange={e=>{setCategory(e.target.value);clearDetail()}}>
            <option value="all">Взрослые и детские</option><option value="adult">Только взрослые</option>
            <option value="child">Только детские</option><option value="unknown">Без категории</option>
          </select></label>
          {(source!=='all'||category!=='all')&&<button type="button" onClick={()=>{setSource('all');setCategory('all');clearDetail()}}>Сбросить фильтры</button>}
        </div>
      </details>
      <div className="demand-section-title">
        <div><h3>{isSent?'Какие товары продали':'Что чаще всего заказывают'}</h3><p>Нажмите «Подробнее», чтобы увидеть конкретные варианты и позиции заказов.</p></div>
        <button type="button" className="demand-download" onClick={exportModels}>↓ Скачать список моделей (CSV)</button>
      </div>
      <div className="demand-main-grid">
        <div className="demand-main-left">
          <label className="demand-model-search">Найти модель в рейтинге <input type="search" placeholder="Введите название товара" value={query} onChange={e=>setQuery(e.target.value)}/></label>
          {analysisCard('product',displayedModels,10)}
          <p className="demand-search-help">Поиск меняет только список моделей, а не общие цифры и остальные рейтинги.</p>
        </div>
        <div className="demand-secondary">
          {analysisCard('color',colors,5)}
          {analysisCard('size',sizes,5)}
        </div>
      </div>
      <div className="demand-subsection"><h3>Другие характеристики товаров</h3><p>Материал, длина и пол — на каких вариантах сосредоточен спрос.</p></div>
      <div className="demand-other-grid">
        {analysisCard('material',materials,5)}
        {analysisCard('length',lengths,5)}
        {analysisCard('gender',genders,5)}
      </div>
    </>}
    {selection&&<div className="demand-dialog-root">
      <button className="demand-dialog-scrim" type="button" aria-label="Закрыть детали и вернуться к статистике" onClick={clearDetail}/>
      <aside className="demand-dialog" role="dialog" aria-modal="true" aria-label="Подробности статистики">
        <div className="demand-dialog-toolbar">
          <button type="button" className="demand-back" onClick={closeOneLevel}>{pickedVariant?'← К вариантам':pickedModel!==null?'← К моделям':'← К статистике'}</button>
          <button type="button" className="demand-close" aria-label="Закрыть подробности" onClick={clearDetail}>×</button>
        </div>
        <div className="demand-dialog-body">
          {pickedVariant?<>
            <span className="demand-eyebrow">ПОЗИЦИИ ЗАКАЗОВ</span>
            <h2>{pickedVariant.product}</h2>
            <p className="demand-dialog-sub">{pickedVariant.color} · {pickedVariant.size} · {pickedVariant.material} · {sourceLabels[pickedVariant.source]||pickedVariant.source}</p>
            {orderError&&<p role="alert">{orderError}</p>}
            {orderLoading&&!orders.length&&<p>Загружаем позиции…</p>}
            {orders.map(item=><article className="demand-order" key={item.itemId}>
              <strong>{item.externalId||'Заказ №'+item.orderId}</strong><small>{isSent?'Отправлен '+(item.shippedAt||'без даты'):'Оформлен '+(item.orderedAt||'без даты')}</small>
              <div><b>{item.net} шт.</b><span>{item.unitPrice===null?'Цена позиции неизвестна':money(item.unitPrice)+' / шт.'}</span></div>
              <small>{item.unitPrice===null?'Общая сумма заказа '+money(item.orderTotal)+' — не цена этого товара':'Стоимость позиции '+money(item.net*item.unitPrice)}</small>
              {item.priceDiscrepancy&&<small className="demand-warning">Старая сумма строки отличается от цены за штуку</small>}
            </article>)}
            {orderMore&&<button type="button" onClick={()=>setOrderPage(p=>p+1)} disabled={orderLoading}>Показать ещё</button>}
          </>:<>
            <span className="demand-eyebrow">{dimensionLabels[selection.kind].toUpperCase()} · {isSent?'ОТПРАВЛЕННЫЕ':'ОФОРМЛЕННЫЕ ЗАКАЗЫ'}</span>
            <h2>{detailModel||selection.name}</h2>
            {selection.kind!=='product'&&<p className="demand-dialog-sub">Выбрано: {selection.name}{detailModel?' · модель '+detailModel:''}</p>}
            <div className="demand-dialog-metrics"><span><b>{count(focusSummary.net)}</b> шт. без возвратов</span><span><b>{count(focusSummary.returned)}</b> возвратов</span><span><b>{focusSummary.priced?money(focusSummary.amount):'—'}</b> стоимость*</span></div>
            {detailModel===null?<>
              <h3>В каких моделях встречается {selection.name.toLowerCase()}?</h3>
              <div className="demand-dialog-models">
                {focusModels.map(model=><button type="button" key={model.name} onClick={()=>setPickedModel(model.name)}>
                  <span><strong>{model.name}</strong><small>Средняя цена: {priceSummary(model)}</small></span>
                  <b>{count(model.net)} шт. →</b>
                </button>)}
              </div>
            </>:<>
              <h3>Какие варианты выбирали</h3>
              <p className="demand-dialog-hint">Выберите вариант, чтобы увидеть, в каких заказах он встречается.</p>
              <div className="demand-dialog-variants">
                {variants.map(row=><button type="button" key={variantKey(row)} onClick={()=>{setPickedVariant(row);setOrders([]);setOrderPage(0)}}>
                  <span><strong>{row.color} · {row.size}</strong><small>{row.material} · {row.length} · {sourceLabels[row.source]||row.source}</small>
                    <small>{row.pricedQuantity?'Средняя цена '+money(row.knownRevenue/row.pricedQuantity):'Цена неизвестна'}</small></span>
                  <b>{count(row.net)} шт. <span aria-hidden="true">→</span></b>
                </button>)}
              </div>
              <small className="demand-dialog-hint">* По известным ценам позиций, не по поступившим оплатам.</small>
            </>}
          </>}
        </div>
      </aside>
    </div>}
  </section>
}
