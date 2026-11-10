import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { DDS_CATEGORIES } from '../../../shared/dds-categories'
import { ddsDateLabel, ddsKindLabel, ddsMoney, ddsMonthLabel, ddsSignedAmount, type DdsEntry, type DdsReport } from './ddsTypes'
import './dds.css'

type Props={apiFetch:(url:string, init?:RequestInit)=>Promise<Response>;isAdmin:boolean}
type View='expenses'|'report'
const currentDay=()=>{
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Almaty',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date())
  const part=(name:string)=>parts.find(value=>value.type===name)?.value||''
  return part('year')+'-'+part('month')+'-'+part('day')
}
const freshExpense=()=>({date:currentDay(),category:'',article:'',amount:'',comment:''})
const freshFunds=()=>({date:currentDay(),amount:'',comment:''})
const integerAmount=(value:string)=>Number.isSafeInteger(Number(value))&&Number(value)>0&&Number(value)<=1000000000
const validMonth=(value:string)=>/^20\d{2}-(0[1-9]|1[0-2])$/.test(value)

function DdsDialog({title,description,children,onClose}:{
  title:string;description:string;children:ReactNode;onClose:()=>void
}) {
  const ref=useRef<HTMLDivElement>(null)
  useEffect(()=>{
    const previous=document.activeElement instanceof HTMLElement?document.activeElement:null
    const area=ref.current
    const selectable=()=>Array.from(area?.querySelectorAll<HTMLElement>('input:not([disabled]),button:not([disabled]),select:not([disabled])')||[])
    selectable()[0]?.focus()
    const onKey=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){event.preventDefault();onClose();return}
      if(event.key!=='Tab')return
      const items=selectable()
      if(!items.length)return
      const first=items[0],last=items[items.length-1]
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
    }
    document.addEventListener('keydown',onKey)
    return ()=>{document.removeEventListener('keydown',onKey);if(previous?.isConnected)previous.focus()}
  },[onClose])
  return <div className="dds-modal-shade" role="presentation">
    <div className="dds-modal" ref={ref} role="dialog" aria-modal="true" aria-label={title}>
      <div className="dds-modal-heading">
        <div><h3>{title}</h3><p>{description}</p></div>
        <button type="button" className="dds-icon-button" aria-label="Закрыть" onClick={onClose}>×</button>
      </div>
      {children}
    </div>
  </div>
}

function DdsTransactions({entries,isAdmin,saving,onReverse,short=false}:{
  entries:DdsEntry[];isAdmin:boolean;saving:boolean;onReverse:(id:number)=>void;short?:boolean
}) {
  if(entries.length===0) return <div className="dds-empty">
    <strong>Пока нет операций</strong><span>После первой записи история появится здесь.</span>
  </div>
  const visible=short?entries.slice(0,8):entries
  const days=new Map<string,DdsEntry[]>()
  for(const entry of visible){const rows=days.get(entry.businessDate)||[];rows.push(entry);days.set(entry.businessDate,rows)}
  return <div className="dds-timeline">
    {Array.from(days,([date,items])=><div className="dds-day" key={date}>
      <div className="dds-day-label">{ddsDateLabel(date)}</div>
      {items.map(entry=>{
        const signed=ddsSignedAmount(entry)
        const name=entry.article || (entry.kind==='funding'?'Пополнение средств':'Исправление записи')
        return <div className="dds-transaction" key={entry.id}>
          <div className={'dds-transaction-icon '+(signed>=0?'is-in':'is-out')} aria-hidden="true">{signed>=0?'+':'−'}</div>
          <div className="dds-transaction-title">
            <strong>{name}</strong>
            <span>{ddsKindLabel[entry.kind]}{entry.category?' · '+entry.category:''}</span>
            {entry.comment&&<small>{entry.comment}</small>}
            {Boolean(entry.reversed)&&<small className="dds-reversed">Исходная запись отменена</small>}
          </div>
          <div className="dds-transaction-side">
            <strong className={signed>=0?'is-plus':'is-minus'}>{signed>=0?'+':'−'}{ddsMoney(Math.abs(signed))}</strong>
            {isAdmin&&(entry.kind==='funding'||entry.kind==='expense')&&!entry.reversed&&
              <button type="button" className="dds-text-button" disabled={saving} onClick={()=>onReverse(entry.id)}>Отменить</button>}
          </div>
        </div>
      })}
    </div>)}
  </div>
}

export function DdsWorkspace({apiFetch,isAdmin}:Props) {
  const [view,setView]=useState<View>('expenses')
  const [month,setMonth]=useState(()=>currentDay().slice(0,7))
  const [data,setData]=useState<DdsReport|null>(null)
  const [loading,setLoading]=useState(false)
  const [saving,setSaving]=useState(false)
  const [exporting,setExporting]=useState(false)
  const [error,setError]=useState('')
  const [notice,setNotice]=useState('')
  const [expense,setExpense]=useState(freshExpense)
  const [funds,setFunds]=useState(freshFunds)
  const [fundingOpen,setFundingOpen]=useState(false)
  const [reverseId,setReverseId]=useState<number|null>(null)
  const [reverseReason,setReverseReason]=useState('')
  const readToken=useRef(0)
  const requestRef=useRef<{fingerprint:string;id:string}|null>(null)
  const savingRef=useRef(false)

  const closeFunding=useCallback(()=>setFundingOpen(false),[])
  const closeReversal=useCallback(()=>setReverseId(null),[])
  const refresh=useCallback(async(forMonth:string)=>{
    const token=++readToken.current
    setLoading(true)
    try{
      const response=await apiFetch('/api/dds?month='+encodeURIComponent(forMonth))
      const payload=await response.json() as DdsReport & {message?:string}
      if(!response.ok||!payload.ok)throw new Error(payload.message||'Не удалось загрузить ДДС.')
      if(token===readToken.current){setData(payload);setError('')}
    }catch(failure){
      if(token===readToken.current)setError(failure instanceof Error?failure.message:'Не удалось загрузить ДДС.')
    }finally{if(token===readToken.current)setLoading(false)}
  },[apiFetch])
  useEffect(()=>{void refresh(month);return()=>{readToken.current++}},[month,refresh])

  const category=DDS_CATEGORIES.find(group=>group.name===expense.category)
  const needsComment=expense.category.startsWith('Зарплата')||expense.article==='Прочее'
  const canSaveExpense=Boolean(expense.date&&integerAmount(expense.amount)&&category&&
    category.articles.some(article=>article===expense.article)&&(!needsComment||expense.comment.trim()))
  const accurate=data?.month===month?data:null
  const shownCategories=useMemo(()=>accurate?.categories.filter(group=>group.total!==0)||[],[accurate])
  const maxCategory=Math.max(1,...shownCategories.map(x=>Math.abs(x.total)))

  async function post(path:string,payload:Record<string,unknown>) {
    if(savingRef.current)return false
    const fingerprint=path+JSON.stringify(payload)
    if(!requestRef.current||requestRef.current.fingerprint!==fingerprint)
      requestRef.current={fingerprint,id:crypto.randomUUID()}
    savingRef.current=true;setSaving(true);setError('');setNotice('')
    try{
      const response=await apiFetch(path,{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({...payload,requestId:requestRef.current.id})})
      const result=await response.json() as {ok:boolean;message?:string}
      if(!response.ok||!result.ok)throw new Error(result.message||'Не удалось сохранить операцию.')
      requestRef.current=null
      await refresh(month)
      return true
    }catch(failure){
      setError(failure instanceof Error?failure.message:'Не удалось сохранить. Повторите действие.')
      return false
    }finally{savingRef.current=false;setSaving(false)}
  }
  async function saveExpense(event:FormEvent){
    event.preventDefault()
    if(!canSaveExpense)return
    const date=expense.date
    const result=await post('/api/dds/expenses',{
      businessDate:date,category:expense.category,article:expense.article,
      amount:Number(expense.amount),comment:expense.comment.trim()
    })
    if(result){
      setExpense(freshExpense())
      if(month!==date.slice(0,7))setMonth(date.slice(0,7))
      setNotice('Расход сохранён. Остаток обновлён.')
    }
  }
  async function saveFunds(event:FormEvent){
    event.preventDefault()
    if(!isAdmin||!integerAmount(funds.amount)||!funds.date)return
    const result=await post('/api/dds/funds',{
      businessDate:funds.date,amount:Number(funds.amount),comment:funds.comment.trim()
    })
    if(result){
      setFundingOpen(false);setFunds(freshFunds())
      if(month!==funds.date.slice(0,7))setMonth(funds.date.slice(0,7))
      setNotice('Пополнение сохранено.')
    }
  }
  async function reverseEntry(){
    if(!isAdmin||!reverseId||reverseReason.trim().length<3)return
    if(await post('/api/dds/entries/'+reverseId+'/reverse',{comment:reverseReason.trim()})){
      setReverseId(null);setReverseReason('');setNotice('Исправление сохранено в истории.')
    }
  }
  async function exportXlsx(){
    if(!accurate||loading||exporting)return
    if(accurate.entries.length>=2000){setError('В истории более 2000 записей. Неполный отчёт скачивать нельзя.');return}
    setExporting(true);setError('')
    try{
      const {buildDdsXlsx}=await import('./ddsExcel')
      const bytes=buildDdsXlsx(accurate)
      const blob=new Blob([new Uint8Array(bytes)],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})
      const url=URL.createObjectURL(blob)
      const link=document.createElement('a')
      link.href=url;link.download='ДДС-'+accurate.month+'.xlsx'
      document.body.appendChild(link);link.click();link.remove()
      window.setTimeout(()=>URL.revokeObjectURL(url),1000)
    }catch(failure){setError(failure instanceof Error?failure.message:'Не удалось подготовить Excel-отчёт.')}
    finally{setExporting(false)}
  }
  const transactions=accurate?.entries||[]

  return <section className="dds-workspace">
    <div className="dds-page-header">
      <div><p className="dds-eyebrow">УЧЁТ РАСХОДОВ</p><h2>Движение денежных средств</h2>
        <p>Записывайте расходы по статьям и смотрите итог за месяц.</p></div>
      <button className="secondary compact" type="button" disabled={loading||saving} onClick={()=>void refresh(month)}>Обновить</button>
    </div>
    <div className="dds-wallet">
      <div><span>Доступный остаток</span><strong>{data?ddsMoney(data.currentBalance):'—'}</strong>
        <small>Общие средства для расходов</small></div>
      {isAdmin&&<button type="button" className="secondary dds-add-funds" onClick={()=>setFundingOpen(true)}>+ Пополнить</button>}
    </div>

    {error&&<div className="dds-alert is-error" role="alert">{error}</div>}
    {notice&&<div className="dds-alert is-success" role="status">{notice}</div>}

    <div className="dds-switch" role="tablist" aria-label="Разделы ДДС">
      <button type="button" role="tab" aria-selected={view==='expenses'} className={view==='expenses'?'is-active':''}
        onClick={()=>setView('expenses')}>Расходы</button>
      <button type="button" role="tab" aria-selected={view==='report'} className={view==='report'?'is-active':''}
        onClick={()=>setView('report')}>Отчёт за месяц</button>
    </div>

    {view==='expenses'&&<>
      <form className="dds-primary-form" onSubmit={event=>void saveExpense(event)}>
        <div className="dds-section-title"><div><h3>Записать расход</h3><p>Выберите, на что были потрачены деньги.</p></div></div>
        <div className="dds-form-grid">
          <label>Сумма, ₸<input className="dds-money-field" required type="number" min="1" max="1000000000" step="1"
            value={expense.amount} placeholder="0" onChange={e=>setExpense(s=>({...s,amount:e.target.value}))}/></label>
          <label>Дата расхода<input required type="date" max={currentDay()} value={expense.date}
            onChange={e=>setExpense(s=>({...s,date:e.target.value}))}/></label>
          <label>Категория<select required value={expense.category}
            onChange={e=>setExpense(s=>({...s,category:e.target.value,article:''}))}>
            <option value="">Выберите категорию</option>
            {DDS_CATEGORIES.map(group=><option key={group.name} value={group.name}>{group.name}</option>)}
          </select></label>
          <label>Статья<select required disabled={!category} value={expense.article}
            onChange={e=>setExpense(s=>({...s,article:e.target.value}))}>
            <option value="">Выберите статью</option>
            {category?.articles.map(article=><option key={article} value={article}>{article}</option>)}
          </select></label>
          <label className="dds-wide">Комментарий{needsComment?' *':''}<input maxLength={500}
            value={expense.comment} placeholder="Например, упаковка 20 заказов"
            onChange={e=>setExpense(s=>({...s,comment:e.target.value}))}/></label>
        </div>
        <div className="dds-form-footer">
          <span>После расхода останется: <strong>{data&&expense.amount?ddsMoney(data.currentBalance-Number(expense.amount)):data?ddsMoney(data.currentBalance):'—'}</strong></span>
          <button type="submit" className="primary" disabled={!canSaveExpense||saving||loading}>{saving?'Сохраняю…':'Сохранить расход'}</button>
        </div>
      </form>

      <section className="dds-section">
        <div className="dds-section-title">
          <div><h3>Недавние операции</h3><p>Расходы и пополнения за выбранный месяц.</p></div>
          <div className="dds-section-tools">
            <input type="month" aria-label="Месяц операций" max={currentDay().slice(0,7)} value={month}
              onChange={e=>{if(validMonth(e.target.value))setMonth(e.target.value)}}/>
            <button className="secondary compact" type="button" onClick={()=>setView('report')}>Весь отчёт</button>
          </div>
        </div>
        {loading&&!accurate?<p className="dds-muted" role="status">Загружаю операции…</p>:
          <DdsTransactions entries={transactions} isAdmin={isAdmin} saving={saving}
            onReverse={id=>{setReverseId(id);setReverseReason('')}} short/>}
      </section>
    </>}

    {view==='report'&&<div className="dds-month-report">
      <div className="dds-report-heading">
        <div><p className="dds-eyebrow">МЕСЯЧНЫЙ ОТЧЁТ</p><h3>{ddsMonthLabel(month)}</h3>
          <p>Все пополнения и расходы с разбивкой по статьям.</p></div>
        <div className="dds-report-actions">
          <input type="month" aria-label="Месяц отчёта" value={month} max={currentDay().slice(0,7)}
            onChange={e=>{if(validMonth(e.target.value))setMonth(e.target.value)}}/>
          <button className="primary" type="button" disabled={!accurate||loading||exporting||transactions.length>=2000}
            onClick={()=>void exportXlsx()}>{exporting?'Создаю файл…':'Скачать Excel (.xlsx)'}</button>
        </div>
      </div>
      {loading&&!accurate?<p className="dds-muted" role="status">Загружаю отчёт…</p>:<>
        <div className="dds-kpis">
          {[
            {label:'На начало месяца',value:accurate?.openingBalance},
            {label:'Пополнено',value:accurate?.monthAdded},
            {label:'Израсходовано',value:accurate?.monthSpent},
            {label:'На конец месяца',value:accurate?.closingBalance},
          ].map((item,i)=><div className={'dds-kpi '+(i===3?'is-closing':'')} key={item.label}>
            <span>{item.label}</span><strong>{typeof item.value==='number'?ddsMoney(item.value):'—'}</strong>
          </div>)}
        </div>

        <section className="dds-section">
          <div className="dds-section-title"><div><h3>На что потратили деньги</h3><p>Нажмите категорию, чтобы увидеть отдельные статьи.</p></div>
            <strong className="dds-report-total">{accurate?ddsMoney(accurate.monthSpent):'—'}</strong></div>
          {!shownCategories.length?<div className="dds-empty"><strong>Расходов пока нет</strong>
            <span>Категории появятся после внесения расходов.</span></div>:
            <div className="dds-category-list">{shownCategories.map((group,index)=><details className="dds-category" key={group.name}>
              <summary><span className="dds-category-index">{String(index+1).padStart(2,'0')}</span>
                <span className="dds-category-main"><strong>{group.name}</strong><span className="dds-bar">
                  <span style={{width:Math.min(100,Math.abs(group.total)/maxCategory*100)+'%'}}/></span></span>
                <strong className="dds-category-money">{ddsMoney(group.total)}</strong>
                <span className="dds-category-arrow" aria-hidden="true">⌄</span></summary>
              <div className="dds-category-articles">{group.articles.map(article=><div key={article.name}>
                <span>{article.name}</span><strong>{ddsMoney(article.amount)}</strong></div>)}</div>
            </details>)}</div>}
          {accurate&&accurate.monthSpent>0&&accurate.categories.some(g=>g.name==='Прочее'&&g.total>accurate.monthSpent*.05)&&
            <p className="dds-warning">На категорию «Прочее» приходится больше 5% расходов. Рекомендуемый ориентир — до 3–5%.</p>}
        </section>
        <section className="dds-section">
          <div className="dds-section-title"><div><h3>История операций</h3><p>Расходы, пополнения и исправления за {ddsMonthLabel(month)}.</p></div>
            <span className="dds-counter">{transactions.length} записей</span></div>
          <DdsTransactions entries={transactions} isAdmin={isAdmin} saving={saving}
            onReverse={id=>{setReverseId(id);setReverseReason('')}}/>
          {transactions.length>=2000&&<p className="dds-warning">Отчёт содержит более 2000 записей. Выгрузка отключена, чтобы не выдать неполные данные.</p>}
        </section>
      </>}
    </div>}

    {isAdmin&&fundingOpen&&<DdsDialog title="Пополнить ДДС" description="Добавьте средства к общему остатку. Количество пополнений не ограничено." onClose={closeFunding}>
      <form className="dds-modal-form" onSubmit={event=>void saveFunds(event)}>
        <label>Сумма, ₸<input required autoFocus type="number" min="1" max="1000000000" step="1"
          value={funds.amount} placeholder="0" onChange={e=>setFunds(s=>({...s,amount:e.target.value}))}/></label>
        <label>Дата<input required type="date" max={currentDay()} value={funds.date}
          onChange={e=>setFunds(s=>({...s,date:e.target.value}))}/></label>
        <label>Комментарий<input maxLength={500} placeholder="Для каких расходов выделены средства"
          value={funds.comment} onChange={e=>setFunds(s=>({...s,comment:e.target.value}))}/></label>
        <div className="dds-modal-preview">Остаток после пополнения:
          <strong>{data?ddsMoney(data.currentBalance+Number(funds.amount||0)):'—'}</strong></div>
        <div className="dds-modal-actions">
          <button type="button" className="secondary" onClick={closeFunding}>Отмена</button>
          <button type="submit" className="primary" disabled={!integerAmount(funds.amount)||saving||loading}>
            {saving?'Сохраняю…':'Добавить деньги'}</button>
        </div>
      </form>
    </DdsDialog>}

    {isAdmin&&reverseId!==null&&<DdsDialog title="Отменить запись?" description="Исходная запись останется в истории, остаток пересчитается автоматически." onClose={closeReversal}>
      <div className="dds-modal-form">
        <label>Причина отмены<input autoFocus required minLength={3} maxLength={500} value={reverseReason}
          placeholder="Почему запись ошибочна?" onChange={e=>setReverseReason(e.target.value)}/></label>
        <div className="dds-modal-actions"><button type="button" className="secondary" onClick={closeReversal}>Назад</button>
          <button type="button" className="primary" disabled={saving||reverseReason.trim().length<3}
            onClick={()=>void reverseEntry()}>Подтвердить отмену</button></div>
      </div>
    </DdsDialog>}
  </section>
}
