import assert from 'node:assert/strict'
import fs from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import {
  postWorkshopSettlementPayment,reverseWorkshopSettlementPayment,
  readWorkshopSettlementSummary,readWorkshopSettlementLedger,
} from '../worker/domains/workshop-settlements.ts'

const d=new DatabaseSync(':memory:')
d.exec(fs.readFileSync('migrations/0083_v72_workshop_settlement_foundation.sql','utf8'))
d.exec(fs.readFileSync('migrations/0107_v72_workshop_settlement_payment_method.sql','utf8'))
d.exec("CREATE TABLE workshop_settlement_capture_control(id INTEGER PRIMARY KEY,enabled INTEGER NOT NULL);INSERT INTO workshop_settlement_capture_control VALUES(1,1)")
let queries=[]
const db={
  prepare(sql){
    queries.push(sql)
    let args=[]
    return {bind(...values){args=values;return this},
      async first(){return d.prepare(sql).get(...args)??null},
      async all(){return {results:d.prepare(sql).all(...args)}},
      async run(){return {meta:d.prepare(sql).run(...args)}},
    }
  }
}
const today=new Date(Date.now()+5*3600000).toISOString().slice(0,10)
const yesterday=new Date(Date.parse(today+'T00:00:00Z')-86400000).toISOString().slice(0,10)
const ins=d.prepare(`INSERT INTO workshop_settlement_events
 (event_key,event_type,business_date,occurred_at,workshop_task_id,order_id,product_name_snapshot,
 quantity,unit_cost,amount_delta,related_event_id)
 VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
ins.run('old','completion',yesterday,yesterday+'T10:00:00Z',1,1,'Старый шапан',2,3000,6000,null)
ins.run('old-unknown','completion',yesterday,yesterday+'T10:00:00Z',2,1,'Старое платье',1,null,null,null)
ins.run('late-cost','price_adjustment',today,today+'T10:00:00Z',2,1,'Старое платье',1,2000,2000,2)
ins.run('today','completion',today,today+'T10:00:00Z',3,1,'Новый шапан',1,5000,5000,null)
const rid='00000000-0000-4000-8000-000000000099'
const payment=await postWorkshopSettlementPayment(db,{requestId:rid,amount:2500},1)
assert.equal(payment.replayed,false)
const recorded=d.prepare('SELECT payment_method FROM workshop_settlement_events WHERE id=?').get(payment.id)
assert.equal(recorded.payment_method,null,'unknown payment source must remain explicitly unknown')
assert.equal((await postWorkshopSettlementPayment(db,{requestId:rid,amount:2500,method:''},1)).replayed,true)
await assert.rejects(postWorkshopSettlementPayment(db,{requestId:rid,amount:2500,method:'Kaspi Pay'},1),
  e=>e.code==='idempotency_conflict')
queries=[]
let summary=await readWorkshopSettlementSummary(db)
assert.equal(summary.ok,true)
assert.equal(summary.captureEnabled,true)
assert.equal(summary.confirmedDebt,10500)
assert.equal(summary.today.completed,5000,'late Catalog correction is not work completed today')
assert.equal(summary.today.costConfirmed,2000,'late cost separately reported')
assert.equal(summary.today.paid,2500)
assert.equal(summary.unresolvedPrices,0)
assert.equal(summary.recent[0].event_type,'payment')
assert.equal(queries.length,3,'summary must require one schema preflight and only two business queries')
assert.equal(queries.filter(q=>q.includes('business_date BETWEEN')).length,0,'no date-scoped full ledger for overview')
assert.ok(!queries.some(q=>q.includes('LIMIT 51')),'no full 50-event page for overview')
const range=new URL('https://example.test/api/workshop/settlements?from='+yesterday+'&to='+today)
const ledger=await readWorkshopSettlementLedger(db,range)
assert.equal(ledger.confirmedDebt,10500)
const currentDay=ledger.days.find(row=>row.date===today)
assert.equal(currentDay.completed,5000)
assert.equal(currentDay.costConfirmed,2000)
assert.equal(currentDay.paid,2500)
assert.equal(ledger.days.find(row=>row.date===yesterday).completed,6000)

const reversed=await reverseWorkshopSettlementPayment(db,payment.id,{reason:'Тестовая ошибка'},1)
assert.equal(reversed.replayed,false)
summary=await readWorkshopSettlementSummary(db)
assert.equal(summary.confirmedDebt,13000)
assert.equal(summary.today.paymentCorrections,2500)
assert.equal(summary.today.costConfirmed,2000)
await assert.rejects(postWorkshopSettlementPayment(db,{requestId:'00000000-0000-4000-8000-000000000100',amount:13001},1),
  e=>e.code==='payment_exceeds_debt')

// Display tests: short home request, full/partial payout, optional method,
// clear debt before approval and hidden full filters/ledger until chosen.
const ui=fs.readFileSync('src/features/workshop/WorkshopSettlementsPanel.tsx','utf8')
const style=fs.readFileSync('src/styles/stage04-workshop-settlements.css','utf8')
const worker=fs.readFileSync('worker/index.ts','utf8')
assert.match(ui,/\/api\/workshop\/settlements\/summary/)
assert.match(ui,/if\(view==='home'\)return/)
assert.match(ui,/Выплатили полностью/)
assert.match(ui,/Выплатили часть/)
assert.match(ui,/Подтвердить выплату/)
assert.match(ui,/Дополнительно \(необязательно\)/)
assert.match(ui,/Не указывать/)
assert.match(ui,/costConfirmed/)
assert.match(ui,/Уточнено стоимости/)
assert.match(ui,/Подтвердить начисление/)
assert.match(ui,/paymentIdempotency/)
assert.match(ui,/const amountValue=Number\(amountDraft\)/,'full payout amount stays frozen while form is open')
assert.match(style,/ws-fast-overview/)
assert.match(style,/workshop-channel-tabs:has\(> \.is-settlements\)/)
assert.match(worker,/\/api\/workshop\/settlements\/summary/)
assert.match(worker,/requireAdminUser\(authUser/)
d.close()
console.log('STAGE04 FAST SETTLEMENTS PASSED — optional method, no duplicate retries, lazy overview, distinct late pricing, safe full/partial UX and reversals')
