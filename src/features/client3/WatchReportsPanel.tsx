import {useMemo,useState} from 'react'
import {CityOrdersExplorer} from '../renderers/CityOrdersExplorer'
import {WatchReportDayDetails} from './WatchReportDayDetails'
import type {WatchBrand} from '../../../shared/client3/watch-domain'
import {LinkedTableScroll} from '../../components/tables/LinkedTableScroll'
import {useWatchAnalytics,watchMoney,watchPeriod,type AnalyticsRow} from './useWatchAnalytics'

type ReportType='payments'|'managers'|'products'|'cities'|'days'|'returns'|'debts'
const choices:{value:ReportType;label:string;note:string}[]=[
 {value:'payments',label:'Оплаты',note:'Фактические денежные операции по способам оплаты'},
 {value:'managers',label:'Менеджеры',note:'Продажи и долги за период по менеджерам'},
 {value:'products',label:'Товары',note:'Проданные модели часов и цены реализации'},
 {value:'cities',label:'Города',note:'Заказы и выручка по городам'},
 {value:'days',label:'Продажи по дням',note:'Количество и сумма заказов по датам'},
 {value:'returns',label:'Возвраты',note:'Денежные возвраты по дате проведения'},
 {value:'debts',label:'Долги',note:'Долги по менеджерам и текущая задолженность'},
]
const s=(row:AnalyticsRow,key:string)=>String(row[key]??'—')
const n=(row:AnalyticsRow,key:string)=>Number(row[key]||0)
const escapeHtml=(x:unknown)=>String(x??'').replaceAll('&','&amp;').replaceAll('<','&lt;')
  .replaceAll('>','&gt;').replaceAll('"','&quot;')
function exportTable(name:string,head:string[],rows:string[][],format:'word'|'csv'){
 const separator='\t'
 const table='<h2>'+escapeHtml(name)+'</h2><table border="1" cellspacing="0" cellpadding="6">'+
  '<thead><tr>'+head.map(x=>'<th>'+escapeHtml(x)+'</th>').join('')+'</tr></thead><tbody>'+
  rows.map(row=>'<tr>'+row.map(x=>'<td>'+escapeHtml(x)+'</td>').join('')+'</tr>').join('')+
  '</tbody></table>'
 const csv=[head,...rows].map(row=>row.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(separator)).join('\r\n')
 const blob=new Blob([format==='word'?'<html><meta charset="utf-8"><body>'+table+'</body></html>':'\ufeff'+csv],
   {type:format==='word'?'application/msword':'text/tab-separated-values;charset=utf-8'})
 const url=URL.createObjectURL(blob),a=document.createElement('a')
 a.href=url;a.download=name.replace(/[^a-zA-Zа-яА-ЯёЁ0-9-_ ]/g,'')+(format==='word'?'.doc':'.tsv')
 document.body.appendChild(a);a.click();a.remove()
 window.setTimeout(()=>URL.revokeObjectURL(url),1000)
}
export function WatchReportsPanel({brands,onOpenOrder}:{brands:readonly WatchBrand[];
 onOpenOrder?:(order:{brand:WatchBrand;orderId:number;externalId:string;orderDate:string})=>void
}){
 const [brand,setBrand]=useState<WatchBrand>(brands[0]||'TAUWACH')
 const [period,setPeriod]=useState(watchPeriod('month'))
 const [type,setType]=useState<ReportType>('payments')
 const [selectedDate,setSelectedDate]=useState<string|null>(null)
 const {data,busy,error,refresh}=useWatchAnalytics(brand,period.from,period.to)
 const current=choices.find(x=>x.value===type)!
 const report=useMemo(()=>{
   if(!data)return {head:[] as string[],rows:[] as string[][],total:''}
   switch(type){
     case 'payments':return {
       head:['Способ оплаты','Поступило','Возвращено','Чистое движение','Событий'],
       rows:data.methods.map(x=>[s(x,'method'),watchMoney(n(x,'incoming')),
         watchMoney(n(x,'outgoing')),watchMoney(n(x,'net')),s(x,'eventCount')]),
       total:'Все поступления: '+watchMoney(data.income.incoming)+
         ' · Возвраты: '+watchMoney(data.income.outgoing)+
         ' · Чистое движение: '+watchMoney(data.income.net),
     }
     case 'managers':return {
       head:['Менеджер','Заказов','Продажи','Получено по заказам','Возвраты','Долг','Средний чек'],
       rows:data.managers.map(x=>[s(x,'manager'),s(x,'orderCount'),
         watchMoney(n(x,'totalSales')),watchMoney(n(x,'receivedFromOrders')),
         watchMoney(n(x,'returnedOnOrders')),watchMoney(n(x,'debt')),watchMoney(n(x,'avgCheck'))]),
       total:'Продаж: '+watchMoney(data.overview.totalSales)+' · Заказов: '+data.overview.orderCount,
     }
     case 'products':return {
       head:['Модель часов','Продано, шт.','Заказов','Выручка по позициям','Средняя цена'],
       rows:data.products.map(x=>[s(x,'product'),s(x,'quantity'),s(x,'orderCount'),
         watchMoney(n(x,'revenue')),watchMoney(n(x,'avgUnitPrice'))]),
       total:'Моделей: '+data.products.length+
         ' · Продано единиц: '+data.products.reduce((a,x)=>a+n(x,'quantity'),0),
     }
     case 'cities':return {
       head:['Город','Заказов','Сумма заказов','Получено по заказам','Долг'],
       rows:data.cities.map(x=>[s(x,'city'),s(x,'orderCount'),
         watchMoney(n(x,'totalSales')),watchMoney(n(x,'receivedFromOrders')),
         watchMoney(n(x,'debt'))]),
       total:'Городов: '+data.cities.length+' · Заказов: '+data.overview.orderCount,
     }
     case 'days':return {
       head:['Дата заказа','Заказов','Продажи','Получено по заказам'],
       rows:data.days.map(x=>[s(x,'date'),s(x,'orderCount'),
         watchMoney(n(x,'totalSales')),watchMoney(n(x,'receivedFromOrders'))]),
       total:'Всего заказов: '+data.overview.orderCount+
         ' · Сумма: '+watchMoney(data.overview.totalSales),
     }
     case 'returns':return {
       head:['Дата возврата','Заказ','Способ','Тип операции','Возвращено'],
       rows:data.events.filter(x=>n(x,'amountDelta')<0).map(x=>[
         s(x,'eventDate'),s(x,'externalOrderId'),s(x,'paymentMethod'),
         s(x,'eventType'),watchMoney(-n(x,'amountDelta'))]),
       total:'Денежные возвраты за период: '+watchMoney(data.income.outgoing),
     }
     case 'debts':return {
       head:['Менеджер','Заказов за период','Продажи','Долг по заказам периода'],
       rows:data.managers.map(x=>[s(x,'manager'),s(x,'orderCount'),
         watchMoney(n(x,'totalSales')),watchMoney(n(x,'debt'))]),
       total:'Актуальный долг всех заказов бренда: '+watchMoney(data.currentDebt.currentDebt)+
         ' · С долгом: '+data.currentDebt.orderCount,
     }
   }
 },[data,type])
 const name=brand+' '+current.label+' '+period.from+' — '+period.to
 const cityRows=(data?.cities||[]).map(row=>({
   city:s(row,'city'),order_count:n(row,'orderCount'),
   total_sales:n(row,'totalSales'),total_received:n(row,'receivedFromOrders'),
   total_debt:n(row,'debt'),clients:0,managers:0,
 }))
 // The Main CityOrdersExplorer is reused unchanged, including its dialog.
 const cityApiFetch=(path:string)=>{
   const requested=new URL(path,window.location.origin).searchParams
   requested.set('brand',brand)
   return fetch('/api/client3/watches/analytics/city-orders?'+requested,{
     credentials:'include',cache:'no-store',
   })
 }
 return <article className="card wide sector-reports" id="reports">
   <div className="card-label">Отчёты</div>
   <div className="card-meta">Отчёты Main по часам выбранного бренда. Продажи — по дате заказа; оплаты и возвраты — по дате операции.</div>
   <div className="orders-filter-panel reports-workspace-panel">
     <div className="reports-filter-header">
       <div><h3>Сводные отчёты</h3>
         <div className="muted-note">Отдельные данные TAUWACH и WACHIZEN. Строгая серверная проверка доступа к бренду.</div>
       </div>
       <div className="reports-period-buttons" role="group" aria-label="Период отчёта">
         {(['today','yesterday','month','year'] as const).map((value,i)=>
           <button className="secondary compact" type="button" key={value}
             onClick={()=>setPeriod(watchPeriod(value))}>{['Сегодня','Вчера','Месяц','Год'][i]}</button>)}
       </div>
     </div>
     <div className="orders-filter-grid reports-main-filter-grid">
       <label>Бренд<select value={brand} onChange={e=>{setBrand(e.target.value as WatchBrand);setSelectedDate(null)}}>
         {brands.map(x=><option key={x} value={x}>{x}</option>)}
       </select></label>
       <label>Тип отчёта<select value={type} onChange={e=>{setType(e.target.value as ReportType);setSelectedDate(null)}}>
         {choices.map(x=><option value={x.value} key={x.value}>{x.label}</option>)}
       </select></label>
       <label>Начало периода<input type="date" value={period.from}
         onChange={e=>setPeriod(p=>({...p,from:e.target.value}))}/></label>
       <label>Конец периода<input type="date" value={period.to}
         onChange={e=>setPeriod(p=>({...p,to:e.target.value}))}/></label>
       <div className="actions orders-filter-actions">
         <button className="primary" disabled={busy} onClick={refresh}>
           {busy?'Считаю…':'Показать отчёт'}</button>
       </div>
     </div>
   </div>
   {error&&<p role="alert" className="app-alert error">{error}</p>}
   <div className="strict-report-header">
     <div className="strict-report-title-row"><div>
       <h2>{current.label}</h2><p className="strict-report-note">{current.note}</p>
     </div><span className="strict-report-period">{period.from} — {period.to}</span></div>
   </div>
   <div className="report-export-actions">
     <button type="button" className="secondary compact" disabled={!data}
       onClick={()=>exportTable(name,report.head,report.rows,'word')}>Скачать Word</button>
     <button type="button" className="secondary compact" disabled={!data}
       onClick={()=>window.print()}>PDF / печать</button>
     <button type="button" className="secondary compact" disabled={!data}
       onClick={()=>exportTable(name,report.head,report.rows,'csv')}>Выгрузить таблицу</button>
   </div>
   <section className="report-stat-section">
     <h3>Общая статистика за период</h3>
     <div className="table-shell"><table className="data-table strict-report-table report-stat-table">
       <thead><tr><th>Бренд</th><th>Период</th><th>Результат</th></tr></thead>
       <tbody><tr><td>{brand}</td><td>{period.from} — {period.to}</td>
         <td>{report.total}</td></tr></tbody>
     </table></div>
   </section>
   {type==='cities'&&data?
     <CityOrdersExplorer key={brand+'-'+period.from+'-'+period.to}
       rows={cityRows} apiFetch={cityApiFetch}
       startDate={period.from} endDate={period.to}
       formatDateShort={value=>value.split('-').reverse().join('.')}
       formatMoney={watchMoney}
       onOpenOrder={order=>onOpenOrder?.({...order,brand})}/>:
     <section className="report-table-card">
       <div className="strict-section-head"><h3>{current.label}</h3>
         <span className="soft-badge">{data?report.rows.length:'—'} строк</span></div>
       <LinkedTableScroll ariaLabel={'Отчёт '+current.label}>
         <table className="data-table strict-report-table">
           <thead><tr>{report.head.map(x=><th key={x}>{x}</th>)}</tr></thead>
           <tbody>{report.rows.map((row,i)=><tr key={i}>{row.map((value,j)=>
             <td className={j?'num':undefined} key={j}>
               {type==='days'&&j===0?
                 <button className="city-report-city-link" type="button"
                   aria-expanded={selectedDate===value}
                   onClick={()=>setSelectedDate(selectedDate===value?null:value)}>
                   {value}
                 </button>:value}
             </td>)}</tr>)}
             {data&&!report.rows.length&&<tr><td className="empty-state" colSpan={report.head.length||1}>
               Нет данных за выбранный период.</td></tr>}
           </tbody>
         </table>
       </LinkedTableScroll>
     </section>}
   {type==='days'&&selectedDate&&
     <WatchReportDayDetails key={brand+'-'+selectedDate} brand={brand}
       date={selectedDate} onClose={()=>setSelectedDate(null)}/>}
   {(type==='payments'||type==='returns')&&data&&
     <section className="strict-report-section">
       <div className="strict-section-head"><h3>Детализация денег по дням</h3>
         <span className="soft-badge">по дате операции</span></div>
       <div className="table-shell"><table className="data-table strict-report-table">
         <thead><tr><th>Дата</th><th className="num">Поступило</th>
           <th className="num">Возвращено</th><th className="num">Чистое</th></tr></thead>
         <tbody>{data.eventDays.map(x=><tr key={s(x,'date')}>
           <td>{s(x,'date')}</td><td className="num">{watchMoney(n(x,'incoming'))}</td>
           <td className="num">{watchMoney(n(x,'outgoing'))}</td>
           <td className="num">{watchMoney(n(x,'net'))}</td></tr>)}</tbody>
       </table></div>
     </section>}
 </article>
}
