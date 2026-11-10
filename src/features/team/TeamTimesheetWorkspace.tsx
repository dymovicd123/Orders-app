import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import type { TeamAttendanceMark, TeamTimesheetResponse, TeamTimesheetEntry } from '../../app/types'
import { TeamAttendanceReport } from './TeamAttendanceReport'
import './teamTimesheetWorkspace.css'

type MarkState = 'present' | 'absent' | 'excused' | 'unmarked'
type DayRow = {id:number; name:string; role:string; color:string; schedule?:TeamTimesheetEntry; mark?:TeamAttendanceMark}
type Props = {
  apiFetch:(path:string,init?:RequestInit)=>Promise<Response>; isAdmin:boolean; canMarkAttendance:boolean
  timesheetMonth:string;timesheetData:TeamTimesheetResponse|null;timesheetBusy:boolean
  setTimesheetMonth:(value:string)=>void
  loadTeamTimesheet:(value?:string)=>Promise<TeamTimesheetResponse|null>
  loadTeamSalaryReport:()=>Promise<unknown>
}
function today(){
  const p=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Almaty',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date())
  const take=(key:string)=>p.find(v=>v.type===key)?.value||''
  return take('year')+'-'+take('month')+'-'+take('day')
}
const dayLabel=(date:string)=>new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'long',year:'numeric',weekday:'long',timeZone:'UTC'}).format(new Date(date+'T12:00:00Z'))
const dateLabel=(date:string)=>date.split('-').reverse().join('.')
const currentDepartureTime=()=>new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Almaty',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date())
function daysOfMonth(month:string){
  const [y,m]=month.split('-').map(Number)
  const end=new Date(Date.UTC(y,m,0)).getUTCDate()
  return Array.from({length:end},(_,i)=>month+'-'+String(i+1).padStart(2,'0'))
}
const weekday=(date:string)=>new Date(date+'T12:00:00Z').getUTCDay()
function monthName(month:string){
  return new Intl.DateTimeFormat('ru-RU',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(month+'-01T12:00:00Z'))
}
function rowsForDay(data:TeamTimesheetResponse|null,date:string):DayRow[]{
  if(!data||data.month!==date.slice(0,7))return []
  const people=new Map(data.employees.map(p=>[p.id,p]))
  const rows=new Map<number,DayRow>()
  for(const shift of data.entries.filter(x=>x.date===date)){
    const p=people.get(shift.managerId)
    rows.set(shift.managerId,{id:shift.managerId,name:shift.manager||p?.name||'Сотрудник',
      role:p?.role||'',color:shift.managerColor||p?.colorKey||'#718096',schedule:shift})
  }
  for(const mark of (data.attendance||[]).filter(x=>x.date===date)){
    const p=people.get(mark.managerId),prev=rows.get(mark.managerId)
    rows.set(mark.managerId,{id:mark.managerId,name:prev?.name||mark.manager||p?.name||'Сотрудник',
      role:prev?.role||p?.role||'',color:prev?.color||mark.managerColor||'#718096',schedule:prev?.schedule,mark})
  }
  return [...rows.values()].sort((a,b)=>a.name.localeCompare(b.name,'ru'))
}
function Dialog({title,note,onClose,children}:{title:string;note:string;onClose:()=>void;children:ReactNode}){
  const area=useRef<HTMLDivElement>(null)
  const closeRef=useRef(onClose)
  closeRef.current=onClose
  useEffect(()=>{
    const previous=document.activeElement instanceof HTMLElement?document.activeElement:null
    const items=()=>Array.from(area.current?.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled])')||[])
    ;(items().find(x=>!x.classList.contains('tw-close'))||items()[0])?.focus({preventScroll:true})
    const keydown=(e:KeyboardEvent)=>{
      if(e.key==='Escape'){e.preventDefault();closeRef.current()}
      if(e.key==='Tab'){
        const all=items();if(!all.length)return
        if(e.shiftKey&&document.activeElement===all[0]){e.preventDefault();all[all.length-1].focus()}
        else if(!e.shiftKey&&document.activeElement===all[all.length-1]){e.preventDefault();all[0].focus()}
      }
    }
    document.addEventListener('keydown',keydown)
    return()=>{document.removeEventListener('keydown',keydown);if(previous?.isConnected)previous.focus()}
  },[])
  return <div className="tw-overlay" role="presentation"><section ref={area} className="tw-dialog" role="dialog" aria-modal="true" aria-label={title}>
    <div className="tw-dialog-head"><div><h3>{title}</h3><p>{note}</p></div>
      <button type="button" className="tw-close" aria-label="Закрыть" onClick={onClose}>×</button></div>
    {children}
  </section></div>
}

export function TeamTimesheetWorkspace({apiFetch,isAdmin,canMarkAttendance,timesheetMonth,timesheetData,timesheetBusy,
  setTimesheetMonth,loadTeamTimesheet,loadTeamSalaryReport}:Props){
  const current=today()
  const [view,setView]=useState<'day'|'report'|'calendar'>('day')
  const [date,setDate]=useState(current)
  const [editor,setEditor]=useState<DayRow|null>(null)
  const [markState,setMarkState]=useState<MarkState>('unmarked')
  const [markEnded,setMarkEnded]=useState('')
  const [markNote,setMarkNote]=useState('')
  const [planning,setPlanning]=useState(false)
  const [showCalendarDay,setShowCalendarDay]=useState(false)
  const [planDates,setPlanDates]=useState<string[]>([])
  const [planPeople,setPlanPeople]=useState<number[]>([])
  const [planUntil,setPlanUntil]=useState('18:00')
  const [planNote,setPlanNote]=useState('')
  const [confirmClear,setConfirmClear]=useState(false)
  const [editingShift,setEditingShift]=useState<TeamTimesheetEntry|null>(null)
  const [editShiftUntil,setEditShiftUntil]=useState('')
  const [editShiftNote,setEditShiftNote]=useState('')
  const [confirmShiftRemove,setConfirmShiftRemove]=useState(false)
  const [saving,setSaving]=useState(false)
  const [error,setError]=useState('')
  const [notice,setNotice]=useState('')
  const [optimisticMarks,setOptimisticMarks]=useState<Record<string,TeamAttendanceMark|null>>({})
  const [pendingMarks,setPendingMarks]=useState<Record<string,boolean>>({})
  const [markErrors,setMarkErrors]=useState<Record<string,string>>({})
  const markingRef=useRef(new Set<string>())
  const busy=useRef(false)
  const dateStripRef=useRef<HTMLDivElement>(null)
  const baseData=timesheetData?.month===timesheetMonth?timesheetData:null
  const data=useMemo(()=>{
    if(!baseData)return null
    const attendance=baseData.attendance.filter(mark=>
      !Object.prototype.hasOwnProperty.call(optimisticMarks,mark.date+':'+mark.managerId))
    for(const [key,mark] of Object.entries(optimisticMarks)){
      if(key.startsWith(baseData.month+'-')&&mark)attendance.push(mark)
    }
    return {...baseData,attendance}
  },[baseData,optimisticMarks])
  useEffect(()=>{
    if(!baseData)return
    setOptimisticMarks(previous=>{
      let changed=false
      const next={...previous}
      for(const [key,local] of Object.entries(previous)){
        if(!key.startsWith(baseData.month+'-')||markingRef.current.has(key))continue
        const stored=baseData.attendance.find(item=>item.date+':'+item.managerId===key)
        if(local===null?!stored:!!stored&&local.status===stored.status
          &&local.finishedAt===stored.finishedAt&&local.comment===stored.comment){
          delete next[key];changed=true
        }
      }
      return changed?next:previous
    })
  },[baseData])
  const dayData=data?.month===date.slice(0,7)?data:null
  const rows=rowsForDay(dayData,date)
  const days=useMemo(()=>daysOfMonth(timesheetMonth),[timesheetMonth])
  const counts=useMemo(()=>{
    const output=new Map<string,{planned:number;present:number;absent:number;excused:number;pending:number}>()
    const attendance=new Set((data?.attendance||[]).map(x=>x.date+':'+x.managerId))
    for(const slot of data?.entries||[]){
      const v=output.get(slot.date)||{planned:0,present:0,absent:0,excused:0,pending:0}
      v.planned++;if(slot.date<=current&&!attendance.has(slot.date+':'+slot.managerId))v.pending++
      output.set(slot.date,v)
    }
    for(const mark of data?.attendance||[]){
      const v=output.get(mark.date)||{planned:0,present:0,absent:0,excused:0,pending:0}
      v[mark.status]++;output.set(mark.date,v)
    }
    return output
  },[data,current])
  const chooseDay=(next:string)=>{setDate(next);setView('day');if(next.slice(0,7)!==timesheetMonth)setTimesheetMonth(next.slice(0,7))}
  const unmarkedDays=[...counts].filter(([d,c])=>d<=current&&c.pending>0)
    .sort(([a],[b])=>a.localeCompare(b))
  const unmarkedTotal=unmarkedDays.reduce((sum,[,c])=>sum+c.pending,0)
  useEffect(()=>{
    if(view!=='day')return
    const active=dateStripRef.current?.querySelector<HTMLElement>('[aria-current="date"]')
    active?.scrollIntoView({inline:'center',block:'nearest'})
  },[date,view,timesheetMonth])
  const activateDay=()=>{if(date.slice(0,7)!==timesheetMonth)setDate(
    timesheetMonth===current.slice(0,7)?current:timesheetMonth+'-01')
    setView('day')
  }
  const selectMonth=(next:string)=>{
    if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(next))return
    setTimesheetMonth(next)
    setDate(next===current.slice(0,7)?current:next+'-01')
  }
  const shiftMonth=(delta:number)=>{
    const [y,m]=timesheetMonth.split('-').map(Number)
    selectMonth(new Date(Date.UTC(y,m-1+delta,1)).toISOString().slice(0,7))
  }
  function openEditor(row:DayRow){
    setEditor(row);setMarkState(row.mark?.status||'unmarked');setMarkEnded(row.mark?.finishedAt||'')
    setMarkNote(row.mark?.comment||'')
  }
  function openPlanner(){
    setPlanDates([date.slice(0,7)===timesheetMonth?date:(timesheetMonth===current.slice(0,7)?current:timesheetMonth+'-01')])
    setPlanPeople([]);setPlanUntil('18:00');setPlanNote('')
    setConfirmClear(false);setPlanning(true);setError('')
  }
  function openPlannerForDate(day:string){
    setDate(day);setShowCalendarDay(false)
    setPlanDates([day]);setPlanPeople([]);setPlanUntil('18:00');setPlanNote('')
    setConfirmClear(false);setPlanning(true);setError('')
  }
  function openShiftEditor(shift:TeamTimesheetEntry){
    setShowCalendarDay(false);setEditingShift(shift);setEditShiftUntil(shift.workUntil||'')
    setEditShiftNote(shift.comment||'');setConfirmShiftRemove(false);setError('')
  }
  async function saveEditedShift(clear:boolean){
    if(!editingShift||!isAdmin||busy.current)return
    busy.current=true;setSaving(true);setError('');setNotice('')
    try{
      const response=await apiFetch('/api/team/timesheet',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({dates:[editingShift.date],managerIds:[editingShift.managerId],
          workUntil:editShiftUntil,comment:editShiftNote.trim(),clear})})
      const payload=await response.json() as {ok?:boolean;message?:string}
      if(!response.ok||!payload.ok)throw new Error(payload.message||'Не удалось изменить смену.')
      await loadTeamTimesheet(timesheetMonth)
      void loadTeamSalaryReport()
      setEditingShift(null);setConfirmShiftRemove(false)
      setNotice(clear?'Смена снята. Отметки явки сохранены.':'Изменения смены сохранены.')
    }catch(cause){setError(cause instanceof Error?cause.message:'Ошибка изменения смены.')}
    finally{busy.current=false;setSaving(false)}
  }
  async function record(row:DayRow,status:MarkState,finishedAt='',comment=''){
    const key=date+':'+row.id
    if(!canMarkAttendance||markingRef.current.has(key)||date>current)return
    markingRef.current.add(key)
    setPendingMarks(previous=>({...previous,[key]:true}))
    setMarkErrors(previous=>{const next={...previous};delete next[key];return next})
    setNotice('')
    const hadLocal=Object.prototype.hasOwnProperty.call(optimisticMarks,key)
    const priorLocal=optimisticMarks[key]
    const nextMark:TeamAttendanceMark|null=status==='unmarked'?null:{
      id:row.mark?.id||-1,date,managerId:row.id,manager:row.name,managerColor:row.color,
      status,finishedAt:status==='present'?finishedAt:'',comment,updatedAt:new Date().toISOString(),
    }
    setOptimisticMarks(previous=>({...previous,[key]:nextMark}))
    setEditor(null)
    try{
      const response=await apiFetch('/api/team/attendance',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({date,managerId:row.id,status,finishedAt:status==='present'?finishedAt:'',comment})})
      const payload=await response.json() as {ok?:boolean;message?:string}
      if(!response.ok||!payload.ok)throw new Error(payload.message||'Не удалось сохранить отметку.')
      // Keep showing the local result while the server persists it.
    }catch(cause){
      setOptimisticMarks(previous=>{
        const next={...previous}
        if(hadLocal)next[key]=priorLocal
        else delete next[key]
        return next
      })
      setMarkErrors(previous=>({...previous,[key]:cause instanceof Error?cause.message:'Отметка не сохранилась.'}))
    }finally{
      markingRef.current.delete(key)
      setPendingMarks(previous=>{const next={...previous};delete next[key];return next})
      // Multiple rapid taps across staff share one background reconciliation.
      if(markingRef.current.size===0)void loadTeamTimesheet(date.slice(0,7)).catch(()=>{})
    }
  }
  function onEditSubmit(e:FormEvent){e.preventDefault();if(editor)void record(editor,markState,markEnded,markNote.trim())}
  async function saveSchedule(clear:boolean){
    if(!isAdmin||busy.current||!planDates.length||!planPeople.length)return
    busy.current=true;setSaving(true);setError('');setNotice('')
    try{
      const response=await apiFetch('/api/team/timesheet',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({dates:planDates,managerIds:planPeople,workUntil:planUntil,comment:planNote.trim(),clear,preserveExisting:!clear})})
      const payload=await response.json() as {ok?:boolean;message?:string}
      if(!response.ok||!payload.ok)throw new Error(payload.message||'Не удалось сохранить график.')
      await loadTeamTimesheet(timesheetMonth)
      void loadTeamSalaryReport()
      setPlanning(false);setConfirmClear(false)
      setNotice(clear?'Выбранные назначения сняты. Отметки явки сохранены.':'График обновлён. Существующие смены не изменены.')
    }catch(cause){setError(cause instanceof Error?cause.message:'Ошибка сохранения графика.')}
    finally{busy.current=false;setSaving(false)}
  }
  const toggleDate=(d:string)=>setPlanDates(a=>a.includes(d)?a.filter(x=>x!==d):[...a,d])
  const toggleEmployee=(id:number)=>setPlanPeople(a=>a.includes(id)?a.filter(x=>x!==id):[...a,id])
  const duplicateAssignments=planDates.reduce((sum,d)=>sum+planPeople.filter(id=>
    data?.entries.some(entry=>entry.date===d&&entry.managerId===id)).length,0)
  const newAssignments=planPeople.length*planDates.length-duplicateAssignments
  const dayPlanEntries=(data?.entries||[]).filter(x=>x.date===date)
  const canMark=canMarkAttendance&&date<=current
  const closeEdit=()=>{if(!saving)setEditor(null)}
  const closePlan=()=>{if(!saving){setPlanning(false);setConfirmClear(false)}}
  const closeShiftEditor=()=>{if(!saving){setEditingShift(null);setConfirmShiftRemove(false)}}
  return <section className="tw-workspace">
    <div className="tw-header"><div><span className="tw-kicker">КОМАНДА</span><h3>Табель сотрудников</h3></div>
      <div className="tw-header-actions">
        {isAdmin&&<button type="button" className="tw-primary-assign" onClick={openPlanner}>+ Составить график</button>}
        <button type="button" className="secondary compact" disabled={timesheetBusy||saving}
          onClick={()=>void loadTeamTimesheet(timesheetMonth)}>Обновить</button>
      </div></div>
    <div className="tw-tabs" role="tablist" aria-label="Режим табеля">
      <button type="button" role="tab" aria-selected={view==='day'} className={view==='day'?'selected':''}
        onClick={activateDay}>Отметить явку</button>
      <button type="button" role="tab" aria-selected={view==='report'} className={view==='report'?'selected':''}
        onClick={()=>setView('report')}>Журнал по дням</button>
      <button type="button" role="tab" aria-selected={view==='calendar'} className={view==='calendar'?'selected':''}
        onClick={()=>setView('calendar')}>График</button>
    </div>
    {error&&<div className="tw-alert error" role="alert">{error}</div>}
    {notice&&<div className="tw-alert success" role="status">{notice}</div>}
    {view==='day'?<>
      <div className="tw-day-heading">
        <div><span className="tw-kicker">ЕЖЕДНЕВНЫЙ УЧЁТ</span><h4>{dayLabel(date)}</h4>
          <p>{rows.filter(x=>x.mark).length} из {rows.filter(x=>x.schedule).length} отмечено{rows.filter(x=>x.schedule&&!x.mark).length&&date<=current?' · осталось '+rows.filter(x=>x.schedule&&!x.mark).length:''}</p></div>
        <div className="tw-day-heading-actions">
          {unmarkedTotal>0&&<button type="button" className="tw-needs-attention"
            onClick={()=>chooseDay(unmarkedDays[0][0])}>Не проверено: {unmarkedTotal} · перейти к {dateLabel(unmarkedDays[0][0])}</button>}
          {isAdmin&&<button type="button" className="secondary" onClick={()=>setView('calendar')}>Изменить график дня</button>}
          {date!==current&&<button type="button" className="secondary" onClick={()=>chooseDay(current)}>Сегодня</button>}
        </div>
      </div>
      <div className="tw-date-picker-row">
        <div className="tw-month-controls">
          <button type="button" className="tw-month-arrow" aria-label="Предыдущий месяц" onClick={()=>shiftMonth(-1)}>‹</button>
          <label>Месяц <input type="month" value={timesheetMonth}
            onChange={e=>{if(e.target.value)selectMonth(e.target.value)}}/></label>
          <button type="button" className="tw-month-arrow" aria-label="Следующий месяц" onClick={()=>shiftMonth(1)}>›</button>
        </div>
        <label className="tw-date-direct">Перейти к дате <input type="date" value={date}
          onChange={e=>{if(e.target.value)chooseDay(e.target.value)}}/></label>
      </div>
      <div ref={dateStripRef} className="tw-date-strip" aria-label="Быстрый переход по дням месяца">
        {days.map(d=>{
          const c=counts.get(d),active=d===date
          return <button type="button" key={d} className={'tw-date-tile'+(active?' active':'')+
            (d===current?' today':'')} aria-current={active?'date':undefined} onClick={()=>chooseDay(d)}>
            <small>{new Intl.DateTimeFormat('ru-RU',{weekday:'short',timeZone:'UTC'}).format(new Date(d+'T12:00:00Z'))}</small>
            <strong>{Number(d.slice(-2))}</strong>
            <span className={(c?.pending||0)>0?'tw-date-needs':''}>{d>current?'План':c?.pending?'! '+c.pending:
              c?.planned?'✓ '+(c.present+c.absent+c.excused):'—'}</span>
          </button>
        })}
      </div>
      {timesheetBusy&&!dayData?<div className="tw-empty">Загрузка табеля…</div>:!rows.length?<div className="tw-empty">
        <strong>На этот день никто не назначен</strong><p>Чтобы отмечать явку, сначала составьте график.</p>
        {isAdmin&&<button type="button" className="secondary compact" onClick={openPlanner}>Назначить сотрудников</button>}
      </div>:<div className="tw-person-list">{rows.map(row=>{
        const future=date>current
        const status=!row.mark?(future?'По графику':'Нет отметки'):
          row.mark.status==='absent'?'Не пришёл':row.mark.status==='excused'?'Уважительная причина':
          row.mark.finishedAt?'Ушёл в '+row.mark.finishedAt:(date===current?'Пришёл · на работе':'Пришёл · уход не указан')
        const tone=!row.mark?'pending':row.mark.status
        return <article className="tw-person" key={row.id}>
          <div className="tw-avatar" style={{backgroundColor:row.color}} aria-hidden="true">{row.name.charAt(0)}</div>
          <div className="tw-person-info"><strong>{row.name}</strong>
            <span>{row.schedule?'По графику'+(row.schedule.workUntil?' до '+row.schedule.workUntil:''):'Без назначения'}
              {row.role?' · '+row.role:''}</span>
            <em className={'tw-status '+tone}>{status}</em>
            {row.mark?.comment&&<p className="tw-comment">{row.mark.comment}</p>}
            {row.schedule?.comment&&!row.mark?.comment&&<p className="tw-comment">График: {row.schedule.comment}</p>}
          </div>
          <div className="tw-person-actions">{canMark&&!row.mark&&row.schedule?<>
            <button type="button" className="tw-quick arrived" disabled={!!pendingMarks[date+':'+row.id]} onClick={()=>void record(row,'present')}>Пришёл</button>
            <button type="button" className="tw-quick absent" disabled={!!pendingMarks[date+':'+row.id]} onClick={()=>void record(row,'absent')}>Не пришёл</button>
            <button type="button" className="tw-quick excused" disabled={!!pendingMarks[date+':'+row.id]} onClick={()=>void record(row,'excused')}>Уваж. причина</button>
          </>:canMark?<div className="tw-mark-completed-actions">
            {row.mark?.status==='present'&&!row.mark.finishedAt&&date===current&&
              <button type="button" className="tw-quick departed" disabled={!!pendingMarks[date+':'+row.id]}
                onClick={()=>void record(row,'present',currentDepartureTime(),row.mark?.comment||'')}>Ушёл</button>}
            <button type="button" className="secondary compact" disabled={!!pendingMarks[date+':'+row.id]} onClick={()=>openEditor(row)}>
              Изменить</button>
          </div>:null}
            {pendingMarks[date+':'+row.id]&&<small className="tw-mark-saving">Сохраняется…</small>}
            {markErrors[date+':'+row.id]&&<small className="tw-mark-failed" role="alert">{markErrors[date+':'+row.id]}</small>}
          </div>
        </article>
      })}</div>}
      <p className="tw-note">Неотмеченные смены не считаются отсутствиями.</p>
    </>:view==='calendar'?<>
      <div className="tw-section-head"><div><span className="tw-kicker">ПЛАН СМЕН</span><h4>{monthName(timesheetMonth)}</h4></div>
        <div className="tw-tools"><button type="button" className="secondary compact" onClick={()=>shiftMonth(-1)}>←</button>
          <input aria-label="Месяц табеля" type="month" value={timesheetMonth} onChange={e=>{if(e.target.value)selectMonth(e.target.value)}}/>
          <button type="button" className="secondary compact" onClick={()=>shiftMonth(1)}>→</button>
          <button type="button" className="secondary compact" onClick={()=>selectMonth(current.slice(0,7))}>Этот месяц</button></div>
      </div>
      <p className="tw-note">Выберите день, чтобы посмотреть его состав и изменить отдельные смены. Массовое назначение — кнопка «+ Составить график» сверху.</p>
      <div className="tw-calendar-scroll"><div className="tw-calendar">
        {['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map(x=><div className="tw-weekday" key={x}>{x}</div>)}
        {Array.from({length:days.length?(weekday(days[0])+6)%7:0},(_,i)=><div className="tw-calendar-blank" key={i}/>)}
        {days.map(d=>{
          const count=counts.get(d)
          const assigned=(data?.entries||[]).filter(shift=>shift.date===d)
          return <button key={d} type="button" onClick={()=>{setDate(d);setShowCalendarDay(true)}}
            className={'tw-calendar-day'+(d===current?' today':'')+(d===date?' chosen':'')}
            aria-pressed={d===date} aria-label={dateLabel(d)+' · '+(count?.planned||0)+' назначений · '+assigned.map(x=>x.manager).join(', ')}>
            <strong>{Number(d.slice(-2))}</strong>
            {assigned.length?<span className="tw-calendar-shifts">
              {assigned.slice(0,3).map(shift=><span className="tw-calendar-shift" key={shift.id}>
                <span className="tw-calendar-name"><i style={{background:shift.managerColor||'#718096'}}/>{shift.manager}</span>
                <b>{shift.workUntil||'—'}</b>
              </span>)}
              {assigned.length>3&&<small className="tw-calendar-more">Ещё {assigned.length-3}</small>}
            </span>:<span className="tw-calendar-no-shifts">Нет смен</span>}
            <span className="tw-calendar-attendance">
              {count?.present?<small className="green">{count.present} пришли</small>:null}
              {count?.absent?<small className="red">{count.absent} не пришли</small>:null}
              {count?.excused?<small className="amber">{count.excused} уважит.</small>:null}
              {count?.pending&&d<=current?<small className="amber">{count.pending} не отмечены</small>:null}
            </span>
          </button>
        })}
      </div></div>

    </>:<>
      <div className="tw-section-head"><div><span className="tw-kicker">ПОДРОБНЫЙ ОТЧЁТ</span>
        <h4>Посещаемость · {monthName(timesheetMonth)}</h4></div>
        <div className="tw-tools">
          <button type="button" className="secondary compact" aria-label="Предыдущий месяц" onClick={()=>shiftMonth(-1)}>←</button>
          <input type="month" value={timesheetMonth} aria-label="Месяц журнала"
            onChange={e=>{if(e.target.value)selectMonth(e.target.value)}}/>
          <button type="button" className="secondary compact" aria-label="Следующий месяц" onClick={()=>shiftMonth(1)}>→</button>
        </div>
      </div>
      <TeamAttendanceReport data={data} todayDate={current} onOpenDay={chooseDay}/>
    </>}
    {view==='calendar'&&showCalendarDay&&date.slice(0,7)===timesheetMonth&&
      <Dialog title={'Смены · '+dayLabel(date)} note="Просмотр и точечное изменение графика этого дня" onClose={()=>setShowCalendarDay(false)}>
        <div className="tw-calendar-detail">

        <div className="tw-calendar-detail-head"><div>
          <span className="tw-kicker">СОСТАВ СМЕНЫ</span>
          <p>{dayPlanEntries.length?dayPlanEntries.length+' сотрудников по графику':'На этот день смен пока нет'}</p>
        </div><div className="tw-calendar-detail-actions">
          {isAdmin&&<button type="button" className="tw-primary-assign" onClick={()=>openPlannerForDate(date)}>+ Добавить сотрудников</button>}
          <button type="button" className="secondary compact" onClick={()=>{setShowCalendarDay(false);chooseDay(date)}}>Отметить явку</button>
        </div></div>
        {dayPlanEntries.length?<div className="tw-calendar-detail-list">{dayPlanEntries.map(shift=><div className="tw-calendar-detail-person" key={shift.id}>
          <span className="tw-calendar-detail-name"><i style={{background:shift.managerColor||'#718096'}}/>{shift.manager}</span>
          <span className="tw-calendar-detail-time">По графику {shift.workUntil?'до '+shift.workUntil:'без времени'}</span>
          {shift.comment&&<small title={shift.comment}>{shift.comment}</small>}
          {isAdmin&&<button type="button" className="secondary compact" onClick={()=>openShiftEditor(shift)}>Изменить</button>}
        </div>)}</div>:<p className="tw-calendar-empty">Добавьте сотрудников на этот день или включите его в массовое назначение.</p>}

        </div>
      </Dialog>}
    {editor&&<Dialog title={'Отметка: '+editor.name} note={dateLabel(date)+' · явку можно исправить или добавить время ухода.'} onClose={closeEdit}>
      <form className="tw-form" onSubmit={onEditSubmit}>
        <div className="tw-mark-choice"><strong>Явка</strong>
          <div className="tw-mark-options" role="group" aria-label="Состояние явки">
            {([['present','Пришёл'],['absent','Не пришёл'],['excused','Уважительная причина']] as const).map(([value,label])=>
              <button type="button" key={value} className={'tw-mark-option '+value+(markState===value?' chosen':'')}
                aria-pressed={markState===value} onClick={()=>{setMarkState(value);if(value!=='present')setMarkEnded('')}}>{label}</button>)}
          </div>
          {editor.mark&&<button className="tw-mark-clear" type="button" aria-pressed={markState==='unmarked'} onClick={()=>{setMarkState('unmarked');setMarkEnded('')}}>Убрать отметку</button>}
        </div>
        {markState==='present'&&<label>Время ухода (необязательно)
          <input type="time" value={markEnded} onChange={e=>setMarkEnded(e.target.value)}/></label>}
        <label>Комментарий (необязательно)<textarea rows={2} maxLength={350} value={markNote}
          placeholder="Например, ушёл раньше по согласованию" onChange={e=>setMarkNote(e.target.value)}/></label>
        <div className="tw-actions"><button className="secondary" type="button" onClick={closeEdit}>Отмена</button>
          <button className="primary" type="submit" disabled={saving}>{saving?'Сохраняю…':'Сохранить отметку'}</button></div>
      </form>
    </Dialog>}
    {editingShift&&<Dialog title={'Изменить смену · '+editingShift.manager} note={dayLabel(editingShift.date)} onClose={closeShiftEditor}>
      <form className="tw-form" onSubmit={event=>{event.preventDefault();void saveEditedShift(false)}}>
        <label>Работает до<input type="time" value={editShiftUntil} onChange={event=>setEditShiftUntil(event.target.value)}/></label>
        <label>Комментарий (необязательно)<textarea rows={2} maxLength={300} value={editShiftNote} onChange={event=>setEditShiftNote(event.target.value)}/></label>
        {confirmShiftRemove?<div className="tw-confirm"><strong>Снять смену только у {editingShift.manager}?</strong>
          <p>Дата: {dateLabel(editingShift.date)}. Остальные сотрудники и отметки явки сохранятся.</p>
          <div className="tw-actions"><button className="secondary" type="button" onClick={()=>setConfirmShiftRemove(false)}>Назад</button>
            <button className="ghost danger" type="button" disabled={saving} onClick={()=>void saveEditedShift(true)}>Подтвердить снятие</button></div></div>:
          <div className="tw-actions split"><button className="ghost danger compact" type="button" disabled={saving} onClick={()=>setConfirmShiftRemove(true)}>Снять смену</button>
            <div className="tw-actions"><button className="secondary" type="button" onClick={closeShiftEditor}>Отмена</button>
              <button className="primary" type="submit" disabled={saving}>{saving?'Сохраняю…':'Сохранить смену'}</button></div></div>}
      </form>
    </Dialog>}
    {planning&&<Dialog title="Назначить смены" note="Массовое добавление: выбирайте сотрудников и любые даты. Уже назначенные смены сохраняются без изменений." onClose={closePlan}>
      <div className="tw-plan">
        <div className="tw-plan-part tw-people-first"><strong>1. Кого назначить?</strong>
          <p className="tw-plan-description">Выберите тех, кого нужно ДОБАВИТЬ. Ранее назначенных сотрудников повторно выбирать не нужно.</p>
          <div className="tw-plan-people">{(data?.employees||[]).map(p=>{
            const already=planDates.filter(d=>data?.entries.some(entry=>entry.date===d&&entry.managerId===p.id)).length
            return <button type="button" key={p.id}
              aria-pressed={planPeople.includes(p.id)} className={planPeople.includes(p.id)?'active':''}
              onClick={()=>toggleEmployee(p.id)}>
              <span className="tw-dot" style={{background:p.colorKey||'#64748b'}}/>{p.name}
              {planPeople.includes(p.id)&&<span className="tw-selected-check">✓</span>}
              {already>0&&<small className="tw-already-chip">Уже назначен: {already} дн.</small>}
            </button>
          })}</div>
          <small>Выбрано для добавления: {planPeople.length}</small>
        </div>
        <div className="tw-plan-part"><strong>2. На какие дни? · {monthName(timesheetMonth)}</strong>
          <p className="tw-plan-description">Выберите даты или удобный набор дней.</p>
        <div className="tw-presets">
          <button type="button" className="secondary compact" onClick={()=>setPlanDates(days.filter(d=>weekday(d)>0&&weekday(d)<6))}>Будни</button>
          <button type="button" className="secondary compact" onClick={()=>setPlanDates(days.filter(d=>weekday(d)===0||weekday(d)===6))}>Выходные</button>
          <button type="button" className="secondary compact" onClick={()=>setPlanDates(days)}>Весь месяц</button>
          <button type="button" className="secondary compact" onClick={()=>setPlanDates([])}>Очистить выбор</button>
        </div>
        <div className="tw-plan-days">
          {['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map(x=><span key={x} className="tw-plan-weekday">{x}</span>)}
          {Array.from({length:days.length?(weekday(days[0])+6)%7:0},(_,i)=><span key={'empty-'+i} aria-hidden="true"/>)}
          {days.map(d=>{
            const assignedCount=(data?.entries||[]).filter(entry=>entry.date===d).length
            return <button key={d} type="button" title={dayLabel(d)+(assignedCount?' · уже '+assignedCount+' смен':'')}
              aria-pressed={planDates.includes(d)} className={planDates.includes(d)?'active':''} onClick={()=>toggleDate(d)}>
              <span>{Number(d.slice(-2))}</span>{assignedCount>0&&<small>{assignedCount} в графике</small>}
            </button>
          })}
        </div>
        <small>Выбрано {planDates.length} дней. Выделение дат не меняет назначенные ранее смены.</small>
        <div className="tw-plan-snapshot"><strong>Кто уже работает в выбранные дни</strong>
          {!planDates.length?<p>Выберите даты, чтобы увидеть ранее составленный график.</p>:
            <div className="tw-plan-snapshot-days">{[...planDates].sort().slice(0,6).map(d=>{
              const assigned=(data?.entries||[]).filter(entry=>entry.date===d)
              return <div className="tw-plan-snapshot-day" key={d}>
                <b>{dateLabel(d)}</b>
                <span>{assigned.length?assigned.map(entry=>entry.manager+(entry.workUntil?' до '+entry.workUntil:'')).join(' · '):'Пока никто не назначен'}</span>
              </div>
            })}{planDates.length>6&&<small>И ещё {planDates.length-6} выбранных дней. Число назначенных видно на календаре.</small>}</div>}
        </div>
      </div><div className="tw-plan-part"><strong>3. Условия новых смен</strong>
        <div className="tw-plan-fields"><label>Работают до<input type="time" value={planUntil} onChange={e=>setPlanUntil(e.target.value)}/></label>
          <label>Комментарий<input maxLength={300} value={planNote} placeholder="Необязательно" onChange={e=>setPlanNote(e.target.value)}/></label></div>
      </div>
      {!confirmClear&&<p className="tw-plan-existing" role="status">
        {newAssignments>0?'Добавится '+newAssignments+' новых смен. ':'Нет новых смен для добавления. '}
        {duplicateAssignments>0?duplicateAssignments+' уже существующих назначений будут пропущены. ':''}
        Остальной график, время и комментарии сохраняются.
      </p>}
      {confirmClear?<div className="tw-confirm"><strong>Убрать выбранные назначения?</strong>
        <p>Снимется {duplicateAssignments} существующих назначений из выбранных комбинаций «сотрудник × дата». Остальной график и явка останутся.</p>
        <div className="tw-actions"><button className="secondary" type="button" onClick={()=>setConfirmClear(false)}>Назад</button>
          <button className="ghost danger" type="button" disabled={saving} onClick={()=>void saveSchedule(true)}>Убрать назначения</button></div>
      </div>:<div className="tw-actions split">
        <button className="ghost danger compact" type="button" disabled={saving||duplicateAssignments===0}
          onClick={()=>setConfirmClear(true)}>Снять выбранные ({duplicateAssignments})</button>
        <button className="primary tw-plan-submit" type="button"
          disabled={saving||newAssignments===0} onClick={()=>void saveSchedule(false)}>
          {saving?'Сохраняю…':newAssignments>0?
            'Добавить '+newAssignments+' смен':'Выберите новые смены'}
        </button></div>}
      </div>
    </Dialog>}
  </section>
}
