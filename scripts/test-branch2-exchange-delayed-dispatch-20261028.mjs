import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

const read=p=>readFileSync(p,'utf8')
const backend=read('worker/domains/returns-exchanges.ts')
const batch=read('worker/domains/exchange-batch.ts')
const lifecycle=read('worker/domains/lifecycle.ts')
const list=read('worker/domains/orders-relations.ts')
const orders=read('src/features/sections/OrdersTableSection.tsx')
const app=read('src/App.tsx')
const smart=read('src/features/sections/OrderExchangeSmartSection.tsx')
const legacy=read('src/features/sections/OrderExchangeSection.tsx')
const routes=read('worker/index.ts')

assert.match(smart,/item\.shipmentState === 'sent'/)
assert.match(smart,/item\.shipmentState === 'pending'/)
assert.match(smart,/Не забудьте отметить отправку!/)
assert.match(smart,/filledNewItems\.some\(\(entry: any\) => entry\.item\?\.sourceType !== 'workshop'/)
assert.match(legacy,/exchangeDraft\.newItem\.shipmentState === 'sent'/)
assert.match(legacy,/exchangeDraft\.newItem\.shipmentState === 'pending'/)
assert.match(app,/item\.shipmentState !== 'sent' && item\.shipmentState !== 'pending'/)
assert.match(backend,/const shipmentState = cleanText\(\(requested as any\)\.shipmentState\)/)
assert.match(backend,/if \(variantId && shipmentState === 'sent'\)/)
assert.match(backend,/if \(plan\.shipmentState === 'sent' && resolved\.variantId\)/)
assert.match(backend,/if \(shipmentState === 'sent' && resolvedNew\.variantId\)/)
assert.match(backend,/pendingReason: plan\.shipmentState === 'pending' \? 'awaiting_dispatch'/)
assert.match(backend,/pendingReason: shipmentState === 'pending' \? 'awaiting_dispatch'/)
assert.match(batch,/shipmentState !== 'sent' && shipmentState !== 'pending'/)
assert.match(batch,/resolvedVariantId && \(effectiveNewItem as any\)\.shipmentState === 'sent'/)
assert.match(backend,/beginCriticalOperation\(db, 'exchange_replacement_dispatch', requestId, \{ eventId \}\)/)
assert.match(backend,/cleanText\(row\.pending_reason\) !== 'awaiting_dispatch'/)
assert.match(backend,/await applyCanonicalInventoryLifecycleEvent\(db, eventId, resolved\.variantId, now/)
assert.match(backend,/await completeCriticalOperation\(db, operation, completedResponse\)/)
assert.match(routes,/api\\\/exchanges\\\/pending-dispatch/)
const unifiedDispatch=read('worker/domains/order-dispatch.ts')
assert.match(orders,/openDispatchDraft\(order\)/, 'One order shipment checklist is required')
assert(!orders.includes('order-exchange-dispatch-button'), 'Remove competing per-replacement send buttons')
assert(unifiedDispatch.includes('replacementByItem.set(')
  && unifiedDispatch.includes("pending_reason='awaiting_dispatch'"),
  'Exchange replacement must participate in the same atomic dispatch and its lifecycle guard')
assert.match(list,/AND e\.pending_reason='awaiting_dispatch'/)
assert.match(app,/async function markExchangeReplacementSent/)
assert.match(lifecycle,/if \(cleanText\(event\.status\) === 'applied'\) return \{ applied: false, already: true, event \}/)
assert.match(lifecycle,/WHERE id = \? AND status = 'pending'/)
assert.match(app,/const critical = prepareCriticalRequest\(key, \{ eventId \}\)/)

// The existing checkpoint implementation must cover correction, full stocktake,
// selective stocktake and manual quick count, and refresh order handover flags.
const movement=read('worker/domains/inventory-movement.ts')
const stocktake=read('worker/domains/inventory-stocktake.ts')
const handover=read('worker/domains/order-reservations.ts')
const inventoryUI=read('src/features/sections/InventorySection.tsx')
assert.match(movement,/INSERT OR IGNORE INTO inventory_stock_checks/)
assert.match(movement,/'manual_set', 'manual'/)
assert.match(handover,/type\.includes\('stocktake'\) \? 'revision' : 'check'/)
assert.match(handover,/FROM inventory_stock_checks/)
assert.match(stocktake,/inventory_stock_checks/)
assert.match(app,/inventoryDraft\.movementType === 'manual_set'\) void loadDashboard\(false\)/)
assert.match(inventoryUI,/void refreshOrdersAfterPhysicalCheck\?\.\(\)/)
assert.match(inventoryUI,/onSuccess: refreshOrdersAfterPhysicalCheck/)

// SQL fixture: only intentional, active pending dispatches should appear.
// Historical unresolved events and already-issued events must remain hidden.
const db=new DatabaseSync(':memory:')
db.exec(`
CREATE TABLE order_items(id INTEGER PRIMARY KEY, quantity INTEGER);
CREATE TABLE exchanges(id INTEGER PRIMARY KEY, status TEXT);
CREATE TABLE inventory_lifecycle_events(id INTEGER PRIMARY KEY, operation_id INTEGER, order_item_id INTEGER, operation_type TEXT, event_type TEXT, status TEXT, pending_reason TEXT);
INSERT INTO order_items VALUES (1,1),(2,1),(3,1),(4,1);
INSERT INTO exchanges VALUES (10,'completed'),(11,'cancelled');
INSERT INTO inventory_lifecycle_events VALUES
(100,10,1,'exchange','exchange_new_out','pending','awaiting_dispatch'),
(101,10,2,'exchange','exchange_new_out','applied',NULL),
(102,10,3,'exchange','exchange_new_out','pending','unresolved_variant'),
(103,11,4,'exchange','exchange_new_out','pending','awaiting_dispatch');
`)
const sql=`SELECT oi.id,
(SELECT e.id FROM inventory_lifecycle_events e
 JOIN exchanges exchange_row ON exchange_row.id=e.operation_id
 WHERE e.order_item_id=oi.id AND e.operation_type='exchange'
 AND e.event_type='exchange_new_out' AND e.status='pending'
 AND e.pending_reason='awaiting_dispatch'
 AND COALESCE(exchange_row.status,'completed')<>'cancelled'
 ORDER BY e.id DESC LIMIT 1) AS pending_exchange_dispatch_id
FROM order_items oi ORDER BY oi.id`
assert.deepEqual(db.prepare(sql).all().map(x=>x.pending_exchange_dispatch_id),[100,null,null,null])
db.close()
console.log('EXCHANGE_DEFERRED_SHIPMENT_AND_CORRECTION_HANDOVER_PASS')
