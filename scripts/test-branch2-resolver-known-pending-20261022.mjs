import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

const review=readFileSync('worker/domains/catalog-review.ts','utf8')
const router=readFileSync('worker/index.ts','utf8')
const stock=readFileSync('worker/domains/order-reservations.ts','utf8')
const admission=readFileSync('worker/domains/reservation-admission.ts','utf8')
const a=review.match(/export function catalogReviewPendingKnownReservationPredicate\(oi = 'oi', o = 'o'\) \{\s*return \`([\s\S]*?)\`;\s*\}/)
assert(a,'Missing known-but-pending order-only reservation predicate')
const p=a[1].replaceAll('${oi}','oi').replaceAll('${o}','o')
assert(!/\b(UPDATE|DELETE|INSERT|ALTER|DROP)\b/i.test(p))

const d=new DatabaseSync(':memory:')
d.exec(`
CREATE TABLE orders(id INTEGER PRIMARY KEY,shipping_status TEXT,order_status TEXT,archived_at TEXT);
CREATE TABLE order_items(id INTEGER PRIMARY KEY,order_id INTEGER,quantity INTEGER,is_workshop INTEGER,
  product_id INTEGER,variant_id INTEGER,stock_writeoff_status TEXT);
CREATE TABLE inventory_reservations(id INTEGER PRIMARY KEY,order_item_id INTEGER,status TEXT,unresolved_reason TEXT);
CREATE TABLE returns(id INTEGER PRIMARY KEY,status TEXT);
CREATE TABLE return_items(id INTEGER PRIMARY KEY,return_id INTEGER,order_item_id INTEGER,quantity INTEGER);
INSERT INTO orders VALUES(1775,'not_sent','active',NULL);
INSERT INTO order_items VALUES(4348,1775,1,0,75,1498,'pending_reservation');
`)
const n=()=>d.prepare(`SELECT COUNT(*) AS n FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE oi.id=4348 AND (${p})`).get().n
assert.equal(n(),1,'Exact old order pending known SKU #1498 should be recoverable')
d.exec('SAVEPOINT pending')
try {
 d.exec("INSERT INTO inventory_reservations VALUES(2,4348,'unresolved','concurrent_shortage')")
 assert.equal(n(),1,'Concurrent last-piece pending known SKU must be visible in order Resolver')
 d.exec("UPDATE inventory_reservations SET unresolved_reason='catalog_variant' WHERE id=2")
 assert.equal(n(),0,'Only the explicit concurrent-stock reason may reopen a known-SKU pending reservation')
}finally {d.exec('ROLLBACK TO pending; RELEASE pending')}
for(const [sql,name] of [
 ["UPDATE order_items SET stock_writeoff_status='fulfilled' WHERE id=4348",'fulfilled was physically issued'],
 ["UPDATE order_items SET variant_id=NULL WHERE id=4348",'no canonical variant'],
 ["UPDATE order_items SET is_workshop=1 WHERE id=4348",'workshop is not warehouse'],
 ["UPDATE order_items SET quantity=0 WHERE id=4348",'zero row'],
 ["UPDATE orders SET shipping_status='sent' WHERE id=1775",'sent is history'],
 ["UPDATE orders SET order_status='archived' WHERE id=1775",'archived is history'],
 ["INSERT INTO inventory_reservations (id,order_item_id,status) VALUES(1,4348,'fulfilled')",'fulfilled reservation is immutable'],
 ["INSERT INTO inventory_reservations (id,order_item_id,status) VALUES(1,4348,'released')",'released reservation must not reactivate'],
 ["INSERT INTO inventory_reservations (id,order_item_id,status) VALUES(1,4348,'active')",'already reserved must not double reserve'],
 ["INSERT INTO returns VALUES(1,'completed'); INSERT INTO return_items VALUES(1,1,4348,1)",'returned item must not re-reserve'],
]) {
 const x=new DatabaseSync(':memory:')
 d.exec('SAVEPOINT test')
 try {d.exec(sql);assert.equal(n(),0,name)}finally {d.exec('ROLLBACK TO test; RELEASE test')}
}
const fetchStart=review.indexOf('export async function fetchCatalogReviewRows')
const fetchEnd=review.indexOf('export async function fetchCatalogReviewResolutionCandidates',fetchStart)
const fetch=review.slice(fetchStart,fetchEnd)
assert(fetch.includes('orderId > 0')&&fetch.includes('catalogReviewPendingKnownReservationPredicate'),'Recovery not limited to order-scoped fetch')
const queueStart=review.indexOf('export async function listCatalogReviewQueue')
const queue=review.slice(queueStart)
assert(queue.includes('orderId > 0')&&queue.includes('catalogReviewPendingKnownReservationPredicate'),'Order modal cannot display a pending known reservation')
assert(review.includes('const rowsResult = await fetchCatalogReviewRows(db, 160, orderId);'),'Order auto-reconcile does not inspect recoverable pending SKU')
assert(review.includes('if (toInt(row.is_workshop, 0) === 1 || !toInt(row.variant_id, 0))'),'Known variant not protected in auto-reconcile')
assert(review.includes('const result = await resolveCatalogReviewRows(db, [row], selected, normalizedCatalogReviewKey(row), new Date().toISOString(), { writeAlias: false })'),'Known SKU safe resolution not reused')
assert(review.includes('const committedMatchesTarget'),'Reservation identity and quantity not proven before publishing')
assert(stock.includes('admitOrderReservationAtomically(db, {'),'Known SKU must use atomic admission')
assert(!admission.includes('SET quantity ='),'Reserving stock must never invent physical stock')
assert(admission.includes('quantity >= COALESCE(reserved_quantity, 0) + ?'),'Concurrency admission must guard available stock')
assert(router.includes("await reconcileCatalogReviewOrder(env.DB, id)"),'Shipping does not retry reservation recovery before blocking')
// Stage 1.5: an HTTP response may be lost after the resolver POST commits.
// The same modal session must recheck with GET and resume the original action
// exactly once; a new order has a completely independent completion latch.
const { createResolutionSession, isRecognizedPendingCatalogReservation } = await import('../src/features/orders/catalogResolutionFlow.ts')
assert.equal(isRecognizedPendingCatalogReservation({
  stockWriteoffStatus:'pending_reservation',productId:75,variantId:1498,
}),true,'A fully recognized SKU with queued shortage is NOT a catalog identity problem')
for(const value of [
  {stockWriteoffStatus:'catalog_unresolved',productId:75,variantId:1498},
  {stockWriteoffStatus:'pending_reservation',productId:75,variantId:null},
  {stockWriteoffStatus:'pending_reservation',productId:null,variantId:1498},
  null,
]) assert.equal(isRecognizedPendingCatalogReservation(value),false,'Only known exact pending SKU gets stock-shortage route')

const modal=readFileSync('src/features/orders/OrderCatalogResolutionModal.tsx','utf8')
assert(modal.includes('owner.markUncertainWrite()') && modal.includes('setNeedsRecheck(true)'),
 'A lost mutation response must allow read-only retry from the modal')
assert(modal.includes('if (needsRecheck) await owner.run(null, load'),
 'Read-only retry must never resubmit the original mutation')
assert(modal.includes('if (pendingKnownShortage)') &&
 modal.includes('Изменить заказ') && modal.includes('Повторный выбор того же SKU не создаст свободный остаток'),
 'Modal must lead known shortage to existing order flow, never broken Save-and-continue')
assert(review.includes("cleanText(anchor.stock_writeoff_status) === 'pending_reservation'") &&
 review.includes("повторное уточнение каталога не поможет"),
 'Direct API stale resolver writes must explain stock shortage without manufacturing inventory')
const firstOrder=createResolutionSession()
let firstWrites=0, firstShipments=0, firstReads=0
await assert.rejects(()=>firstOrder.run(async()=>{
 firstWrites++ // POST persisted on server, but client response was lost
 throw new Error('network response lost')
},async()=>{ firstReads++;return true },async()=>{firstShipments++}),/response lost/)
firstOrder.markUncertainWrite()
assert.equal(firstWrites,1)
assert.equal(firstShipments,0)
await firstOrder.run(null,async()=>{firstReads++;return true},async()=>{firstShipments++;return true})
await firstOrder.run(null,async()=>{firstReads++;return true},async()=>{firstShipments++;return true})
assert.equal(firstWrites,1,'Retry must not duplicate SKU/reservation mutation')
assert.equal(firstShipments,1,'Committed write can resume shipping only once after GET recheck')
assert.equal(firstReads,1,'Completed session must not reread/re-ship')
const unresolvedOrder=createResolutionSession()
unresolvedOrder.markUncertainWrite()
let blockedShipping=0
await unresolvedOrder.run(null,async()=>false,async()=>{blockedShipping++})
assert.equal(blockedShipping,0,'Existing unresolved issues must block automatic shipping')
const secondOrder=createResolutionSession()
let secondWrites=0,secondShips=0
await secondOrder.run(async()=>{secondWrites++},async()=>true,async()=>{secondShips++})
assert.deepEqual([secondWrites,secondShips],[1,1],
 'A second order must not inherit the first order completion latch')


// Actual Branch2 catalog-reconciliation domain on a real SQLite-backed D1
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

console.log('PENDING_KNOWN_SKU_ORDER_SHIPPING_RECOVERY_PASSED: known shortage routes to order edit, no fake catalog resolution, lost response recovery, two independent orders')
