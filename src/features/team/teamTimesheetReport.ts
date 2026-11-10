import type { TeamTimesheetResponse, TeamTimesheetEntry, TeamAttendanceMark } from '../../app/types'

export type AttendanceReportPerson = {id:number;name:string;color:string}
export type AttendanceCell = {
  personId:number; schedule?:TeamTimesheetEntry;mark?:TeamAttendanceMark
  kind:'present'|'absent'|'excused'|'pending'|'future'
  finishedAt:string; label:string
}
export type AttendanceReportDay = {
  date:string;cells:Map<number,AttendanceCell>;scheduled:number;present:number
  absent:number;excused:number;pending:number;finished:number
}
export function buildAttendanceReport(data:TeamTimesheetResponse,today:string){
  const staff=new Map<number,AttendanceReportPerson>()
  for(const person of data.employees)
    staff.set(person.id,{id:person.id,name:person.name,color:person.colorKey||'#64748b'})
  for(const schedule of data.entries)
    if(!staff.has(schedule.managerId))
      staff.set(schedule.managerId,{id:schedule.managerId,name:schedule.manager,color:schedule.managerColor||'#64748b'})
  for(const mark of data.attendance||[])
    if(!staff.has(mark.managerId))
      staff.set(mark.managerId,{id:mark.managerId,name:mark.manager,color:mark.managerColor||'#64748b'})
  const days=new Map<string,AttendanceReportDay>()
  const getDay=(date:string)=>{
    let day=days.get(date)
    if(!day){day={date,cells:new Map(),scheduled:0,present:0,absent:0,excused:0,pending:0,finished:0};days.set(date,day)}
    return day
  }
  for(const schedule of data.entries){
    const day=getDay(schedule.date)
    day.cells.set(schedule.managerId,{personId:schedule.managerId,schedule,kind:schedule.date>today?'future':'pending',
      finishedAt:'',label:schedule.date>today?'Запланирован':'Нет отметки'})
    day.scheduled++
  }
  for(const mark of data.attendance||[]){
    const day=getDay(mark.date)
    const old=day.cells.get(mark.managerId)
    const kind=mark.status
    day.cells.set(mark.managerId,{
      personId:mark.managerId,schedule:old?.schedule,mark,kind,
      finishedAt:mark.status==='present'?mark.finishedAt||'':'',
      label:mark.status==='present'?
        (mark.finishedAt?'Пришёл · ушёл в '+mark.finishedAt:'Пришёл · уход не указан'):
        mark.status==='absent'?'Не пришёл':'Уважительная причина'
    })
  }
  const rows=[...days.values()].sort((a,b)=>b.date.localeCompare(a.date))
  for(const day of rows)
    for(const cell of day.cells.values()){
      if(cell.kind==='present'){day.present++;if(cell.finishedAt)day.finished++}
      else if(cell.kind==='absent')day.absent++
      else if(cell.kind==='excused')day.excused++
      else if(cell.kind==='pending')day.pending++
    }
  const people=[...staff.values()].filter(p=>rows.some(day=>day.cells.has(p.id)))
    .sort((a,b)=>a.name.localeCompare(b.name,'ru'))
  return {people,days:rows,totals:rows.reduce((total,day)=>({
    scheduled:total.scheduled+day.scheduled,present:total.present+day.present,
    absent:total.absent+day.absent,excused:total.excused+day.excused,
    pending:total.pending+day.pending,finished:total.finished+day.finished
  }),{scheduled:0,present:0,absent:0,excused:0,pending:0,finished:0})}
}
