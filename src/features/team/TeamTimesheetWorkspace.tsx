import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import type { TeamAttendanceMark, TeamTimesheetResponse, TeamTimesheetEntry } from '../../app/types'
import './teamTimesheetWorkspace.css'

type MarkState = 'present' | 'absent' | 'excused' | 'unmarked'
type DayRow = {id:number; name:string; role:string; color:string; schedule?:TeamTimesheetEntry; mark?:TeamAttendanceMark}
type Props = {
  apiFetch:(path:string,init?:RequestInit)=>Promise<Response>; isAdmin:boolean
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
function daysOfMonth(month:string){
  const [y,m]=month.split('-').map(Number)
  const end=new Date(Date.UTC(y,m,0)).getUTCDate()
  return Array.from({length:end},(_,i)=>month+'-'+String(i+1).padStart(2,'0'))
}
const weekday=(date:string)=>new Date(date+'T12:00:00Z').getUTCDay()
function adjacentDay(date:string,offset:number){
  const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+offset);return d.toISOString().slice(0,10)
}
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
function MonthSummary({data,todayDate}:{data:TeamTimesheetResponse;todayDate:string}){
  const people=new Map<number,{id:number;name:string;color:string;planned:number;present:number;absent:number;excused:number;pending:number}>()
  function ensure(id:number,name:string,color:string){
    if(!people.has(id))people.set(id,{id,name,color,planned:0,present:0,absent:0,excused:0,pending:0})
    return people.get(id)!
  }
  data.employees.forEach(p=>ensure(p.id,p.name,p.colorKey||'#64748b'))
  const recorded=new Set((data.attendance||[]).map(x=>x.date+':'+x.managerId))
  data.entries.forEach(e=>{
    const p=ensure(e.managerId,e.manager,e.managerColor||'#64748b')
    p.planned++;if(e.date<=todayDate&&!recorded.has(e.date+':'+e.managerId))p.pending++
  })
  ;(data.attendance||[]).forEach(mark=>{
    ensure(mark.managerId,mark.manager,mark.managerColor||'#64748b')[mark.status]++
  })
  const members=[...people.values()].filter(p=>p.planned||p.present||p.absent||p.excused)
    .sort((a,b)=>a.name.localeCompare(b.name,'ru'))
  const totals=members.reduce((sum,p)=>({
    planned:sum.planned+p.planned,present:sum.present+p.present,absent:sum.absent+p.absent,
    excused:sum.excused+p.excused,pending:sum.pending+p.pending
  }),{planned:0,present:0,absent:0,excused:0,pending:0})
  return <section className="tw-panel">
    <div className="tw-subhead"><div><h4>Итоги за месяц</h4><p>План отдельно от явки. Будущие смены не считаются пропусками.</p></div></div>
    <div className="tw-totals">
      {([['По графику',totals.planned],['Пришли',totals.present],['Не пришли',totals.absent],
        ['Уважительная причина',totals.excused],['Без отметки',totals.pending]] as Array<[string,number]>)
        .map(([label,n])=><div key={label}><span>{label}</span><strong>{n}</strong></div>)}
    </div>
    <div className="tw-table-scroll"><table className="tw-table"><thead><tr>
      <th>Сотрудник</th><th>По графику</th><th>Пришёл</th><th>Не пришёл</th><th>Уважит.</th><th>Без отметки</th>
    </tr></thead><tbody>{members.map(p=><tr key={p.id}><td><span className="tw-dot" style={{background:p.color}}/>{p.name}</td>
      <td>{p.planned}</td><td>{p.present}</td><td>{p.absent}</td><td>{p.excused}</td><td>{p.pending}</td></tr>)}
      {!members.length&&<tr><td colSpan={6}>В этом месяце пока нет назначений.</td></tr>}
    </tbody></table></div>
  </section>
}
function Dialog({title,note,onClose,children}:{title:string;note:string;onClose:()=>void;children:ReactNode}){
  const area=useRef<HTMLDivElement>(null)
  useEffect(()=>{
    const previous=document.activeElement instanceof HTMLElement?document.activeElement:null
    const items=()=>Array.from(area.current?.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled])')||[])
    items()[0]?.focus()
    const keydown=(e:KeyboardEvent)=>{
      if(e.key==='Escape'){e.preventDefault();onClose()}
      if(e.key==='Tab'){
        const all=items();if(!all.length)return
        if(e.shiftKey&&document.activeElement===all[0]){e.preventDefault();all[all.length-1].focus()}
        else if(!e.shiftKey&&document.activeElement===all[all.length-1]){e.preventDefault();all[0].focus()}
      }
    }
    document.addEventListener('keydown',keydown)
    return()=>{document.removeEventListener('keydown',keydown);if(previous?.isConnected)previous.focus()}
  },[onClose])
  return <div className="tw-overlay" role="presentation"><section ref={area} className="tw-dialog" role="dialog" aria-modal="true" aria-label={title}>
    <div className="tw-dialog-head"><div><h3>{title}</h3><p>{note}</p></div>
      <button type="button" className="tw-close" aria-label="Закрыть" onClick={onClose}>×</button></div>
    {children}
  </section></div>
}

export function TeamTimesheetWorkspace({apiFetch,isAdmin,timesheetMonth,timesheetData,timesheetBusy,
  setTimesheetMonth,loadTeamTimesheet,loadTeamSalaryReport}:Props){
  const current=today()
  const [view,setView]=useState<'day'|'calendar'>('day')
  const [date,setDate]=useState(current)
  const [editor,setEditor]=useState<DayRow|null>(null)
  const [markState,setMarkState]=useState<MarkState>('unmarked')
  const [markEnded,setMarkEnded]=useState('')
  const [markNote,setMarkNote]=useState('')
  const [planning,setPlanning]=useState(false)
  const [planDates,setPlanDates]=useState<string[]>([])
  const [planPeople,setPlanPeople]=useState<number[]>([])
  const [planUntil,setPlanUntil]=useState('18:00')
  const [planNote,setPlanNote]=useState('')
  const [confirmClear,setConfirmClear]=useState(false)
  const [saving,setSaving]=useState(false)
  const [error,setError]=useState('')
  const [notice,setNotice]=useState('')
  const busy=useRef(false)
  const data=timesheetData?.month===timesheetMonth?timesheetData:null
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
  const shiftMonth=(delta:number)=>{
    const [y,m]=timesheetMonth.split('-').map(Number)
    setTimesheetMonth(new Date(Date.UTC(y,m-1+delta,1)).toISOString().slice(0,7))
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
  async function record(row:DayRow,status:MarkState,finishedAt='',comment=''){
    if(!isAdmin||busy.current||date>current)return
    busy.current=true;setSaving(true);setError('');setNotice('')
    try{
      const response=await apiFetch('/api/team/attendance',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({date,managerId:row.id,status,finishedAt:status==='present'?finishedAt:'',comment})})
      const payload=await response.json() as {ok?:boolean;message?:string}
      if(!response.ok||!payload.ok)throw new Error(payload.message||'Не удалось сохранить отметку.')
      await loadTeamTimesheet(date.slice(0,7))
      setEditor(null);setNotice(status==='unmarked'?'Отметка очищена.':'Явка сохранена.')
    }catch(cause){setError(cause instanceof Error?cause.message:'Ошибка сохранения явки.')}
    finally{busy.current=false;setSaving(false)}
  }
  function onEditSubmit(e:FormEvent){e.preventDefault();if(editor)void record(editor,markState,markEnded,markNote.trim())}
  async function saveSchedule(clear:boolean){
    if(!isAdmin||busy.current||!planDates.length||!planPeople.length)return
    busy.current=true;setSaving(true);setError('');setNotice('')
    try{
      const response=await apiFetch('/api/team/timesheet',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({dates:planDates,managerIds:planPeople,workUntil:planUntil,comment:planNote.trim(),clear})})
      const payload=await response.json() as {ok?:boolean;message?:string}
      if(!response.ok||!payload.ok)throw new Error(payload.message||'Не удалось сохранить график.')
      await loadTeamTimesheet(timesheetMonth)
      void loadTeamSalaryReport()
      setPlanning(false);setConfirmClear(false)
      setNotice(clear?'Назначения убраны. Отметки явки сохранены.':'Смены назначены.')
    }catch(cause){setError(cause instanceof Error?cause.message:'Ошибка сохранения графика.')}
    finally{busy.current=false;setSaving(false)}
  }
  const toggleDate=(d:string)=>setPlanDates(a=>a.includes(d)?a.filter(x=>x!==d):[...a,d])
  const toggleEmployee=(id:number)=>setPlanPeople(a=>a.includes(id)?a.filter(x=>x!==id):[...a,id])
  const canMark=isAdmin&&date<=current&&!saving
  const closeEdit=()=>{if(!saving)setEditor(null)}
  const closePlan=()=>{if(!saving){setPlanning(false);setConfirmClear(false)}}
  return <section className="tw-workspace">
    <div className="tw-header"><div><h3>Табель сотрудников</h3><p>График и фактическая явка — отдельно. Без подсчёта часов.</p></div>
      <div className="tw-tools">{isAdmin&&<button type="button" className="secondary compact" onClick={openPlanner}>+ Назначить смены</button>}
        <button type="button" className="secondary compact" disabled={timesheetBusy||saving}
          onClick={()=>void loadTeamTimesheet(timesheetMonth)}>Обновить</button></div>
    </div>
    <div className="tw-tabs" role="tablist" aria-label="Режим табеля">
      <button type="button" role="tab" aria-selected={view==='day'} className={view==='day'?'selected':''} onClick={()=>setView('day')}>День</button>
      <button type="button" role="tab" aria-selected={view==='calendar'} className={view==='calendar'?'selected':''} onClick={()=>setView('calendar')}>Календарь и итоги</button>
    </div>
    {error&&<div className="tw-alert error" role="alert">{error}</div>}
    {notice&&<div className="tw-alert success" role="status">{notice}</div>}
    {view==='day'?<>
      <div className="tw-section-head"><div><span className="tw-kicker">УЧЁТ ЗА ДЕНЬ</span>
        <h4>{dayLabel(date)}</h4><p>{rows.filter(x=>x.schedule).length} назначено · {rows.filter(x=>x.mark).length} отмечено
          {rows.some(x=>x.schedule&&!x.mark&&date<=current)?' · Есть без отметки':''}</p></div>
        <div className="tw-tools"><button type="button" className="secondary compact" aria-label="Предыдущий день" onClick={()=>chooseDay(adjacentDay(date,-1))}>←</button>
          <input type="date" aria-label="Дата табеля" value={date} onChange={e=>{if(e.target.value)chooseDay(e.target.value)}}/>
          <button type="button" className="secondary compact" aria-label="Следующий день" onClick={()=>chooseDay(adjacentDay(date,1))}>→</button>
          {date!==current&&<button type="button" className="secondary compact" onClick={()=>chooseDay(current)}>Сегодня</button>}</div>
      </div>
      {timesheetBusy&&!dayData?<div className="tw-empty">Загрузка табеля…</div>:!rows.length?<div className="tw-empty">
        <strong>На этот день никто не назначен</strong><p>Чтобы отмечать явку, сначала составьте график.</p>
        {isAdmin&&<button type="button" className="secondary compact" onClick={openPlanner}>Назначить сотрудников</button>}
      </div>:<div className="tw-person-list">{rows.map(row=>{
        const future=date>current
        const status=!row.mark?(future?'По графику':'Нет отметки'):
          row.mark.status==='absent'?'Не пришёл':row.mark.status==='excused'?'Уважительная причина':
          row.mark.finishedAt?'Закончил в '+row.mark.finishedAt:'Пришёл · на работе'
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
            <button type="button" className="tw-quick arrived" onClick={()=>void record(row,'present')}>Пришёл</button>
            <button type="button" className="tw-quick absent" onClick={()=>void record(row,'absent')}>Не пришёл</button>
            <button type="button" className="tw-quiet" onClick={()=>openEditor(row)}>Другое</button>
          </>:canMark?<button type="button" className="secondary compact" onClick={()=>openEditor(row)}>
            {row.mark?.status==='present'&&!row.mark.finishedAt?'Уход / изменить':'Изменить'}</button>:null}</div>
        </article>
      })}</div>}
      <p className="tw-note">Нет отметки — не значит, что сотрудник отсутствовал. Время ухода необязательно.</p>
    </>:<>
      <div className="tw-section-head"><div><span className="tw-kicker">ГРАФИК НА МЕСЯЦ</span><h4>{monthName(timesheetMonth)}</h4></div>
        <div className="tw-tools"><button type="button" className="secondary compact" onClick={()=>shiftMonth(-1)}>←</button>
          <input aria-label="Месяц табеля" type="month" value={timesheetMonth} onChange={e=>{if(e.target.value)setTimesheetMonth(e.target.value)}}/>
          <button type="button" className="secondary compact" onClick={()=>shiftMonth(1)}>→</button>
          <button type="button" className="secondary compact" onClick={()=>setTimesheetMonth(current.slice(0,7))}>Этот месяц</button></div>
      </div>
      <div className="tw-calendar-scroll"><div className="tw-calendar">
        {['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map(x=><div className="tw-weekday" key={x}>{x}</div>)}
        {Array.from({length:days.length?(weekday(days[0])+6)%7:0},(_,i)=><div className="tw-calendar-blank" key={i}/>)}
        {days.map(d=>{
          const count=counts.get(d)
          return <button key={d} type="button" onClick={()=>chooseDay(d)}
            className={'tw-calendar-day'+(d===current?' today':'')+(d===date?' chosen':'')}
            aria-label={dateLabel(d)+' · '+(count?.planned||0)+' назначений'}>
            <strong>{Number(d.slice(-2))}</strong>
            <span>{count?.planned?count.planned+' по графику':'Нет смен'}</span>
            {count?.present?<small className="green">{count.present} пришли</small>:null}
            {(count?.absent||0)+(count?.excused||0)>0?<small className="red">{(count?.absent||0)+(count?.excused||0)} отсутствуют</small>:null}
            {count?.pending&&d<=current?<small className="amber">{count.pending} не отмечены</small>:null}
          </button>
        })}
      </div></div>
      {data?<MonthSummary data={data} todayDate={current}/>:<div className="tw-empty">Загрузка итогов…</div>}
    </>}
    {editor&&<Dialog title={'Отметка: '+editor.name} note={dateLabel(date)+' · явку можно исправить или добавить время ухода.'} onClose={closeEdit}>
      <form className="tw-form" onSubmit={onEditSubmit}>
        <label>Явка<select value={markState} onChange={e=>{setMarkState(e.target.value as MarkState);if(e.target.value!=='present')setMarkEnded('')}}>
          <option value="unmarked">Нет отметки</option><option value="present">Пришёл</option>
          <option value="absent">Не пришёл</option><option value="excused">Уважительная причина</option>
        </select></label>
        {markState==='present'&&<label>Время ухода (необязательно)
          <input type="time" value={markEnded} onChange={e=>setMarkEnded(e.target.value)}/></label>}
        <label>Комментарий (необязательно)<textarea rows={2} maxLength={350} value={markNote}
          placeholder="Например, ушёл раньше по согласованию" onChange={e=>setMarkNote(e.target.value)}/></label>
        <div className="tw-actions"><button className="secondary" type="button" onClick={closeEdit}>Отмена</button>
          <button className="primary" type="submit" disabled={saving}>{saving?'Сохраняю…':'Сохранить отметку'}</button></div>
      </form>
    </Dialog>}
    {planning&&<Dialog title="Назначить смены" note="Выберите дни и сотрудников. Фактическая явка при изменении графика не стирается." onClose={closePlan}>
      <div className="tw-plan"><div className="tw-plan-part"><strong>1. Даты · {monthName(timesheetMonth)}</strong>
        <div className="tw-presets">
          <button type="button" className="secondary compact" onClick={()=>setPlanDates(days.filter(d=>weekday(d)>0&&weekday(d)<6))}>Будни</button>
          <button type="button" className="secondary compact" onClick={()=>setPlanDates(days.filter(d=>weekday(d)===0||weekday(d)===6))}>Выходные</button>
          <button type="button" className="secondary compact" onClick={()=>setPlanDates(days)}>Все дни</button>
          <button type="button" className="secondary compact" onClick={()=>setPlanDates([])}>Сбросить</button>
        </div>
        <div className="tw-plan-days">{days.map(d=><button key={d} type="button" aria-pressed={planDates.includes(d)}
          className={planDates.includes(d)?'active':''} onClick={()=>toggleDate(d)}>{Number(d.slice(-2))}</button>)}</div>
        <small>Выбрано {planDates.length} дней</small>
      </div><div className="tw-plan-part"><strong>2. Сотрудники</strong>
        <div className="tw-plan-people">{(data?.employees||[]).map(p=><button type="button" key={p.id} aria-pressed={planPeople.includes(p.id)}
          className={planPeople.includes(p.id)?'active':''} onClick={()=>toggleEmployee(p.id)}>
          <span className="tw-dot" style={{background:p.colorKey||'#64748b'}}/>{p.name}</button>)}</div>
        <small>Выбрано {planPeople.length} сотрудников</small>
      </div><div className="tw-plan-part"><strong>3. Условия по графику</strong>
        <div className="tw-plan-fields"><label>Работают до<input type="time" value={planUntil} onChange={e=>setPlanUntil(e.target.value)}/></label>
          <label>Комментарий<input maxLength={300} value={planNote} placeholder="Необязательно" onChange={e=>setPlanNote(e.target.value)}/></label></div>
      </div>
      {confirmClear?<div className="tw-confirm"><strong>Убрать выбранные назначения?</strong>
        <p>Только выбранные сотрудники и даты. Сохранённые отметки явки останутся.</p>
        <div className="tw-actions"><button className="secondary" type="button" onClick={()=>setConfirmClear(false)}>Назад</button>
          <button className="ghost danger" type="button" disabled={saving} onClick={()=>void saveSchedule(true)}>Убрать назначения</button></div>
      </div>:<div className="tw-actions split">
        <button className="ghost danger compact" type="button" disabled={saving||!planDates.length||!planPeople.length}
          onClick={()=>setConfirmClear(true)}>Снять выбранные</button>
        <button className="primary" type="button" disabled={saving||!planDates.length||!planPeople.length}
          onClick={()=>void saveSchedule(false)}>{saving?'Сохраняю…':'Назначить выбранное'}</button></div>}
      </div>
    </Dialog>}
  </section>
}
