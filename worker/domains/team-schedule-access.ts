import type { AuthUser } from '../core/types.ts'

// Schedule editing is narrower than team administration. An active warehouse
// supervisor can manage shifts, but cannot edit employees, accounts or salaries.
export async function canManageTeamSchedule(db:D1Database,actor:AuthUser|null):Promise<boolean>{
  if(!actor||actor.mustChangePassword)return false
  if(actor.role==='admin')return true
  if(actor.role!=='manager'||actor.employeeRole!=='Завсклад'
    ||!Number.isSafeInteger(actor.managerId)||Number(actor.managerId)<1)return false
  const person=await db.prepare('SELECT role,is_active FROM managers WHERE id=?')
    .bind(actor.managerId).first<{role:string;is_active:number}>()
  return Number(person?.is_active)===1&&String(person?.role||'').trim()==='Завсклад'
}
