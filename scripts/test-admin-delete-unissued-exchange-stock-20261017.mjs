// Real SQLite proof of the narrow non-issued but physically booked Exchange case.
// Specifically reproduces Branch2 exchange #2's shape WITHOUT touching its records.
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { reviewAdminDeleteAppliedStock } from '../worker/domains/admin-delete-physical.ts'

const sql=new DatabaseSync(':memory:')
sql.exec(`
CREATE TABLE inventory_lifecycle_events(id INTEGER PRIMARY KEY,order_id INTEGER,order_item_id INTEGER,
  operation_id INTEGER,operation_type TEXT,event_type TEXT,direction TEXT,status TEXT,
  quantity INTEGER,variant_id INTEGER,inventory_source TEXT,movement_id INTEGER,
  applied_at TEXT,created_at TEXT,operation_item_id INTEGER);
CREATE TABLE inventory_movements(id INTEGER PRIMARY KEY,variant_id INTEGER,inventory_source TEXT,quantity_delta INTEGER,quantity_after INTEGER,movement_type TEXT,reference_type TEXT,reference_id TEXT,created_at TEXT);
CREATE TABLE orders(id INTEGER PRIMARY KEY,external_id TEXT);
CREATE TABLE order_items(id INTEGER PRIMARY KEY,order_id INTEGER,quantity INTEGER,stock_writeoff_status TEXT);
CREATE TABLE inventory_reservations(id INTEGER PRIMARY KEY,order_id INTEGER,order_item_id INTEGER,
  quantity INTEGER,variant_id INTEGER,inventory_source TEXT,status TEXT,fulfilled_at TEXT);
CREATE TABLE exchanges(id INTEGER PRIMARY KEY,order_id INTEGER,status TEXT);
CREATE TABLE exchange_items(id INTEGER PRIMARY KEY,exchange_id INTEGER,role TEXT,
  product_name_snapshot TEXT,quantity INTEGER,physical_tracking INTEGER,physical_received_at TEXT);
CREATE TABLE inventory_stock_checks(id INTEGER PRIMARY KEY,inventory_source TEXT,variant_id INTEGER,checked_at TEXT);
CREATE TABLE inventory_stocktake_sessions(id TEXT PRIMARY KEY,inventory_source TEXT,status TEXT,started_at TEXT);
CREATE TABLE catalog_products(id INTEGER PRIMARY KEY,is_active INTEGER);
CREATE TABLE catalog_variants(id INTEGER PRIMARY KEY,product_id INTEGER,is_active INTEGER);
CREATE TABLE inventory_stock(id INTEGER PRIMARY KEY,inventory_source TEXT,variant_id INTEGER,
  quantity INTEGER,reserved_quantity INTEGER);
INSERT INTO orders VALUES(9,'ORDER_TEST_9');
INSERT INTO catalog_products VALUES(1,1);
INSERT INTO catalog_variants VALUES(1465,1,1);
INSERT INTO exchanges VALUES(2,9,'completed');
INSERT INTO exchange_items VALUES(8,2,'new','АБАЙ ШАПАН',1,0,NULL);
INSERT INTO order_items VALUES(15,9,1,'reserved');
INSERT INTO inventory_reservations VALUES(13,9,15,1,1465,'warehouse','active',NULL);
INSERT INTO inventory_stock VALUES(10,'warehouse',1465,60,1);
INSERT INTO inventory_movements VALUES(12,1465,'warehouse',-1,59,'sale','exchange_new','2','2026-10-14T14:46:43.892Z');
INSERT INTO inventory_movements VALUES(13,1465,'warehouse',1,60,'revision','order_handover_correction','ORDER_TEST_9','2026-10-14T14:47:13.361Z');
INSERT INTO inventory_lifecycle_events
  (id,order_id,order_item_id,operation_id,operation_type,event_type,
   direction,status,quantity,variant_id,inventory_source,movement_id,
   applied_at,created_at,operation_item_id)
VALUES (7,9,15,2,'exchange','exchange_new_out','out','applied',1,1465,
  'warehouse',12,'2026-10-14T14:46:43.892Z','2026-10-14T14:46:43.892Z',8);
`)
let writes=0
const db={prepare(query){
  const statement={_params:[],
    bind(...args){this._params=args;return this},
    async first(){return sql.prepare(query).get(...this._params)||null},
    async all(){return {results:sql.prepare(query).all(...this._params)}},
    async run(){writes++;throw Error('Not a read-only preview')}
  }
  return statement
}}
const orig=sql.prepare('SELECT quantity,reserved_quantity FROM inventory_stock WHERE id=10').get()
const expected={
  eventId:7,exchangeId:2,orderItemId:15,name:'АБАЙ ШАПАН',
  source:'warehouse',variantId:1465,quantity:1,
  recordedOutbound:-1,physicalRestore:0,reserveRelease:1,
  alreadyCompensated:true,correctionMovementId:13,
}
async function pass(){
  const review=await reviewAdminDeleteAppliedStock(db,9)
  assert.equal(review.allowed,true,JSON.stringify(review.blockers))
  assert.equal(review.appliedCount,1)
  assert.deepEqual(review.reversals,[expected])
  assert.equal(writes,0)
}
async function reject(sqlChange,sqlRestore,tag){
  sql.exec(sqlChange)
  const r=await reviewAdminDeleteAppliedStock(db,9)
  assert.equal(r.allowed,false,'Should reject unsafe '+tag)
  assert.equal(r.appliedCount,1)
  assert.equal(r.reversals.length,0)
  sql.exec(sqlRestore)
  await pass()
}
await pass()
// When the original debit has never been offset, exactly one genuine
// reversal is permitted; never duplicate an already corrected stock count.
sql.exec("DELETE FROM inventory_movements WHERE id=13; UPDATE inventory_stock SET quantity=59 WHERE id=10")
const uncorrected=await reviewAdminDeleteAppliedStock(db,9)
assert.equal(uncorrected.allowed,true)
assert.deepEqual(uncorrected.reversals,[{...expected,physicalRestore:1,alreadyCompensated:false,correctionMovementId:null}])
sql.exec("UPDATE inventory_stock SET quantity=60 WHERE id=10")
sql.exec("INSERT INTO inventory_movements VALUES(13,1465,'warehouse',1,60,'revision','order_handover_correction','ORDER_TEST_9','2026-10-14T14:47:13.361Z')")
await pass()
await reject("UPDATE inventory_movements SET reference_id='OTHER_ORDER' WHERE id=13",
  "UPDATE inventory_movements SET reference_id='ORDER_TEST_9' WHERE id=13",'unrelated correction')
await reject("UPDATE inventory_movements SET quantity_delta=2 WHERE id=13",
  "UPDATE inventory_movements SET quantity_delta=1 WHERE id=13",'wrong correction amount')
await reject("UPDATE inventory_movements SET quantity_after=61 WHERE id=13",
  "UPDATE inventory_movements SET quantity_after=60 WHERE id=13",'correction/current truth drift')
await reject("INSERT INTO inventory_movements VALUES(14,1465,'warehouse',1,61,'arrival','arrival','UNRELATED','2026-10-14T14:49:00Z')",
  "DELETE FROM inventory_movements WHERE id=14",'later independent movement')
await reject("UPDATE inventory_reservations SET status='fulfilled' WHERE id=13",
  "UPDATE inventory_reservations SET status='active' WHERE id=13",'fulfilled handover')
await reject("UPDATE inventory_reservations SET variant_id=1466 WHERE id=13",
  "UPDATE inventory_reservations SET variant_id=1465 WHERE id=13",'wrong variant')
await reject("UPDATE exchange_items SET physical_tracking=1 WHERE id=8",
  "UPDATE exchange_items SET physical_tracking=0 WHERE id=8",'marked physical')
await reject("UPDATE order_items SET stock_writeoff_status='written_off' WHERE id=15",
  "UPDATE order_items SET stock_writeoff_status='reserved' WHERE id=15",'written off item')
await reject("UPDATE inventory_movements SET quantity_delta=0 WHERE id=12",
  "UPDATE inventory_movements SET quantity_delta=-1 WHERE id=12",'movement missing physical debit')
await reject("UPDATE inventory_movements SET quantity_delta=-2 WHERE id=12",
  "UPDATE inventory_movements SET quantity_delta=-1 WHERE id=12",'mismatched physical debit')
await reject("UPDATE catalog_variants SET is_active=0 WHERE id=1465",
  "UPDATE catalog_variants SET is_active=1 WHERE id=1465",'retired SKU')
await reject("UPDATE inventory_stock SET reserved_quantity=0 WHERE id=10",
  "UPDATE inventory_stock SET reserved_quantity=1 WHERE id=10",'already released reserve')
await reject("UPDATE inventory_lifecycle_events SET event_type='return_in' WHERE id=7",
  "UPDATE inventory_lifecycle_events SET event_type='exchange_new_out' WHERE id=7",'real inbound')
await reject("INSERT INTO inventory_stock_checks VALUES(1,'warehouse',1465,'2026-10-15T10:00:00Z')",
  "DELETE FROM inventory_stock_checks WHERE id=1",'later stocktake')
await reject("INSERT INTO inventory_stocktake_sessions VALUES('rev1','warehouse','active','2026-10-13T10:00:00Z')",
  "DELETE FROM inventory_stocktake_sessions WHERE id='rev1'",'active revision')
await reject("INSERT INTO inventory_stocktake_sessions VALUES('rev2','warehouse','completed','2026-10-15T10:00:00Z')",
  "DELETE FROM inventory_stocktake_sessions WHERE id='rev2'",'newer revision session')
await reject("UPDATE exchanges SET status='cancelled' WHERE id=2",
  "UPDATE exchanges SET status='completed' WHERE id=2",'different exchange lifecycle')
await reject("UPDATE inventory_lifecycle_events SET movement_id=NULL WHERE id=7",
  "UPDATE inventory_lifecycle_events SET movement_id=12 WHERE id=7",'missing movement ID')

sql.exec("UPDATE inventory_lifecycle_events SET status='cancelled' WHERE id=7")
const nothing=await reviewAdminDeleteAppliedStock(db,9)
assert.deepEqual(nothing,{allowed:true,appliedCount:0,reversals:[],blockers:[]})
sql.exec("UPDATE inventory_lifecycle_events SET status='applied' WHERE id=7")
assert.deepEqual(sql.prepare('SELECT quantity,reserved_quantity FROM inventory_stock WHERE id=10').get(),orig)
assert.equal(writes,0)
const worker=readFileSync('worker/domains/admin-delete-real-driver.ts','utf8')
const preview=readFileSync('worker/domains/order-delete-preview.ts','utf8')
const ui=readFileSync('src/features/sections/OrdersTableSection.tsx','utf8')
assert(worker.includes('reviewAdminDeleteAppliedStock(db,step.orderId)'))
assert(preview.includes('reviewAdminDeleteAppliedStock(db,orderId)'))
assert(ui.includes('Отмена складских событий обмена') && ui.includes('При нулевом списании'),
  'The operator must see the recorded debit and never assume a physical reversal for zero movement')
console.log('ADMIN_DELETE_UNISSUED_EXCHANGE_BOOKED_STOCK_SAFE_GATE_PASSED')
