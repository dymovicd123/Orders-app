import {useEffect,useMemo,useState} from 'react'
import type {WatchBrand} from '../../../shared/client3/watch-domain'
import {formatWatchDeadline,groupWatchLogistics,type WatchLogisticsRow} from './WatchLogisticsPanel'
import {useWatchAnalytics,watchMoney,watchNumber,watchPeriod} from './useWatchAnalytics'
import '../../styles/dashboard-workshop-attention-r1.css'

type Section='orders'|'create'|'logistics'|'operations'|'catalog'|'reports'|'finance'
const isSent=(row:WatchLogisticsRow)=>row.shippingStatus==='sent'||row.shippingStatus==='Отправлено'
const deadlineValue=(value:string)=>Date.parse(value||'')
export function WatchDashboardPanel({brands,onNavigate}:{
 brands:readonly WatchBrand[];onNavigate:(section:Section)=>void
}){
 const [brand,setBrand]=useState<WatchBrand>(brands[0]||'TAUWACH')
 const [dailyPeriod,setDailyPeriod]=useState<'today'|'yesterday'>('today')
 const month=watchPeriod('month'),day=watchPeriod(dailyPeriod)
 const monthly=useWatchAnalytics(brand,month.from,month.to)
 const daily=useWatchAnalytics(brand,day.from,day.to)
 const [queue,setQueue]=useState<WatchLogisticsRow[]>([])
 const [queueError,setQueueError]=useState('')
 const [queueBusy,setQueueBusy]=useState(true)
 const [detail,setDetail]=useState<ReturnType<typeof groupWatchLogistics>[number]|null>(null)
 const [refreshKey,setRefreshKey]=useState(0)
 useEffect(()=>{
   const abort=new AbortController()
   setQueueBusy(true);setQueueError('');setQueue([])
   void fetch('/api/client3/watches/logistics?'+new URLSearchParams({brand}),{
     credentials:'include',cache:'no-store',signal:abort.signal,
   }).then(async r=>{
     const result=await r.json() as {ok:boolean;rows?:WatchLogisticsRow[];message?:string}
     if(!r.ok||!result.ok)throw Error(result.message||'Не удалось загрузить логистику.')
     if(!abort.signal.aborted)setQueue(result.rows||[])
   }).catch(e=>{if(!abort.signal.aborted)setQueueError(e instanceof Error?e.message:'Ошибка логистики')})
     .finally(()=>{if(!abort.signal.aborted)setQueueBusy(false)})
   return ()=>abort.abort()
 },[brand,refreshKey])
 const pending=useMemo(()=>groupWatchLogistics(queue)
   .filter(g=>!isSent(g.order)&&g.items.some(x=>Number(x.shippedQuantity||0)<Number(x.quantity||0)))
   .sort((a,b)=>{
     const urgent=Number(Boolean(b.order.urgent))-Number(Boolean(a.order.urgent))
     const da=deadlineValue(a.order.shippingDeadlineAt),db=deadlineValue(b.order.shippingDeadlineAt)
     const overdueA=Number.isFinite(da)&&da<Date.now()?1:0
     const overdueB=Number.isFinite(db)&&db<Date.now()?1:0
     return overdueB-overdueA||urgent||(Number.isFinite(da)?da:Infinity)-
       (Number.isFinite(db)?db:Infinity)||a.order.orderId-b.order.orderId
   }),[queue])
 const d=monthly.data,dayData=daily.data
 const refresh=()=>{monthly.refresh();daily.refresh();setRefreshKey(v=>v+1)}
 return <section className="card wide sector-overview dashboard-home" id="dashboard">
   <div className="dashboard-hero">
     <div><div className="card-label">Инфопанель</div>
       <h2>Дэшборд месяца</h2>
       <p>Продажи и деньги бренда, срочная гравировка и предстоящие отправки. Данные из реальных заказов.</p>
     </div>
     <div className="dashboard-hero-actions">
       {brands.length>1&&<select aria-label="Бренд инфопанели" value={brand}
         onChange={e=>setBrand(e.target.value as WatchBrand)}>
         {brands.map(x=><option value={x} key={x}>{x}</option>)}
       </select>}
       <span className="soft-badge">Этот месяц</span>
       <button type="button" className="secondary compact"
         disabled={monthly.busy||queueBusy} onClick={refresh}>Обновить</button>
     </div>
   </div>
   {monthly.error&&<div role="alert" className="app-alert error">{monthly.error}</div>}
   {monthly.busy&&<div className="muted-note">Загрузка инфопанели…</div>}
   <div className="summary-grid dashboard-summary-grid">
     <div className="summary-card"><span>План месяца</span><strong>—</strong>
       <small>План ещё не настроен для бренда</small></div>
     <div className="summary-card"><span>Выполнение</span><strong>—</strong>
       <div className="mini-progress"><i style={{width:'0%'}}/></div></div>
     <div className="summary-card"><span>Кол-во продаж</span><strong>{watchNumber(d?.overview.orderCount)}</strong></div>
     <div className="summary-card"><span>Общая сумма продаж</span><strong>{watchMoney(d?.overview.totalSales)}</strong></div>
     <div className="summary-card"><span>Поступило</span><strong>{watchMoney(d?.income.incoming)}</strong></div>
     <div className="summary-card danger-card"><span>Актуальные долги</span>
       <strong>{watchMoney(d?.currentDebt.currentDebt)}</strong></div>
     <div className="summary-card danger-card"><span>Сумма возврата</span>
       <strong>{watchMoney(d?.income.outgoing)}</strong></div>
     <div className="summary-card"><span>Средний чек</span><strong>{watchMoney(d?.overview.avgCheck)}</strong></div>
     <div className="summary-card"><span>Клиентов месяца</span>
       <strong>{watchNumber(d?.customers.customerCount)}</strong></div>
     <div className="summary-card warning-card"><span>Логистика активные</span>
       <strong>{pending.length}</strong></div>
     <div className="summary-card warning-card"><span>Срочные отправки</span>
       <strong>{pending.filter(g=>Boolean(g.order.urgent)).length}</strong></div>
   </div>
   <section className="mini-panel dashboard-daily-panel">
     <div className="mini-panel-head">
       <div><h3>День работы</h3>
         <p className="mini-panel-note">Продажи по дате заказа, поступления и возвраты по дате денежной операции.</p></div>
       <div className="mini-panel-actions">
         <button type="button" className={dailyPeriod==='today'?'primary compact':'secondary compact'}
           onClick={()=>setDailyPeriod('today')}>Сегодня</button>
         <button type="button" className={dailyPeriod==='yesterday'?'primary compact':'secondary compact'}
           onClick={()=>setDailyPeriod('yesterday')}>Вчера</button>
       </div>
     </div>
     {daily.error&&<p role="alert">{daily.error}</p>}
     <div className="summary-grid dashboard-summary-grid">
       <div className="summary-card"><span>Дата</span><strong>{day.from}</strong></div>
       <div className="summary-card"><span>Заказов</span><strong>{watchNumber(dayData?.overview.orderCount)}</strong></div>
       <div className="summary-card"><span>Продажи по дате заказа</span>
         <strong>{watchMoney(dayData?.overview.totalSales)}</strong></div>
       <div className="summary-card"><span>Поступило по дате оплаты</span>
         <strong>{watchMoney(dayData?.income.incoming)}</strong></div>
       <div className="summary-card danger-card"><span>Возвраты по дате операции</span>
         <strong>{watchMoney(dayData?.income.outgoing)}</strong></div>
       <div className="summary-card"><span>Чистое движение денег</span>
         <strong>{watchMoney(dayData?.income.net)}</strong></div>
     </div>
   </section>
   <div className="dashboard-workspace">
     <section className="mini-panel dashboard-actions-panel">
       <div className="mini-panel-head"><div><h3>Быстрые действия</h3>
         <p className="mini-panel-note">Переходы к рабочим разделам Main.</p></div></div>
       <div className="dashboard-action-grid">
         <button onClick={()=>onNavigate('create')}>Создать заказ</button>
         <button onClick={()=>onNavigate('orders')}>Список заказов</button>
         <button onClick={()=>onNavigate('logistics')}>Логистика</button>
         <button onClick={()=>onNavigate('operations')}>Приход / склад</button>
         <button onClick={()=>onNavigate('catalog')}>Товары</button>
         <button onClick={()=>onNavigate('reports')}>Отчёты</button>
         <button onClick={()=>onNavigate('finance')}>Финансы</button>
       </div>
     </section>
     <section className="mini-panel dashboard-attention-panel dashboard-workshop-attention-panel">
       <div className="mini-panel-head">
         <div><h3>Что требует внимания</h3>
           <p className="mini-panel-note">По образцу очереди контроля цеха Main: просроченные, срочные, затем ближайшие дедлайны.</p>
         </div><span className="soft-badge">{pending.length}</span>
       </div>
       {queueError&&<p role="alert">{queueError}</p>}
       <div className="dashboard-workshop-focus">
         <div className="dashboard-list-head">
           <strong>Очередь контроля логистики</strong>
           <span>{queueBusy?'Обновляю…':'Активных '+pending.length}</span>
         </div>
         <div className="dashboard-workshop-order-list">
           {pending.slice(0,30).map(g=>{
             const o=g.order,deadline=deadlineValue(o.shippingDeadlineAt)
             const overdue=Number.isFinite(deadline)&&deadline<Date.now()
             return <article key={o.orderId} role="button" tabIndex={0}
               className={'dashboard-workshop-order-card '+(overdue?'is-danger':o.urgent?'is-urgent':'is-planned')}
               onClick={()=>setDetail(g)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();setDetail(g)}}}>
               <div className="dashboard-workshop-order-head">
                 <div className="dashboard-workshop-order-identity">
                   <strong className="dashboard-workshop-customer-name">{o.recipientName||'Клиент не указан'}</strong>
                   <span className="dashboard-workshop-order-ref">{o.externalId||'#'+o.orderId}</span>
                   <span className="dashboard-workshop-order-meta-line">{o.brand} · {o.city} · {o.recipientPhone}</span>
                 </div>
                 <div className="dashboard-workshop-statuses">
                   {overdue&&<span className="dashboard-workshop-status is-overdue">Просрочено</span>}
                   {Boolean(o.urgent)&&<span className="dashboard-workshop-status is-urgent-mark">Срочно</span>}
                   <span className="dashboard-workshop-status is-deadline">{formatWatchDeadline(o.shippingDeadlineAt)}</span>
                 </div>
               </div>
               <div className="dashboard-workshop-order-summary">
                 <span><b>{g.items.length}</b> поз.</span>
                 <span className="dashboard-workshop-order-products">{g.items.map(x=>x.modelName||'Часы').slice(0,3).join(', ')}</span>
                 <span className="dashboard-workshop-order-open">Подробнее</span>
               </div>
             </article>
           })}
           {!pending.length&&!queueBusy&&<div className="empty-state">Ожидающих отправки заказов нет.</div>}
         </div>
       </div>
     </section>
   </div>
   {detail&&<div className="dashboard-workshop-detail-backdrop" role="presentation"
     onMouseDown={e=>{if(e.currentTarget===e.target)setDetail(null)}}>
     <section className="dashboard-workshop-detail dashboard-workshop-order-detail"
       role="dialog" aria-modal="true" aria-label="Детали заказа логистики">
       <div className="dashboard-workshop-detail-head">
         <div><span className="dashboard-workshop-order-ref">{detail.order.externalId}</span>
           <h3>{detail.order.recipientName}</h3>
           <p>Отправить до {formatWatchDeadline(detail.order.shippingDeadlineAt)}</p></div>
         <button className="secondary compact" onClick={()=>setDetail(null)}>Закрыть</button>
       </div>
       <div className="dashboard-workshop-detail-grid">
         <div><span>Бренд</span><strong>{detail.order.brand}</strong></div>
         <div><span>Телефон</span><strong>{detail.order.recipientPhone}</strong></div>
         <div><span>Город</span><strong>{detail.order.city}</strong></div>
         <div><span>Доставка</span><strong>{detail.order.deliveryMethod}</strong></div>
         <div><span>Гравировка</span><strong>{detail.order.engravingStatus==='ready'?'Готово':'В работе'}</strong></div>
       </div>
       <div className="dashboard-workshop-detail-items">{detail.items.map(x=>
         <article className="dashboard-workshop-detail-item" key={x.orderItemId}>
           <div><strong>{x.modelName||'Модель не указана'}</strong>
             <small>{[x.movement,x.braceletMaterial,x.dialColor,x.braceletColor].filter(Boolean).join(' · ')}</small>
             {x.engravingText&&<p>Гравировка: {x.engravingText}</p>}
           </div><div className="dashboard-workshop-detail-item-side"><b>{x.quantity} шт.</b></div>
         </article>)}</div>
       <div className="dashboard-workshop-detail-actions">
         <button className="primary" onClick={()=>{setDetail(null);onNavigate('logistics')}}>Открыть в логистике</button>
         <button className="secondary" onClick={()=>setDetail(null)}>Остаться на инфопанели</button>
       </div>
     </section>
   </div>}
 </section>
}
