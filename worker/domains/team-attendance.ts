import { mapSqlRows } from '../core/sql.ts'
import type { AuthUser } from '../core/types.ts'

export type TeamAttendanceInput = {
  date?: unknown; managerId?: unknown; status?: unknown; finishedAt?: unknown; comment?: unknown
}
type AttendanceRow = {
  id:number;work_date:string;manager_id:number;manager:string;manager_color:string;
  status:string;finished_at:string|null;comment:string;updated_at:string
}
function invalid(message:string,status=400){
  const error=new Error(message) as Error & {status:number}
  error.status=status
  return error
}
function text(value:unknown){return typeof value==='string'?value.trim():''}
function todayInAlmaty(){
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Almaty',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date())
  const part=(kind:string)=>parts.find(x=>x.type===kind)?.value||''
  return part('year')+'-'+part('month')+'-'+part('day')
}
function validDate(value:unknown){
  const date=text(value)
  if(!/^20\d{2}-\d{2}-\d{2}$/.test(date))throw invalid('Укажите правильную дату.')
  const parsed=new Date(date+'T00:00:00Z')
  if(Number.isNaN(parsed.getTime())||parsed.toISOString().slice(0,10)!==date)throw invalid('Дата не существует.')
  return date
}
export async function readTeamAttendance(db:D1Database,month:unknown){
  const period=text(month)
  if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(period))throw invalid('Укажите правильный месяц.')
  const rows=await db.prepare(`SELECT a.id,a.work_date,a.manager_id,m.name AS manager,
      COALESCE(m.color_key,'#475569') AS manager_color,
      a.status,a.finished_at,a.comment,a.updated_at
    FROM team_attendance_marks a JOIN managers m ON m.id=a.manager_id
    WHERE a.work_date >= ? AND a.work_date <= ?
    ORDER BY a.work_date,a.manager_id`)
    .bind(period+'-01',period+'-31').all<AttendanceRow>()
  return mapSqlRows(rows).map((row:AttendanceRow)=>({
    id:Number(row.id),date:row.work_date,managerId:Number(row.manager_id),
    manager:row.manager,managerColor:row.manager_color,
    status:row.status as 'present'|'absent'|'excused',finishedAt:row.finished_at||'',
    comment:row.comment||'',updatedAt:row.updated_at,
  }))
}
export async function saveTeamAttendance(db:D1Database,input:TeamAttendanceInput,actor:AuthUser|null){
  if(!actor||actor.role!=='admin')throw invalid('Отмечать явку может только администратор.',403)
  const date=validDate(input.date)
  if(date>todayInAlmaty())throw invalid('Нельзя отмечать фактическую явку за будущий день.')
  const managerId=Number(input.managerId)
  if(!Number.isSafeInteger(managerId)||managerId<1)throw invalid('Выберите сотрудника.')
  const status=text(input.status)
  if(!['present','absent','excused','unmarked'].includes(status))throw invalid('Выберите состояние явки.')
  const finishedAt=text(input.finishedAt)
  if(finishedAt&&(!/^([01]\d|2[0-3]):[0-5]\d$/.test(finishedAt)||status!=='present'))
    throw invalid('Время ухода можно указать только для сотрудника, который пришёл.')
  const comment=text(input.comment)
  if(comment.length>350)throw invalid('Комментарий не должен превышать 350 символов.')
  const person=await db.prepare('SELECT id,name,role FROM managers WHERE id=?')
    .bind(managerId).first<{id:number;name:string;role:string}>()
  if(!person||String(person.name||'').toLocaleLowerCase('ru-RU').includes('сымбат')
    ||String(person.role||'').toLocaleLowerCase('ru-RU').includes('админ'))
    throw invalid('Сотрудник не найден или не участвует в табеле.',404)
  const scheduled=await db.prepare(`SELECT 1 AS found FROM team_timesheet
     WHERE manager_id=? AND work_date=?`).bind(managerId,date).first<{found:number}>()
  const existing=await db.prepare(`SELECT id,status,finished_at,comment FROM team_attendance_marks
    WHERE manager_id=? AND work_date=?`).bind(managerId,date).first<{id:number;status:string;finished_at:string|null;comment:string}>()
  if(!scheduled&&!existing)throw invalid('Сначала назначьте сотрудника на выбранный день.',409)
  if(status==='unmarked'){
    if(existing){
      // The DELETE audit trigger reads the actor stored in OLD: update it before removal.
      // Updating only this metadata does not create a spurious attendance-change audit row.
      await db.prepare('UPDATE team_attendance_marks SET updated_by_user_id=?,updated_at=? WHERE id=?')
        .bind(actor.id,new Date().toISOString(),existing.id).run()
      await db.prepare('DELETE FROM team_attendance_marks WHERE id=?').bind(existing.id).run()
    }
    return {ok:true,cleared:true}
  }
  const now=new Date().toISOString()
  await db.prepare(`INSERT INTO team_attendance_marks
    (work_date,manager_id,status,finished_at,comment,created_at,updated_at,updated_by_user_id)
    VALUES(?,?,?,?,?,?,?,?)
    ON CONFLICT(work_date,manager_id) DO UPDATE SET
      status=excluded.status,finished_at=excluded.finished_at,comment=excluded.comment,
      updated_at=excluded.updated_at,updated_by_user_id=excluded.updated_by_user_id`)
    .bind(date,managerId,status,finishedAt||null,comment,now,now,actor.id).run()
  return {ok:true,date,managerId,status}
}
