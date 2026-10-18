import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import '../../styles/stage04-workshop-settlements.css'

type RecentEvent = { id:number; event_type:string; business_date:string; source_business_date?:string|null; related_event_id?:number|null; product_name_snapshot:string|null; quantity:number|null; unit_cost:number|null; amount_delta:number|null; payment_method:string|null; comment:string|null }
type LedgerEvent = RecentEvent & { isReversed:number; external_order_id:string|null; related_event_id:number|null }
type Day = { date:string; completed:number; costConfirmed:number; completionCorrections:number; paid:number; paymentCorrections:number; netChange:number }
type Summary = { ok:boolean; captureEnabled:boolean; canInitialize:boolean; confirmedDebt:number; correctionCredit:number; unresolvedPrices:number;
  today:{ completed:number; costConfirmed:number; completionCorrections:number; paid:number; paymentCorrections:number };
  recent:RecentEvent[] }
type Ledger = { ok:boolean; range:{ from:string; to:string; openingBalance:number }; days:Day[]; events:LedgerEvent[]; hasMore:boolean; nextBeforeId:number|null }
type Unpriced = { id:number; orderRef:string; productName:string; quantity:number; completedDate:string; availableUnitCost:number|null; catalogProductId:number|null; resolutionState:'missing_cost'|'needs_match'|'ready' }
type UnpricedResponse = { ok:boolean; items:Unpriced[]; total:number; hasMore:boolean }
type View = 'home'|'work'|'history'|'days'|'unpriced'
type PaymentMode = 'full'|'partial'
const number = new Intl.NumberFormat('ru-RU',{maximumFractionDigits:0})
const money = (value:number|null|undefined) => value==null?'Не указана':number.format(value)+' ₸'
const todayKz = () => new Date(Date.now()+5*3600000).toISOString().slice(0,10)
const beforeDays = (day:string,n:number) => new Date(Date.parse(day+'T00:00:00Z')-n*86400000).toISOString().slice(0,10)
const titles:Record<string,string> = {
  completion:'Готовое изделие',completion_reversal:'Возврат в работу',
  price_adjustment:'Подтверждена себестоимость',payment:'Выплата цеху',
  payment_reversal:'Отменена выплата',opening_balance:'Начальный долг',balance_adjustment:'Корректировка',
}
async function api<T>(url:string,options?:RequestInit):Promise<T> {
  const response=await fetch(url,{...options,credentials:'include',cache:'no-store'})
  const result=await response.json().catch(()=>null) as (T & {ok?:boolean;message?:string})|null
  if(!response.ok||!result||result.ok===false)
    throw new Error(result?.message||(response.status===401?'Войдите в систему повторно.':'Не удалось выполнить операцию.'))
  return result
}
const requestKey='workshop:settlements:payment:pending'
function paymentIdempotency(body:string):string {
  try {
    const pending=JSON.parse(sessionStorage.getItem(requestKey)||'null') as {body:string;id:string}|null
    if(pending?.body===body&&pending.id)return pending.id
  }catch{ /* private browsing */ }
  const id=crypto.randomUUID()
  try{sessionStorage.setItem(requestKey,JSON.stringify({body,id}))}catch{ /* optional */ }
  return id
}
function clearPaymentId(){try{sessionStorage.removeItem(requestKey)}catch{ /* optional */ }}

export function WorkshopSettlementsPanel({openUnpricedRequest,onUnpricedCountChange,openCatalogPrice}:{
  openUnpricedRequest:number;onUnpricedCountChange:(count:number)=>void;
  openCatalogPrice:(productId:number|null,name:string)=>void;
}) {
  const today=todayKz()
  const [view,setView]=useState<View>('home')
  const [summary,setSummary]=useState<Summary|null>(null)
  const [details,setDetails]=useState<Ledger|null>(null)
  const [unpriced,setUnpriced]=useState<UnpricedResponse|null>(null)
  const [summaryLoading,setSummaryLoading]=useState(true)
  const [detailLoading,setDetailLoading]=useState(false)
  const [busy,setBusy]=useState(false)
  const [moreBusy,setMoreBusy]=useState(false)
  const [error,setError]=useState('')
  const [notice,setNotice]=useState('')
  const [paymentMode,setPaymentMode]=useState<PaymentMode|null>(null)
  const [amountDraft,setAmountDraft]=useState('')
  const [openingDebtDraft,setOpeningDebtDraft]=useState('')
  const [openingConfirmed,setOpeningConfirmed]=useState(false)
  const [comment,setComment]=useState('')
  const [fromDraft,setFromDraft]=useState(beforeDays(today,29))
  const [toDraft,setToDraft]=useState(today)
  const [period,setPeriod]=useState({from:beforeDays(today,29),to:today})
  const summaryGeneration=useRef(0)
  const detailGeneration=useRef(0)
  const writeLocked=useRef(false)

  const refreshSummary=useCallback(async()=>{
    const generation=++summaryGeneration.current
    setSummaryLoading(true)
    try {
      const next=await api<Summary>('/api/workshop/settlements/summary')
      if(generation!==summaryGeneration.current)return
      setSummary(next);onUnpricedCountChange(next.unresolvedPrices)
    }catch(e) {
      if(generation===summaryGeneration.current)setError(e instanceof Error?e.message:'Не удалось загрузить расчёты.')
    }finally {
      if(generation===summaryGeneration.current)setSummaryLoading(false)
    }
  },[onUnpricedCountChange])

  const loadDetails=useCallback(async()=>{
    if(view==='home')return
    const generation=++detailGeneration.current
    setDetailLoading(true)
    try {
      if(view==='unpriced'){
        setUnpriced(null)
        const result=await api<UnpricedResponse>('/api/workshop/settlements/unpriced')
        if(generation!==detailGeneration.current)return
        setUnpriced(result);onUnpricedCountChange(result.total)
      }else{
        setDetails(null)
        const params=new URLSearchParams(period)
        if(view==='work')params.set('scope','work')
        const result=await api<Ledger>('/api/workshop/settlements?'+params.toString())
        if(generation!==detailGeneration.current)return
        setDetails(result)
      }
    }catch(e){
      if(generation===detailGeneration.current)setError(e instanceof Error?e.message:'Не удалось открыть подробности.')
    }finally{
      if(generation===detailGeneration.current)setDetailLoading(false)
    }
  },[view,period,onUnpricedCountChange])

  useEffect(()=>{void refreshSummary();return()=>{summaryGeneration.current++}},[refreshSummary])
  useEffect(()=>{void loadDetails();return()=>{detailGeneration.current++}},[loadDetails])
  useEffect(()=>{if(openUnpricedRequest>0)setView('unpriced')},[openUnpricedRequest])

  const activated=Boolean(summary?.captureEnabled)
  const debt=Number(summary?.confirmedDebt||0)
  const amountValue=Number(amountDraft)
  const validAmount=Number.isSafeInteger(amountValue)&&amountValue>0&&amountValue<=debt
  const maySave=activated&&!busy&&!summaryLoading&&validAmount
  const openingAmount=Number(openingDebtDraft)
  const mayActivate=Boolean(summary?.canInitialize)&&!busy&&!summaryLoading
    &&openingConfirmed&&openingDebtDraft.trim()!==''
    &&Number.isSafeInteger(openingAmount)&&openingAmount>=0&&openingAmount<=1_000_000_000_000
  const days=useMemo(()=>{
    let running=Number(details?.range.openingBalance||0)
    return [...(details?.days||[])].sort((a,b)=>a.date.localeCompare(b.date)).map(day=>{
      running+=Number(day.netChange||0)
      return {...day,closing:running}
    }).reverse()
  },[details])
  const openPayment=(mode:PaymentMode)=>{
    if(!activated||debt<=0)return
    setPaymentMode(mode)
    setAmountDraft(mode==='full'?String(debt):'')
    setError('');setNotice('')
  }
  const closePayment=()=>{setPaymentMode(null);setAmountDraft('');setComment('')}
  const successfulWrite=async(message:string)=>{
    setNotice(message);setError('');clearPaymentId();closePayment()
    // The write already succeeded. A later network read error is NOT a failed payment.
    await Promise.all([refreshSummary(),...(view!=='home'?[loadDetails()]:[])])
  }
  const activate=async(e:FormEvent)=>{
    e.preventDefault()
    if(writeLocked.current||!mayActivate)return
    if(!window.confirm('Запустить учёт цеха с начальным долгом '+money(openingAmount)+'? Готовые ранее изделия повторно не начисляются. Изменить эту сумму через форму после запуска нельзя.'))return
    writeLocked.current=true;setBusy(true);setError('');setNotice('')
    try {
      await api('/api/workshop/settlements/activate',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({openingDebt:openingAmount})})
      setNotice('Учёт включён. Начальный долг '+money(openingAmount)+' сохранён. Новые готовые изделия будут начисляться автоматически.')
      await refreshSummary()
    }catch(e){setError(e instanceof Error?e.message:'Не удалось включить учёт.')}
    finally{writeLocked.current=false;setBusy(false)}
  }
  const submitPayment=async(e:FormEvent)=>{
    e.preventDefault()
    if(writeLocked.current||!maySave)return
    const body={amount:amountValue,comment:comment.trim()}
    const requestId=paymentIdempotency(JSON.stringify(body))
    writeLocked.current=true;setBusy(true);setError('');setNotice('')
    try{
      await api('/api/workshop/settlements/payments',{method:'POST',
        headers:{'Content-Type':'application/json','X-Idempotency-Key':requestId},
        body:JSON.stringify({...body,requestId})})
      await successfulWrite('Выплата '+money(amountValue)+' сохранена. Задолженность обновлена.')
    }catch(e){
      setError((e instanceof Error?e.message:'Не удалось записать выплату.')+' Если сеть прервалась, повторите без изменения данных.')
    }finally{writeLocked.current=false;setBusy(false)}
  }
  const reversePayment=async(event:LedgerEvent)=>{
    if(writeLocked.current||!activated)return
    const reason=window.prompt('Причина отмены выплаты (сохранится в истории):')
    if(reason===null)return
    if(reason.trim().length<5){setError('Укажите причину отмены не короче 5 символов.');return}
    if(!window.confirm('Отменить выплату '+money(-Number(event.amount_delta||0))+'? Задолженность увеличится.'))return
    writeLocked.current=true;setBusy(true);setError('')
    try {
      await api('/api/workshop/settlements/payments/'+event.id+'/reverse',
        {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reason:reason.trim()})})
      await successfulWrite('Выплата отменена с сохранением истории.')
    }catch(e){setError(e instanceof Error?e.message:'Не удалось отменить выплату.')}
    finally{writeLocked.current=false;setBusy(false)}
  }
  const resolveCost=async(item:Unpriced)=>{
    if(writeLocked.current||!activated||item.availableUnitCost===null)return
    if(!window.confirm('Подтвердить начисление '+money(item.availableUnitCost*item.quantity)+
      ' за «'+item.productName+'» ('+item.quantity+' шт.)?'))return
    writeLocked.current=true;setBusy(true);setError('')
    try {
      await api('/api/workshop/settlements/unpriced/'+item.id+'/confirm-cost',{method:'POST'})
      await successfulWrite('Себестоимость подтверждена. Начисление учтено.')
    }catch(e){setError(e instanceof Error?e.message:'Не удалось подтвердить стоимость.')}
    finally{writeLocked.current=false;setBusy(false)}
  }
  const applyPeriod=(e:FormEvent)=>{
    e.preventDefault()
    const a=Date.parse(fromDraft+'T00:00:00Z'),b=Date.parse(toDraft+'T00:00:00Z')
    if(!Number.isFinite(a)||!Number.isFinite(b)||a>b||(b-a)/86400000>89){
      setError('Выберите корректный период не более 90 дней.');return
    }
    setError('')
    setPeriod({from:fromDraft,to:toDraft})
  }
  const loadMore=async()=>{
    if(moreBusy||detailLoading||!details?.nextBeforeId)return
    const generation=detailGeneration.current
    setMoreBusy(true)
    try{
      const params=new URLSearchParams({...period,beforeId:String(details.nextBeforeId)})
      if(view==='work')params.set('scope','work')
      const page=await api<Ledger>('/api/workshop/settlements?'+params.toString())
      if(generation!==detailGeneration.current)return
      setDetails(current=>current?{...current,events:[...current.events,...page.events],
        hasMore:page.hasMore,nextBeforeId:page.nextBeforeId}:current)
    }catch(e){setError(e instanceof Error?e.message:'Не удалось загрузить продолжение.')}
    finally{setMoreBusy(false)}
  }
  const isWork=(event:RecentEvent)=>['completion','completion_reversal','price_adjustment'].includes(event.event_type)
  const eventLabel=(event:RecentEvent)=>event.product_name_snapshot||(event.event_type==='opening_balance'?'Начальный долг':event.event_type==='payment'?'Выплата цеху':event.event_type==='payment_reversal'?'Исправление выплаты':event.comment||'Операция')
  const openView=(next:View)=>{setError('');setView(next)}
  const openDayHistory=(date:string)=>{
    setFromDraft(date);setToDraft(date);setPeriod({from:date,to:date})
    setError('');setView('history')
  }
  const causeLabel=(event:RecentEvent)=>event.event_type==='price_adjustment'&&event.source_business_date
    ?'Работа завершена '+event.source_business_date+'; стоимость подтверждена '+event.business_date
    :event.event_type==='completion_reversal'&&event.source_business_date
      ?'Отменено начисление за работу от '+event.source_business_date
      :event.event_type==='payment_reversal'&&event.related_event_id
        ?'Отмена выплаты №'+event.related_event_id
        :null

  return <section className="ws-settlements ws-settlements-fast" aria-label="Расчёты с Цехом">
    <div className="ws-fast-top">
      <div><h3>Расчёты с Цехом</h3><p>Единый долг и выплаты за готовые изделия: обычные и Kaspi-заказы.</p></div>
      <button className="secondary compact" type="button" disabled={summaryLoading||busy} onClick={()=>void refreshSummary()}>
        {summaryLoading?'Загружаю…':'Обновить'}
      </button>
    </div>
    {summary&&!activated&&<div className="ws-settlements-startup" role="status">
      <strong>Учёт пока не запущен</strong>
      {summary.canInitialize?<form className="ws-opening-form" onSubmit={e=>void activate(e)}>
        <p>Укажите фактическую задолженность перед цехом на момент запуска. Работа, отмеченная готовой раньше, повторно не начислится.</p>
        <label htmlFor="ws-opening-debt">Начальный долг, ₸
          <input id="ws-opening-debt" type="number" min="0" max="1000000000000" step="1"
            placeholder="Например, 50000" required value={openingDebtDraft}
            onChange={e=>{setOpeningDebtDraft(e.target.value);setOpeningConfirmed(false)}}/>
        </label>
        <label className="ws-opening-confirm"><input type="checkbox" checked={openingConfirmed}
          onChange={e=>setOpeningConfirmed(e.target.checked)}/>
          Сумма проверена. После включения учёт начнётся автоматически.
        </label>
        <button className="primary compact" type="submit" disabled={!mayActivate}>
          {busy?'Включаю…':'Сохранить долг и включить учёт'}
        </button>
      </form>:<p>В журнале уже есть операции. Начальный долг повторно не устанавливается; проверьте состояние учёта перед запуском.</p>}
    </div>}
    <div className="ws-fast-overview">
      <div className="ws-fast-debt">
        <span>Осталось выплатить</span>
        <strong>{summaryLoading&&!summary?'…':activated?money(debt):'—'}</strong>
        <small>Общий накопленный подтверждённый долг</small>
      </div>
      <div className="ws-fast-day">
        <div><span>Сегодня выполнено</span><strong>{activated?money(Number(summary?.today.completed||0)):'—'}</strong></div>
        <div><span>Сегодня выплачено</span><strong>{activated?money(Number(summary?.today.paid||0)-Number(summary?.today.paymentCorrections||0)):'—'}</strong></div>
      </div>
    </div>
    {activated&&(Number(summary?.today.costConfirmed||0)!==0||Number(summary?.today.completionCorrections||0)!==0)&&<div className="ws-fast-explainer" role="note">
      {Number(summary?.today.costConfirmed||0)!==0&&<span>Подтверждена стоимость ранее готовых изделий: <strong>+{money(summary?.today.costConfirmed)}</strong></span>}
      {Number(summary?.today.completionCorrections||0)!==0&&<span>Возвращено в работу — уменьшение долга: <strong>{money(summary?.today.completionCorrections)}</strong></span>}
      <small>Эти операции не считаются новой работой сегодня.</small>
    </div>}
    {summary&&summary.correctionCredit>0&&<p className="ws-settlements-warning">
      После корректировок сумма выплат превысила начисления на {money(summary.correctionCredit)}. Проверьте операции: это не аванс.
    </p>}
    {error&&<div className="ws-settlements-error" role="alert">{error}</div>}
    {notice&&<p className="ws-settlements-success" role="status">{notice}</p>}
    {activated&&<div className="ws-fast-pay">
      <div className="ws-fast-pay-head">
        <strong>Выплата цеху</strong>
        <span>Выплаты сохраняются в истории и не изменяют кассу магазина.</span>
      </div>
      {!paymentMode?<div className="ws-fast-pay-actions">
        <button type="button" className="primary compact" disabled={!debt||summaryLoading||busy}
          onClick={()=>openPayment('full')}>Выплатили полностью · {money(debt)}</button>
        <button type="button" className="secondary compact" disabled={!debt||summaryLoading||busy}
          onClick={()=>openPayment('partial')}>Выплатили часть</button>
      </div>:<form className="ws-fast-pay-form" onSubmit={e=>void submitPayment(e)}>
        <div className="ws-fast-pay-input">
          <label htmlFor="ws-payment-amount">{paymentMode==='full'?'Погашение всего долга':'Сколько выплатили, ₸'}</label>
          {paymentMode==='full'
            ?<strong>{money(amountValue)}</strong>
            :<input id="ws-payment-amount" aria-label="Сумма выплаты, тенге" type="number" min="1" step="1" max={debt}
              placeholder="Введите сумму" required autoFocus value={amountDraft} onChange={e=>setAmountDraft(e.target.value)}/>}
        </div>
        {paymentMode==='partial'&&Number(amountDraft)>debt&&<p className="ws-settlements-warning">Больше текущего долга выплатить нельзя. Авансы не предусмотрены.</p>}
        <label className="ws-fast-comment" htmlFor="ws-payment-comment">Комментарий (необязательно)
          <input id="ws-payment-comment" type="text" maxLength={500} value={comment}
            onChange={e=>setComment(e.target.value)} placeholder="Если нужно пояснить выплату"/>
        </label>}
        <div className="ws-fast-pay-confirm">
          <button type="button" className="secondary compact" onClick={closePayment} disabled={busy}>Отмена</button>
          <button type="submit" className="primary compact" disabled={!maySave}>
            {busy?'Сохраняю…':'Подтвердить выплату '+(validAmount?money(amountValue):'')}
          </button>
        </div>
      </form>}
    </div>}
    <nav className="ws-fast-nav" aria-label="Подробности расчётов">
      <button type="button" className={view==='home'?'is-active':''} onClick={()=>openView('home')}>Обзор</button>
      <button type="button" className={view==='work'?'is-active':''} onClick={()=>openView('work')}>Начисления</button>
      <button type="button" className={view==='history'?'is-active':''} onClick={()=>openView('history')}>История операций</button>
      <button type="button" className={view==='days'?'is-active':''} onClick={()=>openView('days')}>По дням</button>
      <button type="button" className={view==='unpriced'?'is-active':''} onClick={()=>openView('unpriced')}>
        Без себестоимости{summary?.unresolvedPrices?' · '+summary.unresolvedPrices:''}
      </button>
    </nav>
    {view==='home'&&<div className="ws-fast-recent">
      <div className="ws-fast-section-title"><strong>Последние операции</strong><button type="button" className="secondary compact" onClick={()=>openView('history')}>Вся история →</button></div>
      {(summary?.recent||[]).map(item=><div className="ws-fast-event" key={item.id}>
        <div><span>{titles[item.event_type]||'Операция'}</span><small>{item.business_date} · {eventLabel(item)}</small>
          {causeLabel(item)&&<small className="ws-fast-event-context">{causeLabel(item)}</small>}
          {item.quantity!=null&&item.unit_cost!=null&&<small>{item.quantity} шт. × {money(item.unit_cost)}</small>}
        </div>
        <strong>{item.amount_delta==null?'Без цены':money(item.amount_delta)}</strong>
      </div>)}
      {!summaryLoading&&!summary?.recent.length&&<p className="ws-settlements-footnote">Начислений и выплат пока нет.</p>}
    </div>}
    {view!=='home'&&view!=='unpriced'&&<div className="ws-fast-detail">
      <form className="ws-fast-period" onSubmit={applyPeriod}>
        <label>С <input type="date" required value={fromDraft} onChange={e=>setFromDraft(e.target.value)}/></label>
        <label>По <input type="date" required value={toDraft} onChange={e=>setToDraft(e.target.value)}/></label>
        <button type="submit" className="secondary compact" disabled={detailLoading}>Показать</button>
      </form>
      {detailLoading&&<p className="ws-settlements-footnote">Загружаю подробности…</p>}
      {view==='days'?<div className="ws-settlements-table-scroll"><table className="data-table">
        <thead><tr><th>Дата</th><th>Готово</th><th>Уточнена стоимость</th><th>Возвраты в работу</th><th>Выплаты (с учётом отмен)</th><th>Изменение долга</th><th>Остаток</th><th>Подробности</th></tr></thead>
        <tbody>{days.map(day=><tr key={day.date}>
          <td>{day.date}</td><td>{money(Number(day.completed||0))}</td>
          <td>{money(day.costConfirmed||0)}</td>
          <td>{money(day.completionCorrections||0)}</td>
          <td>{money(Number(day.paid||0)-Number(day.paymentCorrections||0))}</td>
          <td>{money(day.netChange||0)}</td>
          <td><strong>{money(day.closing)}</strong></td>
          <td><button type="button" className="ws-fast-day-link" onClick={()=>openDayHistory(day.date)}>Операции дня →</button></td>
        </tr>)}{!detailLoading&&!days.length&&<tr><td colSpan={8}>За выбранный период операций нет.</td></tr>}</tbody>
      </table></div>:<div className="ws-fast-event-list">
        {(details?.events||[]).filter(event=>view==='history'||isWork(event)).map(event=><div className="ws-fast-event" key={event.id}>
          <div><span>{titles[event.event_type]||'Операция'}</span>
            <small>{event.business_date} · {eventLabel(event)}{event.external_order_id?' · Заказ '+event.external_order_id:''}</small>
            {causeLabel(event)&&<small className="ws-fast-event-context">{causeLabel(event)}</small>}
            {event.quantity!=null&&event.unit_cost!=null&&<small>{event.quantity} шт. × {money(event.unit_cost)}</small>}
            {event.event_type==='payment_reversal'&&event.comment&&<small>Причина отмены: {event.comment}</small>}
          </div>
          <div className="ws-fast-event-side"><strong>{event.amount_delta===null?'Цена не указана':money(event.amount_delta)}</strong>
            {event.event_type==='payment'&&!event.isReversed&&activated&&<button type="button" className="secondary compact" disabled={busy}
              onClick={()=>void reversePayment(event)}>Отменить выплату</button>}
          </div>
        </div>)}
        {!detailLoading&&!details?.events.length&&<p className="ws-settlements-footnote">За выбранный период событий нет.</p>}
        {details?.hasMore&&<button className="secondary compact" type="button" disabled={moreBusy} onClick={()=>void loadMore()}>
          {moreBusy?'Загружаю…':'Показать ещё операции'}
        </button>}
      </div>}
      {view==='days'&&<p className="ws-settlements-footnote">Долг до начала периода: {money(details?.range.openingBalance)}. Уточнения стоимости показываются на дату подтверждения, а не дату выполнения работы.</p>}
    </div>}
    {view==='unpriced'&&<div className="ws-fast-detail">
      <div className="ws-fast-section-title">
        <div><strong>Без себестоимости{unpriced?.total?' · '+unpriced.total:''}</strong>
          <p className="ws-settlements-footnote">Стоимость назначает администратор в каталоге. После этого подтвердите начисление.</p>
        </div>
        <button type="button" className="secondary compact" disabled={detailLoading} onClick={()=>void loadDetails()}>Обновить</button>
      </div>
      {detailLoading&&<p className="ws-settlements-footnote">Проверяю себестоимость…</p>}
      {(unpriced?.items||[]).map(item=><div className="ws-fast-event ws-fast-unpriced-row" key={item.id}>
        <div><strong>{item.productName}</strong>
          <small>Готово {item.completedDate} · {item.quantity} шт. {item.orderRef?'· Заказ '+item.orderRef:''}</small>
          <small>{item.resolutionState==='needs_match'?'Требуется сверка товара':item.resolutionState==='missing_cost'?'Себестоимость не назначена':'Себестоимость найдена: '+money(item.availableUnitCost)}</small>
        </div>
        {item.resolutionState==='ready'&&item.availableUnitCost!=null&&activated
          ?<button type="button" className="secondary compact" disabled={busy} onClick={()=>void resolveCost(item)}>Подтвердить начисление · {money(item.availableUnitCost*item.quantity)}</button>
          :<button type="button" className="secondary compact" onClick={()=>openCatalogPrice(item.catalogProductId,item.productName)}>
             {item.resolutionState==='needs_match'?'Проверить товар':'Указать себестоимость →'}
           </button>}
      </div>)}
      {!detailLoading&&!unpriced?.items.length&&<p className="ws-settlements-footnote">Неразобранных позиций нет.</p>}
      {unpriced?.hasMore&&<p className="ws-settlements-footnote">Показаны последние 50 позиций. После разбора обновите список.</p>}
    </div>}
  </section>
}
