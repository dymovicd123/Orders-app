import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {readFileSync} from 'node:fs'
import {getOrderShipmentInventoryBlockers} from '../worker/domains/order-reservations.ts'
import {listCatalogReviewQueue} from '../worker/domains/catalog-review.ts'

// All cases use temporary in-memory SQLite. No remote D1 or production data.
const sql = new DatabaseSync(':memory:')
sql.exec(`
CREATE TABLE orders (
 id INTEGER PRIMARY KEY,external_id TEXT,order_date TEXT,shipping_date TEXT,shipping_status TEXT,
 order_status TEXT,archived_at TEXT,created_at TEXT
);
CREATE TABLE order_items (
 id INTEGER PRIMARY KEY,order_id INTEGER,product_id INTEGER,variant_id INTEGER,
 product_name_snapshot TEXT,audience_type TEXT,gender_snapshot TEXT,color_snapshot TEXT,
 material_snapshot TEXT,length_snapshot TEXT,size_snapshot TEXT,quantity INTEGER,
 source_type TEXT,is_workshop INTEGER,stock_writeoff_status TEXT,created_at TEXT
);
CREATE TABLE inventory_reservations (
 id INTEGER PRIMARY KEY,order_id INTEGER,order_item_id INTEGER,
 inventory_source TEXT,variant_id INTEGER,status TEXT,quantity INTEGER,unresolved_reason TEXT
);
CREATE TABLE catalog_products(id INTEGER PRIMARY KEY,name TEXT);
CREATE TABLE catalog_variants(id INTEGER PRIMARY KEY,product_id INTEGER);
ALTER TABLE catalog_variants ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;
CREATE TABLE inventory_stock(id INTEGER PRIMARY KEY,inventory_source TEXT,variant_id INTEGER,quantity INTEGER);
CREATE TABLE exchanges (id INTEGER PRIMARY KEY,status TEXT);
CREATE TABLE inventory_lifecycle_events (id INTEGER PRIMARY KEY,order_item_id INTEGER,operation_id INTEGER,operation_type TEXT,event_type TEXT,status TEXT,pending_reason TEXT);
CREATE TABLE returns(id INTEGER PRIMARY KEY,status TEXT);
CREATE TABLE return_items(id INTEGER PRIMARY KEY,return_id INTEGER,order_item_id INTEGER,quantity INTEGER);
CREATE TABLE workshop_tasks(id INTEGER PRIMARY KEY,order_item_id INTEGER,quantity INTEGER,status TEXT);
INSERT INTO catalog_products VALUES(75,'ЭТНО КАРДИГАН');
INSERT INTO catalog_variants(id,product_id) VALUES(1498,75);
INSERT INTO orders VALUES(1775,'TEST-RESOLVER','2026-10-22',NULL,'not_sent','active',NULL,'2026-10-22T08:00:00Z');
INSERT INTO order_items VALUES(
 4348,1775,75,1498,'ЭТНО КАРДИГАН','adult','ЖЕН','СВЕТЛО-БЕЖЕВЫЙ',
 'ШЕРСТЬ','СТАНДАРТ','52',1,'warehouse',0,'reserved','2026-10-22T08:00:00Z'
);
INSERT INTO inventory_reservations VALUES(1,1775,4348,'warehouse',1498,'active',1,NULL);
`)
const db = {
 prepare(query) {
   let params=[]
   return {
     bind(...args) { params=args; return this },
     async all(){ return { results:sql.prepare(query).all(...params) } },
     async first(){ return sql.prepare(query).get(...params) || null },
   }
 }
}
const url = new URL('https://test.invalid/api/catalog/review?orderId=1775&limit=10')
async function check(label,expectedUnresolved,expectedReview,expectedShortage=null) {
 const blockers=await getOrderShipmentInventoryBlockers(db,1775)
 const unresolved=blockers.filter(v=>v.blocker_reason==='unresolved')
 const shortage=blockers.filter(v=>v.blocker_reason==='insufficient_physical')
 const review=await listCatalogReviewQueue(db,url)
 assert.equal(unresolved.length,expectedUnresolved,label+': unresolved')
 assert.equal(review.count,expectedReview,label+': actionable catalog work')
 assert.equal(review.items.length,expectedReview,label+': visible items')
 if(expectedShortage!==null)assert.equal(shortage.length,expectedShortage,label+': shortage')
}
async function scenario(label,sqlText,expectedUnresolved,expectedReview,expectedShortage=null){
 sql.exec('SAVEPOINT scenario')
 try{ sql.exec(sqlText);await check(label,expectedUnresolved,expectedReview,expectedShortage)}
 finally{sql.exec('ROLLBACK TO scenario; RELEASE scenario')}
}

// Do not open Resolver for known SKU when active reservation exists but its stock row is missing.
await check('Known SKU + current reservation, missing inventory_stock',1,0,1)
// A zero stock row is physically insufficient, but still NOT a catalog question.
await scenario('Known SKU + physical zero',`INSERT INTO inventory_stock VALUES(1,'warehouse',1498,0)`,0,0,1)
await scenario('Known SKU + physical adequate',`INSERT INTO inventory_stock VALUES(1,'warehouse',1498,2)`,0,0,0)
// With an active valid reservation, old released/fulfilled history must not create a popup.
await scenario('Historical released reservation next to active',`
  INSERT INTO inventory_stock VALUES(1,'warehouse',1498,2);
  INSERT INTO inventory_reservations VALUES(2,1775,4348,'warehouse',1498,'released',1,NULL)`,0,0,0)
await scenario('Missing active reservation, known SKU',`
  DELETE FROM inventory_reservations`,1,0,0)
await scenario('Only historical released reservation',`
  UPDATE inventory_reservations SET status='released'`,1,0,0)
// Pending known reservation is an actionable order-scoped recovery, unlike general catalog scan.
await scenario('Known pending with never-created reservation',`
  DELETE FROM inventory_reservations;
  UPDATE order_items SET stock_writeoff_status='pending_reservation'`,1,1,0)
await scenario('Concurrent shortage retained as unresolved, known SKU requires actionable review',`
  UPDATE inventory_reservations SET status='unresolved',unresolved_reason='concurrent_shortage';
  UPDATE order_items SET stock_writeoff_status='pending_reservation'`,1,1,0)
await scenario('Other unresolved reason is not automatically treated as a concurrent known-stock problem',`
  UPDATE inventory_reservations SET status='unresolved',unresolved_reason='catalog_variant';
  UPDATE order_items SET stock_writeoff_status='pending_reservation'`,1,0,0)
await scenario('Genuinely unresolved catalog identity',`
  DELETE FROM inventory_reservations;
  UPDATE order_items SET product_id=NULL,variant_id=NULL,stock_writeoff_status='catalog_unresolved'`,1,1,0)
await scenario('Retired SKU demand requiring recovery',`
  DELETE FROM inventory_reservations;
  UPDATE order_items SET stock_writeoff_status='catalog_retired'`,1,1,0)
await scenario('Returned item cannot reenter resolver',`
  DELETE FROM inventory_reservations;
  UPDATE order_items SET product_id=NULL,variant_id=NULL,stock_writeoff_status='catalog_unresolved';
  INSERT INTO returns VALUES(5,'completed');
  INSERT INTO return_items VALUES(6,5,4348,1)`,1,0,0)
await scenario('Already fulfilled item',`
  UPDATE order_items SET stock_writeoff_status='fulfilled'`,0,0,0)
await scenario('Workshop item',`
  UPDATE order_items SET is_workshop=1`,0,0,0)

const router=readFileSync('worker/index.ts','utf8')
const start=router.indexOf('let blockers = await getOrderShipmentInventoryBlockers(env.DB, id)')
const end=router.indexOf('const timestamp = new Date().toISOString()',start)
assert(start>0 && end>start,'Shipping gate must exist')
const shipping=router.slice(start,end)
assert(shipping.includes('await reconcileCatalogReviewOrder(env.DB, id)'),'Try automatic safe recovery first')
assert(shipping.includes('await listCatalogReviewQueue(env.DB, reviewUrl)'),'Read the exact order-scoped review')
assert(shipping.includes("reviewUrl.searchParams.set('orderId', String(id))"),'Never consult global catalog queue')
assert(shipping.includes('if (!actionableReview.count || !actionableReview.items?.length)'),'Refuse empty catalog modal')
assert(shipping.indexOf('inventory_reservation_inconsistent')<shipping.indexOf("code: 'catalog_review_required'"),'Stock inconsistency is separate')
assert(!shipping.includes('stockConfirmations: null'),'Do not introduce confirmation popup')
sql.close()
console.log('BRANCH2_RESOLVER_ONLY_WHEN_ACTIONABLE_PASSED: 14 actual SQLite cases; empty modal prohibited; no D1 writes')
