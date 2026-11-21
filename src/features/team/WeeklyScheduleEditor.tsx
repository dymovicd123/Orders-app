import {useEffect,useMemo,useRef,useState} from 'react'
import type {TeamTimesheetEntry} from '../../app/types'
import {WeekAutosaveQueue,previewWeek,type WeekData,type WeekIntent,
  type WeekQueueState,type WeekChange} from './weekAutosaveQueue.ts'
import './weeklyScheduleEditor.css'

type Props={
  apiFetch:(path:string,init?:RequestInit)=>Promise<Response>
  canEdit:boolean
  initialDate:string
  onMonthView:(month:string)=>void
  onWeekChange:(start:string)=>void
  onDirtyChange:(dirty:boolean)=>void
  onSaved:()=>void
}
type Destination={kind:'week';start:string}|{kind:'month';month:string}
type LocalFields={workUntil:string;comment:string}
const stepDate=(date:string,delta:number)=>{
  const d=new Date(date+'T12:00:00Z')
  d.setUTCDate(d.getUTCDate()+delta)
  return d.toISOString().slice(0,10)
}
const weekMonday=(date:string)=>{
  const day=new Date(date+'T12:00:00Z').getUTCDay()
  return stepDate(date,-((day+6)%7))
}
const shortDay=(date:string)=>new Intl.DateTimeFormat('ru-RU',{
  weekday:'short',day:'numeric',month:'short',timeZone:'UTC'
}).format(new Date(date+'T12:00:00Z'))
const dayTitle=(date:string)=>new Intl.DateTimeFormat('ru-RU',{
  weekday:'long',day:'numeric',month:'long',timeZone:'UTC'
}).format(new Date(date+'T12:00:00Z'))
const keyOf=(date:string,id:number)=>date+':'+id
const weekLabel=(start:string)=>shortDay(start)+' — '+shortDay(stepDate(start,6))
const localToday=()=>new Intl.DateTimeFormat('en-CA',{
  timeZone:'Asia/Almaty',year:'numeric',month:'2-digit',day:'2-digit'
}).format(new Date())
async function checkedJson(response:Response):Promise<WeekData>{
  const payload=await response.json().catch(()=>({ok:false,message:'Некорректный ответ сервера.'}))
  if(!response.ok||payload.ok===false)throw new Error(payload.message||'Не удалось загрузить график.')
  return payload as WeekData
}

export function WeeklyScheduleEditor({apiFetch,canEdit,initialDate,
  onMonthView,onWeekChange,onDirtyChange,onSaved}:Props){
  const [weekStart,setWeekStart]=useState(()=>weekMonday(initialDate))
  const [loading,setLoading]=useState(true)
  const [loadError,setLoadError]=useState('')
  const [loadAttempt,setLoadAttempt]=useState(0)
  const [state,setState]=useState<WeekQueueState|null>(null)
  const [notice,setNotice]=useState('')
  const [copying,setCopying]=useState(false)
  const [chosenDays,setChosenDays]=useState<string[]>([])
  const [chosenPeople,setChosenPeople]=useState<number[]>([])
  const [defaultUntil,setDefaultUntil]=useState('18:00')
  const [addingDay,setAddingDay]=useState<string|null>(null)
  const [confirmRemove,setConfirmRemove]=useState<WeekIntent[]|null>(null)
  const [pendingTarget,setPendingTarget]=useState<Destination|null>(null)
  const [lastRemoved,setLastRemoved]=useState<WeekIntent|null>(null)
  const [inputDraft,setInputDraft]=useState<Record<string,LocalFields>>({})
  const inputRef=useRef(inputDraft)
  const queueRef=useRef<WeekAutosaveQueue|null>(null)
  const weekRef=useRef(weekStart)
  const savedRef=useRef(onSaved)
  savedRef.current=onSaved
  weekRef.current=weekStart

  const dates=useMemo(()=>Array.from({length:7},(_,i)=>stepDate(weekStart,i)),[weekStart])
  const pendingCount=state?.pending.reduce((total,task)=>total+task.intents.length,0)||0
  const dirty=pendingCount>0||Object.keys(inputDraft).length>0
  const saving=!!state?.saving
  const failed=!!state?.error
  const data=useMemo(()=>state?previewWeek(state.week,state.pending):null,[state])

  useEffect(()=>{onDirtyChange(dirty)},[dirty,onDirtyChange])
  useEffect(()=>()=>onDirtyChange(false),[onDirtyChange])
  useEffect(()=>{onWeekChange(weekStart)},[weekStart,onWeekChange])
  useEffect(()=>{
    if(!dirty)return
    const protect=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue=''}
    window.addEventListener('beforeunload',protect)
    return()=>window.removeEventListener('beforeunload',protect)
  },[dirty])
  useEffect(()=>{
    let active=true
    setState(null);setLoading(true);setLoadError('');setNotice('')
    setInputDraft({});inputRef.current={}
    const read=async()=>checkedJson(await apiFetch('/api/team/timesheet/week?start='+weekStart))
    void read().then(week=>{
      if(!active)return
      const queue=new WeekAutosaveQueue(week,{
        reload:read,
        send:async(changes:WeekChange[])=>{
          const response=await apiFetch('/api/team/timesheet/week',{
            method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({start:weekStart,changes})
          })
          const result=await response.json().catch(()=>({ok:false,message:'Ответ сервера недоступен.'}))
          if(!response.ok||result.ok===false)throw new Error(
            result.message||'Не удалось сохранить расписание.')
          if(!result.week?.entries||!result.week?.employees)
            throw new Error('Изменение могло сохраниться, но сервер не вернул актуальный график. Обновите и повторите.')
          return result.week as WeekData
        },
        notify:setState,
        onIdle:()=>{setNotice('Изменения сохранены.');savedRef.current()}
      })
      queueRef.current=queue
      setLoading(false)
    }).catch(cause=>{
      if(active){setLoadError(cause instanceof Error?cause.message:'Не удалось загрузить неделю.');setLoading(false)}
    })
    return()=>{
      active=false
      queueRef.current?.dispose()
      queueRef.current=null
    }
  },[apiFetch,weekStart,loadAttempt])

  function enqueue(intents:WeekIntent[],message=''){
    if(!canEdit||!queueRef.current||!intents.length)return
    queueRef.current.enqueue(intents)
    if(message)setNotice(message)
    setLastRemoved(null)
  }
  function editField(row:TeamTimesheetEntry,field:'workUntil'|'comment',value:string){
    if(!canEdit||failed)return
    const key=keyOf(row.date,row.managerId)
    const fields={...(inputRef.current[key]||{
      workUntil:row.workUntil||'',comment:row.comment||''
    }),[field]:value}
    inputRef.current={...inputRef.current,[key]:fields}
    setInputDraft(inputRef.current)
  }
  function commitField(row:TeamTimesheetEntry){
    const key=keyOf(row.date,row.managerId)
    const fields=inputRef.current[key]
    if(!fields)return
    const next={...inputRef.current}
    delete next[key]
    inputRef.current=next;setInputDraft(next)
    if(fields.workUntil===(row.workUntil||'')&&fields.comment===(row.comment||''))return
    enqueue([{date:row.date,managerId:row.managerId,mode:'set',...fields}])
  }
  function flushFields(){
    const fields=inputRef.current
    inputRef.current={};setInputDraft({})
    for(const [key,value] of Object.entries(fields)){
      const [date,id]=key.split(':')
      if(date&&id)enqueue([{date,managerId:Number(id),mode:'set',...value}])
    }
  }
  function applyDestination(destination:Destination){
    setPendingTarget(null);setNotice('')
    setChosenDays([]);setChosenPeople([]);setAddingDay(null)
    setConfirmRemove(null);setLastRemoved(null)
    if(destination.kind==='week')setWeekStart(destination.start)
    else onMonthView(destination.month)
  }
  function requestDestination(destination:Destination){
    if(destination.kind==='week'&&destination.start===weekStart)return
    flushFields()
    const queue=queueRef.current
    if(queue&&(queue.state.pending.length||queue.state.saving||queue.state.error)){
      setPendingTarget(destination)
      return
    }
    applyDestination(destination)
  }
  useEffect(()=>{
    if(!pendingTarget||!state||state.pending.length||state.saving||state.error||
      Object.keys(inputDraft).length)return
    applyDestination(pendingTarget)
  },[pendingTarget,state,inputDraft])
  function selectDay(date:string){
    setChosenDays(previous=>previous.includes(date)?previous.filter(x=>x!==date):[...previous,date])
  }
  function selectPerson(id:number){
    setChosenPeople(previous=>previous.includes(id)?previous.filter(x=>x!==id):[...previous,id])
  }
  function massAdd(){
    if(!data||!chosenDays.length||!chosenPeople.length||failed)return
    const assigned=new Set(data.entries.map(entry=>keyOf(entry.date,entry.managerId)))
    const intents:WeekIntent[]=[]
    for(const date of chosenDays)for(const managerId of chosenPeople){
      if(assigned.has(keyOf(date,managerId)))continue
      intents.push({date,managerId,mode:'set',workUntil:defaultUntil,
        comment:'',onlyIfAbsent:true})
    }
    if(!intents.length){setNotice('Все выбранные сотрудники уже назначены на эти дни.');return}
    enqueue(intents,'Добавление '+intents.length+' смен сохраняется…')
  }
  function massRemove(){
    if(!data||!chosenDays.length||!chosenPeople.length||failed)return
    const assigned=new Set(data.entries.map(entry=>keyOf(entry.date,entry.managerId)))
    const intents:WeekIntent[]=[]
    for(const date of chosenDays)for(const managerId of chosenPeople)
      if(assigned.has(keyOf(date,managerId)))intents.push({date,managerId,mode:'remove'})
    if(!intents.length){setNotice('Среди выбранных сотрудников нет назначений на эти дни.');return}
    setConfirmRemove(intents)
  }
  async function copyPrevious(){
    if(!canEdit||!data||copying||failed)return
    setCopying(true);setNotice('')
    const requested=weekStart,queue=queueRef.current
    try{
      const previous=await checkedJson(await apiFetch(
        '/api/team/timesheet/week?start='+stepDate(requested,-7)))
      if(weekRef.current!==requested||queueRef.current!==queue)return
      const active=new Set(data.employees.map(person=>person.id))
      const assigned=new Set(data.entries.map(entry=>keyOf(entry.date,entry.managerId)))
      const intents:WeekIntent[]=[]
      for(const entry of previous.entries){
        const date=stepDate(entry.date,7)
        if(!active.has(entry.managerId)||assigned.has(keyOf(date,entry.managerId)))continue
        intents.push({date,managerId:entry.managerId,mode:'set',
          workUntil:entry.workUntil||'',comment:entry.comment||'',onlyIfAbsent:true})
      }
      if(intents.length)enqueue(intents,'Копирование '+intents.length+' смен сохраняется…')
      else setNotice('Новых назначений для копирования нет. Существующие не изменены.')
    }catch(cause){setNotice(cause instanceof Error?cause.message:'Не удалось загрузить прошлую неделю.')}
    finally{setCopying(false)}
  }
  function removeOne(row:TeamTimesheetEntry){
    if(!canEdit||failed)return
    const original:WeekIntent={date:row.date,managerId:row.managerId,mode:'set',
      workUntil:row.workUntil||'',comment:row.comment||''}
    queueRef.current?.enqueue([{date:row.date,managerId:row.managerId,mode:'remove'}])
    setLastRemoved(original)
    setNotice('Смена снимается. При необходимости нажмите «Вернуть».')
  }

  return <section className="tw-week-workspace" aria-label="Недельный график сотрудников">
    <div className="tw-week-toolbar">
      <div><span className="tw-kicker">РАСПИСАНИЕ ПО ДНЯМ</span>
        <h4>{weekLabel(weekStart)}</h4>
        <p>Назначения и изменения сохраняются автоматически после каждого действия.</p>
      </div>
      <div className="tw-week-nav" role="group" aria-label="Навигация по неделям">
        <button type="button" className="secondary compact" onClick={()=>
          requestDestination({kind:'week',start:stepDate(weekStart,-7)})}>← Предыдущая</button>
        <button type="button" className="secondary compact" onClick={()=>
          requestDestination({kind:'week',start:stepDate(weekStart,7)})}>Следующая →</button>
        <label className="tw-week-jump">Перейти к дате
          <input aria-label="Перейти к неделе по дате" type="date" value={weekStart}
            onChange={event=>{if(event.target.value)requestDestination({
              kind:'week',start:weekMonday(event.target.value)})}}/>
        </label>
        <button type="button" className="secondary compact"
          onClick={()=>requestDestination({kind:'week',start:weekMonday(localToday())})}>Текущая неделя</button>
        <button type="button" className="secondary compact"
          onClick={()=>requestDestination({kind:'month',month:weekStart.slice(0,7)})}>Обзор месяца</button>
      </div>
    </div>
    {loadError&&<div className="tw-alert error" role="alert">{loadError}</div>}
    <div className={'tw-week-autosave'+(failed?' failed':'')} role="status" aria-live="polite">
      {loading?<><span className="tw-week-save-icon">◌</span> Загружаю расписание…</>:
      failed?<><strong>Не удалось сохранить {pendingCount} изменений.</strong>
        <span>{state?.error}</span>
        <button type="button" className="primary compact"
          onClick={()=>void queueRef.current?.retry()}>Обновить и повторить</button>
        <button type="button" className="secondary compact"
          onClick={()=>void queueRef.current?.discard()}>Отменить неподтверждённые изменения</button>
      </>:
      pendingCount||saving?<><span className="tw-week-save-icon">◌</span>
        <strong>Сохраняется{pendingCount?' · '+pendingCount+' изменений':''}…</strong></>:
      <><span className="tw-week-save-icon">✓</span> Все изменения сохранены</>}
    </div>
    {pendingTarget&&(pendingCount>0||saving||failed)&&<div className="tw-week-navigation-notice" role="status">
      <strong>Переход к другой странице ожидает завершения сохранения.</strong>
      <span>Текущая неделя останется открытой, пока изменения не запишутся.</span>
      <button type="button" className="secondary compact" onClick={()=>setPendingTarget(null)}>
        Отменить переход</button>
    </div>}
    {notice&&<div className="tw-week-feedback" role="status">
      <span>{notice}</span>
      {lastRemoved&&<button type="button" className="secondary compact" onClick={()=>{
        queueRef.current?.enqueue([lastRemoved]);setLastRemoved(null)
        setNotice('Восстановление смены сохраняется…')
      }}>Вернуть смену</button>}
    </div>}
    {loading?<div className="tw-empty">Загружаю график недели…</div>:
      !data?<button type="button" className="secondary"
        onClick={()=>setLoadAttempt(previous=>previous+1)}>Повторить загрузку</button>:<>
      {canEdit&&<div className="tw-week-bulk">
        <div className="tw-week-bulk-head">
          <strong>Добавить сотрудников на несколько дней</strong>
          <button type="button" className="secondary compact" disabled={copying||failed}
            onClick={()=>void copyPrevious()}>{copying?'Копирую…':'Копировать прошлую неделю'}</button>
        </div>
        <div className="tw-week-bulk-section">
          <small>1. Дни недели</small>
          <div className="tw-week-choices">
            {dates.map(day=><button type="button" key={day}
              className={'tw-week-chip'+(chosenDays.includes(day)?' active':'')}
              aria-pressed={chosenDays.includes(day)} onClick={()=>selectDay(day)}>
              {shortDay(day)}</button>)}
          </div>
          <div className="tw-week-presets">
            <button type="button" className="ghost compact" onClick={()=>setChosenDays(dates.slice(0,5))}>Будни</button>
            <button type="button" className="ghost compact" onClick={()=>setChosenDays(dates)}>Все дни</button>
            <button type="button" className="ghost compact" onClick={()=>setChosenDays([])}>Очистить дни</button>
          </div>
        </div>
        <div className="tw-week-bulk-section">
          <small>2. Сотрудники</small>
          <div className="tw-week-choices">{data.employees.map(person=>
            <button key={person.id} type="button" className={'tw-week-chip'+
              (chosenPeople.includes(person.id)?' active':'')}
              aria-pressed={chosenPeople.includes(person.id)} onClick={()=>selectPerson(person.id)}>
              <i style={{background:person.colorKey||'#64748b'}}/>{person.name}
            </button>)}</div>
          <div className="tw-week-presets">
            <button type="button" className="ghost compact"
              onClick={()=>setChosenPeople(data.employees.map(x=>x.id))}>Все сотрудники</button>
            <button type="button" className="ghost compact"
              onClick={()=>setChosenPeople([])}>Очистить выбор</button>
          </div>
        </div>
        <div className="tw-week-bulk-footer">
          <label>Работают до <input type="time" value={defaultUntil}
            onChange={event=>setDefaultUntil(event.target.value)}/></label>
          <button type="button" className="primary compact"
            disabled={failed||!chosenDays.length||!chosenPeople.length}
            onClick={massAdd}>Добавить и сохранить</button>
          <button type="button" className="secondary compact"
            disabled={failed||!chosenDays.length||!chosenPeople.length}
            onClick={massRemove}>Снять выбранные назначения</button>
        </div>
        {confirmRemove&&<div className="tw-week-confirm" role="alert">
          <strong>Снять {confirmRemove.length} смен?</strong>
          <span>Существующие отметки фактической явки останутся.</span>
          <button type="button" className="ghost compact"
            onClick={()=>setConfirmRemove(null)}>Отмена</button>
          <button type="button" className="primary compact" onClick={()=>{
            enqueue(confirmRemove,'Снятие '+confirmRemove.length+' смен сохраняется…')
            setConfirmRemove(null)
          }}>Подтвердить снятие</button>
        </div>}
        <small>Добавление не перезаписывает существующие назначения. Каждое завершённое действие сохраняется само.</small>
      </div>}
      <div className="tw-week-days">
        {dates.map(day=>{
          const members=data.entries.filter(entry=>entry.date===day).sort((a,b)=>
            a.manager.localeCompare(b.manager,'ru'))
          const assigned=new Set(members.map(entry=>entry.managerId))
          const selectable=data.employees.filter(person=>!assigned.has(person.id))
          return <article className="tw-week-day" key={day}>
            <div className="tw-week-day-heading"><strong>{dayTitle(day)}</strong>
              <small>{members.length} по графику</small></div>
            {members.length?<div className="tw-week-persons">{members.map(row=>{
              const key=keyOf(day,row.managerId)
              const fields=inputDraft[key]||{workUntil:row.workUntil||'',comment:row.comment||''}
              const inQueue=!!state?.pending.some(task=>task.intents.some(intent=>
                intent.date===day&&intent.managerId===row.managerId))
              return <div key={row.managerId} className={'tw-week-person'+(inQueue?' changed':'')}>
                <div className="tw-week-person-head">
                  <span><i style={{background:row.managerColor||'#64748b'}}/>{row.manager}</span>
                  {inQueue&&<small>Сохраняется…</small>}
                </div>
                <div className="tw-week-person-fields">
                  <label>До <input type="time" value={fields.workUntil} disabled={!canEdit||failed}
                    onChange={event=>editField(row,'workUntil',event.target.value)}
                    onBlur={()=>commitField(row)}
                    onKeyDown={event=>{if(event.key==='Enter')event.currentTarget.blur()}}/></label>
                  <label>Комментарий <input value={fields.comment} maxLength={300}
                    disabled={!canEdit||failed} placeholder="Необязательно"
                    onChange={event=>editField(row,'comment',event.target.value)}
                    onBlur={()=>commitField(row)}
                    onKeyDown={event=>{if(event.key==='Enter')event.currentTarget.blur()}}/></label>
                  {canEdit&&<button type="button" className="ghost danger compact"
                    disabled={failed} onClick={()=>removeOne(row)}>Снять</button>}
                </div>
              </div>
            })}</div>:<p className="tw-week-no-shifts">Пока нет смен</p>}
            {canEdit&&(addingDay===day?
              <div className="tw-week-day-pick">
                <small>Добавить на этот день:</small>
                <div className="tw-week-choices">{selectable.map(person=>
                  <button type="button" className="tw-week-chip" key={person.id}
                    disabled={failed} onClick={()=>{
                      enqueue([{date:day,managerId:person.id,mode:'set',workUntil:defaultUntil,
                        comment:'',onlyIfAbsent:true}])
                      setAddingDay(null)
                    }}>
                    <i style={{background:person.colorKey||'#64748b'}}/>{person.name}</button>)}</div>
                {!selectable.length&&<small>Все сотрудники уже назначены.</small>}
                <button type="button" className="secondary compact"
                  onClick={()=>setAddingDay(null)}>Закрыть</button>
              </div>:
              <button type="button" className="secondary compact tw-week-add"
                disabled={failed||!selectable.length} onClick={()=>setAddingDay(day)}>
                + Добавить сотрудника</button>)}
          </article>
        })}
      </div>
    </>}
  </section>
}
