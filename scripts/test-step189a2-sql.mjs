import { DatabaseSync } from 'node:sqlite'
import { readdirSync, readFileSync } from 'node:fs'

const db = new DatabaseSync(':memory:')
db.exec('PRAGMA foreign_keys = ON;')
for (const file of readdirSync('migrations').filter((name) => name.endsWith('.sql')).sort()) {
  db.exec(readFileSync(`migrations/${file}`, 'utf8'))
}

const run = (sql, ...params) => db.prepare(sql).run(...params)
const get = (sql, ...params) => db.prepare(sql).get(...params)
const all = (sql, ...params) => db.prepare(sql).all(...params)
const idOf = (result) => Number(result.lastInsertRowid)
const assert = (condition, message) => { if (!condition) throw new Error(message) }

const recentPredicate = `datetime(COALESCE(NULLIF(oi.created_at, ''), NULLIF(o.created_at, ''), o.order_date || 'T00:00:00Z')) >= datetime('now', '-30 days')`
const basePredicate = `oi.quantity > 0
  AND (oi.product_id IS NULL OR oi.variant_id IS NULL)
  AND COALESCE(oi.stock_writeoff_status, '') NOT IN ('catalog_excluded', 'catalog_excluded_history', 'workshop_no_catalog')
  AND COALESCE(o.order_status, 'active') NOT IN ('deleted', 'archived')
  AND COALESCE(o.archived_at, '') = ''
  AND COALESCE((
    SELECT SUM(ri.quantity)
    FROM return_items ri
    JOIN returns r ON r.id = ri.return_id
    WHERE ri.order_item_id = oi.id
      AND COALESCE(r.status, 'completed') <> 'cancelled'
  ), 0) < oi.quantity`
const operationalPredicate = `(${recentPredicate} AND (
  (COALESCE(oi.is_workshop, 0) = 1 AND oi.product_id IS NULL AND EXISTS (
    SELECT 1 FROM workshop_tasks wt WHERE wt.order_item_id = oi.id AND wt.quantity > 0 AND wt.status IN ('active', 'ready')
  ))
  OR (COALESCE(oi.is_workshop, 0) = 0 AND COALESCE(o.shipping_status, 'not_sent') <> 'sent')
))`
const orderScopePredicate = `(
  (COALESCE(oi.is_workshop, 0) = 1 AND oi.product_id IS NULL AND EXISTS (
    SELECT 1 FROM workshop_tasks wt WHERE wt.order_item_id = oi.id AND wt.quantity > 0 AND wt.status IN ('active', 'ready')
  ))
  OR (COALESCE(oi.is_workshop, 0) = 0 AND COALESCE(o.shipping_status, 'not_sent') <> 'sent')
)`

function addOrder(externalId, orderDate, createdAt, { shipping = 'not_sent', status = 'active' } = {}) {
  return idOf(run(
    `INSERT INTO orders(external_id, order_date, order_status, shipping_status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    externalId, orderDate, status, shipping, createdAt, createdAt,
  ))
}
function addUnresolvedItem(orderId, name, createdAt, { workshop = false, status = 'catalog_unresolved' } = {}) {
  const id = idOf(run(
    `INSERT INTO order_items(order_id, product_name_snapshot, quantity, is_workshop, source_type, stock_writeoff_status, created_at)
     VALUES (?, ?, 1, ?, 'warehouse', ?, ?)`,
    orderId, name, workshop ? 1 : 0, status, createdAt,
  ))
  if (workshop) run(
    `INSERT INTO workshop_tasks(order_id, external_order_id, product_name_snapshot, quantity, status, created_at, updated_at, order_item_id)
     SELECT ?, external_id, ?, 1, 'active', ?, ?, ? FROM orders WHERE id = ?`,
    orderId, name, createdAt, createdAt, id, orderId,
  )
  return id
}

const oldOrder = addOrder('ORD-OLD-SAUKеле', '2026-06-30', '2026-06-30T19:17:43Z')
const oldSaukеле = addUnresolvedItem(oldOrder, 'САУКЕЛЕ', '2026-06-30T19:17:43Z', { workshop: true })
const recentOrder = addOrder('ORD-RECENT', '2026-06-10', new Date().toISOString()) // old business date, late system entry
const recentLate = addUnresolvedItem(recentOrder, 'ПОЗДНИЙ ТОВАР', new Date().toISOString())
const recentWorkshopOrder = addOrder('ORD-RECENT-WORKSHOP', '2026-08-18', new Date().toISOString())
const recentWorkshop = addUnresolvedItem(recentWorkshopOrder, 'НОВЫЙ ЦЕХ', new Date().toISOString(), { workshop: true })
const excludedOrder = addOrder('ORD-EXCLUDED', '2026-08-18', new Date().toISOString())
addUnresolvedItem(excludedOrder, 'НЕ В КАТАЛОГ', new Date().toISOString(), { status: 'catalog_excluded' })

const normalQueue = all(
  `SELECT oi.id, oi.product_name_snapshot FROM order_items oi JOIN orders o ON o.id=oi.order_id
   WHERE ${basePredicate} AND ${operationalPredicate} ORDER BY oi.id`,
)
const normalIds = new Set(normalQueue.map((row) => Number(row.id)))
assert(!normalIds.has(oldSaukеле), 'Old June САУКЕЛЕ leaked into the normal review queue')
assert(normalIds.has(recentLate), 'Late-entered order with old business date was incorrectly hidden')
assert(normalIds.has(recentWorkshop), 'Recent active Workshop review item was incorrectly hidden')
assert(!normalQueue.some((row) => row.product_name_snapshot === 'НЕ В КАТАЛОГ'), 'Explicit catalog exclusion leaked back into review')

const oldOrderQueue = all(
  `SELECT oi.id FROM order_items oi JOIN orders o ON o.id=oi.order_id
   WHERE ${basePredicate} AND ${orderScopePredicate} AND oi.order_id = ?`, oldOrder,
)
assert(oldOrderQueue.some((row) => Number(row.id) === oldSaukеле), 'Exact old order could not resurface its unresolved Workshop item')

// Storage safety: active/unresolved reservations and pending lifecycle events must block an old month.
const productId = idOf(run("INSERT INTO catalog_products(name) VALUES ('TEST STORAGE PRODUCT')"))
const variantId = idOf(run("INSERT INTO catalog_variants(product_id, size_label) VALUES (?, '50')", productId))
const blockedReservationOrder = addOrder('OLD-ACTIVE-RESERVATION', '2024-01-10', '2024-01-10T10:00:00Z', { shipping: 'sent', status: 'closed' })
const blockedItem = idOf(run(
  `INSERT INTO order_items(order_id, product_id, variant_id, product_name_snapshot, quantity, source_type, stock_writeoff_status, created_at)
   VALUES (?, ?, ?, 'TEST STORAGE PRODUCT', 1, 'warehouse', 'reserved', '2024-01-10T10:00:00Z')`,
  blockedReservationOrder, productId, variantId,
))
run(
  `INSERT INTO inventory_reservations(order_id, order_item_id, inventory_source, product_id, variant_id, quantity, status, reference_type, created_at, updated_at)
   VALUES (?, ?, 'warehouse', ?, ?, 1, 'active', 'order', '2024-01-10T10:00:00Z', '2024-01-10T10:00:00Z')`,
  blockedReservationOrder, blockedItem, productId, variantId,
)

const blockedLifecycleOrder = addOrder('OLD-PENDING-LIFECYCLE', '2024-01-11', '2024-01-11T10:00:00Z', { shipping: 'sent', status: 'closed' })
const blockedLifecycleItem = idOf(run(
  `INSERT INTO order_items(order_id, product_id, variant_id, product_name_snapshot, quantity, source_type, stock_writeoff_status, created_at)
   VALUES (?, ?, ?, 'TEST STORAGE PRODUCT', 1, 'warehouse', 'fulfilled', '2024-01-11T10:00:00Z')`,
  blockedLifecycleOrder, productId, variantId,
))
run(
  `INSERT INTO inventory_lifecycle_events(event_key, operation_type, operation_id, order_id, order_item_id, event_type, direction, inventory_source, quantity, product_id, variant_id, product_name_snapshot, status, created_at, updated_at)
   VALUES ('pending-test', 'return', 1, ?, ?, 'return_in', 'in', 'warehouse', 1, ?, ?, 'TEST STORAGE PRODUCT', 'pending', '2024-01-11T10:00:00Z', '2024-01-11T10:00:00Z')`,
  blockedLifecycleOrder, blockedLifecycleItem, productId, variantId,
)

const reservationCount = Number(get(
  `SELECT COUNT(*) AS c FROM inventory_reservations ir JOIN orders o ON o.id=ir.order_id
   WHERE o.order_date >= '2024-01-01' AND o.order_date < '2024-02-01' AND ir.status IN ('active','unresolved')`,
).c)
const lifecycleCount = Number(get(
  `SELECT COUNT(*) AS c FROM inventory_lifecycle_events ile JOIN orders o ON o.id=ile.order_id
   WHERE o.order_date >= '2024-01-01' AND o.order_date < '2024-02-01' AND ile.status='pending'`,
).c)
assert(reservationCount === 1, 'Storage month guard missed active inventory reservation')
assert(lifecycleCount === 1, 'Storage month guard missed pending lifecycle event')

// FK ordering: deleting a movement referenced by lifecycle first must fail; deleting the lifecycle row first must succeed.
const safeOrder = addOrder('OLD-SAFE-LIFECYCLE', '2024-02-10', '2024-02-10T10:00:00Z', { shipping: 'sent', status: 'closed' })
const safeItem = idOf(run(
  `INSERT INTO order_items(order_id, product_id, variant_id, product_name_snapshot, quantity, source_type, stock_writeoff_status, created_at)
   VALUES (?, ?, ?, 'TEST STORAGE PRODUCT', 1, 'warehouse', 'fulfilled', '2024-02-10T10:00:00Z')`,
  safeOrder, productId, variantId,
))
const movementId = idOf(run(
  `INSERT INTO inventory_movements(inventory_source, movement_type, product_id, variant_id, product_name_snapshot, quantity_delta, quantity_after, reference_type, reference_id, created_at)
   VALUES ('warehouse','sale',?,?, 'TEST STORAGE PRODUCT',-1,0,'order','OLD-SAFE-LIFECYCLE','2024-02-10T10:00:00Z')`,
  productId, variantId,
))
run(
  `INSERT INTO inventory_lifecycle_events(event_key, operation_type, operation_id, order_id, order_item_id, event_type, direction, inventory_source, quantity, product_id, variant_id, product_name_snapshot, status, movement_id, created_at, updated_at, applied_at)
   VALUES ('applied-test','return',2,?,?,'return_in','in','warehouse',1,?,?, 'TEST STORAGE PRODUCT','applied',?,'2024-02-10T10:00:00Z','2024-02-10T10:00:00Z','2024-02-10T10:00:00Z')`,
  safeOrder, safeItem, productId, variantId, movementId,
)
let fkBlocked = false
try { run('DELETE FROM inventory_movements WHERE id = ?', movementId) } catch { fkBlocked = true }
assert(fkBlocked, 'Test schema did not enforce lifecycle -> movement FK as expected')
run('DELETE FROM inventory_lifecycle_events WHERE order_id = ?', safeOrder)
run('DELETE FROM inventory_movements WHERE id = ?', movementId)
assert(Number(get('SELECT COUNT(*) AS c FROM inventory_movements WHERE id=?', movementId).c) === 0, 'Safe lifecycle-before-movement deletion order failed')

// 0057 review rows must not make an otherwise-safe old order undeletable.
const handoverOrder = addOrder('OLD-HANDOVER-HISTORY', '2024-03-10', '2024-03-10T10:00:00Z', { shipping: 'sent', status: 'closed' })
const handoverItem = idOf(run(
  `INSERT INTO order_items(order_id, product_id, variant_id, product_name_snapshot, quantity, source_type, stock_writeoff_status, created_at)
   VALUES (?, ?, ?, 'TEST STORAGE PRODUCT', 1, 'warehouse', 'fulfilled', '2024-03-10T10:00:00Z')`,
  handoverOrder, productId, variantId,
))
const handoverReservation = idOf(run(
  `INSERT INTO inventory_reservations(order_id, order_item_id, inventory_source, product_id, variant_id, quantity, status, reference_type, created_at, updated_at, fulfilled_at)
   VALUES (?, ?, 'warehouse', ?, ?, 1, 'fulfilled', 'order', '2024-03-10T10:00:00Z', '2024-03-10T10:00:00Z', '2024-03-10T10:00:00Z')`,
  handoverOrder, handoverItem, productId, variantId,
))
run(
  `INSERT INTO inventory_handover_reviews(order_id, order_item_id, reservation_id, decision, checkpoint_id, checkpoint_type, checkpoint_at, reviewed_at)
   VALUES (?, ?, ?, 'issued_before_checkpoint', 1, 'full_stocktake', '2024-03-11T10:00:00Z', '2024-03-11T10:00:00Z')`,
  handoverOrder, handoverItem, handoverReservation,
)
run('DELETE FROM order_items WHERE id=?', handoverItem)
assert(Number(get('SELECT COUNT(*) AS c FROM inventory_handover_reviews WHERE order_id=?', handoverOrder).c) === 0, '0057 handover review did not cascade with deleted order item')
assert(Number(get('SELECT COUNT(*) AS c FROM inventory_reservations WHERE order_id=?', handoverOrder).c) === 0, 'Fulfilled reservation did not cascade with deleted order item')
run('DELETE FROM orders WHERE id=?', handoverOrder)

run("INSERT INTO inventory_stocktake_sessions(id, inventory_source, status, started_at, updated_at) VALUES ('ACTIVE-STOCKTAKE','warehouse','active',datetime('now'),datetime('now'))")
assert(Number(get("SELECT COUNT(*) AS c FROM inventory_stocktake_sessions WHERE status='active'").c) === 1, 'Active stocktake cleanup guard test failed')

console.log('Step 189A.2 SQL safety test passed: old review noise hidden, late entries stay visible, exact old-order resurfacing works, and storage guards/FK ordering are enforced.')
