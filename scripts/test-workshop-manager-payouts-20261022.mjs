import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {postWorkshopSettlementPayment,readWorkshopSettlementSummary,readWorkshopSettlementLedger}
  from '../worker/domains/workshop-settlements.ts'

// Use a disposable in-memory database. No remote D1 access or balance edits.
const sql=new DatabaseSync(':memory:')
sql.exec(readFileSync('migrations/0083_v72_workshop_settlement_foundation.sql','utf8'))
sql.exec('CREATE TABLE workshop_settlement_capture_control(id INTEGER PRIMARY KEY, enabled INTEGER NOT NULL); INSERT INTO workshop_settlement_capture_control VALUES(1,1)')
sql.exec(readFileSync('migrations/0107_v72_workshop_settlement_payment_method.sql','utf8'))
const db={prepare(query){let params=[];return{
  bind(...v){params=v;return this},
  async first(){return sql.prepare(query).get(...params)||null},
  async all(){return {results:sql.prepare(query).all(...params)}},
  async run(){return {meta:sql.prepare(query).run(...params)}}
}}}
const date=new Date(Date.now()+5*3600000).toISOString().slice(0,10)
sql.prepare(`INSERT INTO workshop_settlement_events
 (event_key,event_type,business_date,occurred_at,workshop_task_id,order_id,quantity,unit_cost,amount_delta)
 VALUES('manager-payout-test','completion',?,?,3,5,2,40000,80000)`).run(date,date+'T08:00:00Z')
const uuid='fdda812e-0fd0-4509-a9d1-800000000009'
const body={requestId:uuid,amount:25000,comment:'Выплата менеджером цеху'}
const result=await postWorkshopSettlementPayment(db,body,42)
assert.equal(result.ok,true)
assert.equal(result.replayed,false)
const payment=sql.prepare('SELECT actor_user_id,event_type,amount_delta,comment FROM workshop_settlement_events WHERE id=?').get(result.id)
assert.equal(payment.actor_user_id,42,'Record actual manager actor, never impersonate admin')
assert.equal(payment.event_type,'payment')
assert.equal(payment.amount_delta,-25000)
assert.equal(payment.comment,body.comment)
assert.equal((await postWorkshopSettlementPayment(db,body,42)).replayed,true,'Retry must not pay twice')
assert.equal(sql.prepare("SELECT COUNT(*) as n FROM workshop_settlement_events WHERE event_type='payment'").get().n,1)
await assert.rejects(postWorkshopSettlementPayment(db,{...body,requestId:'fdda812e-0fd0-4509-a9d1-800000000010',amount:80000},42),
  e=>e.code==='payment_exceeds_debt','Overspend is forbidden for managers')
const summary=await readWorkshopSettlementSummary(db)
assert.equal(summary.confirmedDebt,55000)
const details=await readWorkshopSettlementLedger(db,new URL('https://example.test/api/workshop/settlements?from='+date+'&to='+date))
assert.equal(details.confirmedDebt,55000)
assert(details.events.some(e=>e.id===result.id),'Manager payment appears in common history')

const worker=readFileSync('worker/index.ts','utf8')
const routes=worker.slice(worker.indexOf("if (url.pathname === '/api/workshop/settlements/activate'"),worker.indexOf("if (url.pathname === '/api/workshop/counts'"))
assert(routes.includes('getCurrentAuthUser')===false,'Authentication belongs to global API middleware')
assert(worker.includes("if (!authUser) return json({ ok: false, message: 'Войдите в систему.' }"),'All routes remain session authenticated')
for(const route of [
 "if (url.pathname === '/api/workshop/settlements/summary' && request.method === 'GET')",
 "if (url.pathname === '/api/workshop/settlements' && request.method === 'GET')",
 "if (url.pathname === '/api/workshop/settlements/payments' && request.method === 'POST')"
]){
 const a=routes.indexOf(route),b=routes.indexOf('\n      }',a)
 assert(a>=0&&b>a, 'Missing settlement endpoint '+route)
 assert(!routes.slice(a,b).includes('requireAdminUser'), 'Manager incorrectly blocked at '+route)
}
for(const route of [
 "if (url.pathname === '/api/workshop/settlements/activate'",
 "if (url.pathname === '/api/workshop/settlements/unpriced/count'",
 "if (url.pathname === '/api/workshop/settlements/unpriced'",
 "if (url.pathname === '/api/workshop/settlements/payments/'"
])if(!worker.includes(route)&&route.includes("payments/"))assert(worker.includes('workshopSettlementReverseMatch && request.method'), 'Reversal route missing')
for(const fragment of [
 "const denied = requireAdminUser(authUser, 'Запуск учёта цеха",
 "const denied = requireAdminUser(authUser, 'Подтверждение стоимости",
 "const denied = requireAdminUser(authUser, 'Исправление выплат",
 "const denied = requireAdminUser(authUser, 'Стоимость работы доступна только администратору."
])assert(worker.includes(fragment),'Administrator-only operation was exposed: '+fragment)
const section=readFileSync('src/features/sections/WorkshopSection.tsx','utf8')
const panel=readFileSync('src/features/workshop/WorkshopSettlementsPanel.tsx','utf8')
assert(section.includes('const canSeeSettlements = true'),'Manager cannot open workshop payments')
assert(section.includes('const canReviewUnpriced = Boolean(ctx.isAdmin)'), 'Price review leaked into manager role')
assert(section.includes('isAdmin={Boolean(ctx.isAdmin)}'), 'Panel must know authenticated role')
assert(panel.includes("const mayActivate=isAdmin&&"), 'Managers must not activate accounting')
assert(panel.includes("if(!isAdmin||writeLocked.current||!activated)return"), 'Managers must not reverse payments or price completions')
assert(panel.includes("{isAdmin&&event.event_type==='payment'"), 'Reversal button visible to manager')
assert(panel.includes("{isAdmin&&view==='unpriced'"), 'Unpriced admin panel visible to manager')
assert(panel.includes("{isAdmin&&<button type=\"button\" className={view==='unpriced'"), 'Admin-only price nav visible to manager')
sql.close()
console.log('WORKSHOP_MANAGER_PAYOUTS_PASSED: real SQLite actor, idempotency, balance, roles and admin-only controls')
