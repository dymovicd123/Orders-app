import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { createRealAdminDeleteCancellationDriver } from '../worker/domains/admin-delete-real-driver.ts'

// Actual production cancelReturn and critical-operation handlers, with SQLite
// executing their SQL through a minimal D1-compatible adapter. NOT an HTTP or
// remote D1 test. No mocked handler writes, no production connections.
const sql=new DatabaseSync(':memory:')
sql.exec([
  "CREATE TABLE orders(id INTEGER PRIMARY KEY,external_id TEXT,order_status TEXT,shipping_status TEXT,pricing_mode TEXT,total_amount INTEGER,received_amount INTEGER,return_amount INTEGER,debt_amount INTEGER,updated_at TEXT)",
  "CREATE TABLE order_items(id INTEGER PRIMARY KEY,order_id INTEGER,quantity INTEGER,unit_price INTEGER,line_total INTEGER)",
  "CREATE TABLE exchanges(id INTEGER PRIMARY KEY,order_id INTEGER,status TEXT,financial_action TEXT,financial_amount INTEGER,payment_id INTEGER,refund_return_id INTEGER)",
  "CREATE TABLE returns(id INTEGER PRIMARY KEY,order_id INTEGER,status TEXT,amount INTEGER,payment_method TEXT,cancelled_at TEXT,cancellation_comment TEXT)",
  "CREATE TABLE return_items(id INTEGER PRIMARY KEY,return_id INTEGER,order_item_id INTEGER,restocked INTEGER,inventory_source TEXT,product_name_snapshot TEXT,quantity INTEGER)",
  "CREATE TABLE return_workshop_task_reversals(id INTEGER PRIMARY KEY,return_id INTEGER,workshop_task_id INTEGER,previous_status TEXT,previous_quantity INTEGER)",
  "CREATE TABLE workshop_tasks(id INTEGER PRIMARY KEY,order_id INTEGER,order_item_id INTEGER,status TEXT,quantity INTEGER,updated_at TEXT)",
  "CREATE TABLE payments(id INTEGER PRIMARY KEY,order_id INTEGER,amount INTEGER)",
  "CREATE TABLE inventory_reservations(id INTEGER PRIMARY KEY,order_id INTEGER,status TEXT,inventory_source TEXT,variant_id INTEGER)",
  "CREATE TABLE inventory_stock(id INTEGER PRIMARY KEY,inventory_source TEXT,variant_id INTEGER,quantity INTEGER,reserved_quantity INTEGER)",
  "CREATE TABLE inventory_lifecycle_events(id INTEGER PRIMARY KEY,operation_type TEXT,operation_id INTEGER,operation_item_id INTEGER,order_id INTEGER,status TEXT)",
  "CREATE TABLE financial_events(id INTEGER PRIMARY KEY,event_key TEXT UNIQUE,order_id INTEGER,external_order_id TEXT,event_date TEXT,event_at TEXT,event_type TEXT,related_type TEXT,amount_delta INTEGER,payment_method TEXT,source_type TEXT,source_id INTEGER,source_ref TEXT,reason TEXT,comment TEXT,is_backfill INTEGER,created_at TEXT)",
  "CREATE TABLE critical_operations(request_id TEXT PRIMARY KEY,operation_type TEXT,request_fingerprint TEXT,status TEXT,step TEXT,context_json TEXT,lease_token TEXT,lease_until_ms INTEGER,created_at TEXT,updated_at TEXT,response_json TEXT,completed_at TEXT,last_error TEXT,target_type TEXT,target_id INTEGER,target_ref TEXT)"
].join(';')+';')
sql.exec([
  "INSERT INTO orders(id,external_id,order_status,shipping_status,pricing_mode,total_amount,received_amount,return_amount,debt_amount) VALUES(42,'ORDER_TEST_42','active','not_sent','itemized_v1',20000,0,0,20000)",
  "INSERT INTO order_items VALUES(1,42,1,20000,20000)",
  "INSERT INTO returns(id,order_id,status,amount,payment_method) VALUES(400,42,'completed',0,NULL)",
  "INSERT INTO inventory_reservations VALUES(1,42,'active','warehouse',10)",
  "INSERT INTO inventory_stock VALUES(1,'warehouse',10,5,1)"
].join(';')+';')
let failBeforeCriticalComplete=true
let actualReturnTransitions=0
const mkStatement=(query,params=[])=>({
  bind(...args){return mkStatement(query,args)},
  async first(){return sql.prepare(query).get(...params)??null},
  async all(){return {results:sql.prepare(query).all(...params)}},
  _run(){
    if(failBeforeCriticalComplete
      && /UPDATE critical_operations\s+SET status = 'completed'/.test(query)){
      failBeforeCriticalComplete=false
      throw new Error('SIMULATED_WORKER_CRASH_BEFORE_CRITICAL_CHECKPOINT')
    }
    const result=sql.prepare(query).run(...params)
    if(/UPDATE returns\s+SET status = 'cancelled'/.test(query) && result.changes===1)
      actualReturnTransitions++
    return {success:true,meta:{changes:Number(result.changes),last_row_id:Number(result.lastInsertRowid)}}
  },
  async run(){return this._run()}
})
const db={
  prepare(query){return mkStatement(query)},
  async batch(statements){
    sql.exec('BEGIN IMMEDIATE')
    try{
      const res=statements.map(s=>s._run())
      sql.exec('COMMIT')
      return res
    }catch(error){sql.exec('ROLLBACK');throw error}
  }
}
const driver=createRealAdminDeleteCancellationDriver(db)
const step={
  orderId:42,sagaRequestId:'TEST_REAL_RETURN_42',
  cancelRequestId:'TEST_REAL_RETURN_42:return:400',
  stepIndex:0,type:'return',id:400
}
// A physical inbound previously applied for this historical order cannot
// be automatically reversed after a later physical reconciliation.
sql.exec("INSERT INTO inventory_lifecycle_events VALUES(40,'return',400,NULL,42,'applied')")
await assert.rejects(()=>driver.preflight(step),/проведённые физические складские движения/)
assert.equal(sql.prepare('SELECT status FROM returns WHERE id=400').get().status,'completed')
assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM critical_operations WHERE operation_type='return_cancel'").get().n,0)
sql.exec("DELETE FROM inventory_lifecycle_events WHERE id=40")
await driver.preflight(step)
await assert.rejects(()=>driver.cancel(step),/SIMULATED_WORKER_CRASH_BEFORE_CRITICAL_CHECKPOINT/)
assert.equal(sql.prepare("SELECT status FROM returns WHERE id=400").get().status,'cancelled')
assert.equal(sql.prepare("SELECT status FROM critical_operations WHERE request_id=?")
  .get(step.cancelRequestId).status,'started')
assert.equal(actualReturnTransitions,1,'Business effect must already be committed at simulated crash')
await assert.rejects(()=>driver.verifyReconciled(step),/Обработчик ещё не завершил отмену/)

// The same deterministic request ID re-enters the ACTUAL return handler,
// recovers an already-written business effect and finishes its own checkpoint.
await driver.preflight(step)
const recovered=await driver.cancel(step)
assert.equal(recovered.ok,true)
assert.equal(await driver.verifyReconciled(step),true)
assert.equal(actualReturnTransitions,1,'Retry must not execute another Return cancellation')
assert.equal(sql.prepare("SELECT status FROM critical_operations WHERE request_id=?")
  .get(step.cancelRequestId).status,'completed')
assert.equal(sql.prepare("SELECT target_id FROM critical_operations WHERE request_id=?")
  .get(step.cancelRequestId).target_id,400)
await driver.preflight(step)
await driver.cancel(step)
assert.equal(await driver.verifyReconciled(step),true)
assert.equal(actualReturnTransitions,1,'Cached handler replay cannot repeat business effect')
assert.deepEqual({
  ...sql.prepare("SELECT total_amount,received_amount,return_amount,debt_amount FROM orders WHERE id=42").get()
},{total_amount:20000,received_amount:0,return_amount:0,debt_amount:20000})
assert.deepEqual({
  ...sql.prepare("SELECT quantity,reserved_quantity FROM inventory_stock WHERE id=1").get()
},{quantity:5,reserved_quantity:1})
// Real paid Return: cancelling a refund must append exactly ONE positive
// money reversal, preserve the original negative refund, and reconcile order
// balances without changing a single physical stock or reservation row.
sql.exec("INSERT INTO payments VALUES(3,42,2000)")
sql.exec("INSERT INTO returns(id,order_id,status,amount,payment_method) VALUES(402,42,'completed',1000,'Kaspi')")
sql.exec("UPDATE orders SET received_amount=2000,return_amount=1000,debt_amount=18000 WHERE id=42")
sql.exec("INSERT INTO financial_events(event_key,order_id,external_order_id,event_date,event_at,event_type,amount_delta,payment_method,source_type,source_id,created_at) VALUES('REFUND_402_ORIGINAL',42,'ORDER_TEST_42','2026-10-17','2026-10-17','order_refund',-1000,'Kaspi','return',402,'2026-10-17')")
const paidStep={
  orderId:42,sagaRequestId:'TEST_PAID_RETURN_42',
  cancelRequestId:'TEST_PAID_RETURN_42:return:402',
  stepIndex:0,type:'return',id:402
}
const previousStock={...sql.prepare('SELECT quantity,reserved_quantity FROM inventory_stock WHERE id=1').get()}
await driver.preflight(paidStep)
await driver.cancel(paidStep)
assert.equal(await driver.verifyReconciled(paidStep),true)
await driver.preflight(paidStep)
await driver.cancel(paidStep)
assert.equal(await driver.verifyReconciled(paidStep),true)
assert.deepEqual(sql.prepare('SELECT event_type,amount_delta FROM financial_events ORDER BY id').all()
  .map(x=>[x.event_type,x.amount_delta]),
  [['order_refund',-1000],['refund_reversal',1000]],
  'The same refund must be reversed ONCE while original audit remains immutable')
assert.deepEqual({...sql.prepare('SELECT received_amount,return_amount,debt_amount FROM orders WHERE id=42').get()},
  {received_amount:2000,return_amount:0,debt_amount:18000})
assert.deepEqual({...sql.prepare('SELECT quantity,reserved_quantity FROM inventory_stock WHERE id=1').get()},
  previousStock,'A money-only Return must not mutate physical stock or reserves')
sql.close()
console.log('REAL_RETURN_HANDLER_SQLITE_FAILURE_AFTER_BUSINESS_COMMIT_RECOVERY_PASSED')
console.log('REAL_PAID_RETURN_FINANCIAL_STORNO_EXACTLY_ONCE_PASSED')
