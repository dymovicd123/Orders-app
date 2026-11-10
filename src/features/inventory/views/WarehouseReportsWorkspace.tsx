import { useEffect, useMemo, useState } from 'react'
import type { WarehouseCapitalSnapshot, WarehouseCapitalRow } from '../../../../shared/warehouse-capital-types.ts'
import type { WarehouseDemandResponse, WarehouseDemandRow, WarehouseReportChoice } from './warehouseReportExcel'
import './warehouse-report-workspace.css'

type Props={active:boolean;isAdmin:boolean}
type Mode='export'|'capital'
const formatter=new Intl.NumberFormat('ru-RU',{maximumFractionDigits:0})
const count=(n:number)=>formatter.format(n)
const money=(n:number)=>formatter.format(Math.round(n))+' ₸'
function today(){
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Almaty',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date())
  const value=(type:string)=>parts.find(p=>p.type===type)?.value||''
  return value('year')+'-'+value('month')+'-'+value('day')
}
function monthSpan(month:string){
  const [year,m]=month.split('-').map(Number)
  const monthEnd=new Date(Date.UTC(year,m,0)).getUTCDate()
  return {start:month+'-01',end:month+'-'+String(monthEnd).padStart(2,'0')}
}
function shiftMonth(month:string,delta:number){
  const [year,m]=month.split('-').map(Number)
  return new Date(Date.UTC(year,m-1+delta,1)).toISOString().slice(0,7)
}
const scopes:{value:'orders'|'shipped';name:string}[]=[
  {value:'orders',name:'Оформленные заказы'},
  {value:'shipped',name:'Отправленные товары'},
]
function rowsForDemand(rows:WarehouseDemandRow[],source:string,category:string){
  return rows.filter(row=>(source==='all'||row.source===source)&&
    (category==='all'||row.category===category))
}
function rankDemand(rows:WarehouseDemandRow[]){
  const out=new Map<string,{name:string;net:number;sold:number;value:number;priced:number}>()
  for(const row of rows){
    const prev=out.get(row.product)||{name:row.product,net:0,sold:0,value:0,priced:0}
    prev.net+=row.net;prev.sold+=row.sold;prev.value+=row.knownRevenue;prev.priced+=row.pricedQuantity
    out.set(row.product,prev)
  }
  return [...out.values()].sort((a,b)=>b.net-a.net||b.sold-a.sold)
}
function stockGroups(rows:WarehouseCapitalRow[]){
  const out=new Map<string,{name:string;quantity:number;reserved:number;free:number;
    cost:number;sale:number;costPriced:number;salePriced:number}>()
  for(const row of rows){
    const prev=out.get(row.product)||{name:row.product,quantity:0,reserved:0,free:0,
      cost:0,sale:0,costPriced:0,salePriced:0}
    prev.quantity+=row.quantity;prev.reserved+=row.reserved;prev.free+=row.free
    if(row.costValue!==null){prev.cost+=row.costValue;prev.costPriced+=row.quantity}
    if(row.retailValue!==null){prev.sale+=row.retailValue;prev.salePriced+=row.quantity}
    out.set(row.product,prev)
  }
  return [...out.values()].sort((a,b)=>b.cost-a.cost||b.quantity-a.quantity)
}
function freshSummary(source:'all'|'warehouse'|'boutique',capital:WarehouseCapitalSnapshot){
  if(source==='all')return capital.totals
  return capital.bySource[source]
}
export function WarehouseReportsWorkspace({active,isAdmin}:Props){
  const [mode,setMode]=useState<Mode>('export')
  const [month,setMonth]=useState(()=>today().slice(0,7))
  const [custom,setCustom]=useState(false)
  const [period,setPeriod]=useState(()=>monthSpan(today().slice(0,7)))
  const [startDraft,setStartDraft]=useState(()=>monthSpan(today().slice(0,7)).start)
  const [endDraft,setEndDraft]=useState(today)
  const [scope,setScope]=useState<'orders'|'shipped'>('orders')
  const [source,setSource]=useState('all')
  const [category,setCategory]=useState('all')
  const [reload,setReload]=useState(0)
  const [demand,setDemand]=useState<WarehouseDemandResponse|null>(null)
  const [capital,setCapital]=useState<WarehouseCapitalSnapshot|null>(null)
  const [demandLoading,setDemandLoading]=useState(false)
  const [capitalLoading,setCapitalLoading]=useState(false)
  const [exporting,setExporting]=useState(false)
  const [demandError,setDemandError]=useState('')
  const [capitalError,setCapitalError]=useState('')
  const [exportError,setExportError]=useState('')
  useEffect(()=>{
    if(!active)return
    const controller=new AbortController()
    setDemandLoading(true);setDemandError('');setDemand(null)
    const params=new URLSearchParams({start:period.start,end:period.end,scope})
    void fetch('/api/reports/warehouse-demand?'+params,{credentials:'same-origin',cache:'no-store',signal:controller.signal})
      .then(async response=>{
        const data=await response.json() as WarehouseDemandResponse&{message?:string}
        if(!response.ok||!data.ok)throw Error(data.message||'Не удалось загрузить статистику спроса.')
        if(data.truncated)throw Error('Статистика за период неполная. Выберите более короткий период для отчёта.')
        return data
      }).then(data=>{if(!controller.signal.aborted)setDemand(data)})
      .catch(error=>{if(!controller.signal.aborted)setDemandError(error instanceof Error?error.message:'Ошибка чтения спроса.')})
      .finally(()=>{if(!controller.signal.aborted)setDemandLoading(false)})
    return ()=>controller.abort()
  },[active,period.start,period.end,scope,reload])
  useEffect(()=>{
    if(!active||!isAdmin)return
    const controller=new AbortController()
    setCapitalLoading(true);setCapitalError('');setCapital(null)
    void fetch('/api/reports/warehouse-capital',{credentials:'same-origin',cache:'no-store',signal:controller.signal})
      .then(async response=>{
        const data=await response.json() as WarehouseCapitalSnapshot&{message?:string}
        if(!response.ok||!data.ok)throw Error(data.message||'Не удалось прочитать стоимость остатков.')
        return data
      }).then(data=>{if(!controller.signal.aborted)setCapital(data)})
      .catch(error=>{if(!controller.signal.aborted)setCapitalError(error instanceof Error?error.message:'Ошибка оценки запасов.')})
      .finally(()=>{if(!controller.signal.aborted)setCapitalLoading(false)})
    return ()=>controller.abort()
  },[active,isAdmin,reload])
  const salesRows=useMemo(()=>rowsForDemand(demand?.rows||[],source,category),[demand,source,category])
  const salesModels=useMemo(()=>rankDemand(salesRows),[salesRows])
  const salesTotals=useMemo(()=>salesRows.reduce((t,r)=>({
    sold:t.sold+r.sold,net:t.net+r.net,returned:t.returned+r.returned,
    priced:t.priced+r.pricedQuantity,revenue:t.revenue+r.knownRevenue,
  }),{sold:0,net:0,returned:0,priced:0,revenue:0}),[salesRows])
  const capitalRows=useMemo(()=>!capital?[]:capital.rows.filter(r=>
    (source==='all'||r.source===source)&&
    (category==='all'||r.category===category)),[capital,source,category])
  const capitalTotals=useMemo(()=>{
    if(!capital)return null
    if(category==='all'&&source!=='workshop')return freshSummary(source as 'all'|'warehouse'|'boutique',capital)
    // Both source and category filters must affect financial totals; only positive rows.
    const t={...capital.totals}
    for(const key of Object.keys(t) as Array<keyof typeof t>)(t[key] as number)=0
    for(const r of capitalRows){
      t.quantity+=r.quantity;t.reserved+=r.reserved;t.free+=r.free;t.stockRows++
      if(r.costPrice!==null){t.pricedCostQuantity+=r.quantity;t.knownCost+=r.costValue||0;
        t.knownFreeCost+=r.free*r.costPrice;t.knownReservedCost+=r.reserved*r.costPrice}
      else t.missingCostQuantity+=r.quantity
      if(r.salePrice!==null){t.pricedSaleQuantity+=r.quantity;t.knownSale+=r.retailValue||0}
      else t.missingSaleQuantity+=r.quantity
      if(r.grossPotential!==null){t.bothPricedQuantity+=r.quantity;t.knownGrossPotential+=r.grossPotential}
      if(r.overReserved)t.overReservedRows++
      if(r.variantId===null)t.unlinkedPositiveRows++
    }
    return t
  },[capital,capitalRows,source,category])
  const modelsByCapital=useMemo(()=>stockGroups(capitalRows),[capitalRows])
  function chooseMonth(next:string){setMonth(next);setPeriod(monthSpan(next));setCustom(false)}
  const choice:WarehouseReportChoice={...period,scope,source,category}
  async function download(){
    if(demandLoading||exporting||!demand||demand.truncated)return
    setExporting(true);setExportError('')
    try{
      const {buildWarehouseReportXlsx}=await import('./warehouseReportExcel')
      // Never put a partial valuation in a financial report.
      if(isAdmin&&(capitalLoading||capitalError||!capital))
        throw Error('Финансовые данные не загрузились. Повторите обновление.')
      const snapshot=isAdmin&&capital?{...capital,rows:capitalRows,totals:capitalTotals||capital.totals}:null
      const bytes=buildWarehouseReportXlsx({demand,choice,capital:snapshot})
      const blob=new Blob([new Uint8Array(bytes)],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})
      const url=URL.createObjectURL(blob)
      const link=document.createElement('a')
      link.href=url;link.download='Склад-отчёт-'+period.start+'-'+period.end+'.xlsx'
      document.body.appendChild(link);link.click();link.remove()
      window.setTimeout(()=>URL.revokeObjectURL(url),1000)
    }catch(error){setExportError(error instanceof Error?error.message:'Не удалось создать Excel-отчёт.')}
    finally{setExporting(false)}
  }
  if(!active)return null
  return <section className="warehouse-report-page" aria-label="Отчёты склада">
    <header className="warehouse-report-head">
      <div><span className="warehouse-report-eyebrow">СКЛАД · ОТЧЁТЫ</span>
        <h2>Отчёты и аналитика запасов</h2>
        <p>Оценка на текущий момент и подробная выгрузка статистики спроса.</p></div>
      <button type="button" className="secondary" disabled={demandLoading||capitalLoading}
        onClick={()=>setReload(v=>v+1)}>Обновить данные</button>
    </header>
    <div className="warehouse-report-tabs" role="tablist" aria-label="Разделы аналитики">
      <button role="tab" aria-selected={mode==='export'} className={mode==='export'?'chosen':''}
        type="button" onClick={()=>setMode('export')}>Excel и спрос</button>
      {isAdmin&&<button role="tab" aria-selected={mode==='capital'} className={mode==='capital'?'chosen':''}
        type="button" onClick={()=>{setMode('capital');if(source==='workshop')setSource('all')}}>Стоимость запасов</button>}
    </div>
    <div className="warehouse-report-filters">
      <label>Источник <select value={source} onChange={e=>setSource(e.target.value)}>
        <option value="all">{mode==='export'?'Все источники':'Склад и бутик'}</option><option value="warehouse">Склад</option>
        <option value="boutique">Бутик</option>{mode==='export'&&<option value="workshop">Цех (спрос)</option>}
      </select></label>
      <label>Категория <select value={category} onChange={e=>setCategory(e.target.value)}>
        <option value="all">Все</option><option value="adult">Взрослые</option>
        <option value="child">Детские</option><option value="unknown">Не указано</option>
      </select></label>
    </div>
    {mode==='export'?<>
      <div className="warehouse-report-period">
        <div className="warehouse-report-month">
          <button type="button" aria-label="Предыдущий месяц" onClick={()=>chooseMonth(shiftMonth(month,-1))}>←</button>
          <strong>{new Intl.DateTimeFormat('ru-RU',{month:'long',year:'numeric'}).format(new Date(month+'-01T00:00:00Z'))}</strong>
          <button type="button" aria-label="Следующий месяц" onClick={()=>chooseMonth(shiftMonth(month,1))}>→</button>
          <button type="button" onClick={()=>chooseMonth(today().slice(0,7))}>Этот месяц</button>
          <button type="button" onClick={()=>setCustom(v=>!v)}>{custom?'Скрыть выбор':'Свой период'}</button>
        </div>
        {custom&&<form className="warehouse-report-custom" onSubmit={e=>{
          e.preventDefault()
          if(startDraft&&endDraft&&startDraft<=endDraft&&
            Date.parse(endDraft)-Date.parse(startDraft)<=366*86400000)setPeriod({start:startDraft,end:endDraft})
          else setDemandError('Период должен быть не длиннее одного года.')
        }}>
          <label>С <input type="date" value={startDraft} onChange={e=>setStartDraft(e.target.value)}/></label>
          <label>По <input type="date" value={endDraft} onChange={e=>setEndDraft(e.target.value)}/></label>
          <button type="submit">Применить</button>
        </form>}
        <div className="warehouse-report-scope">{scopes.map(s=><button type="button" key={s.value}
          className={scope===s.value?'chosen':''} aria-pressed={scope===s.value}
          onClick={()=>setScope(s.value)}>{s.name}</button>)}</div>
        <small>{period.start} — {period.end}. Считаются те же данные, что на странице «Статистика».</small>
      </div>
      {demandLoading&&<p className="warehouse-report-info" role="status">Загружаем статистику…</p>}
      {demandError&&<p role="alert" className="warehouse-report-error">{demandError}</p>}
      {demand&&!demandLoading&&<>
        <div className="warehouse-report-kpis">
          <div><span>{scope==='orders'?'Заказано':'Отправлено'}</span><strong>{count(salesTotals.sold)} шт.</strong></div>
          <div><span>Без возвратов</span><strong>{count(salesTotals.net)} шт.</strong></div>
          <div><span>Стоимость известных позиций</span><strong>{money(salesTotals.revenue)}</strong></div>
          <div><span>Средняя цена</span><strong>{salesTotals.priced?money(salesTotals.revenue/salesTotals.priced):'Нет данных'}</strong></div>
        </div>
        <div className="warehouse-report-download">
          <div><h3>Весь отчёт в Excel</h3><p>Полные рейтинги моделей, цветов, размеров, материалов, длины, пола и вариантов.
            Подробные заказы не включаются.{isAdmin?' Также включена текущая оценка остатков.':''}</p>
            <small>Сохранённая цена есть для {count(salesTotals.priced)} из {count(salesTotals.net)} шт.</small></div>
          <button type="button" className="primary" disabled={exporting||!demand||isAdmin&&(!capital||capitalLoading||Boolean(capitalError))}
            onClick={()=>void download()}>{exporting?'Формируем…':'Скачать Excel (.xlsx)'}</button>
        </div>
        <div className="warehouse-report-list">
          <div className="warehouse-report-list-head"><h3>Модели по спросу</h3><small>Полный рейтинг в Excel</small></div>
          {salesModels.slice(0,8).map((model,i)=><div className="warehouse-report-list-row" key={model.name}>
            <span>{i+1}. {model.name}</span><b>{count(model.net)} шт.</b></div>)}
          {!salesModels.length&&<p>За выбранный период данных нет.</p>}
        </div>
      </>}
    </>:isAdmin&&<>
      {capitalLoading&&<p className="warehouse-report-info" role="status">Оцениваем текущие остатки…</p>}
      {capitalError&&<p className="warehouse-report-error" role="alert">{capitalError}</p>}
      {capital&&capitalTotals&&<>
        <p className="warehouse-report-snapshot">На {new Intl.DateTimeFormat('ru-RU',{
          timeZone:'Asia/Almaty',dateStyle:'medium',timeStyle:'short'}).format(new Date(capital.capturedAt))}.
          По физическим остаткам, включая резерв. Без нулевых и отрицательных позиций.</p>
        <div className="warehouse-report-kpis">
          <div><span>Средства в остатках*</span><strong>{money(capitalTotals.knownCost)}</strong>
            <small>Себестоимость есть для {count(capitalTotals.pricedCostQuantity)} из {count(capitalTotals.quantity)} шт.</small></div>
          <div><span>Потенциальная выручка*</span><strong>{money(capitalTotals.knownSale)}</strong>
            <small>Цена есть для {count(capitalTotals.pricedSaleQuantity)} из {count(capitalTotals.quantity)} шт.</small></div>
          <div><span>Потенциальная валовая маржа*</span><strong>{money(capitalTotals.knownGrossPotential)}</strong>
            <small>Для {count(capitalTotals.bothPricedQuantity)} шт. с обеими ценами</small></div>
          <div><span>Свободно / в резерве</span><strong>{count(capitalTotals.free)} / {count(capitalTotals.reserved)}</strong>
            <small>Всего {count(capitalTotals.quantity)} шт. на месте</small></div>
        </div>
        <div className="warehouse-report-note">
          <strong>* Оценка по текущим ценам.</strong> Известные суммы могут быть неполными, если цены отсутствуют.
          Это не стоимость исторических закупок, не гарантированная выручка и не чистая прибыль.
          Резервы уже входят в физический остаток и второй раз не прибавляются.
        </div>
        <div className="warehouse-report-list">
          <div className="warehouse-report-list-head"><h3>В каких моделях сосредоточены средства</h3>
            <span>Текущая стоимость по известной себестоимости</span></div>
          {modelsByCapital.slice(0,12).map((g,i)=><div className="warehouse-report-list-row" key={g.name}>
            <span>{i+1}. {g.name}<small>{count(g.quantity)} шт. · оценено {count(g.costPriced)} шт.</small></span>
            <b>{money(g.cost)}</b></div>)}
          {!modelsByCapital.length&&<p>Положительных остатков по выбранным условиям нет.</p>}
        </div>
        <p className="warehouse-report-smallnote">
          В общей базе: нулевых строк — {count(capital.totals.zeroRows)},
          отрицательных — {count(capital.totals.negativeRows)},
          с резервом больше остатка — {count(capital.totals.overReservedRows)}.
          Эти расхождения не прибавлены к стоимости.
        </p>
        <button type="button" className="secondary" disabled={!demand||demandLoading||exporting||Boolean(demandError)}
          onClick={()=>void download()}>{exporting?'Формируем…':'Скачать полный отчёт в Excel'}</button>
        <small className="warehouse-report-smallnote">Excel включает все положительные позиции и отдельный лист качества данных.</small>
      </>}
    </>}
    {exportError&&<p role="alert" className="warehouse-report-error">{exportError}</p>}
  </section>
}
