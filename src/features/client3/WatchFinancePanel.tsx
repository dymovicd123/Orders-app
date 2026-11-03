import {useEffect,useRef,useState} from 'react'
import type {FormEvent} from 'react'
import type {WatchBrand} from '../../../shared/client3/watch-domain'
import {LinkedTableScroll} from '../../components/tables/LinkedTableScroll'
import {useWatchAnalytics,watchMoney,watchPeriod} from './useWatchAnalytics'
import '../../styles/140-finance-truth.css'
import '../../styles/150-orders-finance-sync.css'
import '../../styles/client3-watch-finance.css'

type Mode='summary'|'payments'|'debts'|'returns'|'cash'|'methods'
type CashEntry={id:number;type:string;businessDate:string;createdAt?:string;
 amountDelta:number;externalOrderId?:string;comment?:string;reversesEntryId?:number|null;brand?:string}
type Cash={ok:boolean;initialized:boolean;message?:string;currentBalance:number|null;
 openingAmount?:number;todayIn?:number;todayOut?:number;totalIn?:number;totalOut?:number;
 autoTrackingEnabled?:boolean;cycleStartedAt?:string;cycles?:Array<{id:number;startedAt:string;
 finishedAt:string;openingAmount:number;closingBalance:number;comment:string}>;
 entries:CashEntry[];legacyEntries?:CashEntry[]}
const moneyDate=(value:unknown)=>{
 const date=String(value||'').slice(0,10)
 return /^\d{4}-\d{2}-\d{2}$/.test(date)?date.slice(8,10)+'.'+date.slice(5,7)+'.'+date.slice(0,4):date||'—'
}
const operationLabel=(kind:unknown)=>({
 order_payment:'Оплата заказа',debt_close:'Закрытие долга',order_extra:'Доплата по заказу',
 exchange_extra:'Доплата по обмену',order_refund:'Возврат клиенту',
 exchange_refund:'Возврат при обмене',payment_correction:'Корректировка оплаты',
} as Record<string,string>)[String(kind||'')]||String(kind||'Денежное событие')
const formats:{id:Mode;label:string;hint:string}[]=[
 {id:'summary',label:'Сводка',hint:'Чёткие итоги'},
 {id:'payments',label:'Операции',hint:'По дате операции'},
 {id:'debts',label:'Долги',hint:'Текущие и закрытые'},
 {id:'returns',label:'Возвраты / обмены',hint:'По дате операции'},
 {id:'cash',label:'Касса',hint:'Наличные сейчас'},
 {id:'methods',label:'Способы оплаты',hint:'Справочник оплат'},
]
export function WatchFinancePanel({brands,isAdmin=false,onOpenReferences,onOpenOrder}:{
 brands:readonly WatchBrand[];isAdmin?:boolean;onOpenReferences?:()=>void;
 onOpenOrder?:(order:{brand:WatchBrand;orderId:number;externalId:string;orderDate:string})=>void
}){
 const [brand,setBrand]=useState<WatchBrand>(brands[0]||'TAUWACH')
 const [period,setPeriod]=useState(watchPeriod('month'))
 const [mode,setMode]=useState<Mode>('summary')
 const {data,busy,error,refresh}=useWatchAnalytics(brand,period.from,period.to)
 const [cash,setCash]=useState<Cash|null>(null)
 const [cashBusy,setCashBusy]=useState(false)
 const [cashError,setCashError]=useState('')
 const [cashNotice,setCashNotice]=useState('')
 const [cashRefresh,setCashRefresh]=useState(0)
 const [cashOpening,setCashOpening]=useState('')
 const [cashDirection,setCashDirection]=useState<'in'|'out'>('in')
 const [cashAmount,setCashAmount]=useState('')
 const [cashComment,setCashComment]=useState('')
 const [cashReconcile,setCashReconcile]=useState('')
 const [cashAction,setCashAction]=useState<'manual'|'reconcile'>('manual')
 const [cashResetComment,setCashResetComment]=useState('')
 const [cashCyclesOpen,setCashCyclesOpen]=useState(false)
 const request=useRef<{fingerprint:string;id:string}|null>(null)
 useEffect(()=>{
   if(mode!=='cash'||!isAdmin)return
   const abort=new AbortController()
   setCashBusy(true);setCash(null);setCashError('')
   void fetch('/api/client3/watches/cash',{
     credentials:'include',cache:'no-store',signal:abort.signal,
   }).then(async r=>{
     const value=await r.json() as Cash
     if(!r.ok||!value.ok)throw Error(value.message||'Касса недоступна.')
     if(!abort.signal.aborted)setCash(value)
   }).catch(e=>{if(!abort.signal.aborted)setCashError(e instanceof Error?e.message:'Ошибка кассы.')})
     .finally(()=>{if(!abort.signal.aborted)setCashBusy(false)})
   return ()=>abort.abort()
 },[mode,isAdmin,cashRefresh])
 const cashSubmit=async(e:FormEvent<HTMLFormElement>)=>{
   e.preventDefault()
   if(cashBusy||!isAdmin)return
   const payload:Record<string,unknown>={action:cash?.initialized?cashAction:'setup'}
   if(!cash?.initialized){
     payload.openingAmount=Number(cashOpening)
   }else if(cashAction==='manual'){
     payload.direction=cashDirection;payload.amount=Number(cashAmount)
     payload.comment=cashComment.trim();payload.expectedBalance=cash.currentBalance
   }else{
     payload.amount=Number(cashReconcile);payload.comment=cashComment.trim()
     payload.expectedBalance=cash.currentBalance
   }
   const fingerprint=JSON.stringify(payload)
   if(request.current?.fingerprint!==fingerprint)
     request.current={fingerprint,id:'watch-cash-'+crypto.randomUUID()}
   payload.requestId=request.current.id
   setCashBusy(true);setCashError('');setCashNotice('')
   try{
     const response=await fetch('/api/client3/watches/cash',{
       method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},
       body:JSON.stringify(payload),
     })
     const value=await response.json() as Cash
     if(!response.ok||!value.ok)throw Error(value.message||'Операция кассы не сохранена.')
     setCash(value);setCashAmount('');setCashComment('');setCashReconcile('')
     request.current=null;setCashNotice('Операция сохранена в общей кассе двух брендов.')
     refresh()
   }catch(err){setCashError(err instanceof Error?err.message:'Ошибка операции кассы.')}
   finally{setCashBusy(false)}
 }
 const cashExtra=async(action:'auto'|'reverse'|'reset',extra:Record<string,unknown>)=>{
   if(cashBusy||!cash||!cash.initialized||!isAdmin)return
   if(action==='auto'&&!window.confirm(cash.autoTrackingEnabled?
     'Остановить автоматический учёт наличных? Новые оплаты за время паузы не будут добавлены задним числом.':
     'Включить автоучёт с этого момента? Оплаты за время паузы не будут добавлены задним числом.'))return
   if(action==='reverse'&&!window.confirm('Отменить ручную операцию отдельной записью? История останется.'))return
   if(action==='reset'){
     if(cashResetComment.trim().length<3){setCashError('Укажите причину нового цикла.');return}
     if(!window.confirm('Начать НОВЫЙ цикл общей кассы? Старый журнал сохранится; новый остаток станет 0, автоучёт приостановится.'))return
   }
   const payload:Record<string,unknown>={action,expectedBalance:cash.currentBalance,...extra}
   const fingerprint=JSON.stringify(payload)
   if(request.current?.fingerprint!==fingerprint)
     request.current={fingerprint,id:'watch-cash-'+crypto.randomUUID()}
   payload.requestId=request.current.id
   setCashBusy(true);setCashError('');setCashNotice('')
   try{
     const response=await fetch('/api/client3/watches/cash',{
       method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},
       body:JSON.stringify(payload),
     })
     const value=await response.json() as Cash
     if(!response.ok||!value.ok)throw Error(value.message||'Операция кассы не сохранена.')
     setCash(value);request.current=null;setCashResetComment('')
     setCashNotice(action==='auto'?'Режим автоучёта изменён.':
       action==='reverse'?'Отмена записана отдельной операцией.':'Новый цикл открыт, старый сохранён.')
     refresh()
   }catch(e){setCashError(e instanceof Error?e.message:'Не удалось изменить кассу.')}
   finally{setCashBusy(false)}
 }
 const moneyRows=data?.events||[]
 const refunds=moneyRows.filter(row=>Number(row.amountDelta||0)<0)
 const exchanges=moneyRows.filter(row=>/exchange/i.test(String(row.eventType||'')))
 const outstanding=data?.currentDebt.currentDebt||0
 const kinds=data?.kinds||[]
 const typeMoney=(kind:string,flow:'incoming'|'outgoing')=>
   kinds.filter(row=>String(row.eventType||'')===kind)
     .reduce((total,row)=>total+Number(row[flow]||0),0)
 const orderPayments=typeMoney('order_payment','incoming')
 const debtPayments=typeMoney('debt_close','incoming')+typeMoney('order_extra','incoming')
 const exchangePayments=typeMoney('exchange_extra','incoming')
 const regularReturns=typeMoney('order_refund','outgoing')
 const exchangeReturns=typeMoney('exchange_refund','outgoing')
 const otherOutflow=Math.max(0,Number(data?.income.outgoing||0)-regularReturns-exchangeReturns)
 const auditTotal=Number(data?.income.incoming||0)
 const methodsTotal=(data?.methods||[]).reduce((n,row)=>n+Number(row.incoming||0),0)
 const kindsTotal=kinds.reduce((n,row)=>n+Number(row.incoming||0),0)
 const reconciled=Boolean(data)&&Math.abs(auditTotal-methodsTotal)<0.01&&
   Math.abs(auditTotal-kindsTotal)<0.01
 const dayMap=new Map<string,{date:string;received:number;returned:number;net:number;sales:number;orders:number}>()
 const day=(key:string)=>{
   let item=dayMap.get(key)
   if(!item){item={date:key,received:0,returned:0,net:0,sales:0,orders:0};dayMap.set(key,item)}
   return item
 }
 for(const row of data?.days||[]){
   const item=day(String(row.date||''))
   item.sales=Number(row.totalSales||0);item.orders=Number(row.orderCount||0)
 }
 for(const row of data?.eventDays||[]){
   const item=day(String(row.date||''))
   item.received=Number(row.incoming||0);item.returned=Number(row.outgoing||0)
   item.net=Number(row.net||0)
 }
 const financeDays=[...dayMap.values()].sort((a,b)=>b.date.localeCompare(a.date))
 const crossDateEvents=moneyRows.filter(row=>row.orderDate&&row.eventDate&&
   String(row.orderDate)!==String(row.eventDate))
 const earlyDatedEvents=moneyRows.filter(row=>row.orderDate&&row.eventDate&&
   String(row.eventDate)<String(row.orderDate))
 const operationsTruncated=Number(data?.moneyEventCount||0)>moneyRows.length
 const openOrder=(row:Record<string,string|number|null>)=>{
   const orderId=Number(row.orderId||row.id||0)
   if(orderId>0&&onOpenOrder)onOpenOrder({
     brand,orderId,externalId:String(row.externalOrderId||row.externalId||'#'+orderId),
     orderDate:String(row.orderDate||''),
   })
 }
 return <article className="card wide sector-finance" id="finance">
   <div className="card-label">Финансы</div>
   <div className="card-meta">Деньги показаны по дате операции. Продажи — по дате заказа. Касса общая для TAUWACH и WACHIZEN, остальные показатели разделены по брендам.</div>
   <div className="orders-filter-panel finance-workspace-panel">
     <div className="reports-filter-header">
       <div><h3>{period.from===period.to?'День':'Период'}</h3>
         <div className="muted-note">Все операции ниже относятся к выбранным датам. Поздний ввод и оплата заказа другой даты отмечаются отдельно.</div>
       </div>
       <div className="reports-period-buttons">
         {(['today','yesterday','month','year'] as const).map((p,i)=>
           <button type="button" className="secondary compact" key={p}
             aria-pressed={period.from===watchPeriod(p).from&&period.to===watchPeriod(p).to}
             onClick={()=>setPeriod(watchPeriod(p))}>
             {['Сегодня','Вчера','Месяц','Год'][i]}</button>)}
       </div>
     </div>
     <div className="orders-filter-grid reports-main-filter-grid">
       {mode!=='cash'&&<label>Бренд<select value={brand} onChange={e=>{setBrand(e.target.value as WatchBrand);request.current=null}}>
         {brands.map(x=><option value={x} key={x}>{x}</option>)}</select></label>}
       {mode!=='cash'&&mode!=='methods'&&<>
         <label>С<input type="date" value={period.from}
           onChange={e=>setPeriod(p=>({...p,from:e.target.value}))}/></label>
         <label>По<input type="date" value={period.to}
           onChange={e=>setPeriod(p=>({...p,to:e.target.value}))}/></label>
       </>}
       <div className="finance-auto-refresh"><span className={'status-pill '+(busy?'status-warning':'status-online')}>
         {busy?'Обновляем…':'Данные актуальны'}</span></div>
       <button type="button" className="secondary compact" disabled={busy}
         onClick={()=>{refresh();setCashRefresh(x=>x+1)}}>Обновить</button>
     </div>
   </div>
   <div className="finance-tabs-shell finance-truth-shell">
     <div className="order-panel-tabs finance-tabs" role="tablist" aria-label="Разделы финансов">
       {formats.filter(x=>isAdmin||x.id!=='cash').map(x=>
         <button type="button" className={'secondary compact '+(mode===x.id?'is-active':'')}
           key={x.id} onClick={()=>setMode(x.id)}>
           <strong>{x.label}</strong><span>{x.hint}</span>
         </button>)}
     </div>
   </div>
   {error&&<p role="alert" className="app-alert error">{error}</p>}
   {busy&&<p>Загружаем финансы…</p>}

   {mode==='summary'&&<div className="finance-truth-content">
     <section className="mini-panel finance-overview-panel finance-truth-overview">
       <div className="mini-panel-head"><div><h3>Итоги за выбранный период</h3>
         <p className="mini-panel-note">Деньги показаны по дате оплаты или возврата. Продажи — по дате заказа.</p>
       </div><span className="status-pill status-online">{moneyDate(period.from)} — {moneyDate(period.to)}</span></div>
       <div className="finance-truth-grid">
         <article className="finance-truth-card is-income">
           <div className="finance-truth-card-head"><span>Поступило</span><small>по дате оплаты</small></div>
           <div className="finance-truth-main">{watchMoney(data?.income.incoming)}</div>
           <div className="finance-truth-lines">
             <div><span>Оплаты заказов</span><strong>{watchMoney(orderPayments)}</strong></div>
             <div><span>Закрытие долгов</span><strong>{watchMoney(debtPayments)}</strong></div>
             <div><span>Доплаты по обменам</span><strong>{watchMoney(exchangePayments)}</strong></div>
           </div>
         </article>
         <article className="finance-truth-card is-outflow">
           <div className="finance-truth-card-head"><span>Вернули клиентам</span><small>по дате возврата</small></div>
           <div className="finance-truth-main">{watchMoney(regularReturns+exchangeReturns)}</div>
           <div className="finance-truth-lines">
             <div><span>Обычные возвраты</span><strong>{watchMoney(regularReturns)}</strong></div>
             <div><span>Возвраты при обменах</span><strong>{watchMoney(exchangeReturns)}</strong></div>
             {otherOutflow>0&&<div><span>Другие списания</span><strong>{watchMoney(otherOutflow)}</strong></div>}
           </div>
         </article>
         <article className="finance-truth-card is-net">
           <div className="finance-truth-card-head"><span>Чистое движение</span><small>поступило минус списано</small></div>
           <div className="finance-truth-main">{watchMoney(data?.income.net)}</div>
           <div className="finance-truth-lines">
             <div><span>Поступило</span><strong>{watchMoney(data?.income.incoming)}</strong></div>
             <div><span>Вернули / списали</span><strong>{watchMoney(data?.income.outgoing)}</strong></div>
           </div>
         </article>
         <article className="finance-truth-card is-sales">
           <div className="finance-truth-card-head"><span>Продажи</span><small>по дате заказа</small></div>
           <div className="finance-truth-main">{watchMoney(data?.overview.totalSales)}</div>
           <div className="finance-truth-lines">
             <div><span>Заказов</span><strong>{data?.overview.orderCount||0}</strong></div>
             <div><span>Средний чек</span><strong>{watchMoney(data?.overview.avgCheck)}</strong></div>
           </div>
         </article>
       </div>
     </section>
     <section className="mini-panel finance-days-truth-panel">
       <div className="mini-panel-head"><div><h3>По дням</h3>
         <p className="mini-panel-note">Главная хронология периода: деньги стоят в том дне, к которому относятся.</p>
       </div></div>
       <LinkedTableScroll ariaLabel="Финансы по дням"><table className="data-table finance-days-truth-table">
         <thead><tr><th>Дата</th><th className="num">Поступило</th><th className="num">Возвращено / списано</th>
           <th className="num">Чистое движение</th><th className="num">Продажи</th><th>Состояние</th></tr></thead>
         <tbody>{financeDays.map(row=><tr key={row.date}>
           <td><strong>{moneyDate(row.date)}</strong></td>
           <td className="num"><strong>{watchMoney(row.received)}</strong></td>
           <td className="num">{watchMoney(row.returned)}</td>
           <td className="num"><strong>{watchMoney(row.net)}</strong></td>
           <td className="num">{watchMoney(row.sales)}</td>
           <td>{crossDateEvents.some(event=>event.eventDate===row.date)?
             <span className="soft-badge finance-info-badge">Есть оплаты заказов другой даты</span>:
             <span className="soft-badge">Без замечаний</span>}</td>
         </tr>)}
         {!financeDays.length&&<tr><td colSpan={6} className="empty-state">За выбранный период нет заказов и денежных операций.</td></tr>}
         </tbody></table></LinkedTableScroll>
     </section>
     <section className={'finance-reconciliation finance-reconciliation-v2 '+(reconciled?'is-ok':'is-error')}>
       <div className="finance-reconciliation-head">
         <div><strong>{reconciled?'Данные согласованы':'Есть расхождение в финансовой сверке'}</strong>
           <span>{reconciled?'Оплаты одинаково сходятся по операциям и способам оплаты.':
             'Итоги разных финансовых представлений не совпадают. Проверьте суммы ниже.'}</span></div>
         <div className="finance-reconciliation-badges">
           <span className={'status-pill '+(reconciled?'status-online':'status-offline')}>
             {reconciled?'Без расхождений':'Расхождение: '+watchMoney(Math.max(Math.abs(auditTotal-methodsTotal),Math.abs(auditTotal-kindsTotal)))}
           </span>
           <span className="soft-badge finance-info-badge">
             {crossDateEvents.length?'Заказов другой даты: '+crossDateEvents.length:'Заказов другой даты нет'}
           </span>
           <span className={earlyDatedEvents.length?'soft-badge warning-soft':'soft-badge'}>
             {earlyDatedEvents.length?'Проверьте даты: '+earlyDatedEvents.length:'Ошибок дат не найдено среди загруженных операций'}
           </span>
         </div>
       </div>
       {!reconciled&&<div className="finance-reconciliation-values">
         <span>По журналу: <strong>{watchMoney(auditTotal)}</strong></span>
         <span>По видам: <strong>{watchMoney(kindsTotal)}</strong></span>
         <span>По способам: <strong>{watchMoney(methodsTotal)}</strong></span>
       </div>}
       {operationsTruncated&&<p className="mini-panel-note">Для анализа дат показаны первые {moneyRows.length} событий из {data?.moneyEventCount}. Суммы и хронология рассчитаны по всем событиям периода.</p>}
       {crossDateEvents.length>0&&<details className="finance-secondary-details">
         <summary>Оплаты по заказам другой даты · {crossDateEvents.length}</summary>
         <LinkedTableScroll ariaLabel="Оплаты другой даты"><table className="data-table finance-anomaly-table">
           <thead><tr><th>Дата операции</th><th>Дата заказа</th><th>Заказ</th><th>Операция</th>
             <th className="num">Сумма</th><th>Действие</th></tr></thead>
           <tbody>{crossDateEvents.map(row=><tr key={String(row.id)}>
             <td>{moneyDate(row.eventDate)}</td><td>{moneyDate(row.orderDate)}</td>
             <td>{String(row.externalOrderId||'—')}</td><td>{operationLabel(row.eventType)}</td>
             <td className="num">{watchMoney(row.amountDelta)}</td>
             <td>{onOpenOrder&&<button type="button" className="secondary compact finance-order-link"
               onClick={()=>openOrder(row)}>К заказу</button>}</td>
           </tr>)}</tbody></table></LinkedTableScroll>
       </details>}
     </section>
   </div>}
   {mode==='payments'&&<section className="mini-panel">
     <h3>Денежные операции</h3>
     <p className="mini-panel-note">Первоначальные оплаты, закрытия долгов, обмены и возвраты — по фактической дате.</p>
     <LinkedTableScroll ariaLabel="Финансовые операции">
       <table className="data-table strict-report-table">
         <thead><tr><th>Дата</th><th>Заказ</th><th>Операция</th><th>Способ</th>
           <th>Комментарий</th><th className="num">Сумма</th></tr></thead>
         <tbody>{moneyRows.map(row=><tr key={String(row.id)}>
           <td>{String(row.eventDate)}</td><td>{String(row.externalOrderId||'—')}</td>
           <td>{String(row.eventType||'Операция')}</td><td>{String(row.paymentMethod||'Не указан')}</td>
           <td>{String(row.comment||'—')}</td><td className="num">{watchMoney(row.amountDelta)}</td>
         </tr>)}</tbody>
       </table>
     </LinkedTableScroll>
   </section>}
   {mode==='debts'&&<section className="mini-panel">
     <h3>Долги</h3>
     <div className="summary-grid compact-summary">
       <div className="summary-card danger-card"><span>Общий актуальный долг</span>
         <strong>{watchMoney(outstanding)}</strong></div>
       <div className="summary-card"><span>Заказов с долгом</span>
         <strong>{data?.currentDebt.orderCount||0}</strong></div>
       <div className="summary-card"><span>Долг заказов периода</span>
         <strong>{watchMoney(data?.overview.periodDebt)}</strong></div>
     </div>
     <LinkedTableScroll ariaLabel="Долг по менеджерам"><table className="data-table strict-report-table">
       <thead><tr><th>Менеджер</th><th>Заказов</th><th>Долг по заказам периода</th></tr></thead>
       <tbody>{(data?.managers||[]).map(x=><tr key={String(x.manager)}>
         <td>{String(x.manager)}</td><td>{String(x.orderCount)}</td>
         <td>{watchMoney(x.debt)}</td></tr>)}</tbody>
     </table></LinkedTableScroll>
   </section>}
   {mode==='returns'&&<section className="mini-panel">
     <h3>Возвраты и обмены</h3>
     <div className="summary-grid compact-summary">
       <div className="summary-card danger-card"><span>Списания / возвраты</span>
         <strong>{watchMoney(data?.income.outgoing)}</strong></div>
       <div className="summary-card"><span>Событий возврата денег / коррекции</span>
         <strong>{refunds.length}</strong></div>
       <div className="summary-card"><span>Денежных событий обмена</span>
         <strong>{exchanges.length}</strong></div>
     </div>
     <LinkedTableScroll ariaLabel="Возвраты и обмены"><table className="data-table strict-report-table">
       <thead><tr><th>Дата</th><th>Заказ</th><th>Событие</th><th>Метод</th><th>Сумма</th></tr></thead>
       <tbody>{[...refunds,...exchanges.filter(x=>Number(x.amountDelta)>=0)].map(row=>
         <tr key={String(row.id)}><td>{String(row.eventDate)}</td>
           <td>{String(row.externalOrderId||'—')}</td><td>{String(row.eventType)}</td>
           <td>{String(row.paymentMethod||'—')}</td><td>{watchMoney(row.amountDelta)}</td>
         </tr>)}</tbody>
     </table></LinkedTableScroll>
   </section>}
   {mode==='cash'&&isAdmin&&<section className="mini-panel cash-register-main">
     <div className="mini-panel-head"><div><h3>Общая касса · TAUWACH + WACHIZEN</h3>
       <p className="mini-panel-note">Единый остаток и журнал наличных двух брендов. У каждого заказа в истории указан его бренд. Kaspi не считается наличными.</p></div></div>
     {cashError&&<p role="alert" className="app-alert error">{cashError}</p>}
     {cashNotice&&<p role="status">{cashNotice}</p>}
     {cashBusy&&<p>Обновляем кассу…</p>}
     {cash?.initialized&&<div className="summary-grid cash-register-summary cash-register-summary-v2">
       <div className="summary-card cash-balance-card"><span>Сейчас в кассе</span>
         <strong>{watchMoney(cash.currentBalance)}</strong></div>
       <div className="summary-card"><span>Сегодня пришло</span>
         <strong>{watchMoney(cash.todayIn)}</strong></div>
       <div className="summary-card"><span>Сегодня ушло</span>
         <strong>{watchMoney(cash.todayOut)}</strong></div>
       <div className="summary-card"><span>Всего поступило</span>
         <strong>{watchMoney(cash.totalIn)}</strong></div>
       <div className="summary-card"><span>Всего выдано</span>
         <strong>{watchMoney(cash.totalOut)}</strong></div>
     </div>}
     {cash?.initialized&&<section className="mini-panel cash-auto-status-panel">
       <div className="mini-panel-head"><div><h3>Автоматический учёт наличных</h3>
         <p className="mini-panel-note">Наличные оплаты и возвраты заказов; Kaspi и безналичные способы не входят в кассу. Платежи за время паузы не учитываются задним числом.</p></div></div>
       <div className={'cash-auto-status '+(cash.autoTrackingEnabled?'is-enabled':'is-paused')}>
         <strong>{cash.autoTrackingEnabled?'Автоучёт включён':'Автоучёт приостановлен'}</strong>
         <button className={cash.autoTrackingEnabled?'secondary compact danger-outline':'primary compact'}
           disabled={cashBusy} type="button" onClick={()=>void cashExtra('auto',{
             enabled:!cash.autoTrackingEnabled,
           })}>{cash.autoTrackingEnabled?'Остановить автоучёт':'Включить автоучёт'}</button>
       </div>
     </section>}
     {!cashBusy&&cash&&<form className="watch-cash-entry-form" onSubmit={cashSubmit}>
       {!cash.initialized?<><h4>Первоначальная настройка кассы</h4>
         <label>Фактический начальный остаток наличных<input type="number"
           min={0} max={1000000000} step={1} required value={cashOpening}
           onChange={e=>setCashOpening(e.target.value)}/></label>
         <button className="primary" type="submit">Открыть кассу бренда</button>
       </>:<>
         <div className="order-panel-tabs">
           <button type="button" className={'secondary compact '+(cashAction==='manual'?'is-active':'')}
             onClick={()=>{setCashAction('manual');request.current=null}}>Внесение / выдача</button>
           <button type="button" className={'secondary compact '+(cashAction==='reconcile'?'is-active':'')}
             onClick={()=>{setCashAction('reconcile');request.current=null}}>Сверить остаток</button>
         </div>
         {cashAction==='manual'?<>
           <label>Направление<select value={cashDirection} onChange={e=>setCashDirection(e.target.value as 'in'|'out')}>
             <option value="in">Внести наличные</option><option value="out">Выдать наличные</option>
           </select></label>
           <label>Сумма<input type="number" required min={1} max={1000000000}
             value={cashAmount} step={1} onChange={e=>setCashAmount(e.target.value)}/></label>
         </>:<label>Пересчитанный фактический остаток<input type="number" required
           min={0} max={1000000000} value={cashReconcile} step={1}
           onChange={e=>setCashReconcile(e.target.value)}/></label>}
         <label>Причина операции<textarea required minLength={3} maxLength={500}
           value={cashComment} rows={2} onChange={e=>setCashComment(e.target.value)}/></label>
         <button type="submit" className="primary" disabled={cashBusy}>Подтвердить операцию</button>
       </>}
     </form>}
     {cash?.initialized&&<LinkedTableScroll ariaLabel="История общей кассы">
       <table className="data-table strict-report-table">
         <thead><tr><th>Дата</th><th>Бренд</th><th>Тип</th><th>Заказ</th><th>Комментарий</th>
           <th className="num">Сумма</th><th className="export-hide">Действия</th></tr></thead>
         <tbody>{cash.entries.map((x,i)=><tr key={String(x.type)+String(x.id)+i}>
           <td>{x.businessDate}</td><td>{x.brand||'ОБЩАЯ'}</td><td>{x.reversesEntryId?'Отмена ручной операции':
             ({manual_in:'Внесение',manual_out:'Выдача',reconcile_in:'Сверка +',
               reconcile_out:'Сверка −'} as Record<string,string>)[x.type]||x.type}</td>
           <td>{x.externalOrderId||'—'}</td><td>{x.comment||'—'}</td>
           <td className="num">{watchMoney(x.amountDelta)}</td>
           <td className="export-hide">{['manual_in','manual_out'].includes(x.type)&&!x.reversesEntryId&&
             <button type="button" className="secondary compact"
               disabled={cashBusy} onClick={()=>void cashExtra('reverse',{entryId:x.id})}>Отменить</button>}</td>
         </tr>)}</tbody>
       </table>
     </LinkedTableScroll>}
     {cash?.initialized&&Boolean(cash.legacyEntries?.length)&&
       <details className="mini-panel cash-register-archive">
         <summary><strong>Архив прежних отдельных касс</strong></summary>
         <p className="mini-panel-note">Исторические записи сохранены без повторного зачисления. Начальный расчётный остаток общей кассы был сформирован из предыдущих действующих касс; физическую сумму можно сверить.</p>
         <LinkedTableScroll ariaLabel="Архив прежних брендовых касс">
           <table className="data-table strict-report-table">
             <thead><tr><th>Дата</th><th>Бренд</th><th>Операция</th><th>Комментарий</th><th className="num">Сумма</th></tr></thead>
             <tbody>{(cash.legacyEntries||[]).map((e,i)=><tr key={'legacy-'+e.id+'-'+i}>
               <td>{e.businessDate}</td><td>{e.brand||'—'}</td><td>{e.type}</td>
               <td>{e.comment||'—'}</td><td className="num">{watchMoney(e.amountDelta)}</td>
             </tr>)}</tbody>
           </table>
         </LinkedTableScroll>
       </details>}
     {cash?.initialized&&<section className="mini-panel cash-register-cycles-panel">
       <div className="mini-panel-head"><div><h3>Прошлые циклы кассы</h3>
         <p className="mini-panel-note">Закрытые циклы и фактический остаток перед завершением. Записи не удаляются.</p></div>
         <button className="secondary compact" type="button"
           onClick={()=>setCashCyclesOpen(v=>!v)}>{cashCyclesOpen?'Скрыть':'Показать историю'}</button>
       </div>
       {cashCyclesOpen&&<div className="cash-cycle-list">{(cash.cycles||[]).map(c=>
         <article className="cash-cycle-card" key={c.id}>
           <div><strong>{String(c.startedAt||'').slice(0,10)} — {String(c.finishedAt||'').slice(0,10)}</strong></div>
           <div><span>Начальный остаток</span><strong>{watchMoney(c.openingAmount)}</strong></div>
           <div><span>Остаток перед закрытием</span><strong>{watchMoney(c.closingBalance)}</strong></div>
           <div className="cash-cycle-comment"><strong>{c.comment}</strong></div>
         </article>)}
         {!cash.cycles?.length&&<div className="empty-state">Закрытых циклов пока нет.</div>}
       </div>}
     </section>}
     {cash?.initialized&&<details className="mini-panel cash-register-reset-panel">
       <summary><strong>Новый цикл кассы</strong> · для начала нового периода учёта</summary>
       <p>Текущий цикл завершится с сохранением истории. Новый остаток будет 0; чтобы начать отслеживание платежей, включите автоучёт после сверки.</p>
       <label>Причина нового цикла<textarea rows={2} minLength={3} maxLength={500}
         value={cashResetComment} onChange={e=>setCashResetComment(e.target.value)}/></label>
       <button type="button" className="secondary danger-outline" disabled={cashBusy||cashResetComment.trim().length<3}
         onClick={()=>void cashExtra('reset',{comment:cashResetComment.trim()})}>Закрыть цикл и начать новый</button>
     </details>}
   </section>}
   {mode==='methods'&&<section className="mini-panel">
     <h3>Способы оплаты</h3>
     <p>Справочник способов оплаты общий для системы, но денежные операции и кассы двух брендов разделены.</p>
     <div className="watch-finance-methods">{(data?.methods||[]).map(m=>
       <div key={String(m.method)}><strong>{String(m.method)}</strong>
         <span>За период: {watchMoney(m.incoming)} поступило · {watchMoney(m.outgoing)} возвращено</span>
       </div>)}</div>
     {isAdmin&&onOpenReferences&&<button type="button" className="secondary"
       onClick={onOpenReferences}>Открыть справочник способов оплаты</button>}
   </section>}
 </article>
}
