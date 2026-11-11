import {useEffect,useMemo,useState} from 'react'
import type {WarehouseCapitalSnapshot,WarehouseCapitalRow} from '../../../../shared/warehouse-capital-types.ts'
import type {WarehouseFinanceChoice} from './warehouseReportExcel'
import {labelCategory,labelCharacteristic} from './warehouseReportLocale.ts'
import './warehouse-report-workspace.css'

type Props={active:boolean;isAdmin:boolean}
type OrderBy='cost'|'revenue'|'quantity'
type Summary={
  quantity:number;reserved:number;free:number;cost:number;revenue:number;gross:number;
  freeCost:number;reservedCost:number;freeRevenue:number;reservedRevenue:number;
  costQty:number;revenueQty:number;bothQty:number;comparableRevenue:number;
  missingCost:number;missingRevenue:number;
}
type Breakdown={key:string;name:string;items:WarehouseCapitalRow[];summary:Summary}
const fmt=new Intl.NumberFormat('ru-RU',{maximumFractionDigits:0})
const num=(n:number)=>fmt.format(n)
const money=(n:number)=>fmt.format(Math.round(n))+' ₸'
const label=(s:string)=>labelCharacteristic(s)
function summarize(rows:WarehouseCapitalRow[]):Summary{
  const v:Summary={quantity:0,reserved:0,free:0,cost:0,revenue:0,gross:0,
    freeCost:0,reservedCost:0,freeRevenue:0,reservedRevenue:0,costQty:0,revenueQty:0,
    bothQty:0,comparableRevenue:0,missingCost:0,missingRevenue:0}
  for(const r of rows){
    v.quantity+=r.quantity;v.reserved+=r.reserved;v.free+=r.free
    if(r.costPrice===null)v.missingCost+=r.quantity
    else{v.costQty+=r.quantity;v.cost+=r.costValue||0;
      v.freeCost+=r.costPrice*r.free;v.reservedCost+=r.costPrice*r.reserved}
    if(r.salePrice===null)v.missingRevenue+=r.quantity
    else{v.revenueQty+=r.quantity;v.revenue+=r.retailValue||0;
      v.freeRevenue+=r.salePrice*r.free;v.reservedRevenue+=r.salePrice*r.reserved}
    if(r.grossPotential!==null&&r.salePrice!==null){
      v.bothQty+=r.quantity;v.gross+=r.grossPotential;v.comparableRevenue+=r.salePrice*r.quantity
    }
  }
  return v
}
function groupBy(rows:WarehouseCapitalRow[],key:(r:WarehouseCapitalRow)=>string,
  name:(r:WarehouseCapitalRow)=>string):Breakdown[]{
  const map=new Map<string,{name:string;items:WarehouseCapitalRow[]}>()
  for(const r of rows){
    const k=key(r),entry=map.get(k)||{name:name(r),items:[]}
    entry.items.push(r);map.set(k,entry)
  }
  return [...map].map(([key,g])=>({key,name:g.name,items:g.items,summary:summarize(g.items)}))
}
const sortGroups=(groups:Breakdown[],order:OrderBy)=>[...groups].sort((a,b)=>{
  const field={cost:'cost',revenue:'revenue',quantity:'quantity'}[order] as keyof Summary
  return b.summary[field]-a.summary[field]||a.name.localeCompare(b.name,'ru')
})
const sourceNames:{[key:string]:string}={warehouse:'Склад',boutique:'Бутик'}
const executionKey=(r:WarehouseCapitalRow)=>[r.gender,r.material,r.length,r.category].join('\u001f')
const executionName=(r:WarehouseCapitalRow)=>[r.material,r.length,r.gender].map(labelCharacteristic).join(' · ')+
  ' · '+labelCategory(r.category)
function VariantPricing({item}:{item:WarehouseCapitalRow}){
  return <>
    <div className="warehouse-capital-picked-title">
      <span>Товар</span>
      <strong>{label(item.color)} · {label(item.size)}</strong>
      <small>{sourceNames[item.source]||item.source}{item.archived?' · архив':''}</small>
    </div>
    <div className="warehouse-capital-picked-qty">
      <div><span>Всего</span><b>{num(item.quantity)}</b></div>
      <div><span>Свободно</span><b>{num(item.free)}</b></div>
      <div><span>Резерв</span><b>{num(item.reserved)}</b></div>
    </div>
    <div className="warehouse-capital-picked-price">
      <span>Себестоимость</span>
      <strong>{item.costPrice===null?'Не указана':money(item.costPrice)+' / шт.'}</strong>
      <small>Всего: {item.costValue===null?'не оценено':money(item.costValue)}</small>
    </div>
    <div className="warehouse-capital-picked-price">
      <span>Цена продажи</span>
      <strong>{item.salePrice===null?'Не указана':money(item.salePrice)+' / шт.'}</strong>
      <small>Всего: {item.retailValue===null?'не оценено':money(item.retailValue)}</small>
    </div>
  </>
}
function StockDetails({rows}:{rows:WarehouseCapitalRow[]}){
  const groups=useMemo(()=>sortGroups(groupBy(rows,r=>r.color,r=>label(r.color)),'quantity'),[rows])
  const [selectedId,setSelectedId]=useState<number|null>(groups[0]?.items[0]?.stockId??null)
  const [search,setSearch]=useState('')
  const [showAllColors,setShowAllColors]=useState(false)
  const needle=search.trim().toLocaleLowerCase('ru')
  const filtered=groups.filter(g=>!needle||g.name.toLocaleLowerCase('ru').includes(needle)||
    g.items.some(r=>label(r.size).toLocaleLowerCase('ru').includes(needle)))
  const shown=showAllColors||needle?filtered:filtered.slice(0,6)
  const selected=rows.find(r=>r.stockId===selectedId)||rows[0]
  const multipleSources=new Set(rows.map(r=>r.source)).size>1
  return <div className="warehouse-capital-browser">
    <div className="warehouse-capital-browser-colors">
      {groups.length>8&&<input className="warehouse-capital-color-search" type="search"
        aria-label="Найти цвет или размер" placeholder="Цвет или размер"
        value={search} onChange={e=>setSearch(e.target.value)}/>}
      {shown.map(group=><section className="warehouse-capital-color-group" key={group.key}>
        <div className="warehouse-capital-color-header">
          <strong>{group.name}</strong>
          <span>{num(group.summary.quantity)} шт.</span>
        </div>
        <div className="warehouse-capital-size-pills">
          {group.items.filter(r=>!needle||
            group.name.toLocaleLowerCase('ru').includes(needle)||
            label(r.size).toLocaleLowerCase('ru').includes(needle)).map(r=>
            <button key={r.stockId} type="button" aria-pressed={selected?.stockId===r.stockId}
              className={selected?.stockId===r.stockId?'is-picked':''}
              onClick={()=>setSelectedId(r.stockId)}>
              <b>{label(r.size)}</b>
              <span>{num(r.quantity)} шт.</span>
              {multipleSources&&<small>{sourceNames[r.source]||r.source}</small>}
              {r.reserved>0&&<small className="warehouse-capital-has-reserve">
                Резерв {num(r.reserved)}</small>}
            </button>)}
        </div>
        {selected&&group.items.some(r=>r.stockId===selected.stockId)&&
          <div className="warehouse-capital-picked warehouse-capital-picked-mobile">
            <VariantPricing item={selected}/>
          </div>}
      </section>)}
      {!shown.length&&<p className="warehouse-capital-no-colors">Таких цветов или размеров нет.</p>}
      {!needle&&filtered.length>6&&<button type="button" className="warehouse-capital-all-colors"
        onClick={()=>setShowAllColors(v=>!v)}>
        {showAllColors?'Свернуть цвета':'Показать все цвета · '+num(groups.length)}
      </button>}
    </div>
    {selected&&<aside className="warehouse-capital-picked warehouse-capital-picked-desktop">
      <VariantPricing item={selected}/>
    </aside>}
  </div>
}
function Coverage({title,count,total}:{title:string;count:number;total:number}){
  return <div className="warehouse-capital-coverage-item">
    <div><span>{title}</span><strong>{num(count)} из {num(total)} шт.</strong></div>
    <div className="warehouse-capital-meter-track">
      <span style={{width:(total?count/total*100:0)+'%'}}/>
    </div>
  </div>
}
export function WarehouseReportsWorkspace({active,isAdmin}:Props){
  const [capital,setCapital]=useState<WarehouseCapitalSnapshot|null>(null)
  const [loading,setLoading]=useState(false)
  const [error,setError]=useState('')
  const [refresh,setRefresh]=useState(0)
  const [source,setSource]=useState<WarehouseFinanceChoice['source']>('all')
  const [category,setCategory]=useState('all')
  const [query,setQuery]=useState('')
  const [order,setOrder]=useState<OrderBy>('cost')
  const [visible,setVisible]=useState(30)
  const [exporting,setExporting]=useState(false)
  const [documentExporting,setDocumentExporting]=useState(false)
  const [exportError,setExportError]=useState('')
  useEffect(()=>{
    if(!active||!isAdmin)return
    const ctrl=new AbortController()
    setLoading(true);setError('');setCapital(null)
    void fetch('/api/reports/warehouse-capital',{
      credentials:'same-origin',cache:'no-store',signal:ctrl.signal,
    }).then(async res=>{
      const payload=await res.json() as WarehouseCapitalSnapshot&{message?:string}
      if(!res.ok||!payload.ok)throw new Error(payload.message||'Ошибка загрузки стоимости запасов')
      return payload
    }).then(data=>{if(!ctrl.signal.aborted)setCapital(data)})
      .catch(e=>{if(!ctrl.signal.aborted)setError(e instanceof Error?e.message:'Ошибка чтения склада')})
      .finally(()=>{if(!ctrl.signal.aborted)setLoading(false)})
    return ()=>ctrl.abort()
  },[active,isAdmin,refresh])
  const rows=useMemo(()=>!capital?[]:capital.rows.filter(r=>
    (source==='all'||r.source===source)&&(category==='all'||r.category===category)),
  [capital,source,category])
  const totals=useMemo(()=>summarize(rows),[rows])
  const models=useMemo(()=>sortGroups(groupBy(rows,r=>r.product,r=>r.product),order),
    [rows,order])
  const found=useMemo(()=>models.filter(r=>r.name.toLocaleLowerCase('ru').includes(query.toLocaleLowerCase('ru').trim())),
    [models,query])
  const sourceGroups=useMemo(()=>[
    {name:'Склад',items:rows.filter(r=>r.source==='warehouse')},
    {name:'Бутик',items:rows.filter(r=>r.source==='boutique')},
  ].map(g=>({...g,summary:summarize(g.items)})).filter(g=>g.summary.quantity>0),[rows])
  const biggest=Math.max(1,...models.map(r=>r.summary.cost))
  async function download(){
    if(!capital||loading||exporting)return
    setExporting(true);setExportError('')
    try{
      const {buildWarehouseCapitalXlsx}=await import('./warehouseReportExcel')
      const bytes=buildWarehouseCapitalXlsx({capital,choice:{source,category}})
      const blob=new Blob([new Uint8Array(bytes)],{
        type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      const url=URL.createObjectURL(blob),link=document.createElement('a')
      link.href=url;link.download='Стоимость-запасов-'+capital.capturedAt.slice(0,10)+'.xlsx'
      document.body.appendChild(link);link.click();link.remove()
      window.setTimeout(()=>URL.revokeObjectURL(url),1000)
    }catch(e){setExportError(e instanceof Error?e.message:'Не удалось выгрузить файл')}
    finally{setExporting(false)}
  }
  async function downloadDocument(){
    if(!capital||loading||documentExporting)return
    setDocumentExporting(true);setExportError('')
    try{
      const {buildWarehouseCapitalDocx}=await import('./warehouseReportDocument')
      const blob=await buildWarehouseCapitalDocx({capital,choice:{source,category}})
      const url=URL.createObjectURL(blob),link=document.createElement('a')
      link.href=url;link.download='Финансовый-отчёт-склада-'+capital.capturedAt.slice(0,10)+'.docx'
      document.body.appendChild(link);link.click();link.remove()
      window.setTimeout(()=>URL.revokeObjectURL(url),1000)
    }catch(e){setExportError(e instanceof Error?e.message:'Не удалось подготовить документ')}
    finally{setDocumentExporting(false)}
  }
  if(!active||!isAdmin)return null
  return <section className="warehouse-report-page warehouse-capital-page" aria-label="Стоимость запасов">
    <header className="warehouse-report-head">
      <div><span className="warehouse-report-eyebrow">СКЛАД · ФИНАНСЫ</span>
        <h2>Стоимость товарных запасов</h2>
        <p>Оценка текущих физических остатков склада и бутика, вплоть до цвета и размера.</p>
      </div>
      <div className="warehouse-capital-actions">
        <button type="button" className="primary" disabled={!capital||loading||documentExporting}
          onClick={()=>void downloadDocument()}>{documentExporting?'Формируем…':'Красивый отчёт · Word'}</button>
        <button type="button" className="secondary" disabled={!capital||loading||exporting}
          onClick={()=>void download()}>{exporting?'Формируем…':'Таблицы Excel'}</button>
        <button type="button" className="secondary" disabled={loading}
          onClick={()=>setRefresh(n=>n+1)}>Обновить</button>
      </div>
    </header>
    {loading&&<div className="warehouse-report-info" role="status">Получаем оценку склада…</div>}
    {error&&<div className="warehouse-report-error" role="alert">{error}</div>}
    {exportError&&<div className="warehouse-report-error" role="alert">{exportError}</div>}
    {capital&&<>
      <p className="warehouse-report-snapshot">Данные на {new Intl.DateTimeFormat('ru-RU',{
        timeZone:'Asia/Almaty',dateStyle:'medium',timeStyle:'short',
      }).format(new Date(capital.capturedAt))}. Суммы рассчитываются по текущим ценам каталога.</p>
      <div className="warehouse-report-filters">
        <label>Источник <select value={source} onChange={e=>{setSource(e.target.value as typeof source);setVisible(30)}}>
          <option value="all">Склад и бутик</option><option value="warehouse">Только склад</option>
          <option value="boutique">Только бутик</option>
        </select></label>
        <label>Категория <select value={category} onChange={e=>{setCategory(e.target.value);setVisible(30)}}>
          <option value="all">Все категории</option><option value="adult">Взрослые</option>
          <option value="child">Детские</option><option value="unknown">Не указано</option>
        </select></label>
      </div>
      <section className="warehouse-capital-overview">
        <div className="warehouse-capital-simple-kpis">
          <div className="warehouse-capital-main-card">
            <span>Товаров в наличии</span>
            <strong>{num(totals.quantity)} шт.</strong>
            <div className="warehouse-capital-main-split">
              <span>Свободно <b>{num(totals.free)}</b></span>
              <span>В резерве <b>{num(totals.reserved)}</b></span>
            </div>
          </div>
          <div className="warehouse-capital-main-card is-cost">
            <span>Себестоимость · известная часть</span>
            <strong>{totals.costQty?money(totals.cost):'Не оценена'}</strong>
            <div className="warehouse-capital-main-split">
              <span>Свободно <b>{totals.costQty?money(totals.freeCost):'—'}</b></span>
              <span>В резерве <b>{totals.costQty?money(totals.reservedCost):'—'}</b></span>
            </div>
          </div>
          <div className="warehouse-capital-main-card is-sale">
            <span>Продажная стоимость · известная часть</span>
            <strong>{totals.revenueQty?money(totals.revenue):'Не оценено'}</strong>
            <div className="warehouse-capital-main-split">
              <span>Свободно <b>{totals.revenueQty?money(totals.freeRevenue):'—'}</b></span>
              <span>В резерве <b>{totals.revenueQty?money(totals.reservedRevenue):'—'}</b></span>
            </div>
          </div>
        </div>
        <div className="warehouse-capital-coverage">
          <Coverage title="Известна себестоимость" count={totals.costQty} total={totals.quantity}/>
          <Coverage title="Известна цена продажи" count={totals.revenueQty} total={totals.quantity}/>
        </div>
      </section>
      {source==='all'&&sourceGroups.length>1&&<section className="warehouse-capital-location">
        <h3>Где находится товар</h3>
        <div className="warehouse-capital-location-grid">
          {sourceGroups.map(g=><div key={g.name}>
            <b>{g.name}</b><strong>{num(g.summary.quantity)} шт.</strong>
            <span className="warehouse-capital-meter-track"><span style={{width:
              (totals.quantity?g.summary.quantity/totals.quantity*100:0)+'%'}}/></span>
          </div>)}
        </div>
      </section>}
      <div className="warehouse-capital-models">
        <div className="warehouse-capital-models-head">
          <div><h3>Стоимость по моделям</h3>
            <p></p></div>
          <span>{found.length} моделей · {rows.length} позиций</span>
        </div>
        <div className="warehouse-capital-controls">
          <label>Найти модель
            <input type="search" value={query} onChange={e=>{setQuery(e.target.value);setVisible(30)}}
              placeholder="Название товара"/>
          </label>
          <label>Сортировка <select value={order} onChange={e=>setOrder(e.target.value as OrderBy)}>
            <option value="cost">По средствам в остатках</option>
            <option value="revenue">По потенциальной выручке</option>
            <option value="quantity">По количеству</option>
            
          </select></label>
        </div>
        <div className="warehouse-capital-model-list">{found.slice(0,visible).map(model=>
          <details className="warehouse-capital-model" key={model.key}>
            <summary className="warehouse-capital-model-head">
              <span className="warehouse-capital-model-title"><b>{model.name}</b>
                <small>{num(model.summary.quantity)} шт. · {num(model.summary.reserved)} в резерве · {num(model.summary.free)} свободно</small>
                <span className="warehouse-capital-model-bar"><span style={{width:
                  (model.summary.cost/biggest*100)+'%'}}/></span>
              </span>
              <span className="warehouse-capital-model-values">
                <strong>{model.summary.costQty?money(model.summary.cost):'Нет себестоимости'}</strong>
                <small>По цене продажи: {model.summary.revenueQty?money(model.summary.revenue):'неизвестно'}</small>
              </span>
              <span className="warehouse-capital-chevron" aria-hidden="true">⌄</span>
            </summary>
            <div className="warehouse-capital-model-content">
              {(model.summary.costQty<model.summary.quantity||model.summary.revenueQty<model.summary.quantity)&&
                <p>Оценено по себестоимости: {num(model.summary.costQty)} шт.;
                  по цене продажи: {num(model.summary.revenueQty)} из {num(model.summary.quantity)} шт.</p>}
              {sortGroups(groupBy(model.items,executionKey,executionName),'cost').map(execution=>
                <details className="warehouse-capital-execution" key={execution.key}>
                  <summary><b>{execution.name}</b>
                    <span>{num(execution.summary.quantity)} шт. · себестоимость
                      {' '}{execution.summary.costQty?money(execution.summary.cost):'неизвестна'}
                      {' '}· продажа {execution.summary.revenueQty?money(execution.summary.revenue):'неизвестна'}</span>
                    <span aria-hidden="true">⌄</span>
                  </summary>
                  <StockDetails rows={execution.items}/>
                </details>)}
            </div>
          </details>)}
          {!found.length&&<p className="warehouse-report-info">По выбранным условиям моделей нет.</p>}
        </div>
        {visible<found.length&&<button type="button" className="secondary warehouse-capital-more"
          onClick={()=>setVisible(v=>v+30)}>Показать ещё модели ({num(found.length-visible)})</button>}
      </div>
      {(capital.totals.negativeRows>0||capital.totals.overReservedRows>0)&&
        <div className="warehouse-capital-data-issues">
          Расхождения учёта: {num(capital.totals.negativeRows)} отрицательных остатков,
          {' '}{num(capital.totals.overReservedRows)} случаев резерва выше наличия.
        </div>}
    </>}
  </section>
}
