import {useEffect,useMemo,useState} from 'react'
import {watchReferenceLabel,type WatchBrand} from '../../../shared/client3/watch-domain'
import {LinkedTableScroll} from '../../components/tables/LinkedTableScroll'
import {watchMoney,watchPeriod} from './useWatchAnalytics'

type DemandRow={watchVariantId:number;modelName:string;gender:string;movement:string;
 braceletMaterial:string;dialColor:string;braceletColor:string;orderCount:number;
 soldQuantity:number;returnedQuantity:number;netQuantity:number;
 revenue:number;averagePrice:number;minSalePrice:number;maxSalePrice:number}
type Summary={variants:number;soldQuantity:number;returnedQuantity:number;netQuantity:number;revenue:number}
type Response={ok:boolean;message?:string;rows?:DemandRow[];summary?:Summary;hasMore?:boolean;nextOffset?:number}
const describe=(row:DemandRow)=>[
 row.gender==='male'?'Мужские':'Женские',watchReferenceLabel('movements',row.movement),
 watchReferenceLabel('bracelets',row.braceletMaterial),watchReferenceLabel('dials',row.dialColor),
 row.braceletColor?'Ремешок: '+watchReferenceLabel('leatherColors',row.braceletColor):'',
].filter(Boolean).join(' · ')
const count=(n:unknown)=>Number(n||0).toLocaleString('ru-RU')
export function WatchDemandPanel({brand}:{brand:WatchBrand}){
 const [period,setPeriod]=useState(watchPeriod('month'))
 const [rows,setRows]=useState<DemandRow[]>([])
 const [summary,setSummary]=useState<Summary|null>(null)
 const [hasMore,setHasMore]=useState(false)
 const [busy,setBusy]=useState(false)
 const [error,setError]=useState('')
 const [revision,setRevision]=useState(0)
 const [offset,setOffset]=useState(0)
 useEffect(()=>{
   const controller=new AbortController()
   setBusy(true);setError('')
   if(offset===0){setRows([]);setSummary(null)}
   const q=new URLSearchParams({brand,from:period.from,to:period.to,limit:'100',offset:String(offset)})
   void fetch('/api/client3/watches/stock/demand?'+q,{credentials:'include',cache:'no-store',signal:controller.signal})
    .then(async r=>{
      const v=await r.json() as Response
      if(!r.ok||!v.ok)throw Error(v.message||'Статистика склада недоступна.')
      if(!controller.signal.aborted){
        setRows(current=>offset===0?(v.rows||[]):[...current,...(v.rows||[])])
        setSummary(v.summary||null);setHasMore(Boolean(v.hasMore))
      }
    }).catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Не удалось загрузить статистику.')})
      .finally(()=>{if(!controller.signal.aborted)setBusy(false)})
   return ()=>controller.abort()
 },[brand,period.from,period.to,offset,revision])
 const choose=(value:'today'|'yesterday'|'month'|'year')=>{
   setOffset(0);setPeriod(watchPeriod(value))
 }
 const popular=useMemo(()=>{
   const colors=new Map<string,number>(),bracelets=new Map<string,number>()
   for(const row of rows){
     const color=watchReferenceLabel('dials',row.dialColor)
     const bracelet=watchReferenceLabel('bracelets',row.braceletMaterial)
     colors.set(color,(colors.get(color)||0)+Number(row.netQuantity||0))
     bracelets.set(bracelet,(bracelets.get(bracelet)||0)+Number(row.netQuantity||0))
   }
   const sorted=(m:Map<string,number>)=>[...m].sort((a,b)=>b[1]-a[1]).slice(0,5)
   return {colors:sorted(colors),bracelets:sorted(bracelets)}
 },[rows])
 return <section className="client3-watch-demand">
   <div className="card-label">Статистика склада · {brand}</div>
   <p className="card-meta">Продажи считаются по дате заказа и фактическим ценам в заказах,
     включая ещё не отправленные часы. Возвраты товаров вычитаются из количества.
     Денежные возвраты отражаются отдельно в финансовом отчёте.</p>
   <div className="orders-filter-panel"><div className="reports-period-buttons" role="group" aria-label="Период спроса">
     {(['today','yesterday','month','year'] as const).map((value,i)=>
       <button type="button" className="secondary compact" key={value}
         onClick={()=>choose(value)}>{['Сегодня','Вчера','Месяц','Год'][i]}</button>)}
   </div><div className="orders-filter-grid">
     <label>Начало<input type="date" value={period.from} onChange={e=>{setOffset(0);setPeriod(p=>({...p,from:e.target.value}))}}/></label>
     <label>Конец<input type="date" value={period.to} onChange={e=>{setOffset(0);setPeriod(p=>({...p,to:e.target.value}))}}/></label>
     <button type="button" className="primary" disabled={busy} onClick={()=>{setOffset(0);setRevision(x=>x+1)}}>
       {busy?'Загружаю…':'Обновить статистику'}</button>
   </div></div>
   {error&&<p role="alert" className="app-alert error">{error}</p>}
   {busy&&<p role="status">Считаю продажи комплектаций…</p>}
   {summary&&<div className="summary-grid compact-summary">
     <div className="summary-card"><span>Продано по заказам</span><strong>{count(summary.soldQuantity)} шт.</strong></div>
     <div className="summary-card"><span>Возвращено</span><strong>{count(summary.returnedQuantity)} шт.</strong></div>
     <div className="summary-card"><span>После возвратов</span><strong>{count(summary.netQuantity)} шт.</strong></div>
     <div className="summary-card"><span>Сумма продаж</span><strong>{watchMoney(summary.revenue)}</strong></div>
     <div className="summary-card"><span>Комплектаций</span><strong>{count(summary.variants)}</strong></div>
   </div>}
   <div className="grid-two">
     <section className="mini-panel"><h3>Популярные цвета циферблата</h3>
       {popular.colors.map(([name,qty])=><div className="watch-demand-popular" key={name}>
         <span>{name}</span><strong>{count(qty)} шт.</strong></div>)}
       {!popular.colors.length&&<p>Нет продаж.</p>}
     </section>
     <section className="mini-panel"><h3>Популярные браслеты</h3>
       {popular.bracelets.map(([name,qty])=><div className="watch-demand-popular" key={name}>
         <span>{name}</span><strong>{count(qty)} шт.</strong></div>)}
       {!popular.bracelets.length&&<p>Нет продаж.</p>}
     </section>
   </div>
   {hasMore&&<p className="mini-panel-note">Популярность выше рассчитана по {rows.length} загруженным комплектациям.
     Для окончательной разбивки загрузите все страницы.</p>}
   <h3>Продажи по моделям и комплектациям</h3>
   <LinkedTableScroll ariaLabel="Статистика комплектаций часов"><table className="data-table strict-report-table">
     <thead><tr><th>Модель</th><th>Характеристики</th><th>Заказов</th>
       <th>Продано</th><th>Возврат</th><th>Итого шт.</th><th>Выручка</th>
       <th>Средняя цена</th><th>Диапазон цен</th></tr></thead>
     <tbody>{rows.map(row=><tr key={row.watchVariantId}>
       <td><strong>{row.modelName}</strong></td><td>{describe(row)}</td>
       <td className="num">{count(row.orderCount)}</td>
       <td className="num">{count(row.soldQuantity)}</td>
       <td className="num">{count(row.returnedQuantity)}</td>
       <td className="num"><strong>{count(row.netQuantity)}</strong></td>
       <td className="num">{watchMoney(row.revenue)}</td>
       <td className="num">{watchMoney(row.averagePrice)}</td>
       <td className="num">{watchMoney(row.minSalePrice)} — {watchMoney(row.maxSalePrice)}</td>
     </tr>)}
     {!busy&&!rows.length&&<tr><td colSpan={9}>Продаж за выбранный период нет.</td></tr>}
     </tbody></table></LinkedTableScroll>
   {hasMore&&<button type="button" className="secondary" disabled={busy}
     onClick={()=>setOffset(rows.length)}>{busy?'Загрузка…':'Показать ещё комплектации'}</button>}
 </section>
}
