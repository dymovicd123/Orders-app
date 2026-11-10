import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { DDS_CATEGORIES } from '../../../shared/dds-categories'
import './dds.css'

type DdsEntry = {
  id: number; kind: 'funding' | 'expense' | 'reversal_funding' | 'reversal_expense'
  businessDate: string; amount: number; category: string; article: string
  comment: string; createdAt: string; reversesEntryId: number | null; reversed: number
}
type DdsResponse = {
  ok: boolean; month: string; currentBalance: number; openingBalance: number
  monthAdded: number; monthSpent: number; closingBalance: number
  categories: Array<{name:string;total:number;articles:Array<{name:string;amount:number}>}>
  entries: DdsEntry[]
}
type Props = {
  apiFetch: (url: string, init?: RequestInit) => Promise<Response>
  isAdmin: boolean
}
const formatMoney = (value: number) => new Intl.NumberFormat('ru-RU', {maximumFractionDigits:0}).format(value) + ' ₸'
function todayInAlmaty() {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone:'Asia/Almaty',year:'numeric',month:'2-digit',day:'2-digit' })
    .formatToParts(new Date())
  const part = (type: string) => parts.find(item=>item.type===type)?.value || ''
  return part('year') + '-' + part('month') + '-' + part('day')
}
const monthLabel = (m: string) => {
  const date = new Date(m + '-01T12:00:00Z')
  return new Intl.DateTimeFormat('ru-RU',{month:'long',year:'numeric',timeZone:'UTC'}).format(date)
}
function csvCell(value: string | number) {
  let text = String(value ?? '')
  // Prevent spreadsheet formula execution in user-authored comments.
  if (/^[\s]*[=+@-]/.test(text)) text = "'" + text
  return '"' + text.replaceAll('"','""') + '"'
}
const sign = (kind: DdsEntry['kind']) => ['funding','reversal_expense'].includes(kind) ? 1 : -1
const rowTitle = (kind: DdsEntry['kind']) => ({
  funding:'Пополнение',expense:'Расход',reversal_expense:'Отмена расхода',reversal_funding:'Отмена пополнения',
})[kind]
const newDraft = () => ({ date:todayInAlmaty(),category:'',article:'',amount:'',comment:'' })

export function DdsWorkspace({apiFetch,isAdmin}:Props) {
  const [month,setMonth] = useState(() => todayInAlmaty().slice(0,7))
  const [data,setData] = useState<DdsResponse|null>(null)
  const [loading,setLoading] = useState(false)
  const [saving,setSaving] = useState(false)
  const [error,setError] = useState('')
  const [notice,setNotice] = useState('')
  const [expense,setExpense] = useState(newDraft)
  const [funds,setFunds] = useState({date:todayInAlmaty(),amount:'',comment:''})
  const [reverseId,setReverseId] = useState<number|null>(null)
  const [reverseReason,setReverseReason] = useState('')
  const readToken = useRef(0)
  const requestRef = useRef<{fingerprint:string;id:string}|null>(null)
  const savingRef = useRef(false)

  const refresh = useCallback(async (forMonth: string) => {
    const token = ++readToken.current
    setLoading(true)
    try {
      const response = await apiFetch('/api/dds?month=' + encodeURIComponent(forMonth))
      const payload = await response.json() as DdsResponse & {message?:string}
      if (!response.ok || !payload.ok) throw new Error(payload.message || 'Не удалось загрузить ДДС.')
      if (token === readToken.current) { setData(payload);setError('') }
    } catch (failure) {
      if (token === readToken.current) setError(failure instanceof Error ? failure.message : 'Не удалось загрузить отчёт.')
    } finally {
      if (token === readToken.current) setLoading(false)
    }
  },[apiFetch])
  useEffect(()=>{ void refresh(month);return ()=>{readToken.current++} },[month,refresh])
  const currentCategory = DDS_CATEGORIES.find(group=>group.name===expense.category)
  const canSaveExpense = Boolean(expense.category && expense.article && Number.isSafeInteger(Number(expense.amount))
    && Number(expense.amount)>0 && expense.date && (!expense.category.startsWith('Зарплата') || expense.comment.trim())
    && (expense.article!=='Прочее' || expense.comment.trim()))

  const post = async (path: string, payload: Record<string,unknown>) => {
    if (savingRef.current) return false
    const fingerprint = path + JSON.stringify(payload)
    if (!requestRef.current || requestRef.current.fingerprint !== fingerprint) {
      requestRef.current = {fingerprint,id:crypto.randomUUID()}
    }
    savingRef.current = true
    setSaving(true);setError('');setNotice('')
    try {
      const response = await apiFetch(path,{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({...payload,requestId:requestRef.current.id})})
      const result = await response.json() as {ok:boolean;message?:string}
      if (!response.ok || !result.ok) throw new Error(result.message || 'Не удалось сохранить операцию.')
      requestRef.current = null
      await refresh(month)
      return true
    } catch(failure) {
      setError(failure instanceof Error ? failure.message : 'Не удалось сохранить операцию. Проверьте связь и повторите.')
      return false
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  async function saveExpense(event: FormEvent) {
    event.preventDefault()
    if (!canSaveExpense) return
    const saved=await post('/api/dds/expenses',{
      businessDate:expense.date,category:expense.category,article:expense.article,
      amount:Number(expense.amount),comment:expense.comment.trim(),
    })
    if (saved) {setExpense(newDraft());setNotice('Расход записан. Остаток обновлён.')}
  }
  async function saveFunds(event: FormEvent) {
    event.preventDefault()
    if (!isAdmin || !funds.date || !Number.isSafeInteger(Number(funds.amount)) || Number(funds.amount)<=0)return
    const saved=await post('/api/dds/funds',{
      businessDate:funds.date,amount:Number(funds.amount),comment:funds.comment.trim(),
    })
    if (saved) {setFunds({date:todayInAlmaty(),amount:'',comment:''});setNotice('Деньги добавлены в ДДС.')}
  }
  async function reverseEntry() {
    if (!isAdmin || !reverseId || reverseReason.trim().length < 3) return
    const saved=await post('/api/dds/entries/'+reverseId+'/reverse',{comment:reverseReason.trim()})
    if (saved) {setReverseId(null);setReverseReason('');setNotice('Отмена записана отдельной операцией.')}
  }
  const visibleCategories=useMemo(()=>data?.categories.filter(item=>item.total!==0)||[],[data])
  const peak=Math.max(1,...visibleCategories.map(item=>Math.max(0,item.total)))
  function exportMonth() {
    if (!data) return
    const rows:(string|number)[][]=[
      ['ДДС за '+monthLabel(month)],
      ['Остаток на начало',data.openingBalance],['Пополнено',data.monthAdded],
      ['Израсходовано',data.monthSpent],['Остаток на конец',data.closingBalance],
      [],['Категория','Статья','Сумма'],
      ...data.categories.flatMap(item=>item.articles.map(article=>[item.name,article.name,article.amount])),
      [],['Дата','Операция','Категория','Статья','Комментарий','Сумма'],
      ...data.entries.map(entry=>[entry.businessDate,rowTitle(entry.kind),entry.category,entry.article,
        entry.comment,entry.amount*sign(entry.kind)]),
    ]
    const csv='\uFEFF'+rows.map(row=>row.map(csvCell).join(';')).join('\r\n')
    const link=document.createElement('a'),url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}))
    link.href=url;link.download='ДДС-'+data.month+'.csv';document.body.appendChild(link);link.click();link.remove()
    window.setTimeout(()=>URL.revokeObjectURL(url),1000)
  }

  return <section className="dds-workspace">
    <div className="dds-heading">
      <div><h3>Движение денежных средств</h3><p>Один общий остаток, пополнения и расходы. Без связи с кассой и заказами.</p></div>
      <button className="secondary compact" type="button" disabled={loading||saving} onClick={()=>void refresh(month)}>Обновить</button>
    </div>

    <div className="dds-balance">
      <span>Доступно для расходов</span>
      <strong>{data?formatMoney(data.currentBalance):'—'}</strong>
      <small>Общий остаток по журналу ДДС</small>
    </div>

    {error && <div className="dds-notice is-error" role="alert">{error}</div>}
    {notice && <div className="dds-notice is-success" role="status">{notice}</div>}

    <div className="dds-forms">
      <form onSubmit={(e)=>void saveExpense(e)} className="dds-form">
        <h4>Добавить расход</h4>
        <div className="dds-fields">
          <label>Дата<input required type="date" max={todayInAlmaty()} value={expense.date}
            onChange={event=>setExpense(current=>({...current,date:event.target.value}))}/></label>
          <label>Категория<select required value={expense.category}
            onChange={event=>setExpense(current=>({...current,category:event.target.value,article:''}))}>
            <option value="">Выберите категорию</option>
            {DDS_CATEGORIES.map(item=><option key={item.name} value={item.name}>{item.name}</option>)}
          </select></label>
          <label>Статья<select required disabled={!currentCategory} value={expense.article}
            onChange={event=>setExpense(current=>({...current,article:event.target.value}))}>
            <option value="">Выберите статью</option>
            {currentCategory?.articles.map(article=><option key={article} value={article}>{article}</option>)}
          </select></label>
          <label>Сумма, ₸<input required type="number" min="1" max="1000000000" step="1"
            value={expense.amount} placeholder="0" onChange={event=>setExpense(current=>({...current,amount:event.target.value}))}/></label>
          <label className="dds-wide">Комментарий{(expense.category.startsWith('Зарплата')||expense.article==='Прочее')?' *':''}
            <input maxLength={500} value={expense.comment} placeholder="Например, 20 коробок для заказов"
              onChange={event=>setExpense(current=>({...current,comment:event.target.value}))}/></label>
        </div>
        <div className="dds-form-end">
          <small>Остаток после расхода: {data?formatMoney(data.currentBalance-Number(expense.amount||0)):'—'}</small>
          <button className="primary" type="submit" disabled={saving||!canSaveExpense}>{saving?'Сохраняю…':'Сохранить расход'}</button>
        </div>
      </form>
      {isAdmin && <form onSubmit={(e)=>void saveFunds(e)} className="dds-form dds-funding">
        <h4>Пополнить ДДС</h4>
        <p>Добавляйте деньги столько раз, сколько нужно. Лимита пополнений за месяц нет.</p>
        <div className="dds-fields">
          <label>Дата<input required type="date" max={todayInAlmaty()} value={funds.date}
            onChange={event=>setFunds(current=>({...current,date:event.target.value}))}/></label>
          <label>Сумма, ₸<input required type="number" min="1" max="1000000000" step="1" value={funds.amount}
            placeholder="0" onChange={event=>setFunds(current=>({...current,amount:event.target.value}))}/></label>
          <label className="dds-wide">Комментарий<input maxLength={500} value={funds.comment}
            placeholder="Например, деньги на текущие расходы"
            onChange={event=>setFunds(current=>({...current,comment:event.target.value}))}/></label>
        </div>
        <div className="dds-form-end">
          <small>После пополнения: {data?formatMoney(data.currentBalance+Number(funds.amount||0)):'—'}</small>
          <button className="primary" type="submit" disabled={saving||!Number.isSafeInteger(Number(funds.amount))||Number(funds.amount)<=0}>
            {saving?'Сохраняю…':'Добавить деньги'}
          </button>
        </div>
      </form>}
    </div>

    <div className="dds-report-head">
      <div><h4>Отчёт за месяц</h4><span>Пополнения, расходы, остаток и статьи</span></div>
      <div className="dds-report-actions">
        <input type="month" aria-label="Месяц отчёта" value={month} max={todayInAlmaty().slice(0,7)}
          onChange={event=>setMonth(event.target.value)}/>
        <button className="secondary compact" type="button" disabled={!data||loading} onClick={exportMonth}>Скачать для Excel (CSV)</button>
      </div>
    </div>
    {loading && <p className="dds-loading" role="status">Загружаю отчёт…</p>}
    <div className="dds-summary">
      {[['На начало',data?.openingBalance],['Пополнено',data?.monthAdded],['Израсходовано',data?.monthSpent],['На конец',data?.closingBalance]].map(([label,value])=>
        <div className="dds-stat" key={String(label)}><span>{label}</span><strong>{typeof value==='number'?formatMoney(value):'—'}</strong></div>
      )}
    </div>

    <div className="dds-report-grid">
      <div className="dds-panel">
        <h4>По категориям</h4>
        {!visibleCategories.length?<p className="dds-muted">За выбранный месяц расходов пока нет.</p>:
          visibleCategories.map(group=><details key={group.name} className="dds-category">
            <summary><span>{group.name}</span><b>{formatMoney(group.total)}</b></summary>
            <div className="dds-bar"><div style={{width:Math.min(100,Math.max(0,group.total)/peak*100)+'%'}}/></div>
            <div className="dds-category-lines">
              {group.articles.map(article=><div key={article.name}><span>{article.name}</span><strong>{formatMoney(article.amount)}</strong></div>)}
            </div>
          </details>)
        }
        {data && data.monthSpent>0 && data.categories.some(c=>c.name==='Прочее' && c.total>data.monthSpent*.05) &&
          <p className="dds-hint">Доля «Прочее» больше 5%. По списку статей желательно удерживать её в пределах 3–5%.</p>}
      </div>
      <div className="dds-panel dds-history">
        <h4>История за {monthLabel(month)}</h4>
        {!data?.entries.length?<p className="dds-muted">Записей пока нет.</p>:
          <div className="dds-history-list">{data.entries.map(entry=><div className="dds-history-row" key={entry.id}>
            <div className="dds-entry-main">
              <span>{entry.businessDate.split('-').reverse().join('.')} · {rowTitle(entry.kind)}</span>
              <strong>{entry.article || (entry.kind==='funding'?'Пополнение средств':'Корректировка')}</strong>
              {entry.comment && <small>{entry.comment}</small>}
              {Boolean(entry.reversed) && <small className="dds-muted">Отменено</small>}
            </div>
            <div className="dds-entry-sum">
              <strong className={sign(entry.kind)>0?'dds-credit':'dds-debit'}>
                {sign(entry.kind)>0?'+':'−'}{formatMoney(entry.amount)}
              </strong>
              {isAdmin && ['funding','expense'].includes(entry.kind) && !entry.reversed &&
                <button className="secondary compact" type="button" disabled={saving}
                  onClick={()=>{setReverseId(entry.id);setReverseReason('')}}>Отменить</button>}
            </div>
          </div>)}</div>
        }
        {data?.entries.length===2000 && <p className="dds-hint">История ограничена 2000 последними записями месяца. Сводные суммы рассчитаны полностью.</p>}
      </div>
    </div>

    {isAdmin && reverseId!==null && <div className="dds-dialog-overlay" role="presentation">
      <div className="dds-dialog" role="dialog" aria-modal="true" aria-label="Отмена записи ДДС">
        <h4>Отменить запись №{reverseId}?</h4>
        <p>Исходная запись останется в истории. Остаток пересчитается автоматически.</p>
        <label>Причина отмены<input autoFocus required minLength={3} maxLength={500} value={reverseReason}
          placeholder="Почему запись ошибочна?" onChange={event=>setReverseReason(event.target.value)}/></label>
        <div className="dds-dialog-buttons">
          <button className="secondary" type="button" onClick={()=>{setReverseId(null);setReverseReason('')}}>Назад</button>
          <button className="primary" type="button" disabled={saving||reverseReason.trim().length<3}
            onClick={()=>void reverseEntry()}>Подтвердить отмену</button>
        </div>
      </div>
    </div>}
  </section>
}
