import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { fulfillOrderReservationsV2 } from '../worker/domains/order-reservations.ts'

const q = new DatabaseSync(':memory:')
q.exec([
"CREATE TABLE orders(id INTEGER PRIMARY KEY, external_id TEXT, order_date TEXT, order_status TEXT, archived_at TEXT, shipping_status TEXT, shipping_date TEXT, updated_at TEXT)",
"CREATE TABLE order_items(id INTEGER PRIMARY KEY, order_id INTEGER, product_id INTEGER, product_name_snapshot TEXT, source_type TEXT, audience_type TEXT, gender_snapshot TEXT, color_snapshot TEXT, material_snapshot TEXT, length_snapshot TEXT, size_snapshot TEXT, stock_writeoff_status TEXT, quantity INTEGER, is_workshop INTEGER, stock_quantity_before INTEGER, stock_quantity_after INTEGER)",
"CREATE TABLE inventory_reservations(id INTEGER PRIMARY KEY, order_id INTEGER, order_item_id INTEGER, inventory_source TEXT, variant_id INTEGER, status TEXT, quantity INTEGER, reference_type TEXT, reference_id TEXT, fulfilled_at TEXT, updated_at TEXT)",
"CREATE TABLE inventory_stock(id INTEGER PRIMARY KEY, inventory_source TEXT, variant_id INTEGER, product_id INTEGER, product_name_snapshot TEXT, gender_snapshot TEXT, color_snapshot TEXT, material_snapshot TEXT, length_snapshot TEXT, size_snapshot TEXT, quantity INTEGER, reserved_quantity INTEGER, last_action TEXT, last_source_ref TEXT, updated_at TEXT)",
"CREATE TABLE catalog_products(id INTEGER PRIMARY KEY, name TEXT, is_active INTEGER)",
"CREATE TABLE catalog_variants(id INTEGER PRIMARY KEY, product_id INTEGER, category TEXT, gender TEXT, color TEXT, material TEXT, length TEXT, size_label TEXT, is_active INTEGER)",
"CREATE TABLE returns(id INTEGER PRIMARY KEY, order_id INTEGER, status TEXT)",
"CREATE TABLE return_items(id INTEGER PRIMARY KEY, return_id INTEGER, order_item_id INTEGER, quantity INTEGER)",
"CREATE TABLE exchanges(id INTEGER PRIMARY KEY, refund_return_id INTEGER, status TEXT)",
"CREATE TABLE inventory_model_meta(key TEXT PRIMARY KEY, value TEXT, updated_at TEXT)",
"CREATE TABLE inventory_movements(id INTEGER PRIMARY KEY AUTOINCREMENT, inventory_source TEXT, movement_type TEXT, product_id INTEGER, variant_id INTEGER, product_name_snapshot TEXT, gender_snapshot TEXT, color_snapshot TEXT, material_snapshot TEXT, length_snapshot TEXT, size_snapshot TEXT, quantity_delta INTEGER, quantity_after INTEGER, reference_type TEXT, reference_id TEXT, comment TEXT, created_at TEXT)",
"INSERT INTO orders VALUES(201,'ORD-ZERO','2026-10-21','active','','not_sent',NULL,NULL)",
"INSERT INTO orders VALUES(202,'ORD-POS','2026-10-21','active','','not_sent',NULL,NULL)",
"INSERT INTO catalog_products VALUES(11,'БАЯН СҰЛУ ШАПАН',1)",
"INSERT INTO catalog_variants VALUES(1829,11,'adult','МУЖ','ОРАНЖЕВЫЙ','СТАНДАРТ','СТАНДАРТ','52',1)",
"INSERT INTO catalog_variants VALUES(1830,11,'adult','ЖЕН','СИНИЙ','СТАНДАРТ','СТАНДАРТ','46',1)",
"INSERT INTO order_items VALUES(301,201,11,'БАЯН СҰЛУ ШАПАН','boutique','adult','МУЖ','ОРАНЖЕВЫЙ','СТАНДАРТ','СТАНДАРТ','52','reserved',1,0,NULL,NULL)",
"INSERT INTO order_items VALUES(302,202,11,'БАЯН СҰЛУ ШАПАН','boutique','adult','ЖЕН','СИНИЙ','СТАНДАРТ','СТАНДАРТ','46','reserved',1,0,NULL,NULL)",
"INSERT INTO inventory_stock VALUES(401,'boutique',1829,11,'БАЯН СҰЛУ ШАПАН','МУЖ','ОРАНЖЕВЫЙ','СТАНДАРТ','СТАНДАРТ','52',0,1,NULL,NULL,NULL)",
"INSERT INTO inventory_stock VALUES(402,'boutique',1830,11,'БАЯН СҰЛУ ШАПАН','ЖЕН','СИНИЙ','СТАНДАРТ','СТАНДАРТ','46',2,1,NULL,NULL,NULL)",
"INSERT INTO inventory_reservations VALUES(501,201,301,'boutique',1829,'active',1,'order','ORD-ZERO',NULL,NULL)",
"INSERT INTO inventory_reservations VALUES(502,202,302,'boutique',1830,'active',1,'order','ORD-POS',NULL,NULL)"
].join(';\n')+';')
q.exec(readFileSync('migrations/0071_v72_inventory_operation_evidence.sql','utf8'))

const db={
 prepare(sql) {
  let args=[]
  return {
   bind(...values){args=values;return this},
   async first(){return q.prepare(sql).get(...args)||null},
   async all(){return {results:q.prepare(sql).all(...args)}},
   async run(){const x=q.prepare(sql).run(...args);return {meta:{changes:x.changes,last_row_id:Number(x.lastInsertRowid)}}}
  }
 },
 async batch(statements){
  q.exec('BEGIN')
  try{let r=[];for(let s of statements)r.push(await s.run());q.exec('COMMIT');return r}
  catch(err){q.exec('ROLLBACK');throw err}
 }
}
const now='2026-10-21T16:40:00Z'
const sent=await fulfillOrderReservationsV2(db,201,'ORD-ZERO',now,{shippingDate:'2026-10-21',checkedBy:'test-manager'})
assert.equal(sent.shippingCommitted,true)
assert.equal(sent.fulfilled,1)
assert.equal(q.prepare('SELECT shipping_status FROM orders WHERE id=201').get().shipping_status,'sent')
assert.equal(q.prepare('SELECT status FROM inventory_reservations WHERE id=501').get().status,'fulfilled')
assert.equal(q.prepare('SELECT quantity FROM inventory_stock WHERE id=401').get().quantity,0)
assert.equal(q.prepare('SELECT reserved_quantity FROM inventory_stock WHERE id=401').get().reserved_quantity,0)
const e=q.prepare("SELECT * FROM inventory_operation_evidence WHERE operation_type='shipping'").all()
assert.equal(e.length,1)
assert.equal(e[0].tracked_physical_before,0)
assert.equal(e[0].confirmed_operation_quantity,1)
assert.equal(e[0].unexplained_quantity,1)
assert.equal(e[0].confirmed_by,'test-manager')
assert.equal(q.prepare("SELECT quantity_delta FROM inventory_movements WHERE movement_type='sale'").get().quantity_delta,0)
const retry=await fulfillOrderReservationsV2(db,201,'ORD-ZERO',now,{shippingDate:'2026-10-21'})
assert.equal(retry.shippingCommitted,false)
assert.equal(q.prepare('SELECT COUNT(*) n FROM inventory_operation_evidence').get().n,1)
assert.equal(q.prepare('SELECT COUNT(*) n FROM inventory_movements').get().n,1)
const normal=await fulfillOrderReservationsV2(db,202,'ORD-POS',now,{shippingDate:'2026-10-21'})
assert.equal(normal.shippingCommitted,true)
assert.equal(q.prepare('SELECT quantity FROM inventory_stock WHERE id=402').get().quantity,1)
assert.equal(q.prepare('SELECT COUNT(*) n FROM inventory_operation_evidence').get().n,1)
// Early handover is a different, per-item action. Its possession guard stays
// intact rather than being weakened by the ordinary «Отправлен» change.
q.exec([
 "INSERT INTO orders VALUES(203,'ORD-HANDOVER','2026-10-21','active','','not_sent',NULL,NULL)",
 "INSERT INTO order_items VALUES(303,203,11,'БАЯН СҰЛУ ШАПАН','boutique','adult','МУЖ','ОРАНЖЕВЫЙ','СТАНДАРТ','СТАНДАРТ','52','reserved',1,0,NULL,NULL)",
 "UPDATE inventory_stock SET reserved_quantity=1 WHERE id=401",
 "INSERT INTO inventory_reservations VALUES(503,203,303,'boutique',1829,'active',1,'order','ORD-HANDOVER',NULL,NULL)"
].join(';')+';')
await assert.rejects(
 fulfillOrderReservationsV2(db,203,'ORD-HANDOVER',now,{stockConfirmationOperation:'handover',orderItemIds:[303]}),
 /нужно отдельно подтвердить/
)
assert.equal(q.prepare("SELECT status FROM inventory_reservations WHERE id=503").get().status,'active')
assert.equal(q.prepare('SELECT COUNT(*) n FROM inventory_operation_evidence').get().n,1)

const attention=readFileSync('worker/domains/warehouse-attention.ts','utf8')
const tick=String.fromCharCode(96)
const marker='SELECT COUNT(*) AS count\n       FROM inventory_operation_evidence evidence'
const ix=attention.indexOf(marker)
assert(ix>0,'Current untracked-shipment count query missing')
const countSQL=attention.slice(attention.lastIndexOf(tick,ix)+1,attention.indexOf(tick,ix))
assert.equal(q.prepare(countSQL).get().count,1)
const di=attention.indexOf('const shippedUntrackedRows = await db.prepare(')
assert(di>0,'Persisted outbound details query missing')
const detailSQL=attention.slice(attention.indexOf(tick,di)+1,attention.indexOf(tick,attention.indexOf(tick,di)+1))
const rows=q.prepare(detailSQL).all(30)
assert.equal(rows.length,1)
assert.equal(rows[0].order_id,201)
assert.equal(rows[0].external_id,'ORD-ZERO')
assert.equal(rows[0].unexplained_quantity,1)
const router=readFileSync('worker/index.ts','utf8')
const route=router.slice(router.indexOf('const orderShippingMatch = url.pathname.match('),router.indexOf('const orderDeleteMatch'))
assert(!route.includes("buildStockResolutionRequired('shipping'"))
assert(route.includes("code: 'catalog_review_required'"))
const app=readFileSync('src/App.tsx','utf8')
const fn=app.slice(app.indexOf('async function markOrderSentToClient'),app.indexOf('async function correctMistakenOrderShipping'))
assert(!fn.includes('await askStockResolution({'))
assert(fn.includes('void loadWarehouseAttention(false, true)'))
assert(readFileSync('src/features/inventory/views/renderInventoryAttentionPanel.tsx','utf8').includes('Заказ уже отправлен — проверить причину'))
const stockAttentionUI = readFileSync('src/features/inventory/views/renderInventoryAttentionPanel.tsx','utf8')
assert.equal((stockAttentionUI.match(/className="inventory-attention-guide"/g) || []).length, 1, 'Active shortage section has one common guide')
assert.equal((stockAttentionUI.match(/className="inventory-attention-guide is-shipped"/g) || []).length, 1, 'Shipped shortage section has one common guide')
assert(!stockAttentionUI.includes('inventory-attention-task-help'), 'No repeated instruction in each item card')
assert(!stockAttentionUI.includes('не добавляйте его повторно на склад'), 'Avoid vague historical-shipment instruction')
assert(stockAttentionUI.includes('Оформить приход') && stockAttentionUI.includes('Проверить количество'), 'Keep existing stock actions')

assert(readFileSync('src/features/sections/OrdersHeaderSection.tsx','utf8').includes('shippedUntracked'))
assert(readFileSync('worker/domains/order-reservations.ts','utf8').includes("stockConfirmationOperation === 'handover' && bounded.requiresResolution && !stockConfirmation"))
assert(readFileSync('worker/domains/orders-write.ts','utf8').includes("blockers.filter((row) => cleanText(row.blocker_reason) !== 'insufficient_physical')"))
// A historical negative Physical must not cause a failed evidence CHECK or
// a synthetic positive 'sale' movement when the book value is clamped to zero.
q.exec([
 "INSERT INTO orders VALUES(204,'ORD-NEGATIVE','2026-10-21','active','','not_sent',NULL,NULL)",
 "INSERT INTO order_items VALUES(304,204,11,'БАЯН СҰЛУ ШАПАН','boutique','adult','МУЖ','ОРАНЖЕВЫЙ','СТАНДАРТ','СТАНДАРТ','52','reserved',1,0,NULL,NULL)",
 "UPDATE inventory_stock SET quantity=-2,reserved_quantity=2 WHERE id=401",
 "INSERT INTO inventory_reservations VALUES(504,204,304,'boutique',1829,'active',1,'order','ORD-NEGATIVE',NULL,NULL)"
].join(';')+';')
const negative=await fulfillOrderReservationsV2(db,204,'ORD-NEGATIVE',now,{shippingDate:'2026-10-21',checkedBy:'test-manager'})
assert.equal(negative.shippingCommitted,true)
const negEvidence=q.prepare("SELECT * FROM inventory_operation_evidence WHERE operation_reference='ORD-NEGATIVE'").get()
assert.equal(negEvidence.tracked_physical_before,0)
assert.equal(negEvidence.explained_quantity,0)
assert.equal(negEvidence.unexplained_quantity,1)
assert.equal(q.prepare("SELECT quantity FROM inventory_stock WHERE id=401").get().quantity,0)
assert.equal(q.prepare("SELECT quantity_delta FROM inventory_movements WHERE reference_id='ORD-NEGATIVE' AND movement_type='sale'").get().quantity_delta,0)
q.close()
console.log('BRANCH2_SHIPPING_LIVE_SQL_BOUNDED_STOCK_IDEMPOTENCE_EVIDENCE_LIST_PASSED')
