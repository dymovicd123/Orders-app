import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

const source=readFileSync('worker/domains/order-reservations.ts','utf8')
const lifecycle=readFileSync('worker/domains/lifecycle.ts','utf8')
const exchange=readFileSync('worker/domains/returns-exchanges.ts','utf8')
const orders=readFileSync('src/features/sections/OrdersTableSection.tsx','utf8')
const helper=source.match(/const pendingExchangeReplacementExclusionSql = \(orderItemReference: 'r.order_item_id' \| 'oi.id'\) => `([\s\S]*?)`;/)
assert(helper, 'Find actual shared WHERE predicate for pending exchange replacements')
const predicate=alias=>helper[1].replaceAll('${orderItemReference}',alias)
assert(!predicate('r.order_item_id').includes('${'))
assert.match(predicate('r.order_item_id'),/pending_reason = 'awaiting_dispatch'/)
assert.match(predicate('r.order_item_id'),/pending_replacement.status = 'pending'/)
assert.match(predicate('r.order_item_id'),/COALESCE\(pending_exchange.status,'completed'\) <> 'cancelled'/)

assert.match(source,/WHERE r\.order_id = \? AND r\.status IN \('active', 'unresolved'\)\$\{scopeSql\}[\s\S]{0,80}pendingExchangeReplacementExclusionSql\('r.order_item_id'\)/)
assert.match(source,/AND \$\{pendingExchangeReplacementExclusionSql\('oi.id'\)\}/)
assert((source.match(/pendingExchangeReplacementExclusionSql\('r.order_item_id'\)/g)||[]).length>=2)
assert.match(source,/if \(stockConfirmationOperation === 'handover'\) \{[\s\S]*?pendingReplacement = await db\.prepare/)
assert.match(source,/Эта замена ещё не отправлена/)
assert.match(lifecycle,/options\.explicitReplacementDispatch !== true/)
assert.match(exchange,/dispatchSelectedCompleteOrderLines\(db,orderId,\{/,
  'Legacy replacement endpoint must use the same atomic order dispatch')
const selectedDispatch=readFileSync('worker/domains/order-dispatch.ts','utf8')
assert.match(selectedDispatch,/replacementByItem\.set\(item\.orderItemId,/,
  'Pending replacements must use the same order dispatch atomic batch')
assert.match(orders,/openDispatchDraft\(order\)/,
  'Unified shipment checklist must remain accessible')
assert(!orders.includes('order-exchange-dispatch-button'),
  'Legacy replacement button must not compete with unified shipment action')

const db=new DatabaseSync(':memory:')
db.exec(`
CREATE TABLE orders(id INTEGER PRIMARY KEY,shipping_status TEXT);
CREATE TABLE order_items(id INTEGER PRIMARY KEY,order_id INTEGER,quantity INTEGER,product_name_snapshot TEXT);
CREATE TABLE inventory_reservations(id INTEGER PRIMARY KEY,order_id INTEGER,order_item_id INTEGER,status TEXT,quantity INTEGER,variant_id INTEGER,inventory_source TEXT);
CREATE TABLE exchanges(id INTEGER PRIMARY KEY,status TEXT);
CREATE TABLE inventory_lifecycle_events(id INTEGER PRIMARY KEY,operation_id INTEGER,order_id INTEGER,order_item_id INTEGER,operation_type TEXT,event_type TEXT,status TEXT,pending_reason TEXT);
CREATE TABLE inventory_stock(id INTEGER PRIMARY KEY,inventory_source TEXT,variant_id INTEGER,quantity INTEGER,reserved_quantity INTEGER);
INSERT INTO orders VALUES(42,'not_sent');
INSERT INTO order_items VALUES(11,42,1,'Original item'),(12,42,1,'New exchange'),(13,42,2,'Another ordinary item'),(14,42,1,'Cancelled replacement');
INSERT INTO inventory_reservations VALUES
 (100,42,11,'active',1,3,'warehouse'),
 (101,42,12,'active',1,4,'warehouse'),
 (102,42,13,'active',2,5,'warehouse'),
 (103,42,14,'active',1,6,'warehouse');
INSERT INTO exchanges VALUES(9,'completed'),(10,'cancelled');
INSERT INTO inventory_lifecycle_events VALUES
 (20,9,42,12,'exchange','exchange_new_out','pending','awaiting_dispatch'),
 (21,10,42,14,'exchange','exchange_new_out','pending','awaiting_dispatch');
INSERT INTO inventory_stock VALUES(31,'warehouse',3,5,1),(32,'warehouse',4,1,1),(33,'warehouse',5,4,2),(34,'warehouse',6,1,1);
`)
const shippedSql=`SELECT r.id,r.order_item_id,r.quantity
FROM inventory_reservations r
WHERE r.order_id=? AND r.status IN ('active','unresolved')
 AND ${predicate('r.order_item_id')}
ORDER BY r.id`
const rows=db.prepare(shippedSql).all(42)
assert.deepEqual(rows.map(r=>r.order_item_id),[11,13,14],'Ignore only live pending exchange, not ordinary or cancelled exchange rows')
const unresolvedSql=`SELECT oi.id FROM order_items oi
LEFT JOIN inventory_reservations r ON r.order_item_id=oi.id AND r.status='active'
LEFT JOIN inventory_stock stock ON stock.inventory_source=r.inventory_source AND stock.variant_id=r.variant_id
WHERE oi.order_id=? AND oi.quantity>0 AND ${predicate('oi.id')}
AND (r.id IS NULL OR r.variant_id IS NULL OR stock.id IS NULL)`
assert.deepEqual(db.prepare(unresolvedSql).all(42),[])
// The original order may be sent while replacement still awaits the separate button.
// Simulate precisely the set of rows selected by the new shipment query.
db.exec('BEGIN IMMEDIATE')
for(const r of rows){
 const stock=db.prepare('SELECT inventory_source,variant_id FROM inventory_reservations WHERE id=?').get(r.id)
 db.prepare('UPDATE inventory_stock SET quantity=quantity-?,reserved_quantity=reserved_quantity-? WHERE inventory_source=? AND variant_id=?')
   .run(r.quantity,r.quantity,stock.inventory_source,stock.variant_id)
 db.prepare("UPDATE inventory_reservations SET status='fulfilled' WHERE id=?").run(r.id)
}
db.prepare("UPDATE orders SET shipping_status='sent' WHERE id=42").run()
db.exec('COMMIT')
assert.equal(db.prepare('SELECT quantity FROM inventory_stock WHERE variant_id=4').get().quantity,1)
assert.equal(db.prepare('SELECT reserved_quantity FROM inventory_stock WHERE variant_id=4').get().reserved_quantity,1)
assert.equal(db.prepare('SELECT status FROM inventory_reservations WHERE id=101').get().status,'active')
assert.equal(db.prepare('SELECT shipping_status FROM orders WHERE id=42').get().shipping_status,'sent')
assert.equal(db.prepare("SELECT status FROM inventory_lifecycle_events WHERE id=20").get().status,'pending')
assert.equal(db.prepare("SELECT quantity FROM inventory_stock WHERE variant_id=3").get().quantity,4)
assert.equal(db.prepare("SELECT quantity FROM inventory_stock WHERE variant_id=5").get().quantity,2)
console.log('BRANCH2_INITIAL_SHIPPING_PRESERVES_PENDING_EXCHANGE_PASS')

db.exec("INSERT INTO inventory_reservations VALUES (104,42,99,'unresolved',1,NULL,'warehouse')")
db.exec("INSERT INTO order_items VALUES(99,42,1,'Another replacement')")
db.exec("INSERT INTO inventory_lifecycle_events VALUES (22,9,42,99,'exchange','exchange_new_out','pending','awaiting_dispatch')")
assert.equal(db.prepare(shippedSql).all(42).some(r=>r.order_item_id===99),false)
const latePending=db.prepare('SELECT id FROM inventory_lifecycle_events WHERE order_item_id=? AND status=? AND pending_reason=?').get(99,'pending','awaiting_dispatch')
assert.equal(latePending.id,22)
db.close()
console.log('BRANCH2_PENDING_REPLACEMENT_UNIFIED_SHIPPING_PASS')
