import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import {
  planAdminDeleteSaga,advanceAdminDeleteSagaOneStep,getAdminDeleteSagaProgress,
} from '../worker/domains/admin-delete-saga.ts'
import { previewAdminOrderDeleteChain } from '../worker/domains/order-delete-chain-plan.ts'

const sqlite=new DatabaseSync(':memory:')
sqlite.exec([
 "CREATE TABLE orders(id INTEGER PRIMARY KEY,external_id TEXT,order_status TEXT,shipping_status TEXT,received_amount INTEGER,return_amount INTEGER,total_amount INTEGER)",
 "CREATE TABLE order_items(id INTEGER PRIMARY KEY,order_id INTEGER,quantity INTEGER,unit_price INTEGER,line_total INTEGER)",
 "CREATE TABLE exchanges(id INTEGER PRIMARY KEY,order_id INTEGER,status TEXT,refund_return_id INTEGER,old_order_item_id INTEGER,new_order_item_id INTEGER)",
 "CREATE TABLE exchange_items(id INTEGER PRIMARY KEY,exchange_id INTEGER,order_item_id INTEGER,role TEXT)",
 "CREATE TABLE critical_operations(id INTEGER PRIMARY KEY,operation_type TEXT,target_type TEXT,target_id INTEGER)",
 "CREATE TABLE returns(id INTEGER PRIMARY KEY,order_id INTEGER,status TEXT,amount INTEGER)",
 "CREATE TABLE return_items(id INTEGER PRIMARY KEY,return_id INTEGER,order_item_id INTEGER)",
 "CREATE TABLE payments(id INTEGER PRIMARY KEY,order_id INTEGER,amount INTEGER)",
 "CREATE TABLE inventory_reservations(id INTEGER PRIMARY KEY,order_id INTEGER,status TEXT,quantity INTEGER)",
 "CREATE TABLE inventory_stock(id INTEGER PRIMARY KEY,variant_id INTEGER,quantity INTEGER,reserved_quantity INTEGER)",
].join(';')+';')
sqlite.exec(readFileSync('migrations/0111_v72_admin_order_delete_saga_journal.sql','utf8'))
sqlite.exec("INSERT INTO orders VALUES(42,'ORD-42','active','not_sent',0,0,30000)")
for(const [id,qty,price] of [[1,0,10000],[10,0,20000],[20,0,30000],[30,1,30000]])
  sqlite.prepare("INSERT INTO order_items VALUES(?,42,?,?,?)").run(id,qty,price,qty*price)
const ex=(id,oldId,newId)=>{
 sqlite.prepare("INSERT INTO exchanges VALUES(?,42,'completed',NULL,?,?)").run(id,oldId,newId)
 sqlite.prepare("INSERT INTO exchange_items(exchange_id,order_item_id,role) VALUES (?,?,'old')").run(id,oldId)
 sqlite.prepare("INSERT INTO exchange_items(exchange_id,order_item_id,role) VALUES (?,?,'new')").run(id,newId)
 sqlite.prepare("INSERT INTO critical_operations(operation_type,target_type,target_id) VALUES('exchange_set_create','exchange',?)").run(id)
}
ex(100,1,10);ex(200,10,20);ex(300,20,30)
sqlite.exec("INSERT INTO returns VALUES(400,42,'completed',0)")
sqlite.exec("INSERT INTO return_items VALUES(400,30)")
sqlite.exec("INSERT INTO inventory_reservations VALUES(1,42,'active',1)")
sqlite.exec("INSERT INTO inventory_stock VALUES(1,240,4,2)")
const db={
 prepare(statement){let args=[];return{
   bind(...next){args=next;return this},
   async all(){return {results:sqlite.prepare(statement).all(...args)}},
   async first(){return sqlite.prepare(statement).get(...args)??null},
   async run(){const meta=sqlite.prepare(statement).run(...args);return {meta:{changes:meta.changes,last_row_id:meta.lastInsertRowid}}},
   _batch(){if(/^\s*SELECT/i.test(statement))return sqlite.prepare(statement).all(...args);
     return sqlite.prepare(statement).run(...args)}
 }},
 async batch(statements){
   sqlite.exec('BEGIN IMMEDIATE')
   try{
     const result=[]
     for(const st of statements)result.push(st._batch())
     sqlite.exec('COMMIT')
     return result
   }catch(error){sqlite.exec('ROLLBACK');throw error}
 }
}
const plan=await previewAdminOrderDeleteChain(db,42)
assert.deepEqual(plan.steps.map(x=>x.type+':'+x.id),
 ['return:400','exchange:300','exchange:200','exchange:100'])
assert.equal(plan.manualReviewRequired,false)
const requestId='ADMIN_DELETE_E2E_42'
const started=await planAdminDeleteSaga(db,42,requestId,plan.snapshotFingerprint)
assert.equal(started.status,'planned')
assert.equal(started.nextStep,0)
assert.equal(started.totalSteps,4)
assert.equal((await planAdminDeleteSaga(db,42,requestId,plan.snapshotFingerprint)).nextStep,0,'Idempotent plan init')
assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM admin_order_delete_saga_steps').get().n,4)
await assert.rejects(
 ()=>planAdminDeleteSaga(db,42,'ANOTHER_ADMIN_DELETE',plan.snapshotFingerprint),
 /Другая операция удаления/,
 'Per-order active saga lock prevents overlapping admin deletion')
const executed=new Map()
const retryKeys=new Map()
let failAfterCommitKey=null
let rejectPreflightKey=null
let unverifiableKey=null
const driver={
 async preflight(step){
   if(rejectPreflightKey===step.cancelRequestId)throw Error('STALE_CONTEXT_PREFLIGHT')
   const order=sqlite.prepare('SELECT order_status FROM orders WHERE id=42').get()
   assert.equal(order.order_status,'active')
   const stillActive=sqlite.prepare(
     step.type==='exchange'?'SELECT status FROM exchanges WHERE id=? AND order_id=42':
       'SELECT status FROM returns WHERE id=? AND order_id=42'
   ).get(step.id)
   assert(stillActive)
 },
 async cancel(step){
   assert.equal(step.cancelRequestId,
     requestId+':'+step.type+':'+step.id,'Retry request ID MUST be stable')
   const key=step.cancelRequestId
   const prior=retryKeys.get(key)||0
   retryKeys.set(key,prior+1)
   const tbl=step.type==='exchange'?'exchanges':'returns'
   const row=sqlite.prepare('SELECT status FROM '+tbl+' WHERE id=? AND order_id=42').get(step.id)
   if(row.status!=='cancelled'){
      const count=executed.get(key)||0
      executed.set(key,count+1)
      sqlite.prepare("UPDATE "+tbl+" SET status='cancelled' WHERE id=?").run(step.id)
   }
   if(failAfterCommitKey===key){failAfterCommitKey=null;throw Error('SIMULATED_CRASH_AFTER_BUSINESS_COMMIT')}
   return {ok:true,key}
 },
 async verifyReconciled(step){
   if(unverifiableKey===step.cancelRequestId)return false
   const tbl=step.type==='exchange'?'exchanges':'returns'
   const status=sqlite.prepare('SELECT status FROM '+tbl+' WHERE id=? AND order_id=42').get(step.id)
   const stock=sqlite.prepare('SELECT quantity,reserved_quantity FROM inventory_stock WHERE id=1').get()
   return status?.status==='cancelled' && stock.quantity===4 && stock.reserved_quantity===2
     && sqlite.prepare('SELECT COUNT(*) AS n FROM payments').get().n===0
 }
}
// Race: another Worker holding the lease prevents any business action.
sqlite.prepare("UPDATE admin_order_delete_sagas SET lease_token='other-runner',lease_until_ms=? WHERE request_id=?")
 .run(Date.now()+50000,requestId)
await assert.rejects(()=>advanceAdminDeleteSagaOneStep(db,requestId,driver),/Другая отмена/)
assert.equal(retryKeys.size,0)
sqlite.prepare("UPDATE admin_order_delete_sagas SET lease_token=NULL,lease_until_ms=0 WHERE request_id=?").run(requestId)

// Fault before changing business records: stays on step 0 and can retry.
rejectPreflightKey=requestId+':return:400'
await assert.rejects(()=>advanceAdminDeleteSagaOneStep(db,requestId,driver),/STALE_CONTEXT_PREFLIGHT/)
let progress=await getAdminDeleteSagaProgress(db,requestId)
assert.equal(progress.nextStep,0)
assert.equal(sqlite.prepare('SELECT status FROM returns WHERE id=400').get().status,'completed')
rejectPreflightKey=null
progress=await advanceAdminDeleteSagaOneStep(db,requestId,driver)
assert.equal(progress.nextStep,1)
assert.equal(sqlite.prepare('SELECT status FROM returns WHERE id=400').get().status,'cancelled')

// Simulated Worker death AFTER business action but BEFORE checkpoint.
// Persisted step remains 'started'; exactly the same cancel ID is retried.
failAfterCommitKey=requestId+':exchange:300'
await assert.rejects(()=>advanceAdminDeleteSagaOneStep(db,requestId,driver),/SIMULATED_CRASH_AFTER_BUSINESS_COMMIT/)
progress=await getAdminDeleteSagaProgress(db,requestId)
assert.equal(progress.nextStep,1)
assert.equal(sqlite.prepare("SELECT status FROM admin_order_delete_saga_steps WHERE step_index=1").get().status,'started')
assert.equal(sqlite.prepare("SELECT status FROM exchanges WHERE id=300").get().status,'cancelled')
progress=await advanceAdminDeleteSagaOneStep(db,requestId,driver)
assert.equal(progress.nextStep,2)
assert.equal(executed.get(requestId+':exchange:300'),1,'No double execution on retry')
assert.equal(retryKeys.get(requestId+':exchange:300'),2,'Same exact idempotency key retried')

// Simulated business handler returned but reconciliation FAILED.
unverifiableKey=requestId+':exchange:200'
await assert.rejects(()=>advanceAdminDeleteSagaOneStep(db,requestId,driver),/сверку/)
progress=await getAdminDeleteSagaProgress(db,requestId)
assert.equal(progress.nextStep,2)
assert.equal(sqlite.prepare("SELECT status FROM admin_order_delete_saga_steps WHERE step_index=2").get().status,'started')
unverifiableKey=null
progress=await advanceAdminDeleteSagaOneStep(db,requestId,driver)
assert.equal(progress.nextStep,3)
assert.equal(executed.get(requestId+':exchange:200'),1)
progress=await advanceAdminDeleteSagaOneStep(db,requestId,driver)
assert.equal(progress.nextStep,4)
assert.equal(progress.status,'ready_for_final_delete')
assert.equal(progress.remaining.length,0)
assert.equal((await advanceAdminDeleteSagaOneStep(db,requestId,driver)).nextStep,4)
assert.equal(retryKeys.get(requestId+':exchange:100'),1)
assert.equal([...executed.values()].reduce((a,b)=>a+b,0),4)
assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM admin_order_delete_saga_steps WHERE status="completed"').get().n,4)
assert.equal(sqlite.prepare('SELECT order_status FROM orders WHERE id=42').get().order_status,'active',
  'Saga must NEVER automatically delete the order itself')
assert.deepEqual({...sqlite.prepare('SELECT quantity,reserved_quantity FROM inventory_stock WHERE id=1').get()},
  {quantity:4,reserved_quantity:2},'No money or warehouse changes in simulator')
await assert.rejects(
  ()=>planAdminDeleteSaga(db,42,requestId,'0'.repeat(64)),/ключ уже принадлежит/,
  'An existing saga cannot be replaced with a different preview')

const ts=readFileSync('worker/domains/admin-delete-saga.ts','utf8')
const worker=readFileSync('worker/index.ts','utf8')
assert(!worker.includes('advanceAdminDeleteSagaOneStep('),'Never expose incomplete actual-money saga through HTTP router')
assert(ts.includes('await driver.preflight(step)'))
assert(ts.includes('await driver.verifyReconciled(step)'))
assert(ts.includes('SELECT json(\\'ADMIN_DELETE_SAGA_STALE\\')'))
sqlite.close()
console.log('ADMIN_ORDER_DELETE_DURABLE_ONE_STEP_SAGA_FAULT_INJECTION_RETRIES_AND_INVENTORY_SAFETY_PASSED')
