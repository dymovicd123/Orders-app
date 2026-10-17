import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { createRealAdminDeleteCancellationDriver } from '../worker/domains/admin-delete-real-driver.ts'
import { criticalOperationFingerprint } from '../worker/domains/critical.ts'

const sql=new DatabaseSync(':memory:')
sql.exec([
 "CREATE TABLE orders(id INTEGER PRIMARY KEY,order_status TEXT,shipping_status TEXT,pricing_mode TEXT,total_amount INTEGER,received_amount INTEGER,return_amount INTEGER,debt_amount INTEGER)",
 "CREATE TABLE order_items(id INTEGER PRIMARY KEY,order_id INTEGER,quantity INTEGER,unit_price INTEGER,line_total INTEGER)",
 "CREATE TABLE exchanges(id INTEGER PRIMARY KEY,order_id INTEGER,status TEXT,financial_action TEXT,financial_amount INTEGER,payment_id INTEGER,refund_return_id INTEGER)",
 "CREATE TABLE returns(id INTEGER PRIMARY KEY,order_id INTEGER,status TEXT,amount INTEGER)",
 "CREATE TABLE payments(id INTEGER PRIMARY KEY,order_id INTEGER,amount INTEGER)",
 "CREATE TABLE inventory_reservations(id INTEGER PRIMARY KEY,order_id INTEGER,status TEXT,inventory_source TEXT,variant_id INTEGER)",
 "CREATE TABLE inventory_stock(id INTEGER PRIMARY KEY,inventory_source TEXT,variant_id INTEGER,quantity INTEGER,reserved_quantity INTEGER)",
 "CREATE TABLE critical_operations(request_id TEXT PRIMARY KEY,operation_type TEXT,status TEXT,response_json TEXT,target_type TEXT,target_id INTEGER,request_fingerprint TEXT)",
 "CREATE TABLE inventory_lifecycle_events(id INTEGER PRIMARY KEY,operation_type TEXT,operation_id INTEGER,order_id INTEGER,status TEXT)",
].join(';')+';')
sql.exec([
 "INSERT INTO orders VALUES(42,'active','not_sent','itemized_v1',20000,0,0,20000)",
 "INSERT INTO order_items VALUES(1,42,1,20000,20000)",
 "INSERT INTO exchanges VALUES(200,42,'completed','none',0,NULL,NULL)",
 "INSERT INTO exchanges VALUES(201,42,'completed','none',0,NULL,NULL)",
 "INSERT INTO returns VALUES(400,42,'completed',0)",
 "INSERT INTO returns VALUES(401,42,'completed',0)",
 "INSERT INTO inventory_reservations VALUES(1,42,'active','shop',10)",
 "INSERT INTO inventory_stock VALUES(1,'shop',10,5,2)",
 "INSERT INTO critical_operations(request_id,operation_type,status,response_json,target_type,target_id) VALUES('creation-200','exchange_set_create','completed','{}','exchange',200)",
].join(';')+';')
const db={prepare(query){let args=[];return{
 bind(...x){args=x;return this},
 async first(){return sql.prepare(query).get(...args)??null},
 async all(){return {results:sql.prepare(query).all(...args)}},
 async run(){return sql.prepare(query).run(...args)}
}}}
const recorded=[]
const actualCounts=new Map()
const mockFinish=async (table,stepKey,opType,id)=>{
 const before=sql.prepare("SELECT status FROM "+table+" WHERE id=?").get(id).status
 if(before!=='cancelled'){
  sql.prepare("UPDATE "+table+" SET status='cancelled' WHERE id=?").run(id)
  actualCounts.set(stepKey,(actualCounts.get(stepKey)||0)+1)
 }
 const comment='Автоматическая отмена зависимой операции перед административным удалением'
 const payload=table==='returns'
   ? {returnId:id,requestId:stepKey,comment}
   : {exchangeId:id,requestId:stepKey,comment}
 const fingerprint=await criticalOperationFingerprint(opType,payload)
 sql.prepare("INSERT OR IGNORE INTO critical_operations(request_id,operation_type,status,response_json,target_type,target_id,request_fingerprint) VALUES(?,?,'completed','{}',?,?,?)")
   .run(stepKey,opType,table==='returns'?'return':'exchange',id,fingerprint)
 return {ok:true}
}
const driver=createRealAdminDeleteCancellationDriver(db,{
 async cancelReturn(_db,id,input){recorded.push(['return',input.requestId]);return mockFinish('returns',input.requestId,'return_cancel',id)},
 async cancelExchangeSetV2(_db,id,input){recorded.push(['exchange',input.requestId]);return mockFinish('exchanges',input.requestId,'exchange_set_cancel',id)}
})
const ret={orderId:42,sagaRequestId:'ADMIN_DEL_REQ_42',cancelRequestId:'ADMIN_DEL_REQ_42:return:400',stepIndex:0,type:'return',id:400}
const ex={orderId:42,sagaRequestId:'ADMIN_DEL_REQ_42',cancelRequestId:'ADMIN_DEL_REQ_42:exchange:200',stepIndex:1,type:'exchange',id:200}
// A physical movement on a different operation within the SAME order also
// blocks this saga, even without a shipping/fulfilled marker. The stocktake
// may already have established a newer physical truth; no handler is invoked.
sql.exec("INSERT INTO inventory_lifecycle_events VALUES(1,'exchange',999,42,'applied')")
const originalStock={...sql.prepare('SELECT quantity,reserved_quantity FROM inventory_stock WHERE id=1').get()}
const originalRecorded=recorded.length
await assert.rejects(()=>driver.preflight(ret),/проведённые физические складские движения/)
await assert.rejects(()=>driver.preflight(ex),/проведённые физические складские движения/)
assert.equal(recorded.length,originalRecorded)
assert.deepEqual({...sql.prepare('SELECT quantity,reserved_quantity FROM inventory_stock WHERE id=1').get()},originalStock)
assert.equal(sql.prepare("SELECT status FROM returns WHERE id=400").get().status,'completed')
assert.equal(sql.prepare("SELECT status FROM exchanges WHERE id=200").get().status,'completed')
sql.exec("DELETE FROM inventory_lifecycle_events WHERE id=1")
await driver.preflight(ret)
await driver.cancel(ret)
assert.equal(await driver.verifyReconciled(ret),true)
await driver.preflight(ret)
await driver.cancel(ret)
assert.equal(await driver.verifyReconciled(ret),true)
assert.equal(actualCounts.get(ret.cancelRequestId),1,'Exactly-once Return physical status effect')
await driver.preflight(ex)
await driver.cancel(ex)
assert.equal(await driver.verifyReconciled(ex),true)
await driver.preflight(ex)
await driver.cancel(ex)
assert.equal(actualCounts.get(ex.cancelRequestId),1,'Exactly-once V2 physical status effect')
assert.deepEqual(recorded,[['return',ret.cancelRequestId],['return',ret.cancelRequestId],['exchange',ex.cancelRequestId],['exchange',ex.cancelRequestId]])
assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM payments').get().n,0)

// Matching request ID and operation type are insufficient for replay ownership.
sql.prepare("UPDATE critical_operations SET request_fingerprint='spoofed' WHERE request_id=?").run(ret.cancelRequestId)
await assert.rejects(()=>driver.preflight(ret),/Ключ отмены связан с другим запросом/)
await assert.rejects(()=>driver.verifyReconciled(ret),/Ключ отмены связан с другим запросом/)
sql.prepare("UPDATE critical_operations SET request_fingerprint=? WHERE request_id=?").run(
 await criticalOperationFingerprint('return_cancel',{
   returnId:ret.id,requestId:ret.cancelRequestId,
   comment:'Автоматическая отмена зависимой операции перед административным удалением',
 }),ret.cancelRequestId)
sql.prepare("UPDATE critical_operations SET target_id=999 WHERE request_id=?").run(ex.cancelRequestId)
await assert.rejects(()=>driver.preflight(ex),/Ключ отмены связан с другим запросом/)
await assert.rejects(()=>driver.verifyReconciled(ex),/Ключ отмены связан с другим запросом/)
sql.prepare("UPDATE critical_operations SET target_id=? WHERE request_id=?").run(ex.id,ex.cancelRequestId)
assert.equal(await driver.verifyReconciled(ex),true)
assert.deepEqual({...sql.prepare('SELECT quantity,reserved_quantity FROM inventory_stock WHERE id=1').get()},
 {quantity:5,reserved_quantity:2})

// Cancelled without matching critical record must NOT be treated as our replay.
sql.exec("UPDATE returns SET status='cancelled' WHERE id=401")
await assert.rejects(()=>driver.preflight({...ret,id:401,cancelRequestId:'orphan-cancel-key'}),/уже отменена вручную/)

// Legacy Exchange must be blocked even though it exists and has no cash.
await assert.rejects(()=>driver.preflight({...ex,id:201,cancelRequestId:'legacy-201'}),/старого формата/)
// Payment field on an exchange is a cash movement even if payments is empty.
sql.exec("UPDATE exchanges SET financial_action='extra_payment',financial_amount=5000 WHERE id=201")
await assert.rejects(()=>driver.preflight({...ex,id:201,cancelRequestId:'financial-exchange'}),/старого формата|денежн/)
sql.exec("UPDATE exchanges SET status='cancelled' WHERE id=201")
await assert.rejects(()=>driver.preflight({...ex,id:200}),/денежн|сторно/,
 'Cancelled Exchange with previous financial action remains blocked')
sql.exec("UPDATE exchanges SET status='completed',financial_action='none',financial_amount=0 WHERE id=201")
sql.exec("INSERT INTO returns VALUES(501,42,'completed',1000)")
await assert.rejects(()=>driver.preflight({...ex,id:200}),/денежн/)
sql.exec("UPDATE returns SET status='cancelled' WHERE id=501")
await assert.rejects(()=>driver.preflight({...ex,id:200}),/денежн|сторно/,
 'Historical cancelled money Return must remain a blocker until audited')
sql.exec("UPDATE returns SET amount=0 WHERE id=501") // revert only the isolated test fixture
sql.exec("INSERT INTO payments VALUES(1,42,1000)")
await assert.rejects(()=>driver.preflight({...ex,id:200}),/денежн/)
sql.exec("DELETE FROM payments")
sql.exec("INSERT INTO exchanges VALUES(203,42,'completed','none',0,NULL,400)")
sql.exec("INSERT INTO critical_operations(request_id,operation_type,status,response_json,target_type,target_id) VALUES('creation-203','exchange_set_create','completed','{}','exchange',203)")
await assert.rejects(()=>driver.preflight({...ret,id:400,cancelRequestId:ret.cancelRequestId}),/принадлежит обмену/)
sql.exec("UPDATE exchanges SET status='cancelled' WHERE id=203")
sql.exec("UPDATE orders SET shipping_status='sent' WHERE id=42")
await assert.rejects(()=>driver.preflight(ex),/отправлен/)
sql.exec("UPDATE orders SET shipping_status='not_sent' WHERE id=42")
sql.exec("UPDATE inventory_reservations SET status='fulfilled' WHERE id=1")
await assert.rejects(()=>driver.preflight(ex),/выдачу/)
sql.exec("UPDATE inventory_reservations SET status='active' WHERE id=1")

// The verifier must detect real status/line-total/ledger/stock drift and
// reject the saga cursor, not silently declare a safe cancellation.
sql.exec("UPDATE order_items SET line_total=22000 WHERE id=1")
await assert.rejects(()=>driver.verifyReconciled(ex),/Суммы/)
sql.exec("UPDATE order_items SET line_total=20000 WHERE id=1")
sql.exec("UPDATE inventory_stock SET reserved_quantity=-1 WHERE id=1")
await assert.rejects(()=>driver.verifyReconciled(ex),/ниже нуля/)
sql.exec("UPDATE inventory_stock SET reserved_quantity=2 WHERE id=1")
sql.exec("UPDATE orders SET debt_amount=1 WHERE id=42")
await assert.rejects(()=>driver.verifyReconciled(ex),/Финансовый баланс/)
sql.exec("UPDATE orders SET debt_amount=20000 WHERE id=42")
assert.equal(await driver.verifyReconciled(ex),true)

// Positive order totals can mask internally inconsistent order item prices.
// Equal and opposite line errors must not pass reconciliation.
sql.exec("INSERT INTO order_items VALUES(2,42,1,5000,5000)")
sql.exec("UPDATE orders SET total_amount=25000,debt_amount=25000 WHERE id=42")
sql.exec("UPDATE order_items SET line_total=21000 WHERE id=1")
sql.exec("UPDATE order_items SET line_total=4000 WHERE id=2")
await assert.rejects(()=>driver.verifyReconciled(ex),/Суммы/)
sql.exec("UPDATE order_items SET line_total=20000 WHERE id=1")
sql.exec("UPDATE order_items SET line_total=5000 WHERE id=2")
assert.equal(await driver.verifyReconciled(ex),true)

// An inventory event still applied after handler completion is NOT safe.
sql.exec("INSERT INTO inventory_lifecycle_events VALUES(10,'exchange',200,42,'applied')")
await assert.rejects(()=>driver.verifyReconciled(ex),/проведённые физические складские движения|применённые складские движения/)
sql.exec("UPDATE inventory_lifecycle_events SET status='cancelled' WHERE id=10")
assert.equal(await driver.verifyReconciled(ex),true)
// A sibling operation can turn physical during the same saga step. It must
// not silently pass an otherwise valid completed Exchange checkpoint.
sql.exec("INSERT INTO inventory_lifecycle_events VALUES(11,'return',999,42,'applied')")
await assert.rejects(()=>driver.verifyReconciled(ex),/проведённые физические складские движения/)
sql.exec("UPDATE inventory_lifecycle_events SET status='cancelled' WHERE id=11")
assert.equal(await driver.verifyReconciled(ex),true)

// Source-level assertion ensures only the genuine production handlers are
// named; caller is deliberately NOT wired to Worker routes.
const adapter=readFileSync('worker/domains/admin-delete-real-driver.ts','utf8')
const worker=readFileSync('worker/index.ts','utf8')
assert(adapter.includes("cancelReturn, cancelExchangeSetV2, isExchangeSetV2"))
assert(adapter.includes("h.cancelExchangeSetV2(db,step.id,{requestId:step.cancelRequestId,comment})"))
assert(!adapter.includes('cancelExchange(db,step.id'),'Legacy unsafe cancellation must not be used')
assert(!worker.includes('createRealAdminDeleteCancellationDriver'),'Do not wire unproven real handler chain to HTTP yet')
sql.close()
console.log('REAL_V2_CANCEL_ADAPTER_PRECHECKS_POSTCHECKS_IDEMPOTENCY_AND_MONEY_STOCK_BLOCKS_PASSED')
