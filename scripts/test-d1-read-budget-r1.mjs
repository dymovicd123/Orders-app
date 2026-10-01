import fs from 'node:fs'

const relations = fs.readFileSync('worker/domains/orders-relations.ts', 'utf8')
const ordersRead = fs.readFileSync('worker/domains/orders-read.ts', 'utf8')
const reservations = fs.readFileSync('worker/domains/order-reservations.ts', 'utf8')
const fail = (message) => { throw new Error(message) }
const check = (condition, message) => { if (!condition) fail(message) }

check(relations.includes("import { fetchOrderStockHandoverRows } from './order-reservations.ts'"), 'Orders list must keep one canonical handover resolver')
check(relations.includes('fetchOrderStockHandoverRows(db, chunk, { listFlagsOnly: true })'), 'Orders list must request compact handover flags')
check(!relations.includes('inventory_stock_checks') && !relations.includes('inventory_stocktake_sessions'), 'Orders relations must not duplicate checkpoint SQL')
check(reservations.includes('listFlagsOnly?: boolean'), 'Canonical resolver must expose compact list-flags mode')
check(reservations.includes('WITH active_reservations AS'), 'Compact resolver must start from scoped active reservations')
check(reservations.includes('workshop_orders AS'), 'Mixed-order handover semantics must remain explicit')
check(
  reservations.includes('latest_full_stocktake AS')
    || (
      reservations.includes('AS full_point')
      && reservations.includes("s.status = 'completed'")
      && reservations.includes("s.id NOT LIKE 'REV-%-P-%'")
      && reservations.includes('datetime(s.started_at) <= datetime(si.origin_at)')
      && reservations.includes("exact_sku.reference_type = 'stocktake'")
    ),
  'Full-stocktake fallback must remain in compact resolver',
)
check(
  reservations.includes('latest_review AS')
    || (
      reservations.includes('AS review_point')
      && reservations.includes('ORDER BY datetime(hr.checkpoint_at) DESC, hr.checkpoint_id DESC, hr.id DESC')
      && reservations.includes('reviewed_checkpoint_id')
      && reservations.includes('reviewed_checkpoint_at')
    ),
  'Existing handover answers must still suppress reviewed checkpoints',
)
check(reservations.includes('THEN 1 ELSE 0 END AS review_needed'), 'Compact resolver must preserve review-needed flag')
check(reservations.includes('const rows = await fetchOrderStockHandoverRows(db, [orderId])'), 'Explicit order handover must still use full canonical payload')
check(reservations.includes("fetchOrderStockHandoverRows(db, [], { allActive: true })"), 'Warehouse attention count must still use full canonical resolver')
check(ordersRead.includes('const exactExternalId = /^ORD-'), 'Complete ORD identifiers must retain an explicit exact-id detector')
check(ordersRead.includes("baseWhereParts.push('o.external_id = ?')"), 'Exact order search must use external_id equality')
check(ordersRead.includes("if (q && Array.from(q).length < 3) {"), 'R7.1 short generic search guard missing')
check(ordersRead.indexOf("if (q && Array.from(q).length < 3) {") < ordersRead.indexOf('await isOrderPricingFoundationEnabled(db)'), 'R7.1 short search must return before any D1 read')
check(!ordersRead.includes('const searchOrderText ='), 'R7.1 legacy short full-table order scan returned')
check(ordersRead.includes('order_search_orders_fts MATCH ?'), 'General order FTS search missing')
check(ordersRead.includes('order_search_items_fts MATCH ?'), 'General item FTS search missing')
check(ordersRead.includes('order_search_payments_fts MATCH ?'), 'General payment FTS search missing')

console.log('D1 read-budget R1 regression: OK — R7.1 keeps exact/prefix/FTS search while removing 1–2 character scans')
