import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { previewAdminOrderDeleteChain } from '../worker/domains/order-delete-chain-plan.ts'
import { previewAdminOrderDeletion } from '../worker/domains/order-delete-preview.ts'

const sql=new DatabaseSync(':memory:')
sql.exec([
 "CREATE TABLE orders(id INTEGER PRIMARY KEY,external_id TEXT,order_status TEXT,shipping_status TEXT,received_amount INTEGER,return_amount INTEGER,total_amount INTEGER)",
 "CREATE TABLE order_items(id INTEGER PRIMARY KEY,order_id INTEGER,quantity INTEGER,unit_price INTEGER,line_total INTEGER)",
 "CREATE TABLE exchanges(id INTEGER PRIMARY KEY,order_id INTEGER,status TEXT,refund_return_id INTEGER,old_order_item_id INTEGER,new_order_item_id INTEGER,financial_amount INTEGER)",
 "CREATE TABLE exchange_items(id INTEGER PRIMARY KEY,exchange_id INTEGER,order_item_id INTEGER,role TEXT)",
 "CREATE TABLE critical_operations(id INTEGER PRIMARY KEY,operation_type TEXT,target_type TEXT,target_id INTEGER)",
 "CREATE TABLE returns(id INTEGER PRIMARY KEY,order_id INTEGER,status TEXT,amount INTEGER)",
 "CREATE TABLE return_items(id INTEGER PRIMARY KEY,return_id INTEGER,order_item_id INTEGER)",
 "CREATE TABLE payments(id INTEGER PRIMARY KEY,order_id INTEGER,amount INTEGER,method TEXT)",
 "CREATE TABLE inventory_reservations(id INTEGER PRIMARY KEY,order_id INTEGER,status TEXT,quantity INTEGER)",
].join(';')+';')
sql.exec("INSERT INTO orders VALUES(42,'ORD-42','active','not_sent',35000,5000,60000)")
sql.exec("INSERT INTO order_items VALUES(1,42,0,10000,0)")
sql.exec("INSERT INTO order_items VALUES(10,42,0,20000,0)")
sql.exec("INSERT INTO order_items VALUES(20,42,0,30000,0)")
sql.exec("INSERT INTO order_items VALUES(30,42,1,60000,60000)")
sql.exec("INSERT INTO payments VALUES(1,42,35000,'Kaspi')")
sql.exec("INSERT INTO inventory_reservations VALUES(1,42,'active',2)")
const ex=(id,oldItem,newItem,refund=null)=>{
  sql.prepare("INSERT INTO exchanges VALUES(?,42,'completed',?,?,?,0)").run(id,refund,oldItem,newItem)
  sql.prepare("INSERT INTO exchange_items(exchange_id,order_item_id,role) VALUES(?,?,'old')").run(id,oldItem)
  sql.prepare("INSERT INTO exchange_items(exchange_id,order_item_id,role) VALUES(?,?,'new')").run(id,newItem)
  sql.prepare("INSERT INTO critical_operations(operation_type,target_type,target_id) VALUES('exchange_set_create','exchange',?)").run(id)
}
const ret=(id,item,amount)=>{
  sql.prepare("INSERT INTO returns VALUES(?,42,'completed',?)").run(id,amount)
  sql.prepare("INSERT INTO return_items(return_id,order_item_id) VALUES(?,?)").run(id,item)
}
ex(100,1,10)
ex(200,10,20,420)
ex(300,20,30)
ret(400,30,5000)
ret(420,1,0) // Exchange's own automatic refund, NOT a standalone step
ret(500,1,1000) // Another standalone Return on original item
const initialPayments=sql.prepare('SELECT amount FROM payments WHERE id=1').get().amount
const initialStatuses=sql.prepare("SELECT COUNT(*) AS n FROM exchanges WHERE status='completed'").get().n
let writeCalls=0
const db={prepare(query){
  assert(/^SELECT\s/i.test(query.trim()),'The plan must only prepare SELECT statements')
  let args=[]
  return {
    bind(...values){args=values;return this},
    async all(){return {results:sql.prepare(query).all(...args)}},
    async first(){return sql.prepare(query).get(...args)??null},
    async run(){writeCalls++;throw Error('No write from the plan')}
  }
}}
const plan=await previewAdminOrderDeleteChain(db,42)
assert.deepEqual(plan.activeExchangeIds,[300,200,100])
assert.deepEqual(plan.activeReturnIds,[500,420,400])
assert.deepEqual(plan.generatedExchangeRefundIds,[420])
assert.equal(plan.allOperationsAccountedFor,true)
assert.equal(plan.manualReviewRequired,false)
assert.equal(plan.canExecuteAutomatically,false)
assert.equal(plan.steps.length,5)
const order=plan.steps.map(x=>x.type+':'+x.id)
assert.equal(order.includes('return:420'),false,'Generated refund must never be independently cancelled')
const index=(key)=>order.indexOf(key)
assert(index('return:400')<index('exchange:300'))
assert(index('exchange:300')<index('exchange:200'))
assert(index('exchange:200')<index('exchange:100'))
assert(order.includes('return:500'),'Standalone Return must be accounted for')
assert.match(plan.snapshotFingerprint,/^[0-9a-f]{64}$/)
assert.equal((await previewAdminOrderDeleteChain(db,42)).snapshotFingerprint,plan.snapshotFingerprint)
let preview=await previewAdminOrderDeletion(db,42)
assert.equal(preview.canAttemptDelete,false)
assert.deepEqual(preview.chainPlan.steps,plan.steps)
assert.equal(preview.registeredPayments,35000)
assert.equal(preview.recordedRefunds,6000)
assert.equal(writeCalls,0)
assert.equal(sql.prepare('SELECT amount FROM payments WHERE id=1').get().amount,initialPayments)
assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM exchanges WHERE status='completed'").get().n,initialStatuses)

sql.exec("UPDATE payments SET amount=36000 WHERE id=1")
const paymentChanged=await previewAdminOrderDeleteChain(db,42)
assert.notEqual(paymentChanged.snapshotFingerprint,plan.snapshotFingerprint,'Actual payment edit must make approval stale')
sql.exec("UPDATE payments SET amount=35000 WHERE id=1")
sql.exec("UPDATE order_items SET unit_price=61000 WHERE id=30")
const priceChanged=await previewAdminOrderDeleteChain(db,42)
assert.notEqual(priceChanged.snapshotFingerprint,plan.snapshotFingerprint,'Item price edit must make approval stale')
sql.exec("UPDATE order_items SET unit_price=60000 WHERE id=30")
sql.exec("UPDATE returns SET amount=7000 WHERE id=400")
const refundChanged=await previewAdminOrderDeleteChain(db,42)
assert.notEqual(refundChanged.snapshotFingerprint,plan.snapshotFingerprint)
sql.exec("UPDATE returns SET amount=5000 WHERE id=400")
sql.exec("UPDATE inventory_reservations SET quantity=3 WHERE id=1")
const stockChanged=await previewAdminOrderDeleteChain(db,42)
assert.notEqual(stockChanged.snapshotFingerprint,plan.snapshotFingerprint,'Reservation drift invalidates snapshot')
sql.exec("UPDATE inventory_reservations SET quantity=2 WHERE id=1")
sql.exec("UPDATE exchanges SET refund_return_id=777 WHERE id=200")
const orphan=await previewAdminOrderDeleteChain(db,42)
assert.equal(orphan.manualReviewRequired,true)
assert(orphan.blockers.some(x=>x.includes('777')))
sql.exec("UPDATE exchanges SET refund_return_id=420 WHERE id=200")
sql.exec("DELETE FROM critical_operations WHERE target_id=200")
const legacy=await previewAdminOrderDeleteChain(db,42)
assert.equal(legacy.manualReviewRequired,true)
assert(legacy.steps.some(x=>x.id===200&&x.requiresManualReview))
assert.equal(legacy.canExecuteAutomatically,false)
sql.exec("UPDATE exchanges SET status='cancelled' WHERE id=300")
const canceled=await previewAdminOrderDeleteChain(db,42)
assert.equal(canceled.activeExchangeIds.length,2)
assert.notEqual(canceled.snapshotFingerprint,plan.snapshotFingerprint)
assert.equal(writeCalls,0)
const deletion=readFileSync('worker/domains/order-delete.ts','utf8')
assert(deletion.includes("expectedSnapshot!==deletionPreview.chainPlan.snapshotFingerprint"))
assert(deletion.indexOf("expectedSnapshot!==deletionPreview.chainPlan.snapshotFingerprint")<deletion.indexOf("const humanInventoryModelEnabled"))
const app=readFileSync('src/App.tsx','utf8')
const table=readFileSync('src/features/sections/OrdersTableSection.tsx','utf8')
assert(app.includes("expectedSnapshot,"))
assert(table.includes('chainPlan?.snapshotFingerprint'),'Impact confirmation must use current chain snapshot')
assert(table.includes('Обмены и возвраты товаров'),'All dependencies must be visible before approval')
sql.close()
console.log('ADMIN_DELETE_COMPLETE_CHAIN_PREVIEW_SNAPSHOT_AND_NO_WRITES_PASSED')
