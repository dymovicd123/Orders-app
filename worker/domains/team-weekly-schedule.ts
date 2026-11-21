import { listTeamTimesheet } from './team.ts'
import { readTeamAttendance } from './team-attendance.ts'
import { writeActivityLog } from './activity.ts'

type ChangeKind='add'|'update'|'remove'
type WeekChange={
  date:string;managerId:number;kind:ChangeKind;workUntil:string;comment:string
  baseId:number|null;baseUpdatedAt:string;baseWorkUntil:string;baseComment:string
}
export type WeekScheduleInput={start?:unknown;changes?:unknown}

export class WeeklyScheduleError extends Error {
  readonly status:number
  readonly code:string
  constructor(message:string,status=400,code='weekly_schedule_invalid'){
    super(message);this.status=status;this.code=code
  }
}
const invalid=(message:string)=>new WeeklyScheduleError(message)
const stale=()=>new WeeklyScheduleError(
  'График изменился после открытия недели. Сохранение отменено. Обновите неделю и повторите изменения.',409,'weekly_schedule_stale')
function validDate(raw:unknown):string{
  if(typeof raw!=='string'||!/^20\d{2}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(raw))throw invalid('Некорректная дата расписания.')
  const date=new Date(raw+'T12:00:00Z')
  if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==raw)throw invalid('Дата расписания не существует.')
  return raw
}
const stepDay=(date:string,days:number)=>{
  const utc=new Date(date+'T12:00:00Z')
  utc.setUTCDate(utc.getUTCDate()+days)
  return utc.toISOString().slice(0,10)
}
export function weekDays(start:unknown):string[]{
  const date=validDate(start)
  if(new Date(date+'T12:00:00Z').getUTCDay()!==1)throw invalid('Неделя должна начинаться в понедельник.')
  return Array.from({length:7},(_,index)=>stepDay(date,index))
}
export async function listTeamScheduleWeek(db:D1Database,start:unknown){
  const dates=weekDays(start)
  const months=[...new Set(dates.map(day=>day.slice(0,7)))]
  const results=await Promise.all(months.map(async month=>{
    const url=new URL('https://orders-app.invalid/api/team/timesheet?month='+month)
    const [schedule,attendance]=await Promise.all([listTeamTimesheet(db,url),readTeamAttendance(db,month)])
    return {schedule,attendance}
  }))
  const dateSet=new Set(dates)
  return {ok:true,startDate:dates[0],endDate:dates[6],
    employees:results[0]?.schedule.employees||[],
    entries:results.flatMap(r=>r.schedule.entries).filter(e=>dateSet.has(e.date)),
    attendance:results.flatMap(r=>r.attendance).filter(m=>dateSet.has(m.date))}
}
function readChanges(input:WeekScheduleInput):{dates:string[],changes:WeekChange[]} {
  const dates=weekDays(input.start)
  if(!Array.isArray(input.changes)||!input.changes.length||input.changes.length>500)
    throw invalid('Выберите от 1 до 500 изменений расписания.')
  const allowedDates=new Set(dates)
  const unique=new Set<string>()
  const changes:WeekChange[]=[]
  for(const raw of input.changes){
    if(!raw||typeof raw!=='object'||Array.isArray(raw))throw invalid('Некорректная строка расписания.')
    const record=raw as Record<string,unknown>
    const date=validDate(record.date)
    const managerId=record.managerId
    const kind=record.kind
    if(!allowedDates.has(date)||!Number.isSafeInteger(managerId)||Number(managerId)<1||
      !['add','update','remove'].includes(String(kind)))
      throw invalid('В изменениях указаны неверные даты, сотрудники или действия.')
    const key=date+':'+managerId
    if(unique.has(key))throw invalid('Одна смена указана дважды.')
    unique.add(key)
    if(typeof record.workUntil!=='string'||(record.workUntil!==''&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(record.workUntil)))
      throw invalid('Укажите корректное время окончания смены.')
    if(typeof record.comment!=='string'||record.comment.length>300)throw invalid('Комментарий слишком длинный.')
    if(typeof record.baseUpdatedAt!=='string'||record.baseUpdatedAt.length>90||
      typeof record.baseWorkUntil!=='string'||record.baseWorkUntil.length>20||
      typeof record.baseComment!=='string'||record.baseComment.length>300)
      throw invalid('Некорректная версия расписания.')
    if(kind==='add'?record.baseId!==null:
       !Number.isSafeInteger(record.baseId)||Number(record.baseId)<1)
      throw invalid('Неверное исходное состояние смены.')
    changes.push({date,managerId:Number(managerId),kind:kind as ChangeKind,
      workUntil:record.workUntil,comment:record.comment,
      baseId:record.baseId===null?null:Number(record.baseId),
      baseUpdatedAt:record.baseUpdatedAt,baseWorkUntil:record.baseWorkUntil,
      baseComment:record.baseComment})
  }
  return {dates,changes}
}
export async function saveTeamScheduleWeek(db:D1Database,input:WeekScheduleInput){
  const {dates,changes}=readChanges(input)
  const managerIds=[...new Set(changes.map(x=>x.managerId))]
  const found=await db.prepare(
    `SELECT id,name,COALESCE(role,'') AS role FROM managers WHERE is_active=1
     AND id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))`
  ).bind(JSON.stringify(managerIds)).all<{id:number;name:string;role:string}>()
  const allowed=new Set((found.results||[]).filter(row=>
    !String(row.name||'').toLocaleLowerCase('ru-RU').includes('сымбат')&&
    !String(row.role||'').toLocaleLowerCase('ru-RU').includes('админ')
  ).map(row=>Number(row.id)))
  if(managerIds.some(id=>!allowed.has(id)))throw invalid('Один из сотрудников неактивен или недоступен для графика. Обновите неделю.')
  const json=JSON.stringify(changes)
  const now=new Date().toISOString()
  // D1.batch executes all statements in one transaction. The first SQL statement
  // deliberately fails on a stale baseline before any rows are changed.
  // This protects create/update/delete together from concurrent week editors.
  const statements=[
    db.prepare(`SELECT CASE WHEN EXISTS(
       SELECT 1 FROM json_each(?) j
       LEFT JOIN team_timesheet t
         ON t.work_date=json_extract(j.value,'$.date')
         AND t.manager_id=CAST(json_extract(j.value,'$.managerId') AS INTEGER)
       WHERE (json_extract(j.value,'$.baseId') IS NULL AND t.id IS NOT NULL)
          OR (json_extract(j.value,'$.baseId') IS NOT NULL AND (
            t.id IS NULL OR t.id<>CAST(json_extract(j.value,'$.baseId') AS INTEGER)
            OR COALESCE(t.updated_at,'')<>json_extract(j.value,'$.baseUpdatedAt')
            OR COALESCE(t.work_until,'')<>json_extract(j.value,'$.baseWorkUntil')
            OR COALESCE(t.comment,'')<>json_extract(j.value,'$.baseComment')
          ))
     ) THEN json('weekly_schedule_stale') ELSE 1 END AS accepted`).bind(json),
    db.prepare(`INSERT INTO team_timesheet
       (work_date,manager_id,work_until,comment,created_at,updated_at)
       SELECT json_extract(j.value,'$.date'),
         CAST(json_extract(j.value,'$.managerId') AS INTEGER),
         NULLIF(json_extract(j.value,'$.workUntil'),''),
         NULLIF(json_extract(j.value,'$.comment'),''),?,?
       FROM json_each(?) j
       WHERE json_extract(j.value,'$.kind')='add'
       ON CONFLICT(work_date,manager_id) DO NOTHING`).bind(now,now,json),
    db.prepare(`UPDATE team_timesheet AS t
       SET work_until=NULLIF(json_extract(j.value,'$.workUntil'),''),
           comment=NULLIF(json_extract(j.value,'$.comment'),''),
           updated_at=?
       FROM json_each(?) j
       WHERE json_extract(j.value,'$.kind')='update'
         AND t.work_date=json_extract(j.value,'$.date')
         AND t.manager_id=CAST(json_extract(j.value,'$.managerId') AS INTEGER)`).bind(now,json),
    db.prepare(`DELETE FROM team_timesheet WHERE EXISTS(
       SELECT 1 FROM json_each(?) j WHERE json_extract(j.value,'$.kind')='remove'
       AND work_date=json_extract(j.value,'$.date')
       AND manager_id=CAST(json_extract(j.value,'$.managerId') AS INTEGER)
     )`).bind(json),
  ]
  try{await db.batch(statements)}
  catch(error){
    const message=String(error instanceof Error?error.message:error)
    if(/malformed json|weekly_schedule_stale/i.test(message))throw stale()
    throw error
  }
  await writeActivityLog(db,{eventType:'timesheet_saved',entityType:'team_timesheet',
    title:'Обновлён график недели',
    details:'Неделя '+dates[0]+'; добавлено '+changes.filter(c=>c.kind==='add').length+
      '; изменено '+changes.filter(c=>c.kind==='update').length+
      '; снято '+changes.filter(c=>c.kind==='remove').length})
  return {ok:true,created:changes.filter(x=>x.kind==='add').length,
    updated:changes.filter(x=>x.kind==='update').length,removed:changes.filter(x=>x.kind==='remove').length,
    week:await listTeamScheduleWeek(db,dates[0])}
}
