import {json} from '../core/http.ts'
import type {AuthUser} from '../core/types.ts'
import {listTeamEmployees,setTeamEmployeeActive,listTeamTimesheet,saveTeamTimesheet,type TimesheetInput} from './team.ts'
import {normalizeManagerColor} from './activity.ts'
import {normalizeEmployeeRole} from '../core/text.ts'

type Input=Record<string,unknown>
const denied=()=>json({ok:false,message:'Настройки команды доступны администратору.'},{status:403})
const bad=(message:string,status=400)=>json({ok:false,message},{status})
const text=(raw:unknown,max:number)=>typeof raw==='string'?raw.trim().slice(0,max):''
const validDate=(v:unknown):v is string=>{
 if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v))return false
 const n=Date.parse(v+'T00:00:00Z')
 return Number.isFinite(n)&&new Date(n).toISOString().slice(0,10)===v
}
const roles=['Менеджер','Логист','Упаковщик','Завсклад','Админ'] as const
const validRole=(v:unknown)=>typeof v==='string'&&roles.includes(v as typeof roles[number])
export async function listClient3WatchTeam(db:D1Database,actor:AuthUser){
 if(actor.role!=='admin')return denied()
 const [roster,brands,accounts]=await Promise.all([
   listTeamEmployees(db,true),
   db.prepare(`SELECT mb.manager_id AS managerId,b.code AS brand
     FROM watch_manager_brands mb JOIN watch_brands b ON b.id=mb.brand_id
     ORDER BY mb.manager_id,b.code`).all<{managerId:number;brand:string}>(),
   db.prepare(`SELECT manager_id AS managerId,id,login,role,is_active AS isActive,
     must_change_password AS mustChangePassword FROM app_users
     WHERE manager_id IS NOT NULL ORDER BY id DESC`).all<Record<string,unknown>>(),
 ])
 const memberships=new Map<number,string[]>()
 for(const x of brands.results||[]){
  memberships.set(x.managerId,[...(memberships.get(x.managerId)||[]),x.brand])
 }
 const accountsByManager=new Map<number,Record<string,unknown>>()
 for(const u of accounts.results||[])if(!accountsByManager.has(Number(u.managerId)))
  accountsByManager.set(Number(u.managerId),u)
 return json({ok:true,stats:roster.stats,
  employees:roster.employees.map(r=>({...r,brands:memberships.get(r.id)||[],
    access:accountsByManager.get(r.id)||null}))})
}

/** Main roster fields, with one extra genuine Client3 role (Логист).
 * Do not normalize logistics to manager; login permissions use this exact role.
 */
export async function saveClient3WatchEmployee(db:D1Database,actor:AuthUser,input:Input){
 if(actor.role!=='admin')return denied()
 const id=Number(input.id||0)
 const name=text(input.name,80).toLocaleUpperCase('ru-RU')
 if(!Number.isSafeInteger(id)||id<0||!name)return bad('Укажите действительное имя сотрудника.')
 if(!validRole(input.role))return bad('Укажите роль сотрудника.')
 const role=String(input.role)
 const phone=text(input.phone,100),comment=text(input.comment,500)
 const hiredAt=input.hiredAt===''||input.hiredAt==null?'':String(input.hiredAt)
 const birthDate=input.birthDate===''||input.birthDate==null?'':String(input.birthDate)
 if(hiredAt&&!validDate(hiredAt))return bad('Проверьте дату начала работы.')
 const today=new Date(Date.now()+5*3600_000).toISOString().slice(0,10)
 if(birthDate&&(!validDate(birthDate)||birthDate>today))return bad('Проверьте дату рождения.')
 const color=normalizeManagerColor(input.colorKey,id||0)
 const now=new Date().toISOString()
 if(id){
  const existed=await db.prepare('SELECT id,is_active FROM managers WHERE id=?').bind(id).first()
  if(!existed)return bad('Сотрудник не найден.',404)
  const res=await db.prepare(`UPDATE managers SET name=?,role=?,phone=?,comment=?,
    color_key=?,hired_at=COALESCE(NULLIF(?,''),hired_at),birth_date=?,updated_at=?
    WHERE id=?`).bind(name,role,phone||null,comment||null,color,hiredAt,
      birthDate||null,now,id).run()
  if(!res.meta?.changes)return bad('Не удалось обновить сотрудника.',409)
  return json({ok:true,id,updated:true})
 }
 const res=await db.prepare(`INSERT INTO managers(name,role,phone,comment,color_key,
    hired_at,birth_date,is_active,created_at,updated_at)
   VALUES(?,?,?,?,?,?,?,1,?,?)`).bind(name,role,phone||null,comment||null,color,
     hiredAt||today,birthDate||null,now,now).run()
 return json({ok:true,id:Number(res.meta?.last_row_id||0),created:true})
}
export async function setClient3WatchEmployeeActive(
 db:D1Database,actor:AuthUser,id:number,isActive:unknown){
 if(actor.role!=='admin')return denied()
 if(!Number.isSafeInteger(id)||id<=0||typeof isActive!=='boolean')
  return bad('Некорректный сотрудник или состояние.')
 // Identical Main employment guard: preserve historic identity, disable
 // logins/sessions when dismissed and refuse when active work blocks it.
 return setTeamEmployeeActive(db,id,isActive)
}
export async function listClient3WatchTimesheet(db:D1Database,actor:AuthUser,url:URL){
 if(actor.role!=='admin')return denied()
 return json(await listTeamTimesheet(db,url))
}
export async function saveClient3WatchTimesheet(db:D1Database,actor:AuthUser,input:TimesheetInput){
 if(actor.role!=='admin')return denied()
 // Team data is cross-brand; reuse exactly Main's batch+audit timesheet logic.
 return json(await saveTeamTimesheet(db,input))
}
export async function listClient3WatchTeamActivity(db:D1Database,actor:AuthUser,url:URL){
 if(actor.role!=='admin')return denied()
 const from=url.searchParams.get('from'),to=url.searchParams.get('to')
 if(!validDate(from)||!validDate(to)||from>to)return bad('Некорректный период отчёта.')
 const rows=await db.prepare(`SELECT m.id AS managerId,m.name AS manager,m.role,
    m.color_key AS colorKey,COUNT(DISTINCT o.id) AS ordersCount,
    COALESCE(SUM(o.total_amount),0) AS salesTotal,
    COALESCE(SUM(CASE WHEN o.shipping_status='sent' THEN 1 ELSE 0 END),0) AS sentOrders
   FROM managers m LEFT JOIN orders o ON o.manager_id=m.id
     AND o.order_date BETWEEN ? AND ? AND o.order_status NOT IN ('deleted','archived')
     AND EXISTS(SELECT 1 FROM watch_order_details wd WHERE wd.order_id=o.id)
   GROUP BY m.id ORDER BY ordersCount DESC,m.name COLLATE NOCASE`)
   .bind(from,to).all()
 return json({ok:true,from,to,rows:rows.results||[]})
}
export async function listClient3WatchTeamSalary(db:D1Database,actor:AuthUser,url:URL){
 if(actor.role!=='admin')return denied()
 const from=url.searchParams.get('from'),to=url.searchParams.get('to')
 if(!validDate(from)||!validDate(to)||from>to)return bad('Некорректный период зарплаты.')
 const [managers,plans,timesheets]=await Promise.all([
  db.prepare(`SELECT id AS managerId,name AS manager,COALESCE(role,'Менеджер') AS role,
    COALESCE(color_key,'#2563EB') AS colorKey,salary_base AS salaryBase
    FROM managers ORDER BY is_active DESC,name COLLATE NOCASE`).all<Record<string,unknown>>(),
  db.prepare(`SELECT p.manager_id AS managerId,p.brand_id AS brandId,
    p.planned_amount AS plannedAmount,p.salary_base AS salaryBase,
    p.bonus_hit_percent AS hitPercent,p.bonus_miss_percent AS missPercent,
    (SELECT COALESCE(SUM(f.amount_delta),0) FROM financial_events f
      JOIN watch_order_details wd ON wd.order_id=f.order_id
      JOIN orders o ON o.id=f.order_id
      WHERE wd.brand_id=p.brand_id AND o.manager_id=p.manager_id
        AND o.order_status NOT IN ('deleted','archived')
        AND f.event_date BETWEEN p.period_start AND p.period_end) AS factAmount
    FROM watch_brand_manager_plans p
    WHERE p.period_start<=? AND p.period_end>=?`)
    .bind(to,from).all<Record<string,unknown>>(),
  db.prepare(`SELECT manager_id AS managerId,COUNT(DISTINCT work_date) AS workDays
    FROM team_timesheet WHERE work_date BETWEEN ? AND ? GROUP BY manager_id`)
    .bind(from,to).all<Record<string,unknown>>(),
 ])
 const days=new Map((timesheets.results||[]).map(x=>[Number(x.managerId),Number(x.workDays)]))
 const all=(managers.results||[]).map(m=>{
   const p=(plans.results||[]).filter(x=>Number(x.managerId)===Number(m.managerId))
   const planned=p.reduce((sum,x)=>sum+Number(x.plannedAmount||0),0)
   const fact=p.reduce((sum,x)=>sum+Number(x.factAmount||0),0)
   const bonus=p.reduce((sum,x)=>sum+Math.round(Math.max(0,Number(x.factAmount||0))*
    Number(Number(x.factAmount||0)>=Number(x.plannedAmount||0)?x.hitPercent:x.missPercent)/100),0)
   const base=Math.max(Number(m.salaryBase||0),...p.map(x=>Number(x.salaryBase||0)),0)
   return {...m,workDays:days.get(Number(m.managerId))||0,plannedAmount:planned,
     factAmount:fact,salaryBase:base,bonusAmount:bonus,totalSalary:base+bonus,
     completionRate:planned>0?fact/planned:null}
 })
 return json({ok:true,from,to,rows:all})
}
