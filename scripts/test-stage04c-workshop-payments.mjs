import assert from 'node:assert/strict'
import fs from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import {
  postWorkshopSettlementPayment, reverseWorkshopSettlementPayment,
  readWorkshopSettlementLedger, assertWorkshopSettlementSchema
} from '../worker/domains/workshop-settlements.ts'

const wrangler=fs.readFileSync('wrangler.jsonc','utf8')
assert.match(wrangler, /"database_name"\s*:\s*"orders_db_prod"/)
assert.doesNotMatch(wrangler,/orders_db_branch2|40065052-854e-44b8-bcd5-251bdd488301/)
const sql=fs.readFileSync('migrations/0107_v72_workshop_settlement_payment_method.sql','utf8')
assert.doesNotMatch(sql,/(?:UPDATE|DELETE\s+FROM|INSERT\s+INTO)\s+workshop_settlement_events\b/i)
assert.match(sql,/ALTER TABLE workshop_settlement_events ADD COLUMN payment_method TEXT/)

const database=new DatabaseSync(':memory:')
database.exec(fs.readFileSync('migrations/0083_v72_workshop_settlement_foundation.sql','utf8'))
database.exec("CREATE TABLE workshop_settlement_capture_control(id INTEGER PRIMARY KEY, enabled INTEGER NOT NULL); INSERT INTO workshop_settlement_capture_control VALUES(1,0)")
const db = {
  prepare(sql) {
    let args=[]
    return {
      bind(...values){args=values;return this},
      async first(){return database.prepare(sql).get(...args)??null},
      async all(){return {results:database.prepare(sql).all(...args)}},
      async run(){return {meta:database.prepare(sql).run(...args)}},
    }
  },
}
const day=new Date(Date.now()+5*3600000).toISOString().slice(0,10)
const endpoint=new URL('https://example.test/api/workshop/settlements?from='+day+'&to='+day)
const uuid = (x) => '00000000-0000-4000-8000-'+String(x).padStart(12,'0')
async function failed(promise,status,code){
  await assert.rejects(promise,(error)=>{
    assert.equal(error.status,status)
    assert.equal(error.code,code)
    return true
  })
}
const completion = database.prepare(`INSERT INTO workshop_settlement_events
 (event_key,event_type,business_date,occurred_at,workshop_task_id,order_id,quantity,unit_cost,amount_delta)
 VALUES(?, 'completion', ?, ?, ?, 1, ?, ?, ?)`)
const money = () => Number(database.prepare("SELECT COALESCE(SUM(amount_delta),0) AS b FROM workshop_settlement_events").get().b)
const numberEvents = () => Number(database.prepare('SELECT COUNT(*) AS n FROM workshop_settlement_events').get().n)
completion.run('c1',day,day+'T08:00:00Z',1,3,40000,120000)
completion.run('pending',day,day+'T08:00:00Z',2,1,null,null)
assert.equal(money(),120000)
await failed(assertWorkshopSettlementSchema(db),503,'workshop_settlement_schema_not_ready')
database.exec(sql)
assert.equal(await assertWorkshopSettlementSchema(db),false)
await failed(postWorkshopSettlementPayment(db,{requestId:uuid(1),amount:70000,method:'Kaspi Pay'},1),409,'settlements_not_active')
assert.equal(money(),120000)
database.exec('UPDATE workshop_settlement_capture_control SET enabled=1 WHERE id=1')
assert.equal(await assertWorkshopSettlementSchema(db),true)
await failed(postWorkshopSettlementPayment(db,{requestId:'bad',amount:1000,method:'Наличные'},1),400,'idempotency_required')
await failed(postWorkshopSettlementPayment(db,{requestId:uuid(1),amount:0,method:'Наличные'},1),400,'invalid_payment_amount')
await failed(postWorkshopSettlementPayment(db,{requestId:uuid(1),amount:1000,method:'X'.repeat(81)},1),400,'invalid_settlement_input')
await failed(postWorkshopSettlementPayment(db,{requestId:uuid(1),amount:120001,method:'Наличные'},1),409,'payment_exceeds_debt')
let r=await postWorkshopSettlementPayment(db,{requestId:uuid(1),amount:70000,method:'Kaspi Pay',comment:'За готовые изделия'},1)
assert.equal(r.ok,true)
assert.equal(r.replayed,false)
const firstPaymentId=r.id
assert.equal(money(),50000)
r=await postWorkshopSettlementPayment(db,{requestId:uuid(1),amount:70000,method:'Kaspi Pay',comment:'За готовые изделия'},1)
assert.equal(r.id,firstPaymentId)
assert.equal(r.replayed,true)
await failed(postWorkshopSettlementPayment(db,{requestId:uuid(1),amount:60000,method:'Kaspi Pay',comment:'За готовые изделия'},1),409,'idempotency_conflict')
await failed(postWorkshopSettlementPayment(db,{requestId:uuid(1),amount:70000,method:'Наличные',comment:'За готовые изделия'},1),409,'idempotency_conflict')
assert.equal(money(),50000)

const attempts=await Promise.allSettled([
  postWorkshopSettlementPayment(db,{requestId:uuid(2),amount:40000,method:'Наличные'},1),
  postWorkshopSettlementPayment(db,{requestId:uuid(3),amount:40000,method:'Наличные'},1),
])
assert.equal(attempts.filter(x=>x.status==='fulfilled').length,1,'only one concurrent payment fits the balance')
assert.equal(attempts.filter(x=>x.status==='rejected').length,1)
assert.equal(attempts.find(x=>x.status==='rejected').reason.code,'payment_exceeds_debt')
assert.equal(money(),10000)
const report=await readWorkshopSettlementLedger(db,endpoint)
assert.equal(report.ok,true)
assert.equal(report.confirmedDebt,10000)
assert.equal(report.paid,110000)
assert.equal(report.charged,120000)
assert.equal(report.unresolvedPrices,1)
assert.equal(report.days[0].completed,120000)
assert.equal(report.days[0].paid,110000)
assert.equal(report.range.openingBalance,0)
assert.ok(report.events.length>=4)

await failed(reverseWorkshopSettlementPayment(db, firstPaymentId,{reason:'x'},1),400,'reversal_reason_required')
const reversed=await reverseWorkshopSettlementPayment(db,firstPaymentId,{reason:'Неверная выплата'},1)
assert.equal(reversed.ok,true)
assert.equal(reversed.replayed,false)
assert.equal(money(),80000)
const reversalRepeat=await reverseWorkshopSettlementPayment(db,firstPaymentId,{reason:'Неверная выплата'},1)
assert.equal(reversalRepeat.replayed,true)
assert.equal(reversalRepeat.id,reversed.id)
await failed(reverseWorkshopSettlementPayment(db,firstPaymentId,{reason:'Иная причина'},1),409,'reversal_conflict')
await failed(reverseWorkshopSettlementPayment(db,999999,{reason:'Неверная выплата'},1),404,'payment_not_found')
assert.equal(database.prepare("SELECT payment_method FROM workshop_settlement_events WHERE id=?").get(firstPaymentId).payment_method,'Kaspi Pay')
assert.equal(database.prepare("SELECT payment_method FROM workshop_settlement_events WHERE id=?").get(reversed.id).payment_method,'Kaspi Pay')
assert.throws(()=>database.exec('DELETE FROM workshop_settlement_events WHERE id='+firstPaymentId),/immutable/)

database.exec('UPDATE workshop_settlement_capture_control SET enabled=0 WHERE id=1')
const count=numberEvents()
await failed(postWorkshopSettlementPayment(db,{requestId:uuid(4),amount:5000,method:'Наличные'},1),409,'settlements_not_active')
const replay=await postWorkshopSettlementPayment(db,{requestId:uuid(1),amount:70000,method:'Kaspi Pay',comment:'За готовые изделия'},1)
assert.equal(replay.replayed,true)
assert.equal(numberEvents(),count)
const inactiveReport=await readWorkshopSettlementLedger(db,endpoint)
assert.equal(inactiveReport.captureEnabled,false)
assert.equal(inactiveReport.confirmedDebt,80000)
assert.equal(inactiveReport.paymentsReversed,70000)
await failed(readWorkshopSettlementLedger(db,new URL('https://example.test/api/workshop/settlements?from=2026-02-31&to=2026-03-01')),400,'invalid_date')
database.close()
console.log('STAGE04-C WORKSHOP PAYMENTS PASSED — immutable journal, exact replay, no advances, concurrent payment guard, corrections, unresolved prices and date scope')
