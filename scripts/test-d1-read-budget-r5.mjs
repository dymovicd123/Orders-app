import fs from 'node:fs'

const read = (path) => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

const migration = read('migrations/0062_v72_d1_read_budget_r5_warehouse_indexes.sql')
const attention = read('worker/domains/warehouse-attention.ts')
const catalogReview = read('worker/domains/catalog-review.ts')
const reservations = read('worker/domains/order-reservations.ts')

// R5.1 is deliberately query-plan-only: no warehouse truth or workflow state may be rewritten.
check(!/\b(?:UPDATE|DELETE|INSERT|REPLACE)\b\s+(?:INTO\s+)?(?:inventory_stock|inventory_reservations|orders|order_items|returns|return_items|inventory_lifecycle_events|inventory_handover_reviews|inventory_stocktake_sessions)\b/i.test(migration), 'R5.1 migration must not mutate warehouse/business rows')

check(migration.includes('idx_inventory_stock_source_variant') && migration.includes('ON inventory_stock(inventory_source, variant_id)'), 'stock source/variant lookup index missing')
check(migration.includes('idx_return_items_order_item_return') && migration.includes('ON return_items(order_item_id, return_id)'), 'return-item lookup index missing')
check(migration.includes('idx_inventory_lifecycle_order_item_status') && migration.includes('ON inventory_lifecycle_events(order_item_id, status)'), 'lifecycle order-item lookup index missing')
check(migration.includes('idx_inventory_stocktake_completed_source_time') && migration.includes('ON inventory_stocktake_sessions(inventory_source, completed_at DESC)'), 'completed stocktake source/time index missing')

// Preserve the exact Warehouse Attention semantics while accelerating the joins they already use.
check(attention.includes("{ allActive: true, listFlagsOnly: !details }"), 'Warehouse Attention must keep compact handover mode')
check(attention.includes('fullyExplainedShortageKeys') && attention.includes('rawShortageCount - fullyExplainedShortageKeys.size'), 'handover-explained shortage protection changed')
check(attention.includes("e.status = 'pending' AND e.direction = 'in'"), 'pending intake classification changed')
check(catalogReview.includes("COALESCE(r.status, 'completed') <> 'cancelled'"), 'returned-quantity truth gate changed')
check(attention.includes("e.status = 'pending' AND e.order_item_id = oi.id"), 'catalog/lifecycle exclusion changed')

check(reservations.includes("scoped_order.order_status NOT IN ('deleted', 'archived')"), 'compact handover active-order scope changed')
check(reservations.includes("COALESCE(scoped_order.shipping_status, 'not_sent') <> 'sent'"), 'compact handover shipping scope changed')
check(reservations.includes("date(c.checked_at, '+5 hours') >= date(si.order_date)"), 'handover checkpoint date truth gate changed')
check(
  reservations.includes("s.status = 'completed'")
    && reservations.includes('s.completed_at IS NOT NULL')
    && reservations.includes("s.id NOT LIKE 'REV-%-P-%'")
    && reservations.includes('datetime(s.started_at) <= datetime(si.origin_at)')
    && reservations.includes("date(s.completed_at, '+5 hours') >= date(si.order_date)"),
  'full-stocktake checkpoint scope changed',
)
check(reservations.includes("exact_sku.reference_type = 'stocktake'"), 'exact-SKU stocktake exclusion changed')
check(reservations.includes('exact_sku.reference_id = s.id'), 'exact-SKU stocktake reference identity changed')
check(reservations.includes('COALESCE(stock.reserved_quantity, 0) AS total_reserved_quantity'), 'compact handover stock truth payload changed')

console.log('D1 READ BUDGET R5.1 PASSED — warehouse hot joins are indexed without changing handover, shortage, return, lifecycle, or stocktake truth rules')
