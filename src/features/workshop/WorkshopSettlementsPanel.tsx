import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import '../../styles/stage04-workshop-settlements.css'

type LedgerEvent={id:number;event_type:string;business_date:string;external_order_id:string|null;product_name_snapshot:string|null;quantity:number|null;unit_cost:number|null;amount_delta:number|null;payment_method:string|null;comment:string|null;related_event_id:number|null}
type Day={date:string;completed:number;completionCorrections:number;paid:number;paymentCorrections:number;netChange:number;unpricedNewCount:number}
type Ledger={ok:boolean;captureEnabled:boolean;balance:number;confirmedDebt:number;correctionCredit:number;unresolvedPrices:number;range:{from:string;to:string;openingBalance:number};days:Day[];events:LedgerEvent[];hasMore:boolean;nextBeforeId:number|null}
type Unpriced={id:number;taskId:number;orderRef:string;productName:string;quantity:number;completedDate:string;availableUnitCost:number|null}
type UnpricedResponse={ok:boolean;items:Unpriced[];hasMore:boolean}
type View='daily'|'history'|'unpriced'
const formatter=new Intl.NumberFormat('ru-RU',{maximumFractionDigits:0})
const money=(n:number|null|undefined)=>n==null?'Не указана':formatter.format(n)+' ₸'
const todayKz=()=>new Date(Date.now()+5*3600000).toISOString().slice(0,10)
const backDays=(date:string,n:number)=>new Date(Date.parse(date+'T00:00:00Z')-n*86400000).toISOString().slice(0,10)
const eventNames:Record<string,string>={completion:'Готовая работа',completion_reversal:'Возврат в работу',price_adjustment:'Стоимость уточнена',payment:'Выплата цеху',payment_reversal:'Отмена выплаты',opening_balance:'Начальный долг',balance_adjustment:'Корректировка'}
async function readApi<T>(url:string,init?:RequestInit):Promise<T>{
  const response=await fetch(url,{...init,credentials:'include',cache:'no-store'})
  const payload=await response.json().catch(()=>null) as ({ok?:boolean;message?:string}&T)|null
  if(!response.ok||!payload||payload.ok===false)throw new Error(payload?.message||(response.status===401?'Войдите в систему повторно.':'Не удалось выполнить запрос.'))
  return payload
}
const draftStorageKey='workshop:settlements:payment:pending'
function paymentIdempotency(body:string){
  try{
    const saved=JSON.parse(sessionStorage.getItem(draftStorageKey)||'null') as {body:string;id:string}|null
    if(saved?.body===body&&saved?.id)return saved.id
  }catch{ /* private browsing */ }
  const id=crypto.randomUUID()
  try{sessionStorage.setItem(draftStorageKey,JSON.stringify({body,id}))}catch{ /* optional */ }
  return id
}
const clearPaymentId=()=>{try{sessionStorage.removeItem(draftStorageKey)}catch{ /* optional */ }}

export function WorkshopSettlementsPanel(){
  const today=todayKz()
  const [from,setFrom]=useState(backDays(today,29))
  const [to,setTo]=useState(today)
  const [period,setPeriod]=useState({from:backDays(today,29),to:today})
  const [view,setView]=useState<View>('daily')
  const [ledger,setLedger]=useState<Ledger|null>(null)
  const [unpriced,setUnpriced]=useState<UnpricedResponse|null>(null)
  const [loading,setLoading]=useState(true)
  const [busy,setBusy]=useState(false)
  const [moreBusy,setMoreBusy]=useState(false)
  const [error,setError]=useState('')
  const [notice,setNotice]=useState('')
  const [showPayment,setShowPayment]=useState(false)
  const [paymentAmount,setPaymentAmount]=useState('')
  const [method,setMethod]=useState('')
  const [comment,setComment]=useState('')
  const requestGeneration=useRef(0)
  const writeLocked=useRef(false)

  const refresh=useCallback(async()=>{
    const generation=++requestGeneration.current
    setLoading(true);setError('')
    try{
      const query=new URLSearchParams(period)
      const [next,unknown]=await Promise.all([
        readApi<Ledger>('/api/workshop/settlements?'+query.toString()),
        readApi<UnpricedResponse>('/api/workshop/settlements/unpriced'),
      ])
      if(requestGeneration.current!==generation)return
      setLedger(next);setUnpriced(unknown)
    }catch(e){
      if(requestGeneration.current===generation)setError(e instanceof Error?e.message:'Ошибка обновления расчётов.')
    }finally{
      if(requestGeneration.current===generation)setLoading(false)
    }
  },[period])
  useEffect(()=>{void refresh();return()=>{requestGeneration.current++}},[refresh])

  const daily=useMemo(()=>{
    let running=Number(ledger?.range.openingBalance||0)
    return [...(ledger?.days||[])].sort((a,b)=>a.date.localeCompare(b.date)).map(day=>{
      running+=Number(day.netChange||0)
      return {...day,closing:running}
    }).reverse()
  },[ledger])
  const todayRow=ledger?.days.find(day=>day.date===today)
  const activated=Boolean(ledger?.captureEnabled)
  const amountValue=Number(paymentAmount)
  const validAmount=Number.isSafeInteger(amountValue)&&amountValue>0&&amountValue<=(ledger?.confirmedDebt||0)
  const allowSave=activated&&!busy&&!loading&&validAmount&&Boolean(method.trim())
  const reversedIds=new Set((ledger?.events||[]).filter(x=>x.event_type==='payment_reversal').map(x=>Number(x.related_event_id)))

  const applyPeriod=(e:FormEvent)=>{
    e.preventDefault()
    const first=Date.parse(from+'T00:00:00Z'),last=Date.parse(to+'T00:00:00Z')
    if(!Number.isFinite(first)||!Number.isFinite(last)||first>last||(last-first)/86400000>89){
      setError('Выберите корректный период не длиннее 90 дней.');return
    }
    setPeriod({from,to})
  }
  const afterSave=async(note:string)=>{
    setNotice(note);setShowPayment(false);setPaymentAmount('');setComment('');clearPaymentId()
    await refresh()
  }
  const savePayment=async(e:FormEvent)=>{
    e.preventDefault()
    if(writeLocked.current||!allowSave)return
    const body={amount:amountValue,method:method.trim(),comment:comment.trim()}
    const id=paymentIdempotency(JSON.stringify(body))
    writeLocked.current=true;setBusy(true);setError('');setNotice('')
    try{
      await readApi('/api/workshop/settlements/payments',{
        method:'POST',headers:{'Content-Type':'application/json','X-Idempotency-Key':id},
        body:JSON.stringify({...body,requestId:id}),
      })
      await afterSave('Выплата записана, задолженность обновлена.')
    }catch(e){
      setError((e instanceof Error?e.message:'Не удалось записать выплату.')+' Если сеть прервалась, попробуйте повторить без изменения суммы.')
    }finally{writeLocked.current=false;setBusy(false)}
  }
  const reversePayment=async(item:LedgerEvent)=>{
    if(writeLocked.current||!activated)return
    const reason=window.prompt('Почему отменяем выплату? Причина останется в истории:')
    if(reason===null)return
    if(reason.trim().length<5){setError('Укажите причину не короче 5 символов.');return}
    if(!window.confirm('Отменить выплату '+money(-Number(item.amount_delta||0))+'? Задолженность увеличится.'))return
    writeLocked.current=true;setBusy(true);setError('')
    try{
      await readApi('/api/workshop/settlements/payments/'+item.id+'/reverse',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reason:reason.trim()})})
      await afterSave('Выплата отменена, история сохранена.')
    }catch(e){setError(e instanceof Error?e.message:'Не удалось отменить выплату.')}
    finally{writeLocked.current=false;setBusy(false)}
  }
  const resolveCost=async(item:Unpriced)=>{
    if(writeLocked.current||!activated||item.availableUnitCost===null)return
    if(!window.confirm('Подтвердить себестоимость '+money(item.availableUnitCost)+' × '+item.quantity+' шт. для «'+item.productName+'»?'))return
    writeLocked.current=true;setBusy(true);setError('')
    try{
      await readApi('/api/workshop/settlements/unpriced/'+item.id+'/confirm-cost',{method:'POST'})
      await afterSave('Стоимость подтверждена по каталогу.')
    }catch(e){setError(e instanceof Error?e.message:'Не удалось подтвердить себестоимость.')}
    finally{writeLocked.current=false;setBusy(false)}
  }
  const loadMore=async()=>{
    if(moreBusy||!ledger?.nextBeforeId)return
    setMoreBusy(true);setError('')
    try{
      const query=new URLSearchParams({...period,beforeId:String(ledger.nextBeforeId)})
      const page=await readApi<Ledger>('/api/workshop/settlements?'+query.toString())
      setLedger(current=>current?{...current,events:[...current.events,...page.events],hasMore:page.hasMore,nextBeforeId:page.nextBeforeId}:current)
    }catch(e){setError(e instanceof Error?e.message:'Не удалось загрузить историю.')}
    finally{setMoreBusy(false)}
  }

  return <section className="ws-settlements" aria-label="Расчёты с Цехом">
    <header className="ws-settlements-head">
      <div><h3>Расчёты с Цехом</h3><p>Общие начисления за обычные и Kaspi-заказы, выплаты и непогашенная задолженность.</p></div>
      <button type="button" className="secondary compact" disabled={loading||busy} onClick={()=>void refresh()}>{loading?'Загружаю…':'Обновить'}</button>
    </header>
    {ledger&&!activated&&<div className="ws-settlements-startup" role="status"><strong>Учёт пока не запущен.</strong> Новые начисления и выплаты отключены до сверки начальной задолженности на дату запуска. Исторические заказы не будут начисляться повторно.</div>}
    <div className="ws-settlements-kpis">
      <div><span>Сегодня выполнено</span><strong>{money(Number(todayRow?.completed||0)+Number(todayRow?.completionCorrections||0))}</strong><small>Подтверждённая себестоимость</small></div>
      <div><span>Сегодня выплачено</span><strong>{money(Number(todayRow?.paid||0)-Number(todayRow?.paymentCorrections||0))}</strong><small>За вычетом отмен выплат</small></div>
      <div><span>Осталось выплатить</span><strong>{money(ledger?.confirmedDebt||0)}</strong><small>Общий накопленный долг</small></div>
      <div><span>Без себестоимости</span><strong>{ledger?.unresolvedPrices??0}</strong><small>Не включены в долг</small></div>
    </div>
    {ledger&&ledger.correctionCredit>0&&<p className="ws-settlements-warning">После исправлений возникла переплата {money(ledger.correctionCredit)}. Это не аванс — проверьте корректировки и выплаты.</p>}
    {error&&<div className="ws-settlements-error" role="alert">{error}</div>}
    {notice&&<p className="ws-settlements-success" role="status">{notice}</p>}
    <div className="ws-settlements-actions">
      <form className="ws-settlements-period" onSubmit={applyPeriod}>
        <label>С <input type="date" value={from} onChange={e=>setFrom(e.target.value)} required/></label>
        <label>По <input type="date" value={to} onChange={e=>setTo(e.target.value)} required/></label>
        <button type="submit" className="secondary compact" disabled={loading}>Показать</button>
      </form>
      <button type="button" className="primary compact" disabled={!activated||busy||loading} onClick={()=>setShowPayment(open=>!open)}>{showPayment?'Закрыть форму':'+ Записать выплату'}</button>
    </div>
    {showPayment&&activated&&<form className="ws-settlements-payment" onSubmit={e=>void savePayment(e)}>
      <div className="ws-settlements-form-head"><strong>Выплата цеху</strong><span>Доступно: {money(ledger?.confirmedDebt)}</span></div>
      <div className="ws-settlements-fields">
        <label>Сумма, ₸<input type="number" min="1" step="1" max={ledger?.confirmedDebt||0} required value={paymentAmount} onChange={e=>setPaymentAmount(e.target.value)} placeholder="Сумма"/></label>
        <label>Способ оплаты<input type="text" maxLength={80} required value={method} onChange={e=>setMethod(e.target.value)} placeholder="Наличные, Kaspi Pay…"/></label>
        <label>Комментарий<input type="text" maxLength={500} value={comment} onChange={e=>setComment(e.target.value)} placeholder="Необязательно"/></label>
      </div>
      {amountValue>(ledger?.confirmedDebt||0)&&<p className="ws-settlements-warning">Сумма превышает текущую задолженность. Авансы не предусмотрены.</p>}
      <div className="ws-settlements-form-foot"><span>Дата выплаты фиксируется автоматически (время Казахстана).</span><button className="primary compact" type="submit" disabled={!allowSave}>{busy?'Сохраняю…':'Подтвердить выплату'}</button></div>
    </form>}
    <div className="workshop-section-tabs ws-settlements-tabs" role="tablist" aria-label="Просмотр расчётов">
      <button role="tab" type="button" aria-selected={view==='daily'} className={view==='daily'?'is-active':''} onClick={()=>setView('daily')}>По дням</button>
      <button role="tab" type="button" aria-selected={view==='history'} className={view==='history'?'is-active':''} onClick={()=>setView('history')}>История операций</button>
      <button role="tab" type="button" aria-selected={view==='unpriced'} className={view==='unpriced'?'is-active':''} onClick={()=>setView('unpriced')}>Без себестоимости{ledger?.unresolvedPrices?' · '+ledger.unresolvedPrices:''}</button>
    </div>
    {view==='daily'&&<section aria-label="Расчёты по дням">
      <div className="ws-settlements-table-scroll"><table className="data-table">
        <thead><tr><th>Дата</th><th>Выполнено</th><th>Выплачено</th><th>Изменение долга</th><th>Остаток</th></tr></thead>
        <tbody>{daily.map(day=><tr key={day.date}><td><strong>{day.date}</strong></td><td>{money(Number(day.completed||0)+Number(day.completionCorrections||0))}</td><td>{money(Number(day.paid||0)-Number(day.paymentCorrections||0))}</td><td>{money(Number(day.netChange||0))}</td><td><strong>{money(day.closing)}</strong></td></tr>)}
          {!daily.length&&<tr><td className="empty-state" colSpan={5}>{loading?'Загружаю…':'За выбранный период операций нет.'}</td></tr>}
        </tbody>
      </table></div>
      <p className="ws-settlements-footnote">Долг до начала периода: {money(ledger?.range.openingBalance)}. Выплаты цеху пока не списываются автоматически из кассы магазина.</p>
    </section>}
    {view==='history'&&<section aria-label="История начислений и выплат">
      <div className="ws-settlements-table-scroll"><table className="data-table">
        <thead><tr><th>Дата</th><th>Операция</th><th>Описание</th><th>Сумма</th><th>Действие</th></tr></thead>
        <tbody>{(ledger?.events||[]).map(e=><tr key={e.id}>
          <td>{e.business_date}</td><td><strong>{eventNames[e.event_type]||'Операция'}</strong>{e.payment_method&&<small>{e.payment_method}</small>}</td>
          <td>{e.product_name_snapshot||e.comment||'—'}{e.external_order_id&&<small>Заказ {e.external_order_id}</small>}{e.quantity&&e.unit_cost!==null&&<small>{e.quantity} × {money(e.unit_cost)}</small>}</td>
          <td>{e.amount_delta===null?'Цена не указана':money(e.amount_delta)}</td>
          <td>{e.event_type==='payment'&&!reversedIds.has(e.id)&&activated?<button className="secondary compact" type="button" disabled={busy} onClick={()=>void reversePayment(e)}>Отменить</button>:'—'}</td>
        </tr>)}{!ledger?.events.length&&<tr><td colSpan={5} className="empty-state">Операций за выбранный период нет.</td></tr>}</tbody>
      </table></div>
      {ledger?.hasMore&&<button type="button" className="secondary compact ws-settlements-more" disabled={moreBusy} onClick={()=>void loadMore()}>{moreBusy?'Загружаю…':'Показать ещё'}</button>}
    </section>}
    {view==='unpriced'&&<section aria-label="Позиции без себестоимости">
      <p className="ws-settlements-footnote">Эти готовые товары не включены в подтверждённый долг. Исправьте себестоимость в каталоге, обновите список и подтвердите цену без изменения старых записей.</p>
      <div className="ws-settlements-table-scroll"><table className="data-table">
        <thead><tr><th>Готово</th><th>Изделие</th><th>Кол-во</th><th>Себестоимость</th><th>Действие</th></tr></thead>
        <tbody>{(unpriced?.items||[]).map(item=><tr key={item.id}>
          <td>{item.completedDate}</td><td><strong>{item.productName}</strong>{item.orderRef&&<small>Заказ {item.orderRef}</small>}</td><td>{item.quantity}</td><td>{money(item.availableUnitCost)}</td>
          <td>{item.availableUnitCost!==null&&activated?<button type="button" className="secondary compact" disabled={busy} onClick={()=>void resolveCost(item)}>Подтвердить</button>:<span className="ws-settlements-muted">Нужна проверка</span>}</td>
        </tr>)}{!unpriced?.items.length&&<tr><td colSpan={5} className="empty-state">Неразобранных позиций нет.</td></tr>}</tbody>
      </table></div>
      {unpriced?.hasMore&&<p className="ws-settlements-footnote">Показаны последние 50 позиций. После обработки обновите список.</p>}
    </section>}
  </section>
}
