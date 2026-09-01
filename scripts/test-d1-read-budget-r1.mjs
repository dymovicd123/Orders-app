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
check(reservations.includes('latest_full_stocktake AS'), 'Full-stocktake fallback must remain in compact resolver')
check(reservations.includes('latest_review AS'), 'Existing handover answers must still suppress reviewed checkpoints')
check(reservations.includes('THEN 1 ELSE 0 END AS review_needed'), 'Compact resolver must preserve review-needed flag')
check(reservations.includes('const rows = await fetchOrderStockHandoverRows(db, [orderId])'), 'Explicit order handover must still use full canonical payload')
check(reservations.includes("fetchOrderStockHandoverRows(db, [], { allActive: true })"), 'Warehouse attention count must still use full canonical resolver')
check(ordersRead.includes('const exactExternalId = /^ORD-'), 'Complete ORD identifiers must retain an explicit exact-id detector')
check(ordersRead.includes("baseWhereParts.push('o.external_id = ?')"), 'Exact order search must use external_id equality')
check(ordersRead.includes('const searchOrderText = `COALESCE(o.external_id'), 'General free-text search fallback must remain available')
check(ordersRead.includes('EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = o.id'), 'General item search fallback must remain available')
check(ordersRead.includes('EXISTS (SELECT 1 FROM payments search_payment WHERE search_payment.order_id = o.id'), 'General payment search fallback must remain available')

console.log('D1 read-budget R1 regression: OK')