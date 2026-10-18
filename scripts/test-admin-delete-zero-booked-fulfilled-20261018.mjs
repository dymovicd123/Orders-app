// Reproduce the *observed* Branch2 order #3 / Exchange #3 / lifecycle #8
// on isolated SQLite. The customer was not handed the replacement, but the
// old Exchange writer marked its reservation fulfilled while booking a ZERO
// sale delta. No production or Branch2 D1 business data is mutated.
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {readFileSync} from 'node:fs'
import {reviewAdminDeleteAppliedStock} from '../worker/domains/admin-delete-physical.ts'

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
