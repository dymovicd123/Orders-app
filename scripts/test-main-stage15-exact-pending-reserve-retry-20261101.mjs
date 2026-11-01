import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
const router=readFileSync('worker/index.ts','utf8')
// Stage 1.5: real Main catalog reconciliation domain on isolated SQLite-backed D1
// adapter. A known exact SKU with concurrent_shortage must retain the *same*
// pending reservation even if shipment attempts automatic repair repeatedly.
const {reconcileCatalogReviewOrder}=await import('../worker/domains/catalog-review.ts')
const persistent=new DatabaseSync(':memory:')
persistent.exec([
 "CREATE TABLE orders(id INTEGER PRIMARY KEY,external_id TEXT,order_date TEXT,created_at TEXT,shipping_status TEXT,shipping_date TEXT,order_status TEXT,archived_at TEXT)",
 "CREATE TABLE order_items(id INTEGER PRIMARY KEY,order_id INTEGER,quantity INTEGER,is_workshop INTEGER,product_id INTEGER,variant_id INTEGER,stock_writeoff_status TEXT,product_name_snapshot TEXT,audience_type TEXT,gender_snapshot TEXT,color_snapshot TEXT,material_snapshot TEXT,length_snapshot TEXT,size_snapshot TEXT,source_type TEXT,created_at TEXT)",
 "CREATE TABLE inventory_reservations(id INTEGER PRIMARY KEY,order_id INTEGER,order_item_id INTEGER,inventory_source TEXT,product_id INTEGER,variant_id INTEGER,quantity INTEGER,status TEXT,unresolved_reason TEXT,created_at TEXT)",
 "CREATE TABLE inventory_stock(id INTEGER PRIMARY KEY,inventory_source TEXT,variant_id INTEGER,quantity INTEGER,reserved_quantity INTEGER)",
 "CREATE TABLE returns(id INTEGER PRIMARY KEY,status TEXT)",
 "CREATE TABLE return_items(id INTEGER PRIMARY KEY,return_id INTEGER,order_item_id INTEGER,quantity INTEGER)",
 "CREATE TABLE workshop_tasks(id INTEGER PRIMARY KEY,order_item_id INTEGER,quantity INTEGER,status TEXT)",
 "INSERT INTO orders VALUES(2195,'CI-2195','2026-10-31','2026-10-31T15:35:14Z','not_sent',NULL,'active',NULL)",
 "INSERT INTO order_items VALUES(5301,2195,1,0,75,962,'pending_reservation','АБАЙ ТАКИЯ','ВЗРОСЛЫЙ','МУЖ','ТЕМНО-СИНИЙ','СТАНДАРТ','СТАНДАРТ','57','warehouse','2026-10-31T15:35:14Z')",
 "INSERT INTO inventory_reservations VALUES(2203,2195,5301,'warehouse',75,962,1,'unresolved','concurrent_shortage','2026-10-31T15:35:14Z')",
 "INSERT INTO inventory_stock VALUES(12,'warehouse',962,0,0)",
].join(';\n')+';')
let attemptedMutation=0
const db={
 prepare(sql){
   return {
     bind(...args){
       return {
         async first(){return persistent.prepare(sql).get(...args)??null},
         async all(){return {results:persistent.prepare(sql).all(...args)}},
         async run(){attemptedMutation++;throw new Error('Catalog auto-repair must not write a known concurrent shortage')}
       }
     },
   }
 }
}
const before=persistent.prepare("SELECT id,status,unresolved_reason,quantity FROM inventory_reservations WHERE order_item_id=5301").get()
for(let attempt=0;attempt<3;attempt++){
 const outcome=await reconcileCatalogReviewOrder(db,2195)
 assert.equal(outcome.resolvedGroups,0,'Known shortage is not a catalog identity repair')
 assert.equal(outcome.reserved,0,'No new physical stock or reservation is admissible on blind retry')
 const after=persistent.prepare("SELECT id,status,unresolved_reason,quantity FROM inventory_reservations WHERE order_item_id=5301").get()
 assert.deepEqual(after,before,'Blocked shipment must retain the existing pending reservation ID')
}
assert.equal(attemptedMutation,0,'Repeated unresolved known-SKU shipment attempts must be read-only')
const unchangedStock=persistent.prepare('SELECT quantity,reserved_quantity FROM inventory_stock WHERE id=12').get()
assert.equal(unchangedStock.quantity,0,'No phantom physical units during pending shipment')
assert.equal(unchangedStock.reserved_quantity,0,'No stock reservation was added by pending shipment')
assert(router.includes("unresolvedBlockers.some(row => toInt(row.known_pending_reservation, 0) !== 1)"),
 'Shipping must skip catalog repair entirely when all blockers are already-known shortages')
console.log('PENDING_KNOWN_SKU_RESERVATION_ID_STABLE_PASS: 3 retries preserve ID 2203, no writes, no phantom physical stock')
