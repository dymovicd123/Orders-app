import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { previewExchangeCancellationChain } from '../worker/domains/exchange-cancel-chain.ts'

const sql=new DatabaseSync(':memory:')
sql.exec([
 "CREATE TABLE exchanges(id INTEGER PRIMARY KEY,order_id INTEGER,status TEXT,refund_return_id INTEGER,old_order_item_id INTEGER,new_order_item_id INTEGER)",
 "CREATE TABLE exchange_items(id INTEGER PRIMARY KEY,exchange_id INTEGER,order_item_id INTEGER,role TEXT)",
 "CREATE TABLE critical_operations(id INTEGER PRIMARY KEY,operation_type TEXT,target_type TEXT,target_id INTEGER)",
 "CREATE TABLE returns(id INTEGER PRIMARY KEY,order_id INTEGER,status TEXT)",
 "CREATE TABLE return_items(id INTEGER PRIMARY KEY,return_id INTEGER,order_item_id INTEGER)",
 "CREATE TABLE order_items(id INTEGER PRIMARY KEY,order_id INTEGER,quantity INTEGER,unit_price INTEGER)",
 "CREATE TABLE payments(id INTEGER PRIMARY KEY,order_id INTEGER,amount INTEGER)",
 "CREATE TABLE inventory_stock(id INTEGER PRIMARY KEY,variant_id INTEGER,quantity INTEGER,reserved_quantity INTEGER)",
].join(';')+';')
const db={prepare(query){let args=[];return{
 bind(...x){args=x;return this},
 async all(){return {results:sql.prepare(query).all(...args)}},
 async first(){return sql.prepare(query).get(...args)??null},
}}}
const makeExchange=(id,oldItem,newItem,{orderId=42,v2=true,refundId=null}={})=>{
 sql.prepare("INSERT INTO exchanges VALUES(?,?,'completed',?,?,?)").run(id,orderId,refundId,oldItem,newItem)
 sql.prepare("INSERT INTO exchange_items(exchange_id,order_item_id,role) VALUES (?,?,'old')").run(id,oldItem)
 sql.prepare("INSERT INTO exchange_items(exchange_id,order_item_id,role) VALUES (?,?,'new')").run(id,newItem)
 if(v2)sql.prepare("INSERT INTO critical_operations(operation_type,target_type,target_id) VALUES('exchange_set_create','exchange',?)").run(id)
}
const ret=(id,itemId,orderId=42)=>{
 sql.prepare("INSERT INTO returns VALUES(?,?,'completed')").run(id,orderId)
 sql.prepare("INSERT INTO return_items(return_id,order_item_id) VALUES(?,?)").run(id,itemId)
}
sql.exec("INSERT INTO order_items VALUES(10,42,0,12000)")
sql.exec("INSERT INTO payments VALUES(1,42,35000)")
sql.exec("INSERT INTO inventory_stock VALUES(1,240,4,2)")
makeExchange(100,1,10)
makeExchange(200,10,20)
makeExchange(300,20,30)
ret(400,30)
ret(900,99) // unrelated return must never appear in dependency plan
const base=await previewExchangeCancellationChain(db,42,100)
assert.deepEqual(base.steps.map(x=>x.type+':'+x.id),['return:400','exchange:300','exchange:200','exchange:100'])
assert.deepEqual(base.steps.map(x=>x.order),[1,2,3,4])
assert.equal(base.blockedByLaterOperations,true)
assert.equal(base.canAttemptCancelNow,false)
assert.equal(base.manualReviewRequired,false)
assert.equal((await previewExchangeCancellationChain(db,42,200)).steps.length,3)
assert.deepEqual((await previewExchangeCancellationChain(db,42,300)).steps.map(x=>x.id),[400,300])
const leaf=await previewExchangeCancellationChain(db,42,300)
assert.equal(leaf.canAttemptCancelNow,false)
sql.exec("UPDATE returns SET status='cancelled' WHERE id=400")
assert.deepEqual((await previewExchangeCancellationChain(db,42,100)).steps.map(x=>x.id),[300,200,100])
assert.equal((await previewExchangeCancellationChain(db,42,300)).canAttemptCancelNow,true)
sql.exec("UPDATE exchanges SET status='cancelled' WHERE id=300")
assert.deepEqual((await previewExchangeCancellationChain(db,42,100)).steps.map(x=>x.id),[200,100])
sql.exec("UPDATE exchanges SET status='cancelled' WHERE id=200")
assert.equal((await previewExchangeCancellationChain(db,42,100)).canAttemptCancelNow,true)
sql.exec("UPDATE exchanges SET status='completed' WHERE id=200")
sql.exec("DELETE FROM critical_operations WHERE operation_type='exchange_set_create' AND target_id=200")
const legacy=await previewExchangeCancellationChain(db,42,100)
assert.equal(legacy.manualReviewRequired,true)
assert.equal(legacy.steps.find(x=>x.id===200).requiresManualReview,true)
assert.equal(legacy.canAttemptCancelNow,false)
makeExchange(700,70,71,{orderId:999})
ret(701,71,999)
assert.deepEqual((await previewExchangeCancellationChain(db,42,100)).steps.map(x=>x.id),[200,100],'Must not mix different order graphs')
await assert.rejects(()=>previewExchangeCancellationChain(db,999,100),/не найден/i)
assert.deepEqual({...sql.prepare('SELECT quantity,reserved_quantity FROM inventory_stock WHERE id=1').get()}, {quantity:4,reserved_quantity:2})
assert.equal(sql.prepare('SELECT amount FROM payments WHERE id=1').get().amount,35000)
assert.equal(sql.prepare("SELECT status FROM exchanges WHERE id=100").get().status,'completed')

sql.exec("UPDATE exchanges SET status='cancelled' WHERE id=200")
makeExchange(110,1100,1110,{refundId:410})
ret(410,1110)
const ownRefund=await previewExchangeCancellationChain(db,42,110)
assert.deepEqual(ownRefund.steps.map(x=>x.id),[110],'Generated exchange refund must not appear as independent cancellation')
// A generated Return mistakenly touching a different exchange new item is not safe to auto-plan.
sql.exec("INSERT INTO return_items(return_id,order_item_id) VALUES(410,10)")
const ambiguous=await previewExchangeCancellationChain(db,42,100)
assert.equal(ambiguous.manualReviewRequired,true,'Cross-exchange refund link must require manual review')
sql.exec("DELETE FROM return_items WHERE return_id=410 AND order_item_id=10")
sql.exec("UPDATE exchanges SET status='completed' WHERE id=200")
makeExchange(500,10,60,{v2:false})
sql.exec("DELETE FROM exchange_items WHERE exchange_id=500")
const legacyFallback=await previewExchangeCancellationChain(db,42,100)
assert(legacyFallback.steps.some(x=>x.type==='exchange'&&x.id===500&&x.requiresManualReview),
  'Later legacy exchange using only exchanges.old_order_item_id must never disappear')
assert.equal(legacyFallback.manualReviewRequired,true)
sql.exec("UPDATE exchanges SET status='cancelled' WHERE id=500")
sql.exec("INSERT INTO exchange_items(exchange_id,order_item_id,role) VALUES(100,20,'old')")
await assert.rejects(()=>previewExchangeCancellationChain(db,42,100),/цикл/i)
sql.close()
console.log('READ_ONLY_EXCHANGE_CHAIN_CANCEL_PLAN_AND_MONEY_STOCK_SAFETY_PASSED')
