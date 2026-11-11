import {useEffect,useMemo,useState} from 'react'
import type {WarehouseCapitalSnapshot,WarehouseCapitalRow} from '../../../../shared/warehouse-capital-types.ts'
import type {WarehouseFinanceChoice} from './warehouseReportExcel'
import './warehouse-report-workspace.css'

type Props={active:boolean;isAdmin:boolean}
type OrderBy='cost'|'revenue'|'quantity'|'gross'
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
const pct=(a:number,b:number)=>b?(a/b*100).toFixed(1).replace('.',',')+'%':'—'
const label=(s:string)=>s||'Не указано'
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
  const field={cost:'cost',revenue:'revenue',quantity:'quantity',gross:'gross'}[order] as keyof Summary
  return b.summary[field]-a.summary[field]||a.name.localeCompare(b.name,'ru')
})
const sourceNames:{[key:string]:string}={warehouse:'Склад',boutique:'Бутик'}
const executionKey=(r:WarehouseCapitalRow)=>[r.gender,r.material,r.length,r.category].join('\u001f')
const executionName=(r:WarehouseCapitalRow)=>[r.material,r.length,r.gender,r.category].filter(Boolean).join(' · ')
function Amount({value,known}:{value:number;known:boolean}){
  return <span>{known?money(value):'Цена неизвестна'}</span>
}
function OverviewCard({labelText,value,note}:{labelText:string;value:string;note:string}){
  return <div className="warehouse-report-kpi"><span>{labelText}</span><strong>{value}</strong><small>{note}</small></div>
}
function StockDetails({rows}:{rows:WarehouseCapitalRow[]}){
  return <>
    <div className="warehouse-capital-table-scroll">
      <table className="warehouse-capital-table">
        <thead><tr><th>Источник</th><th>Цвет / размер</th><th>В наличии</th><th>Резерв</th><th>Свободно</th>
          <th>Себестоимость / шт.</th><th>Цена / шт.</th><th>Средства в товаре</th>
          <th>Возможная выручка</th><th>Возможная маржа</th></tr></thead>
        <tbody>{rows.map(r=><tr key={r.stockId}>
          <td>{sourceNames[r.source]||r.source}</td><td><strong>{label(r.color)}</strong><small>{label(r.size)}{r.archived?' · архив':''}</small></td>
          <td>{num(r.quantity)}</td><td>{num(r.reserved)}</td><td>{num(r.free)}</td>
          <td><Amount value={r.costPrice||0} known={r.costPrice!==null}/></td>
          <td><Amount value={r.salePrice||0} known={r.salePrice!==null}/></td>
          <td><Amount value={r.costValue||0} known={r.costValue!==null}/></td>
          <td><Amount value={r.retailValue||0} known={r.retailValue!==null}/></td>
          <td><Amount value={r.grossPotential||0} known={r.grossPotential!==null}/></td>
        </tr>)}</tbody>
      </table>
    </div>
    <div className="warehouse-capital-mobile">
      {rows.map(r=><div className="warehouse-capital-mobile-item" key={r.stockId}>
        <strong>{label(r.color)} · {label(r.size)}</strong>
        <small>{sourceNames[r.source]||r.source}{r.archived?' · архив':''}</small>
        <div><span>В наличии / резерв / свободно</span><b>{num(r.quantity)} / {num(r.reserved)} / {num(r.free)}</b></div>
        <div><span>Себестоимость / цена за шт.</span><b>{r.costPrice===null?'—':money(r.costPrice)} / {r.salePrice===null?'—':money(r.salePrice)}</b></div>
        <div><span>Средства / выручка</span><b>{r.costValue===null?'—':money(r.costValue)} / {r.retailValue===null?'—':money(r.retailValue)}</b></div>
        <div><span>Потенциальная маржа</span><b>{r.grossPotential===null?'—':money(r.grossPotential)}</b></div>
      </div>)}
    </div>
  </>
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
  const coveredMargin=pct(totals.gross,totals.comparableRevenue)
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
  if(!active||!isAdmin)return null
  return <section className="warehouse-report-page warehouse-capital-page" aria-label="Стоимость запасов">
    <header className="warehouse-report-head">
      <div><span className="warehouse-report-eyebrow">СКЛАД · ФИНАНСЫ</span>
        <h2>Стоимость товарных запасов</h2>
        <p>Оценка текущих физических остатков склада и бутика, вплоть до цвета и размера.</p>
      </div>
      <div className="warehouse-capital-actions">
        <button type="button" className="primary" disabled={!capital||loading||exporting}
          onClick={()=>void download()}>{exporting?'Формируем…':'Скачать Excel'}</button>
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
      <div className="warehouse-report-kpis">
        <OverviewCard labelText="Средства в остатках" value={money(totals.cost)}
          note={'Себестоимость известна для '+num(totals.costQty)+' из '+num(totals.quantity)+' шт.'}/>
        <OverviewCard labelText="Потенциальная выручка" value={money(totals.revenue)}
          note={'Цена продажи известна для '+num(totals.revenueQty)+' из '+num(totals.quantity)+' шт.'}/>
        <OverviewCard labelText="Потенциальная валовая маржа" value={money(totals.gross)}
          note={'Обе цены известны для '+num(totals.bothQty)+' шт. · '+coveredMargin+' от сопоставимой выручки'}/>
        <OverviewCard labelText="Физически / резерв / свободно" value={num(totals.quantity)+' / '+num(totals.reserved)+' / '+num(totals.free)}
          note="Резерв уже входит в физический запас, отдельно не прибавляется"/>
      </div>
      <div className="warehouse-capital-secondary">
        <div><small>Свободный товар по цене продажи</small><strong>{money(totals.freeRevenue)}</strong></div>
        <div><small>Зарезервированный по цене продажи</small><strong>{money(totals.reservedRevenue)}</strong></div>
        <div><small>Свободный товар по себестоимости</small><strong>{money(totals.freeCost)}</strong></div>
        <div><small>Зарезервированный по себестоимости</small><strong>{money(totals.reservedCost)}</strong></div>
      </div>
      <div className="warehouse-report-note">
        <b>Оценка, а не точная прибыль.</b> Если себестоимость или цена отсутствуют, соответствующая сумма неполная.
        Неизвестную цену не заменяем нулём или средней. Это не историческая закупочная стоимость и не прогноз оплаты.
      </div>
      <div className="warehouse-capital-models">
        <div className="warehouse-capital-models-head">
          <div><h3>Модели и стоимость</h3>
            <p>Раскройте модель, затем исполнение — увидите все цвета, размеры и цены.</p></div>
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
            <option value="gross">По потенциальной марже</option>
          </select></label>
        </div>
        <div className="warehouse-capital-model-list">{found.slice(0,visible).map(model=>
          <details className="warehouse-capital-model" key={model.key}>
            <summary className="warehouse-capital-model-head">
              <span className="warehouse-capital-model-title"><b>{model.name}</b>
                <small>{num(model.summary.quantity)} шт. · {num(model.summary.reserved)} резерв · {num(model.summary.free)} свободно</small>
              </span>
              <span className="warehouse-capital-model-values">
                <strong>{money(model.summary.cost)}</strong>
                <small>Потенциально {money(model.summary.revenue)} · маржа {money(model.summary.gross)}</small>
              </span>
              <span className="warehouse-capital-chevron" aria-hidden="true">⌄</span>
            </summary>
            <div className="warehouse-capital-model-content">
              <p>Себестоимость известна для {num(model.summary.costQty)} из {num(model.summary.quantity)} шт.;
                цена продажи — для {num(model.summary.revenueQty)} шт.</p>
              {sortGroups(groupBy(model.items,executionKey,executionName),'cost').map(execution=>
                <details className="warehouse-capital-execution" key={execution.key}>
                  <summary><b>{execution.name}</b>
                    <span>{num(execution.summary.quantity)} шт. · себ. {money(execution.summary.cost)}
                      · продажа {money(execution.summary.revenue)}</span>
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
      <p className="warehouse-report-smallnote">
        В системе отдельно отмечены {num(capital.totals.zeroRows)} строк с нулевым остатком,
        {num(capital.totals.negativeRows)} с отрицательным и
        {num(capital.totals.overReservedRows)} с резервом больше наличия.
        Эти сведения относятся ко всем источникам; нулевые и отрицательные остатки не входят в оценку.
      </p>
    </>}
  </section>
}
