import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { fetchOrderStockHandoverRows, getOrderStockHandoverState } from '../worker/domains/order-reservations.ts'

const sql = new DatabaseSync(':memory:')
sql.exec(`
CREATE TABLE orders(id INTEGER PRIMARY KEY, external_id TEXT, order_date TEXT, created_at TEXT,order_status TEXT DEFAULT 'active',archived_at TEXT,shipping_status TEXT DEFAULT 'not_sent',workshop_status TEXT,customer_id INTEGER);
CREATE TABLE order_items(id INTEGER PRIMARY KEY,order_id INTEGER, quantity INTEGER DEFAULT 1,is_workshop INTEGER DEFAULT 0,created_at TEXT,inventory_obligation_key TEXT,inventory_obligation_origin_at TEXT,product_name_snapshot TEXT,gender_snapshot TEXT,color_snapshot TEXT,material_snapshot TEXT,length_snapshot TEXT,size_snapshot TEXT,source_type TEXT,stock_writeoff_status TEXT,product_id INTEGER,variant_id INTEGER);
CREATE TABLE inventory_reservations(id INTEGER PRIMARY KEY,order_id INTEGER,order_item_id INTEGER,inventory_source TEXT,variant_id INTEGER,quantity INTEGER,status TEXT,created_at TEXT);
CREATE TABLE inventory_stock(id INTEGER PRIMARY KEY,inventory_source TEXT,variant_id INTEGER,quantity INTEGER,reserved_quantity INTEGER);
CREATE TABLE inventory_stock_checks(id INTEGER PRIMARY KEY,inventory_source TEXT,variant_id INTEGER,checked_at TEXT,check_type TEXT,reference_type TEXT,reference_id TEXT);
CREATE TABLE inventory_stocktake_sessions(id TEXT PRIMARY KEY,inventory_source TEXT,status TEXT,started_at TEXT,completed_at TEXT);
CREATE TABLE inventory_handover_reviews(id INTEGER PRIMARY KEY,order_id INTEGER,order_item_id INTEGER,reservation_id INTEGER,decision TEXT,checkpoint_id INTEGER,checkpoint_at TEXT);
CREATE TABLE catalog_variants(id INTEGER PRIMARY KEY,product_id INTEGER,gender TEXT,color TEXT,material TEXT,length TEXT,size_label TEXT);
CREATE TABLE catalog_products(id INTEGER PRIMARY KEY,name TEXT);
CREATE TABLE customers(id INTEGER PRIMARY KEY,display_name TEXT);
CREATE TABLE workshop_tasks(id INTEGER PRIMARY KEY,order_id INTEGER,quantity INTEGER,status TEXT);
INSERT INTO catalog_products VALUES(99,'ЕҢЛІК ШАПАН');
INSERT INTO catalog_variants VALUES(240,99,'ЖЕН','ОРАНЖЕВЫЙ','ЗАМША ВЕЛЮР','СТАНДАРТ','46');
INSERT INTO inventory_stock VALUES(169,'warehouse',240,4,3);
`)
const db={
 prepare(query){
   let args=[]
   return {
     bind(...xs){args=xs;return this},
     async all(){return {results:sql.prepare(query).all(...args)}},
     async first(){return sql.prepare(query).get(...args)??null},
   }
 }
}
function makeOrder(id,date,created,{workshop=false,sku=240}={}){
 sql.prepare('INSERT INTO orders(id,external_id,order_date,created_at) VALUES(?,?,?,?)').run(id,'ORD-'+id,date,created)
 const item=id*10
 sql.prepare(`INSERT INTO order_items(id,order_id,quantity,is_workshop,created_at,inventory_obligation_origin_at,product_name_snapshot,gender_snapshot,color_snapshot,material_snapshot,length_snapshot,size_snapshot,source_type,product_id,variant_id)
 VALUES(?,?,1,0,? ,?,'ЕҢЛІК ШАПАН','ЖЕН','ОРАНЖЕВЫЙ','ЗАМША ВЕЛЮР','СТАНДАРТ','46','warehouse',99,?)`).run(item,id,created,created,sku)
 sql.prepare('INSERT INTO inventory_reservations(id,order_id,order_item_id,inventory_source,variant_id,quantity,status,created_at) VALUES(?,?,?,?,?,1,?,?)').run(item,id,item,'warehouse',sku,'active',created)
 if(workshop){
  sql.prepare('INSERT INTO order_items(id,order_id,quantity,is_workshop,created_at,source_type) VALUES(?,?,1,1,?,?)').run(item+1,id,created,'workshop')
 }
 return item
}
const september=makeOrder(1658,'2026-09-30','2026-09-30T10:48:04Z')
const sameDayNew=makeOrder(1887,'2026-10-10','2026-10-10T11:27:50Z')
const mixed=makeOrder(1900,'2026-10-04','2026-10-04T08:00:00Z',{workshop:true})
const backdated=makeOrder(1901,'2026-09-30','2026-10-10T11:27:50Z')
const noRelevant=makeOrder(1902,'2026-10-17','2026-10-17T08:00:00Z')
sql.exec(`
INSERT INTO inventory_stock_checks(id,inventory_source,variant_id,checked_at,check_type,reference_type,reference_id) VALUES
(2557,'warehouse',240,'2026-10-06T10:30:51Z','selective_stocktake','stocktake','REV-W-P-01'),
(3143,'warehouse',240,'2026-10-10T10:31:58Z','manual_set','manual','manual-1'),
(3230,'warehouse',240,'2026-10-16T12:32:44Z','manual_set','manual','manual-2');
`)
async function assertReview(id,expected){
 const compact=(await fetchOrderStockHandoverRows(db,[id],{listFlagsOnly:true}))
 const detailed=(await getOrderStockHandoverState(db,id))
 if(id===1658) console.log('SEPTEMBER_COMPACT_DIAGNOSTIC='+JSON.stringify({compact,detail:detailed.items.map(x=>({review:x.reviewNeeded,checkpoint:x.checkpointId,at:x.checkpointAt,reason:x.reviewReason}))}))
 assert.equal(compact.length,1,'one active inventory reservation needed')
 assert.equal(detailed.items.length,1,'one stock item per order')
 assert.equal(Number(compact[0].review_needed),expected?1:0,'compact discrepancy for '+id)
 assert.equal(detailed.items[0].reviewNeeded,expected,'detail discrepancy for '+id)
 assert.equal(detailed.items[0].state,expected?'handover_review':'ready_to_issue')
 return detailed.items[0]
}
const oldItem=await assertReview(1658,true)
assert.equal(oldItem.checkpointId,3230,'Latest physical checkpoint after September order should win')
assert.equal(oldItem.reviewReason,'checkpoint_after_order')
await assertReview(1887,true) // Oct16 checkpoint occurred AFTER this Oct10 order, so review genuinely required
await assertReview(1900,true)
await assertReview(1901,true)
await assertReview(1902,false)

// New same-day ordinary order created AFTER an earlier check, without any later check.
const cleanDay=makeOrder(2000,'2026-10-20','2026-10-20T11:27:50Z')
sql.prepare("INSERT INTO inventory_stock_checks VALUES(4000,'warehouse',240,'2026-10-20T10:00:00Z','manual_set','manual','manual-day')").run()
await assertReview(2000,false)

// Non-backdated earlier check is never a post-order checkpoint.
const tooNew=makeOrder(2001,'2026-10-21','2026-10-21T11:27:50Z')
await assertReview(2001,false)

// A reviewed exact checkpoint must not demand the same answer twice.
sql.prepare("INSERT INTO inventory_handover_reviews VALUES(1,1658,?,?,?, ?, ?)").run(september,september,'still_here',3230,'2026-10-16T12:32:44Z')
await assertReview(1658,false)

// A source-wide *full* stocktake after order creation is a checkpoint even without per-SKU checks.
const fullOrder=makeOrder(2010,'2026-10-22','2026-10-22T11:00:00Z')
sql.prepare("INSERT INTO inventory_stocktake_sessions VALUES('REV-W-F-2010','warehouse','completed','2026-10-23T09:00:00Z','2026-10-23T09:45:00Z')").run()
const f=await assertReview(2010,true)
assert.equal(f.checkpointKind,'revision')
assert.equal(f.checkpointId<0,true,'Full revision uses negative rowid')
assert.equal(f.reviewReason,'checkpoint_after_order')

sql.close()
console.log('OLD_ORDINARY_ORDER_POST_STOCKTAKE_REVIEW_SQLITE_PASSED')
