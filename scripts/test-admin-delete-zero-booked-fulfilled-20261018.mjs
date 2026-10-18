// Reproduce the *observed* Branch2 order #3 / Exchange #3 / lifecycle #8
// on isolated SQLite. The customer was not handed the replacement, but the
// old Exchange writer marked its reservation fulfilled while booking a ZERO
// sale delta. No production or Branch2 D1 business data is mutated.
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {readFileSync} from 'node:fs'
import {reviewAdminDeleteAppliedStock} from '../worker/domains/admin-delete-physical.ts'
import {cancelInventoryLifecycleEvent} from '../worker/domains/lifecycle.ts'

const sql=new DatabaseSync(':memory:')
sql.exec([
  'CREATE TABLE inventory_lifecycle_events(id INTEGER PRIMARY KEY,order_id INTEGER,order_item_id INTEGER,operation_id INTEGER,operation_type TEXT,event_type TEXT,direction TEXT,status TEXT,quantity INTEGER,variant_id INTEGER,inventory_source TEXT,movement_id INTEGER,applied_at TEXT,created_at TEXT,operation_item_id INTEGER)',
  'CREATE TABLE inventory_movements(id INTEGER PRIMARY KEY,variant_id INTEGER,inventory_source TEXT,quantity_delta INTEGER,quantity_after INTEGER,movement_type TEXT,reference_type TEXT,reference_id TEXT,created_at TEXT)',
  'CREATE TABLE orders(id INTEGER PRIMARY KEY,external_id TEXT)',
  'CREATE TABLE order_items(id INTEGER PRIMARY KEY,order_id INTEGER,quantity INTEGER,stock_writeoff_status TEXT)',
  'CREATE TABLE inventory_reservations(id INTEGER PRIMARY KEY,order_id INTEGER,order_item_id INTEGER,quantity INTEGER,variant_id INTEGER,inventory_source TEXT,status TEXT,fulfilled_at TEXT)',
  'CREATE TABLE exchanges(id INTEGER PRIMARY KEY,order_id INTEGER,status TEXT)',
  'CREATE TABLE exchange_items(id INTEGER PRIMARY KEY,exchange_id INTEGER,role TEXT,product_name_snapshot TEXT,quantity INTEGER,physical_tracking INTEGER,physical_received_at TEXT)',
  'CREATE TABLE inventory_stock_checks(id INTEGER PRIMARY KEY,inventory_source TEXT,variant_id INTEGER,checked_at TEXT)',
  'CREATE TABLE inventory_stocktake_sessions(id TEXT PRIMARY KEY,inventory_source TEXT,status TEXT,started_at TEXT)',
  'CREATE TABLE catalog_products(id INTEGER PRIMARY KEY,is_active INTEGER)',
  'CREATE TABLE catalog_variants(id INTEGER PRIMARY KEY,product_id INTEGER,is_active INTEGER)',
  'CREATE TABLE inventory_stock(id INTEGER PRIMARY KEY,inventory_source TEXT,variant_id INTEGER,quantity INTEGER,reserved_quantity INTEGER)',
].join(';')+';')
sql.exec([
  "INSERT INTO orders VALUES(3,'ORDER_TEST_3')",
  "INSERT INTO catalog_products VALUES(1,1)",
  "INSERT INTO catalog_variants VALUES(1336,1,1)",
  "INSERT INTO exchanges VALUES(3,3,'completed')",
  "INSERT INTO exchange_items VALUES(6,3,'new','АБАЙ ТАКИЯ',1,0,NULL)",
  "INSERT INTO order_items VALUES(16,3,1,'fulfilled')",
  "INSERT INTO inventory_reservations VALUES(14,3,16,1,1336,'warehouse','fulfilled','2026-10-18T06:49:17.647Z')",
  "INSERT INTO inventory_stock VALUES(10,'warehouse',1336,0,0)",
  "INSERT INTO inventory_movements VALUES(14,1336,'warehouse',0,0,'sale','exchange_new','3','2026-10-18T06:49:17.647Z')",
  "INSERT INTO inventory_lifecycle_events(id,order_id,order_item_id,operation_id,operation_type,event_type,direction,status,quantity,variant_id,inventory_source,movement_id,applied_at,created_at,operation_item_id) VALUES(8,3,16,3,'exchange','exchange_new_out','out','applied',1,1336,'warehouse',14,'2026-10-18T06:49:17.647Z','2026-10-18T06:49:17.647Z',6)",
].join(';')+';')
let writes=0
const db={prepare(query){return {params:[],bind(...args){this.params=args;return this},
  async first(){return sql.prepare(query).get(...this.params)||null},
  async all(){return {results:sql.prepare(query).all(...this.params)}},
  async run(){writes++;throw Error('Preview must never write')},
}}}
const pass=async()=>{
  const r=await reviewAdminDeleteAppliedStock(db,3)
  assert.equal(r.allowed,true,JSON.stringify(r.blockers))
  assert.equal(r.appliedCount,1)
  assert.equal(r.bookkeepingFulfilledCount,1)
  assert.equal(r.reversals.length,1)
  assert.equal(r.reversals[0].bookkeepingFulfillmentOnly,true)
  assert.equal(r.reversals[0].recordedOutbound,0)
  assert.equal(r.reversals[0].physicalRestore,0)
  assert.equal(r.reversals[0].reserveRelease,0)
  assert.equal(writes,0)
}
const reject=async(change,reset,label)=>{
  sql.exec(change)
  const r=await reviewAdminDeleteAppliedStock(db,3)
  assert.equal(r.allowed,false,'Unsafe zero-debit history should reject '+label)
  assert.equal(r.reversals.length,0)
  sql.exec(reset)
  await pass()
}
await pass()
await reject("UPDATE inventory_reservations SET status='active' WHERE id=14",
  "UPDATE inventory_reservations SET status='fulfilled' WHERE id=14",'not a fulfilled booking')
await reject("UPDATE inventory_reservations SET fulfilled_at=NULL WHERE id=14",
  "UPDATE inventory_reservations SET fulfilled_at='2026-10-18T06:49:17.647Z' WHERE id=14",'missing fulfillment timestamp')
await reject("UPDATE inventory_movements SET quantity_delta=-1 WHERE id=14",
  "UPDATE inventory_movements SET quantity_delta=0 WHERE id=14",'not really zero')
await reject("UPDATE inventory_movements SET reference_id='other' WHERE id=14",
  "UPDATE inventory_movements SET reference_id='3' WHERE id=14",'foreign movement')
await reject("UPDATE inventory_stock SET quantity=1 WHERE id=10",
  "UPDATE inventory_stock SET quantity=0 WHERE id=10",'changed stock')
await reject("UPDATE inventory_stock SET reserved_quantity=1 WHERE id=10",
  "UPDATE inventory_stock SET reserved_quantity=0 WHERE id=10",'other active reservation')
await reject("INSERT INTO inventory_movements VALUES(15,1336,'warehouse',1,1,'arrival','arrival','other','2026-10-18T06:50:00Z')",
  "DELETE FROM inventory_movements WHERE id=15",'later movement')
await reject("INSERT INTO inventory_stock_checks VALUES(1,'warehouse',1336,'2026-10-18T07:00:00Z')",
  "DELETE FROM inventory_stock_checks WHERE id=1",'later physical check')
await reject("INSERT INTO inventory_stocktake_sessions VALUES('rev','warehouse','active','2026-10-18T07:00:00Z')",
  "DELETE FROM inventory_stocktake_sessions WHERE id='rev'",'active stocktake')
await reject("UPDATE exchange_items SET physical_tracking=1 WHERE id=6",
  "UPDATE exchange_items SET physical_tracking=0 WHERE id=6",'physical inbound mark')
await reject("UPDATE order_items SET stock_writeoff_status='reserved' WHERE id=16",
  "UPDATE order_items SET stock_writeoff_status='fulfilled' WHERE id=16",'different writeoff state')
await reject("UPDATE catalog_variants SET is_active=0 WHERE id=1336",
  "UPDATE catalog_variants SET is_active=1 WHERE id=1336",'retired SKU')
await reject("UPDATE inventory_lifecycle_events SET movement_id=NULL WHERE id=8",
  "UPDATE inventory_lifecycle_events SET movement_id=14 WHERE id=8",'no source movement')
const finalStock=sql.prepare('SELECT quantity,reserved_quantity FROM inventory_stock WHERE id=10').get()
assert.equal(finalStock.quantity,0)
assert.equal(finalStock.reserved_quantity,0)
assert.equal(writes,0)
sql.close()
const preview=readFileSync('worker/domains/order-delete-preview.ts','utf8')
const saga=readFileSync('worker/domains/admin-delete-saga.ts','utf8')
const driver=readFileSync('worker/domains/admin-delete-real-driver.ts','utf8')
const lifecycle=readFileSync('worker/domains/lifecycle.ts','utf8')
assert(preview.includes('appliedStockReview.bookkeepingFulfilledCount')&&preview.includes('bookedOnlyFulfilled'))
assert(saga.includes("preview.appliedStockReview.appliedCount>0)")&&saga.includes("physicalOutcome!=='not_issued'"),
  'Admin consent for zero-booked Exchange must still be mandatory before any cancellation')
assert(driver.includes('fulfilledCount!==review.bookkeepingFulfilledCount'),
  'Any unrelated/real fulfilled handover must stay blocked')
assert(lifecycle.includes('Math.max(0, -Math.min(0, toInt(originalMovement?.quantity_delta, 0)))'),
  'Established V2 cancellation must use the actual ZERO delta, never nominal quantity')
console.log('BRANCH2_EVENT8_ZERO_BOOKED_FULFILLED_CONSENTED_DELETE_PROOF_PASSED')


// Execute the *real* lifecycle cancellation handler against an isolated
// zero-stock fulfilled Exchange with an actual movement of zero. It must never
// turn a bookkeeping-only event into phantom physical inventory.
const stepDb=new DatabaseSync(':memory:')
stepDb.exec([
"CREATE TABLE orders(id INTEGER PRIMARY KEY,external_id TEXT)",
"CREATE TABLE catalog_products(id INTEGER PRIMARY KEY,name TEXT,category TEXT,is_active INTEGER)",
"CREATE TABLE catalog_variants(id INTEGER PRIMARY KEY,product_id INTEGER,category TEXT,gender TEXT,color TEXT,material TEXT,length TEXT,size_label TEXT,is_active INTEGER)",
"CREATE TABLE inventory_lifecycle_events(id INTEGER PRIMARY KEY,event_key TEXT,operation_type TEXT,operation_id INTEGER,operation_item_id INTEGER,order_id INTEGER,order_item_id INTEGER,event_type TEXT,direction TEXT,inventory_source TEXT,quantity INTEGER,product_id INTEGER,variant_id INTEGER,status TEXT,movement_id INTEGER,applied_at TEXT,created_at TEXT,cancelled_at TEXT,updated_at TEXT,resolution_comment TEXT,reversal_movement_id INTEGER)",
"CREATE TABLE inventory_movements(id INTEGER PRIMARY KEY,inventory_source TEXT,movement_type TEXT,product_id INTEGER,variant_id INTEGER,product_name_snapshot TEXT,gender_snapshot TEXT,color_snapshot TEXT,material_snapshot TEXT,length_snapshot TEXT,size_snapshot TEXT,quantity_delta INTEGER,quantity_after INTEGER,reference_type TEXT,reference_id TEXT,comment TEXT,created_at TEXT)",
"CREATE TABLE inventory_stock(id INTEGER PRIMARY KEY,inventory_source TEXT,product_id INTEGER,variant_id INTEGER,product_name_snapshot TEXT,gender_snapshot TEXT,color_snapshot TEXT,material_snapshot TEXT,length_snapshot TEXT,size_snapshot TEXT,quantity INTEGER,reserved_quantity INTEGER,last_action TEXT,last_source_ref TEXT,updated_at TEXT)",
"CREATE TABLE inventory_reservations(id INTEGER PRIMARY KEY,order_item_id INTEGER,status TEXT,released_at TEXT,updated_at TEXT)",
"CREATE TABLE inventory_stock_checks(id INTEGER PRIMARY KEY,inventory_source TEXT,variant_id INTEGER,checked_at TEXT)",
"CREATE TABLE inventory_stocktake_sessions(id TEXT PRIMARY KEY,inventory_source TEXT,status TEXT,started_at TEXT)"
].join(';')+';')
stepDb.exec([
"INSERT INTO orders VALUES(3,'ORDER_TEST_3')",
"INSERT INTO catalog_products VALUES(1,'АБАЙ ТАКИЯ','adult',1)",
"INSERT INTO catalog_variants(id,product_id,category,is_active) VALUES(1336,1,'adult',1)",
"INSERT INTO inventory_stock(id,inventory_source,variant_id,quantity,reserved_quantity) VALUES(1,'warehouse',1336,0,0)",
"INSERT INTO inventory_reservations(id,order_item_id,status) VALUES(14,16,'fulfilled')",
"INSERT INTO inventory_movements(id,inventory_source,movement_type,variant_id,quantity_delta,quantity_after,reference_type,reference_id,created_at) VALUES(14,'warehouse','sale',1336,0,0,'exchange_new','3','2026-10-18T06:49:17.647Z')",
"INSERT INTO inventory_lifecycle_events(id,event_key,operation_type,operation_id,operation_item_id,order_id,order_item_id,event_type,direction,inventory_source,quantity,product_id,variant_id,status,movement_id,applied_at,created_at) VALUES(8,'exchange:3:new:6','exchange',3,6,3,16,'exchange_new_out','out','warehouse',1,1,1336,'applied',14,'2026-10-18T06:49:17.647Z','2026-10-18T06:49:17.647Z')"
].join(';')+';')
const statement=(query,params=[])=>({
  query,params,bind(...values){return statement(query,values)},
  async first(){return stepDb.prepare(query).get(...params)??null},
  async all(){return {results:stepDb.prepare(query).all(...params)}},
  async run(){const v=stepDb.prepare(query).run(...params);return {success:true,meta:{changes:Number(v.changes),last_row_id:Number(v.lastInsertRowid)}}},
  _run(){return stepDb.prepare(query).run(...params)}
})
const stepConn={prepare(query){return statement(query)},async batch(stmts){
  stepDb.exec('BEGIN')
  try{const values=stmts.map(s=>s._run());stepDb.exec('COMMIT');return values}
  catch(err){stepDb.exec('ROLLBACK');throw err}
}}
const cancelled=await cancelInventoryLifecycleEvent(stepConn,8,'2026-10-18T08:15:00.000Z','Администратор подтвердил отсутствие выдачи')
assert.equal(cancelled.cancelled,true)
assert.equal(cancelled.quantityDelta,0,'ZERO movement must only be reversed by ZERO')
assert.equal(stepDb.prepare('SELECT quantity FROM inventory_stock WHERE id=1').get().quantity,0)
assert.equal(stepDb.prepare('SELECT reserved_quantity FROM inventory_stock WHERE id=1').get().reserved_quantity,0)
assert.equal(stepDb.prepare('SELECT status FROM inventory_reservations WHERE id=14').get().status,'released')
assert.equal(stepDb.prepare('SELECT status FROM inventory_lifecycle_events WHERE id=8').get().status,'cancelled')
const afterStep=stepDb.prepare('SELECT id,quantity_delta FROM inventory_movements ORDER BY id').all()
assert.equal(afterStep.length,2)
assert.equal(afterStep[0].quantity_delta,0)
assert.equal(afterStep[1].quantity_delta,0)
const replayZero=await cancelInventoryLifecycleEvent(stepConn,8,'2026-10-18T08:16:00.000Z','retry')
assert.equal(replayZero.already,true)
assert.equal(stepDb.prepare('SELECT COUNT(*) AS n FROM inventory_movements').get().n,2)
assert.equal(stepDb.prepare('SELECT quantity FROM inventory_stock WHERE id=1').get().quantity,0)
stepDb.close()
console.log('REAL_LIFECYCLE_EVENT8_ZERO_DELTA_CANCEL_IDEMPOTENT_NO_PHANTOM_STOCK_PASSED')
