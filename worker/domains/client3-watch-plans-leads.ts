import {json} from '../core/http.ts'
import type {AuthUser} from '../core/types.ts'

type RecordInput=Record<string,unknown>
type Manager={id:number;name:string}
const failure=(message:string,status=400)=>json({ok:false,message},{status})
const dateOk=(value:unknown):value is string=>{
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false
 const time=Date.parse(value+'T00:00:00Z')
 return Number.isFinite(time)&&new Date(time).toISOString().slice(0,10)===value
}
const moneyOk=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0&&value<=1_000_000_000_000
const countOk=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0&&value<=100_000_000
const text=(v:unknown,max=500)=>typeof v==='string'?v.trim().slice(0,max):''
const dateRange=(url:URL)=>{
 const from=url.searchParams.get('from')||''
 const to=url.searchParams.get('to')||''
 if(!dateOk(from)||!dateOk(to)||from>to||
   Date.parse(to+'T00:00:00Z')-Date.parse(from+'T00:00:00Z')>86400000*730)
   return null
 return {from,to}
}
async function managerFor(db:D1Database,brandId:number,managerId:number){
 if(!Number.isSafeInteger(managerId)||managerId<=0)return null
 return db.prepare(`SELECT m.id,m.name FROM managers m
   JOIN watch_manager_brands wmb ON wmb.manager_id=m.id
   WHERE wmb.brand_id=? AND m.is_active=1 AND m.id=? LIMIT 1`)
   .bind(brandId,managerId).first<Manager>()
}
async function managerAccess(db:D1Database,actor:AuthUser,brandId:number,raw:unknown){
 const id=Number(raw)
 if(actor.role!=='admin'&&id!==actor.managerId)return null
 return managerFor(db,brandId,id)
}
const eventFact=`(SELECT COALESCE(SUM(f.amount_delta),0)
 FROM financial_events f
 JOIN watch_order_details details ON details.order_id=f.order_id
 JOIN orders ord ON ord.id=f.order_id
 WHERE details.brand_id=p.brand_id AND f.event_date BETWEEN p.period_start AND p.period_end
   AND ord.order_status NOT IN ('deleted','archived'))`
const managerFact=`(SELECT COALESCE(SUM(f.amount_delta),0)
 FROM financial_events f
 JOIN watch_order_details details ON details.order_id=f.order_id
 JOIN orders ord ON ord.id=f.order_id
 WHERE details.brand_id=p.brand_id AND ord.manager_id=p.manager_id
 AND f.event_date BETWEEN p.period_start AND p.period_end
 AND ord.order_status NOT IN ('deleted','archived'))`

/** Same Main monetary plan definitions, with watch-brand isolation and actual
 * financial-event date. Unlike KPI, the target is a scalar tenge amount. */
export async function listClient3WatchPlans(db:D1Database,actor:AuthUser,brandId:number,url:URL){
 const period=dateRange(url)
 if(!period)return failure('Укажите корректный период планов, не более двух лет.')
 const {from,to}=period
 const [departments,managers]=await Promise.all([
  db.prepare(`SELECT p.id,p.period_start AS periodStart,p.period_end AS periodEnd,
    p.planned_amount AS plannedAmount,p.comment,p.updated_at AS updatedAt,
    ${eventFact} AS factAmount
    FROM watch_brand_department_plans p
    WHERE p.brand_id=? AND p.period_end>=? AND p.period_start<=?
    ORDER BY p.period_start DESC,p.id DESC LIMIT 300`).bind(brandId,from,to).all(),
  db.prepare(`SELECT p.id,p.manager_id AS managerId,m.name AS manager,
    p.period_start AS periodStart,p.period_end AS periodEnd,
    p.planned_amount AS plannedAmount,p.salary_base AS salaryBase,
    p.bonus_hit_percent AS bonusHitPercent,p.bonus_miss_percent AS bonusMissPercent,
    p.comment,p.updated_at AS updatedAt,${managerFact} AS factAmount
    FROM watch_brand_manager_plans p JOIN managers m ON m.id=p.manager_id
    WHERE p.brand_id=? AND p.period_end>=? AND p.period_start<=?
      AND (?=1 OR p.manager_id=?)
    ORDER BY p.period_start DESC,m.name COLLATE NOCASE,p.id DESC LIMIT 500`)
      .bind(brandId,from,to,actor.role==='admin'?1:0,actor.managerId||0).all(),
 ])
 const map=(row:Record<string,unknown>)=>{
  const target=Number(row.plannedAmount||0),actual=Number(row.factAmount||0)
  const rate=target>0?actual/target:0
  const base=Number(row.salaryBase||0)
  const pct=target>0&&actual>=target?Number(row.bonusHitPercent||0):Number(row.bonusMissPercent||0)
  const bonus=Math.round(Math.max(0,actual)*pct/100)
  return {...row,periodStart:String(row['periodStart']||''),periodEnd:String(row['periodEnd']||''),completionRate:rate,bonusAmount:bonus,
    totalSalary:base+bonus}
 }
 const managerRows=(managers.results||[]).map(x=>map(x))
 const departRows=(departments.results||[]).map(x=>map(x))
 return json({ok:true,from,to,departmentPlans:departRows,managerPlans:managerRows,
   // Dashboard never invents an unconfigured plan.
   monthPlan:departRows.find(x=>String(x['periodStart'])<=from&&String(x['periodEnd'])>=to)||null})
}

export async function saveClient3WatchPlan(db:D1Database,actor:AuthUser,brandId:number,input:RecordInput){
 if(actor.role!=='admin')return failure('Сохранять денежные планы может только администратор.',403)
 const kind=input.kind
 if(kind!=='department'&&kind!=='manager')return failure('Выберите план отдела или менеджера.')
 const start=input.periodStart,end=input.periodEnd
 if(!dateOk(start)||!dateOk(end)||start>end||
    Date.parse(end+'T00:00:00Z')-Date.parse(start+'T00:00:00Z')>86400000*366)
   return failure('Период плана должен быть корректным и не более одного года.')
 if(!moneyOk(input.plannedAmount))return failure('Введите корректную сумму плана.')
 const comment=text(input.comment)
 const id=Number(input.id||0)
 if(!Number.isSafeInteger(id)||id<0)return failure('Некорректная запись плана.')
 let manager:Manager|null=null
 if(kind==='manager'){
  manager=await managerFor(db,brandId,Number(input.managerId))
  if(!manager)return failure('Выберите действующего менеджера этого бренда.',403)
 }
 const now=new Date().toISOString()
 if(kind==='manager'){
  const base=input.salaryBase===undefined?0:Number(input.salaryBase)
  const hit=input.bonusHitPercent===undefined?5:Number(input.bonusHitPercent)
  const miss=input.bonusMissPercent===undefined?3:Number(input.bonusMissPercent)
  if(!moneyOk(base)||!Number.isFinite(hit)||!Number.isFinite(miss)||hit<0||miss<0||hit>100||miss>100)
   return failure('Проверьте оклад и проценты премии.')
  if(id){
   const r=await db.prepare(`UPDATE watch_brand_manager_plans SET manager_id=?,period_start=?,period_end=?,
     planned_amount=?,salary_base=?,bonus_hit_percent=?,bonus_miss_percent=?,comment=?,updated_at=?
     WHERE id=? AND brand_id=?`).bind(manager!.id,start,end,input.plannedAmount,
        base,hit,miss,comment,now,id,brandId).run()
   if(!r.meta?.changes)return failure('План не найден в этом бренде.',404)
  }else{
   await db.prepare(`INSERT INTO watch_brand_manager_plans
     (brand_id,manager_id,period_start,period_end,planned_amount,salary_base,
       bonus_hit_percent,bonus_miss_percent,comment,created_at,updated_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(brand_id,manager_id,period_start,period_end)
     DO UPDATE SET planned_amount=excluded.planned_amount,salary_base=excluded.salary_base,
       bonus_hit_percent=excluded.bonus_hit_percent,bonus_miss_percent=excluded.bonus_miss_percent,
       comment=excluded.comment,updated_at=excluded.updated_at`)
     .bind(brandId,manager!.id,start,end,input.plannedAmount,base,hit,miss,comment,now,now).run()
  }
 }else{
  if(id){
   const r=await db.prepare(`UPDATE watch_brand_department_plans
     SET period_start=?,period_end=?,planned_amount=?,comment=?,updated_at=?
     WHERE id=? AND brand_id=?`).bind(start,end,input.plannedAmount,comment,now,id,brandId).run()
   if(!r.meta?.changes)return failure('План отдела не найден в этом бренде.',404)
  }else{
   await db.prepare(`INSERT INTO watch_brand_department_plans
     (brand_id,period_start,period_end,planned_amount,comment,created_at,updated_at)
     VALUES(?,?,?,?,?,?,?) ON CONFLICT(brand_id,period_start,period_end) DO UPDATE
     SET planned_amount=excluded.planned_amount,comment=excluded.comment,updated_at=excluded.updated_at`)
     .bind(brandId,start,end,input.plannedAmount,comment,now,now).run()
  }
 }
 return json({ok:true,kind,periodStart:start,periodEnd:end})
}
export async function deleteClient3WatchPlan(db:D1Database,actor:AuthUser,brandId:number,input:RecordInput){
 if(actor.role!=='admin')return failure('Удалять денежные планы может только администратор.',403)
 const kind=input.kind
 const id=Number(input.id)
 if((kind!=='manager'&&kind!=='department')||!Number.isSafeInteger(id)||id<=0)
  return failure('Некорректная запись плана.')
 const table=kind==='manager'?'watch_brand_manager_plans':'watch_brand_department_plans'
 const res=await db.prepare('DELETE FROM '+table+' WHERE id=? AND brand_id=?').bind(id,brandId).run()
 return res.meta?.changes?json({ok:true}):failure('Запись не найдена в выбранном бренде.',404)
}

const leadConfig={
 leads:{table:'watch_brand_lead_records',date:'lead_date',
  fields:['accepted_count','bad_count']},
 callCentre:{table:'watch_brand_call_centre_records',date:'record_date',
  fields:['accepted_leads','calls_made','calls_accepted','fake_count','refusal_count','potential_count']},
} as const
type LeadKind=keyof typeof leadConfig
const leadKind=(raw:unknown):raw is LeadKind=>raw==='leads'||raw==='callCentre'
const leadFormat=(row:Record<string,unknown>,kind:LeadKind)=>{
 const d=(key:string)=>Number(row[key]||0)
 const accepted=d(kind==='leads'?'accepted_count':'accepted_leads')
 const bad=d('bad_count')
 const qualified=Math.max(0,accepted-bad)
 const sold=d('sales_count')
 return {id:Number(row.id),date:String(row.record_day||''),managerId:d('manager_id'),
  manager:String(row.manager||''),acceptedCount:accepted,badCount:bad,
  qualifiedCount:qualified,salesCount:sold,conversionRate:qualified>0?sold/qualified:0,
  callsMade:d('calls_made'),callsAccepted:d('calls_accepted'),fakeCount:d('fake_count'),
  refusalCount:d('refusal_count'),potentialCount:d('potential_count'),
  callAcceptanceRate:d('calls_made')>0?d('calls_accepted')/d('calls_made'):0,
  comment:String(row.comment||'')}
}
export async function listClient3WatchLeads(db:D1Database,actor:AuthUser,brandId:number,url:URL){
 const period=dateRange(url)
 if(!period)return failure('Укажите правильный период лидов.')
 const kind=url.searchParams.get('kind')||'leads'
 if(!leadKind(kind))return failure('Неизвестный журнал лидов.')
 const config=leadConfig[kind]
 const list=await db.prepare(`SELECT l.*,l.${config.date} AS record_day,m.name AS manager,
    (SELECT COUNT(*) FROM watch_order_details wd JOIN orders o ON o.id=wd.order_id
     WHERE wd.brand_id=l.brand_id AND o.manager_id=l.manager_id
     AND o.order_date=l.${config.date} AND o.order_status NOT IN ('deleted','archived')) AS sales_count
     FROM ${config.table} l JOIN managers m ON m.id=l.manager_id
     WHERE l.brand_id=? AND l.${config.date} BETWEEN ? AND ?
       AND (?=1 OR l.manager_id=?)
     ORDER BY l.${config.date} DESC,m.name COLLATE NOCASE,l.id DESC LIMIT 1000`)
   .bind(brandId,period.from,period.to,actor.role==='admin'?1:0,actor.managerId||0).all<Record<string,unknown>>()
 const rows=(list.results||[]).map(row=>leadFormat(row,kind))
 const totals=rows.reduce((a,r)=>({
   acceptedCount:a.acceptedCount+r.acceptedCount,badCount:a.badCount+r.badCount,
   qualifiedCount:a.qualifiedCount+r.qualifiedCount,salesCount:a.salesCount+r.salesCount,
 }),{acceptedCount:0,badCount:0,qualifiedCount:0,salesCount:0})
 return json({ok:true,...period,kind,rows,totals})
}
export async function saveClient3WatchLead(db:D1Database,actor:AuthUser,brandId:number,input:RecordInput){
 const kind=input.kind
 if(!leadKind(kind))return failure('Выберите журнал «Лиды» или «Call Centre».')
 if(!dateOk(input.date))return failure('Укажите корректную дату.')
 const manager=await managerAccess(db,actor,brandId,input.managerId)
 if(!manager)return failure('Нет доступа к выбранному менеджеру или бренду.',403)
 const config=leadConfig[kind]
 const fields=[...config.fields]
 const values=fields.map(field=>Number(input[field]))
 if(!values.every(countOk))return failure('Количество лидов и звонков должно быть неотрицательным целым.')
 if(kind==='leads'&&values[1]>values[0])return failure('Неквалифицированных лидов не может быть больше принятых.')
 if(kind==='callCentre'&&values[2]>values[1])return failure('Принятых звонков не может быть больше совершённых.')
 const comment=text(input.comment)
 const id=Number(input.id||0)
 if(!Number.isSafeInteger(id)||id<0)return failure('Некорректная запись.')
 const now=new Date().toISOString()
 if(id){
  const q=`UPDATE ${config.table} SET ${config.date}=?,manager_id=?,
    ${fields.map(f=>f+'=?').join(',')},comment=?,updated_at=?
    WHERE id=? AND brand_id=? AND (?=1 OR manager_id=?)`
  const result=await db.prepare(q).bind(input.date,manager.id,...values,comment,now,
    id,brandId,actor.role==='admin'?1:0,actor.managerId||0).run()
  if(!result.meta?.changes)return failure('Запись не найдена или недоступна.',404)
 }else{
  const cols=['brand_id',config.date,'manager_id',...fields,'comment','created_at','updated_at']
  const placeholders=cols.map(()=>'?').join(',')
  const update=[...fields,'comment','updated_at'].map(x=>x+'=excluded.'+x).join(',')
  const q=`INSERT INTO ${config.table}(${cols.join(',')}) VALUES(${placeholders})
    ON CONFLICT(brand_id,${config.date},manager_id) DO UPDATE SET ${update}`
  await db.prepare(q).bind(brandId,input.date,manager.id,...values,comment,now,now).run()
 }
 return json({ok:true,date:input.date,managerId:manager.id,kind})
}
export async function deleteClient3WatchLead(db:D1Database,actor:AuthUser,brandId:number,input:RecordInput){
 if(actor.role!=='admin')return failure('Удалять записи лидов может только администратор.',403)
 const kind=input.kind,id=Number(input.id)
 if(!leadKind(kind)||!Number.isSafeInteger(id)||id<=0)return failure('Некорректная запись.')
 const row=await db.prepare('DELETE FROM '+leadConfig[kind].table+' WHERE id=? AND brand_id=?')
   .bind(id,brandId).run()
 return row.meta?.changes?json({ok:true}):failure('Запись не найдена.',404)
}
