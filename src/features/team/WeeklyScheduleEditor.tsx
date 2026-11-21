import {useEffect,useMemo,useRef,useState} from 'react'
import type {TeamTimesheetEmployee,TeamTimesheetEntry,TeamAttendanceMark} from '../../app/types'
import './weeklyScheduleEditor.css'

type EditKind='add'|'update'|'remove'
type WeekEdit={
  date:string;managerId:number;kind:EditKind;workUntil:string;comment:string
  baseId:number|null;baseUpdatedAt:string;baseWorkUntil:string;baseComment:string
}
type WeekData={ok:boolean;startDate:string;endDate:string;employees:TeamTimesheetEmployee[];
  entries:TeamTimesheetEntry[];attendance:TeamAttendanceMark[]}
type Props={
  apiFetch:(path:string,init?:RequestInit)=>Promise<Response>
  canEdit:boolean
  initialDate:string
  onMonthView:(month:string)=>void
  onWeekChange:(start:string)=>void
  onDirtyChange:(dirty:boolean)=>void
  onSaved:()=>void
}
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
type Destination={kind:'week';start:string}|{kind:'month';month:string}
const keyOf=(date:string,id:number)=>date+':'+id
const weekLabel=(start:string)=>shortDay(start)+' — '+shortDay(stepDate(start,6))
const localToday=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Almaty',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
async function checkedJson(response:Response):Promise<WeekData>{
  const payload=await response.json().catch(()=>({ok:false,message:'Сервер вернул неверный ответ.'}))
  if(!response.ok||payload.ok===false)throw new Error(payload.message||'Не удалось загрузить график.')
  return payload as WeekData
}

export function WeeklyScheduleEditor({apiFetch,canEdit,initialDate,onMonthView,onWeekChange,onDirtyChange,onSaved}:Props){
  const [weekStart,setWeekStart]=useState(()=>weekMonday(initialDate))
  const weekRef=useRef(weekStart)
  weekRef.current=weekStart
  const [pendingTarget,setPendingTarget]=useState<Destination|null>(null)
  const [snapshot,setSnapshot]=useState<WeekData|null>(null)
  const [loading,setLoading]=useState(true)
  const [saving,setSaving]=useState(false)
  const [error,setError]=useState('')
  const [notice,setNotice]=useState('')
  const [draft,setDraft]=useState<Record<string,WeekEdit>>({})
  const [chosenDays,setChosenDays]=useState<string[]>([])
  const [chosenPeople,setChosenPeople]=useState<number[]>([])
  const [defaultUntil,setDefaultUntil]=useState('18:00')
  const [addingDay,setAddingDay]=useState<string|null>(null)
  const [confirmRemoved,setConfirmRemoved]=useState(false)
  const dates=useMemo(()=>Array.from({length:7},(_,i)=>stepDate(weekStart,i)),[weekStart])
  const edits=Object.values(draft)
  const dirty=edits.length>0
  const addCount=edits.filter(x=>x.kind==='add').length
  const updateCount=edits.filter(x=>x.kind==='update').length
  const removeCount=edits.filter(x=>x.kind==='remove').length

  useEffect(()=>{onDirtyChange(dirty)},[dirty,onDirtyChange])
  useEffect(()=>{onWeekChange(weekStart)},[weekStart,onWeekChange])
  useEffect(()=>{
    if(!dirty)return
    const protect=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue=''}
    window.addEventListener('beforeunload',protect)
    return()=>window.removeEventListener('beforeunload',protect)
  },[dirty])
  useEffect(()=>()=>onDirtyChange(false),[onDirtyChange])
  useEffect(()=>{
    let live=true
    setLoading(true);setSnapshot(null);setError('');setNotice('')
    void apiFetch('/api/team/timesheet/week?start='+weekStart).then(checkedJson).then(data=>{
      if(live){setSnapshot(data);setLoading(false)}
    }).catch(reason=>{
      if(live){setError(reason instanceof Error?reason.message:'Не удалось загрузить неделю.');setLoading(false)}
    })
    return()=>{live=false}
  },[apiFetch,weekStart])

  const baseline=useMemo(()=>{
    const map=new Map<string,TeamTimesheetEntry>()
    for(const entry of snapshot?.entries||[])map.set(keyOf(entry.date,entry.managerId),entry)
    return map
  },[snapshot])
  const weekRows=useMemo(()=>{
    const map=new Map<string,WeekEdit>()
    for(const entry of snapshot?.entries||[]){
      const key=keyOf(entry.date,entry.managerId)
      map.set(key,{date:entry.date,managerId:entry.managerId,kind:'update',
        workUntil:entry.workUntil||'',comment:entry.comment||'',
        baseId:entry.id,baseUpdatedAt:entry.updatedAt||'',
        baseWorkUntil:entry.workUntil||'',baseComment:entry.comment||''})
    }
    for(const change of edits)map.set(keyOf(change.date,change.managerId),change)
    return map
  },[snapshot,draft])

  function stage(date:string,managerId:number,kind:'set'|'remove',until='',comment=''){
    if(!canEdit||saving||loading)return
    const key=keyOf(date,managerId),old=baseline.get(key)
    setDraft(previous=>{
      const next={...previous}
      if(kind==='remove'){
        if(!old)delete next[key]
        else next[key]={date,managerId,kind:'remove',workUntil:old.workUntil||'',
          comment:old.comment||'',baseId:old.id,baseUpdatedAt:old.updatedAt||'',
          baseWorkUntil:old.workUntil||'',baseComment:old.comment||''}
      }else{
        if(old&&until===(old.workUntil||'')&&comment===(old.comment||''))delete next[key]
        else next[key]={date,managerId,kind:old?'update':'add',workUntil:until,
          comment,baseId:old?.id??null,baseUpdatedAt:old?.updatedAt||'',
          baseWorkUntil:old?.workUntil||'',baseComment:old?.comment||''}
      }
      return next
    })
    setConfirmRemoved(false);setError('');setNotice('')
  }
  function restore(date:string,managerId:number){
    setDraft(previous=>{
      const next={...previous};delete next[keyOf(date,managerId)];return next
    })
    setConfirmRemoved(false)
  }
  function selectDay(date:string){
    setChosenDays(previous=>previous.includes(date)?previous.filter(x=>x!==date):[...previous,date])
  }
  function selectPerson(id:number){
    setChosenPeople(previous=>previous.includes(id)?previous.filter(x=>x!==id):[...previous,id])
  }
  function stageMassAdd(){
    if(!snapshot||!chosenDays.length||!chosenPeople.length)return
    let skipped=0,added=0
    const next={...draft}
    for(const date of chosenDays)for(const id of chosenPeople){
      const key=keyOf(date,id)
      const existing=baseline.get(key)
      if(existing){skipped++;continue}
      next[key]={date,managerId:id,kind:'add',workUntil:defaultUntil,
        comment:'',baseId:null,baseUpdatedAt:'',baseWorkUntil:'',baseComment:''}
      added++
    }
    setDraft(next)
    setNotice('Подготовлено '+added+' новых смен.'+(skipped?' Уже назначены и не изменены: '+skipped+'.':''))
    setConfirmRemoved(false)
  }
  function stageMassRemove(){
    if(!snapshot||!chosenDays.length||!chosenPeople.length)return
    for(const date of chosenDays)for(const id of chosenPeople)stage(date,id,'remove')
    setNotice('Выбранные назначения помечены для снятия. Изменения ещё не сохранены.')
  }
  function applyDestination(destination:Destination){
    setPendingTarget(null)
    setChosenDays([]);setChosenPeople([]);setAddingDay(null);setConfirmRemoved(false)
    setError('')
    if(destination.kind==='week'){
      setWeekStart(destination.start)
    }else onMonthView(destination.month)
  }
  function requestDestination(destination:Destination){
    if(saving)return
    if(destination.kind==='week'&&destination.start===weekStart)return
    if(dirty){
      setPendingTarget(destination)
      setConfirmRemoved(false)
      return
    }
    applyDestination(destination)
  }
  function moveWeek(delta:number){
    requestDestination({kind:'week',start:stepDate(weekStart,7*delta)})
  }
  function openMonth(){
    requestDestination({kind:'month',month:weekStart.slice(0,7)})
  }
  async function refreshWeek(requestedWeek=weekStart){
    const response=await apiFetch('/api/team/timesheet/week?start='+requestedWeek)
    const latest=await checkedJson(response)
    if(weekRef.current===requestedWeek)setSnapshot(latest)
  }
  async function copyPrevious(){
    if(!canEdit||!snapshot||saving)return
    setError('');setNotice('')
    try{
      const previousStart=stepDate(weekStart,-7)
      const previous=await checkedJson(await apiFetch('/api/team/timesheet/week?start='+previousStart))
      const active=new Set(snapshot.employees.map(x=>x.id))
      const next={...draft}
      let added=0
      for(const item of previous.entries){
        const target=stepDate(item.date,7),key=keyOf(target,item.managerId)
        if(!active.has(item.managerId)||baseline.has(key)||next[key]?.kind==='add')continue
        next[key]={date:target,managerId:item.managerId,kind:'add',
          workUntil:item.workUntil||'',comment:item.comment||'',
          baseId:null,baseUpdatedAt:'',baseWorkUntil:'',baseComment:''}
        added++
      }
      setDraft(next)
      setNotice(added?'Скопировано '+added+' новых смен из прошлой недели. Проверьте их перед сохранением.':
        'Нет новых смен для копирования. Существующие назначения не изменены.')
    }catch(cause){setError(cause instanceof Error?cause.message:'Не удалось скопировать неделю.')}
  }
  async function saveWeek(after?:Destination){
    if(!canEdit||!snapshot||saving||!dirty)return
    if(removeCount&&!confirmRemoved&&!after){setConfirmRemoved(true);return}
    setSaving(true);setError('');setNotice('')
    try{
      const response=await apiFetch('/api/team/timesheet/week',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({start:weekStart,changes:edits})
      })
      const payload=await response.json().catch(()=>({ok:false,message:'Нет ответа сервера.'}))
      if(!response.ok||payload.ok===false)throw new Error(payload.message||'График не сохранился.')
      // Saved results show immediately; canonical IDs and timestamps follow on reload.
      setSnapshot(previous=>{
        if(!previous)return previous
        const next=new Map(previous.entries.map(x=>[keyOf(x.date,x.managerId),x]))
        for(const item of edits){
          const key=keyOf(item.date,item.managerId)
          if(item.kind==='remove'){next.delete(key);continue}
          const old=next.get(key),employee=previous.employees.find(x=>x.id===item.managerId)
          next.set(key,{id:old?.id??-Math.floor(Math.random()*10000000)-1,
            date:item.date,managerId:item.managerId,
            manager:old?.manager||employee?.name||'Сотрудник',
            managerColor:old?.managerColor||employee?.colorKey,
            workUntil:item.workUntil,comment:item.comment,
            updatedAt:new Date().toISOString()})
        }
        return {...previous,entries:[...next.values()]}
      })
      setDraft({});setConfirmRemoved(false)
      setNotice('Сохранено: добавлено '+addCount+', изменено '+updateCount+', снято '+removeCount+'.')
      if(after)applyDestination(after)
      else {
        setPendingTarget(null)
        void refreshWeek().catch(()=>setNotice('Сохранено, но актуальную версию не удалось загрузить. Обновите страницу.'))
      }
      onSaved()
    }catch(cause){setError(cause instanceof Error?cause.message:'Не удалось сохранить график.')}
    finally{setSaving(false)}
  }

  return <section className="tw-week-workspace" aria-label="Недельный график сотрудников">
    <div className="tw-week-toolbar">
      <div><span className="tw-kicker">РАСПИСАНИЕ ПО ДНЯМ</span>
        <h4>{weekLabel(weekStart)}</h4>
        <p>Укажите разных сотрудников и время на каждый день. Всё сохраняется одной операцией.</p>
      </div>
      <div className="tw-week-nav" role="group" aria-label="Навигация по неделям">
        <button type="button" className="secondary compact" onClick={()=>moveWeek(-1)} disabled={saving}>← Предыдущая</button>
        <button type="button" className="secondary compact" onClick={()=>moveWeek(1)} disabled={saving}>Следующая →</button>
        <label className="tw-week-jump">Перейти к дате
          <input aria-label="Перейти к неделе по дате" type="date" value={weekStart} disabled={saving}
            onChange={event=>{if(event.target.value)requestDestination({kind:'week',start:weekMonday(event.target.value)})}}/>
        </label>
        <button type="button" className="secondary compact" onClick={()=>requestDestination({kind:'week',start:weekMonday(localToday())})}
          disabled={saving}>Текущая неделя</button>
        <button type="button" className="secondary compact" onClick={openMonth} disabled={saving}>Обзор месяца</button>
      </div>
    </div>
    {error&&<div className="tw-alert error" role="alert">{error}</div>}
    {notice&&<div className="tw-alert success" role="status">{notice}</div>}
          {canEdit&&<div className={'tw-week-savebar'+(dirty?' dirty':'')} role="region" aria-label="Сохранение недельного графика">
        <div className="tw-week-save-status">
          <strong>{dirty?'Не сохранено: '+edits.length+' изменений':'График сохранён'}</strong>
          {dirty&&<small>+{addCount} новых · {updateCount} изменений · {removeCount} снятий</small>}
        </div>
        <div className="tw-week-save-actions">
          {dirty&&<button type="button" className="secondary compact" disabled={saving} onClick={()=>{
            setDraft({});setConfirmRemoved(false);setPendingTarget(null);setError('');setNotice('Черновик отменён.')
          }}>Отменить изменения</button>}
          <button type="button" className="primary tw-week-main-save" disabled={saving||!dirty}
            onClick={()=>void saveWeek()}>{saving?'Сохраняю…':dirty?'Сохранить '+edits.length+' изменений':'Изменений нет'}</button>
        </div>
        {pendingTarget&&dirty&&<div className="tw-week-navigation-confirm" role="alert">
          <strong>Есть несохранённые изменения.</strong>
          <span>{pendingTarget.kind==='month'?'Перейти к обзору месяца?':'Перейти к другой неделе?'}
            {removeCount>0?' При сохранении будет снято '+removeCount+' смен; отметки явки останутся.':''}</span>
          <div className="tw-week-confirm-actions">
            <button type="button" className="primary compact" disabled={saving}
              onClick={()=>void saveWeek(pendingTarget||undefined)}>Сохранить и перейти</button>
            <button type="button" className="secondary compact" disabled={saving}
              onClick={()=>{setDraft({});if(pendingTarget)applyDestination(pendingTarget)}}>Не сохранять и перейти</button>
            <button type="button" className="ghost compact" disabled={saving}
              onClick={()=>setPendingTarget(null)}>Остаться</button>
          </div>
        </div>}
        {confirmRemoved&&dirty&&<div className="tw-week-confirm" role="alert">
          Будут сняты {removeCount} смен. Отметки фактической явки сохранятся.
          <button type="button" className="secondary compact" disabled={saving}
            onClick={()=>setConfirmRemoved(false)}>Назад</button>
          <button type="button" className="primary compact" disabled={saving}
            onClick={()=>void saveWeek(pendingTarget||undefined)}>Подтвердить сохранение</button>
        </div>}
      </div>}
    {loading?<div className="tw-empty">Загружаю график недели…</div>:
      !snapshot?<button type="button" className="secondary" onClick={()=>void refreshWeek().catch(e=>setError(String(e)))}>Повторить загрузку</button>:<>
      {canEdit&&<div className="tw-week-bulk">
        <div className="tw-week-bulk-head">
          <strong>Добавить сотрудников на несколько дней</strong>
          <button type="button" className="secondary compact" disabled={saving} onClick={()=>void copyPrevious()}>
            <span>Копировать прошлую неделю</span>
          </button>
        </div>
        <div className="tw-week-bulk-section">
          <small>1. Дни недели</small>
          <div className="tw-week-choices">
            {dates.map(d=><button type="button" key={d} disabled={saving}
              className={'tw-week-chip'+(chosenDays.includes(d)?' active':'')} aria-pressed={chosenDays.includes(d)}
              onClick={()=>selectDay(d)}>{shortDay(d)}</button>)}
          </div>
          <div className="tw-week-presets">
            <button type="button" className="ghost compact" onClick={()=>setChosenDays(dates.slice(0,5))}>Будни</button>
            <button type="button" className="ghost compact" onClick={()=>setChosenDays(dates)}>Все дни</button>
            <button type="button" className="ghost compact" onClick={()=>setChosenDays([])}>Очистить дни</button>
          </div>
        </div>
        <div className="tw-week-bulk-section">
          <small>2. Сотрудники</small>
          <div className="tw-week-choices">{snapshot.employees.map(person=>
            <button key={person.id} type="button" disabled={saving}
              className={'tw-week-chip'+(chosenPeople.includes(person.id)?' active':'')}
              aria-pressed={chosenPeople.includes(person.id)} onClick={()=>selectPerson(person.id)}>
              <i style={{background:person.colorKey||'#64748b'}}/>{person.name}
            </button>)}</div>
          <div className="tw-week-presets">
            <button type="button" className="ghost compact" onClick={()=>setChosenPeople(snapshot.employees.map(x=>x.id))}>Все сотрудники</button>
            <button type="button" className="ghost compact" onClick={()=>setChosenPeople([])}>Очистить выбор</button>
          </div>
        </div>
        <div className="tw-week-bulk-footer">
          <label>Работают до <input type="time" value={defaultUntil} disabled={saving}
            onChange={e=>setDefaultUntil(e.target.value)}/></label>
          <button type="button" className="primary compact" disabled={saving||!chosenDays.length||!chosenPeople.length}
            onClick={stageMassAdd}>Добавить к выбранным дням</button>
          <button type="button" className="secondary compact" disabled={saving||!chosenDays.length||!chosenPeople.length}
            onClick={stageMassRemove}>Снять выбранные назначения</button>
        </div>
        <small>Добавление не изменяет существующие смены. Разные комбинации можно подготовить до одного сохранения.</small>
      </div>}
      <div className="tw-week-days">
        {dates.map(d=>{
          const members=[...weekRows.values()].filter(x=>x.date===d).sort((a,b)=>{
            const nameA=snapshot.employees.find(e=>e.id===a.managerId)?.name||''
            const nameB=snapshot.employees.find(e=>e.id===b.managerId)?.name||''
            return nameA.localeCompare(nameB,'ru')
          })
          const present=members.filter(m=>m.kind!=='remove')
          const selectable=snapshot.employees.filter(p=>!weekRows.has(keyOf(d,p.id)))
          return <article className="tw-week-day" key={d}>
            <div className="tw-week-day-heading"><strong>{dayTitle(d)}</strong>
              <small>{present.length} по графику{members.length>present.length?' · '+(members.length-present.length)+' снимаются':''}</small></div>
            {members.length?<div className="tw-week-persons">{members.map(line=>{
              const person=snapshot.employees.find(x=>x.id===line.managerId)
              const staged=draft[keyOf(d,line.managerId)]
              return <div key={line.managerId} className={'tw-week-person'+(line.kind==='remove'?' removing':'')+(staged?' changed':'')}>
                <div className="tw-week-person-head">
                  <span><i style={{background:person?.colorKey||'#64748b'}}/>{person?.name||'Сотрудник'}</span>
                  {staged&&<small>{line.kind==='remove'?'Снимается':line.kind==='add'?'Добавляется':'Изменено'}</small>}
                </div>
                {line.kind==='remove'?
                  <button type="button" className="secondary compact" disabled={!canEdit||saving}
                    onClick={()=>restore(d,line.managerId)}>Вернуть смену</button>:
                  <div className="tw-week-person-fields">
                    <label>До <input type="time" value={line.workUntil} disabled={!canEdit||saving}
                      onChange={e=>stage(d,line.managerId,'set',e.target.value,line.comment)}/></label>
                    <label>Комментарий <input value={line.comment} maxLength={300} disabled={!canEdit||saving}
                      placeholder="Необязательно"
                      onChange={e=>stage(d,line.managerId,'set',line.workUntil,e.target.value)}/></label>
                    {canEdit&&<button type="button" className="ghost danger compact" disabled={saving}
                      onClick={()=>stage(d,line.managerId,'remove')}>Снять</button>}
                    {staged&&canEdit&&<button type="button" className="ghost compact" disabled={saving}
                      onClick={()=>restore(d,line.managerId)}>Отменить</button>}
                  </div>}
              </div>
            })}</div>:<p className="tw-week-no-shifts">Пока нет смен</p>}
            {canEdit&&(addingDay===d?
              <div className="tw-week-day-pick">
                <small>Добавить на этот день:</small>
                <div className="tw-week-choices">{selectable.map(person=>
                  <button type="button" className="tw-week-chip" key={person.id}
                    onClick={()=>{stage(d,person.id,'set',defaultUntil);setAddingDay(null)}}>
                    <i style={{background:person.colorKey||'#64748b'}}/>{person.name}
                  </button>)}</div>
                {!selectable.length&&<small>Все сотрудники уже включены в график.</small>}
                <button type="button" className="secondary compact" onClick={()=>setAddingDay(null)}>Закрыть</button>
              </div>:
              <button type="button" className="secondary compact tw-week-add"
                disabled={saving||!selectable.length} onClick={()=>setAddingDay(d)}>
                + Добавить сотрудника
              </button>)}
          </article>
        })}
      </div>

    </>}
  </section>
}
