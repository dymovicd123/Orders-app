import { useMemo, useState } from 'react'
import type { TeamTimesheetResponse } from '../../app/types'
import { buildAttendanceReport, type AttendanceCell } from './teamTimesheetReport'

type Props={data:TeamTimesheetResponse|null;todayDate:string;onOpenDay:(date:string)=>void}
const formatDate=(d:string)=>new Intl.DateTimeFormat('ru-RU',{
  weekday:'short',day:'numeric',month:'short',timeZone:'UTC'
}).format(new Date(d+'T12:00:00Z'))
function ReportCell({cell}:{cell:AttendanceCell|undefined}){
  if(!cell)return <span className="tw-report-dash" aria-label="Не назначен">—</span>
  return <div className={'tw-report-cell '+cell.kind} title={cell.mark?.comment||cell.schedule?.comment||''}>
    <span className="tw-report-cell-status">
      {cell.kind==='present'?'Пришёл':cell.kind==='absent'?'Не пришёл':
        cell.kind==='excused'?'Уважит. причина':cell.kind==='future'?'По графику':'Не отмечено'}
    </span>
    {cell.kind==='present'&&cell.finishedAt?<strong>Ушёл в {cell.finishedAt}</strong>:
      cell.kind==='present'?<small>Уход не указан</small>:
      cell.kind==='future'&&cell.schedule?.workUntil?<small>До {cell.schedule.workUntil} по плану</small>:null}
    {cell.mark?.comment&&<span className="tw-report-cell-comment" title={cell.mark.comment}>Есть комментарий</span>}
  </div>
}
export function TeamAttendanceReport({data,todayDate,onOpenDay}:Props){
  const [employee,setEmployee]=useState(0)
  const [onlyPending,setOnlyPending]=useState(false)
  const report=useMemo(()=>data?buildAttendanceReport(data,todayDate):null,[data,todayDate])
  if(!report)return <div className="tw-empty">Загрузка журнала посещаемости…</div>
  const validEmployee=report.people.some(p=>p.id===employee)?employee:0
  const people=validEmployee?report.people.filter(p=>p.id===validEmployee):report.people
  const dates=report.days.filter(day=>{
    if(onlyPending&&!people.some(p=>day.cells.get(p.id)?.kind==='pending'))return false
    return people.some(p=>day.cells.has(p.id))
  })
  const totals=report.totals
  return <section className="tw-report">
    <div className="tw-report-intro"><div>
      <h4>Журнал посещаемости</h4>
      <p>По каждой дате видно, кто приходил и во сколько ушёл. Время по графику отмечено отдельно.</p>
    </div><span className="tw-report-count">{dates.length} дней в списке</span></div>
    <div className="tw-report-metrics">
      <div><span>Пришли</span><strong>{totals.present}</strong></div>
      <div><span>Уход отмечен</span><strong>{totals.finished}</strong></div>
      <div><span>Не пришли</span><strong>{totals.absent}</strong></div>
      <div className={totals.pending?'needs-action':''}><span>Нужно уточнить явку</span><strong>{totals.pending}</strong></div>
    </div>
    <div className="tw-report-controls">
      <label>Сотрудник
        <select aria-label="Фильтр по сотруднику" value={validEmployee} onChange={event=>setEmployee(Number(event.target.value))}>
          <option value={0}>Все сотрудники</option>
          {report.people.map(p=><option value={p.id} key={p.id}>{p.name}</option>)}
        </select>
      </label>
      <label className="tw-report-checkbox"><input type="checkbox" checked={onlyPending}
        onChange={event=>setOnlyPending(event.target.checked)}/> Только даты без отметок</label>
    </div>
    <div className="tw-report-table-scroll" role="region" tabIndex={0} aria-label="Журнал по датам, при необходимости прокрутите вправо">
      <table className="tw-report-table">
        <thead><tr><th scope="col">Дата</th>{people.map(p=><th scope="col" key={p.id}>
          <span className="tw-dot" style={{background:p.color}}/>{p.name}</th>)}</tr></thead>
        <tbody>
          {dates.map(day=><tr key={day.date}>
            <th scope="row"><button type="button" className="tw-report-date" onClick={()=>onOpenDay(day.date)}>
              <strong>{formatDate(day.date)}</strong>
              <small>Открыть день</small>
            </button></th>
            {people.map(p=><td key={p.id}><ReportCell cell={day.cells.get(p.id)}/></td>)}
          </tr>)}
          {!dates.length&&<tr><td colSpan={people.length+1} className="tw-report-empty">
            {onlyPending?'Дней с незаполненной явкой для выбранного сотрудника нет.':'За этот месяц пока нет назначений и отметок.'}
          </td></tr>}
        </tbody>
      </table>
    </div>
    <p className="tw-report-footnote">«Не отмечено» означает, что явку ещё не проверили, а не отсутствие сотрудника. Нажмите дату, чтобы внести или исправить отметки.</p>
  </section>
}
