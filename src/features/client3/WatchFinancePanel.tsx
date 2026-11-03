import {useEffect,useRef,useState} from 'react'
import type {FormEvent} from 'react'
import type {WatchBrand} from '../../../shared/client3/watch-domain'
import {LinkedTableScroll} from '../../components/tables/LinkedTableScroll'
import {useWatchAnalytics,watchMoney,watchPeriod} from './useWatchAnalytics'
import '../../styles/client3-watch-finance.css'

type Mode='summary'|'payments'|'debts'|'returns'|'cash'|'methods'
type CashEntry={id:number;type:string;businessDate:string;createdAt?:string;
 amountDelta:number;externalOrderId?:string;comment?:string;reversesEntryId?:number|null;brand?:string}
type Cash={ok:boolean;initialized:boolean;message?:string;currentBalance:number|null;
 openingAmount?:number;todayIn?:number;todayOut?:number;totalIn?:number;totalOut?:number;
 autoTrackingEnabled?:boolean;cycleStartedAt?:string;cycles?:Array<{id:number;startedAt:string;
 finishedAt:string;openingAmount:number;closingBalance:number;comment:string}>;
 entries:CashEntry[];legacyEntries?:CashEntry[]}
const formats:{id:Mode;label:string;hint:string}[]=[
 {id:'summary',label:'Сводка',hint:'Чёткие итоги'},
 {id:'payments',label:'Операции',hint:'По дате операции'},
 {id:'debts',label:'Долги',hint:'Текущие и закрытые'},
 {id:'returns',label:'Возвраты / обмены',hint:'По дате операции'},
 {id:'cash',label:'Касса',hint:'Наличные сейчас'},
 {id:'methods',label:'Способы оплаты',hint:'Справочник оплат'},
]
export function WatchFinancePanel({brands,isAdmin=false,onOpenReferences}:{
 brands:readonly WatchBrand[];isAdmin?:boolean;onOpenReferences?:()=>void
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
 const stats=[
   ['Общая сумма продаж',data?.overview.totalSales],
   ['Поступило',data?.income.incoming],
   ['Возвращено / списано',data?.income.outgoing],
   ['Чистое движение',data?.income.net],
   ['Актуальные долги',outstanding],
 ]
 return <article className="card wide sector-finance" id="finance">
   <div className="card-label">Финансы</div>
   <div className="card-meta">Денежные события и касса по дате операции. Продажи и долги по дате заказа. Каждый бренд отдельно.</div>
   <div className="orders-filter-panel finance-workspace-panel">
     <div className="reports-filter-header">
       <div><h3>{period.from===period.to?'День':'Период'}</h3>
         <div className="muted-note">Все движения денег записаны с реальной датой события.</div>
       </div>
       <div className="reports-period-buttons">
         {(['today','yesterday','month','year'] as const).map((p,i)=>
           <button type="button" className="secondary compact" key={p} onClick={()=>setPeriod(watchPeriod(p))}>
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
   {mode==='summary'&&<section className="mini-panel">
     <div className="mini-panel-head"><div><h3>Сводка</h3>
       <p className="mini-panel-note">Без двойного счёта по способам оплаты.</p>
     </div></div>
     <div className="summary-grid compact-summary">{stats.map(([label,value],i)=>
       <div className={'summary-card '+(i===2||i===4?'danger-card':'')} key={label}>
         <span>{label}</span><strong>{watchMoney(value)}</strong>
       </div>)}
       <div className="summary-card"><span>Заказов за период</span>
         <strong>{data?.overview.orderCount||0}</strong></div>
       <div className="summary-card"><span>Должников всего</span>
         <strong>{data?.currentDebt.orderCount||0}</strong></div>
     </div>
     <div className="watch-finance-methods">{(data?.methods||[]).map(row=>
       <div key={String(row.method)}><strong>{String(row.method)}</strong>
         <span>Поступило: {watchMoney(row.incoming)} · Возврат: {watchMoney(row.outgoing)} ·
           Чистое: {watchMoney(row.net)}</span>
       </div>)}</div>
   </section>}
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
