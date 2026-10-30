import assert from 'node:assert/strict'
import fs from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { activateWorkshopSettlements, readWorkshopSettlementSummary,
  postWorkshopSettlementPayment, reverseWorkshopSettlementPayment } from '../worker/domains/workshop-settlements.ts'

function createLedger(){
  const sqlite=new DatabaseSync(':memory:')
  sqlite.exec(fs.readFileSync('migrations/0083_v72_workshop_settlement_foundation.sql','utf8'))
  sqlite.exec(fs.readFileSync('migrations/0107_v72_workshop_settlement_payment_method.sql','utf8'))
  sqlite.exec(`CREATE TABLE workshop_settlement_capture_control (
    id INTEGER PRIMARY KEY CHECK(id=1),enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
    activated_at TEXT,CHECK(enabled=0 OR activated_at IS NOT NULL));
    INSERT INTO workshop_settlement_capture_control(id,enabled) VALUES(1,0)`)
  const db={
    prepare(sql){
      let args=[]
      return {
        _sql:sql,
        _params:()=>args,
        bind(...values){args=values;return this},
        async first(){return sqlite.prepare(sql).get(...args)??null},
        async all(){return {results:sqlite.prepare(sql).all(...args)}},
        async run(){return {meta:sqlite.prepare(sql).run(...args)}},
      }
    },
    async batch(statements){
      const result=[]
      sqlite.exec('BEGIN IMMEDIATE')
      try{
        for(const q of statements)result.push({meta:sqlite.prepare(q._sql).run(...q._params())})
        sqlite.exec('COMMIT')
        return result
      }catch(e){sqlite.exec('ROLLBACK');throw e}
    },
  }
  return {sqlite,db,close:()=>sqlite.close()}
}

const {sqlite,db,close}=createLedger()
let summary=await readWorkshopSettlementSummary(db)
assert.equal(summary.captureEnabled,false)
assert.equal(summary.canInitialize,true)
assert.equal(summary.confirmedDebt,0)
await assert.rejects(activateWorkshopSettlements(db,{openingDebt:-1},1),e=>e.code==='invalid_opening_debt')
await assert.rejects(activateWorkshopSettlements(db,{openingDebt:1.25},1),e=>e.code==='invalid_opening_debt')
await assert.rejects(activateWorkshopSettlements(db,{openingDebt:5000},0),e=>e.code==='actor_required')
assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM workshop_settlement_events').get().n,0)

const first=await activateWorkshopSettlements(db,{openingDebt:70000},1)
assert.equal(first.replayed,false)
assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM workshop_settlement_events').get().n,1)
assert.equal(sqlite.prepare("SELECT event_type FROM workshop_settlement_events").get().event_type,'opening_balance')
assert.equal(sqlite.prepare('SELECT enabled FROM workshop_settlement_capture_control').get().enabled,1)
assert.equal(sqlite.prepare("SELECT amount_delta FROM workshop_settlement_events").get().amount_delta,70000)
assert.ok(sqlite.prepare("SELECT activated_at FROM workshop_settlement_capture_control").get().activated_at)
assert.equal((await activateWorkshopSettlements(db,{openingDebt:70000},1)).replayed,true)
await assert.rejects(activateWorkshopSettlements(db,{openingDebt:80000},1),e=>e.code==='already_activated')
assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM workshop_settlement_events').get().n,1)

summary=await readWorkshopSettlementSummary(db)
assert.equal(summary.canInitialize,false)
assert.equal(summary.confirmedDebt,70000)
assert.equal(summary.recent[0].event_type,'opening_balance')
const payment=await postWorkshopSettlementPayment(db,
  {requestId:'00000000-0000-4000-8000-000000000551',amount:20000},1)
assert.equal(sqlite.prepare('SELECT payment_method FROM workshop_settlement_events WHERE id=?').get(payment.id).payment_method,null)
assert.equal((await readWorkshopSettlementSummary(db)).confirmedDebt,50000)
await reverseWorkshopSettlementPayment(db,payment.id,{reason:'Ошибочная выплата'},1)
assert.equal((await readWorkshopSettlementSummary(db)).confirmedDebt,70000)
close()

const legacy=createLedger()
legacy.sqlite.prepare(`INSERT INTO workshop_settlement_events
  (event_key,event_type,business_date,occurred_at,amount_delta)
  VALUES('historical-test','opening_balance','2026-10-18','2026-10-18T12:00:00Z',100)`).run()
assert.equal((await readWorkshopSettlementSummary(legacy.db)).canInitialize,false)
await assert.rejects(activateWorkshopSettlements(legacy.db,{openingDebt:100},1),
  e=>e.code==='nonempty_settlement_ledger')
assert.equal(legacy.sqlite.prepare('SELECT enabled FROM workshop_settlement_capture_control').get().enabled,0)
legacy.close()

const ui=fs.readFileSync('src/features/workshop/WorkshopSettlementsPanel.tsx','utf8')
const worker=fs.readFileSync('worker/index.ts','utf8')
const css=fs.readFileSync('src/styles/stage04-workshop-settlements.css','utf8')
assert.match(ui,/Сохранить долг и включить учёт/)
assert.match(ui,/openingConfirmed/)
assert.match(ui,/\/api\/workshop\/settlements\/activate/)
assert.match(ui,/Выплатили полностью/)
assert.match(ui,/Выплатили часть/)
assert.match(ui,/Комментарий \(необязательно\)/)
assert.doesNotMatch(ui,/<select value=\{method\}/)
assert.doesNotMatch(ui,/Способ выплаты:/)
assert.match(worker,/requireAdminUser\(authUser, 'Запуск учёта цеха доступен только администратору.'\)/)
assert.match(css,/ws-opening-form/)
console.log('STAGE04 CUTOVER PASSED: one-time atomic opening balance, replay, payouts, reversal, legacy guard, simple UI')
