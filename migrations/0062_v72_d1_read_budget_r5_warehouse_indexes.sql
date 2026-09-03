-- D1 Read Budget R5.1: Warehouse Attention / handover hot-read indexes.
-- Additive only. These indexes do not change physical stock, reservations, orders, returns,
-- lifecycle state, handover decisions, stocktake facts, or any user-visible business rule.
-- They only give the existing truth-preserving queries direct lookup paths.

-- Warehouse Attention and compact handover repeatedly join active reservations to the canonical
-- stock row by (inventory_source, variant_id). The legacy stock indexes are snapshot-name based,
-- so this join otherwise scans a large part of inventory_stock for every reservation group.
CREATE INDEX IF NOT EXISTS idx_inventory_stock_source_variant
  ON inventory_stock(inventory_source, variant_id)
  WHERE variant_id IS NOT NULL;

-- Catalog-review attention checks the already-returned quantity of each unresolved order item.
-- return_items historically had only a return_id index, while this hot predicate starts from
-- order_item_id and then validates the parent return status.
CREATE INDEX IF NOT EXISTS idx_return_items_order_item_return
  ON return_items(order_item_id, return_id)
  WHERE order_item_id IS NOT NULL;

-- The same attention query excludes unresolved order items that already have a pending lifecycle
-- event. The existing lifecycle index starts with order_id, so an order_item-only lookup could not
-- use it efficiently.
CREATE INDEX IF NOT EXISTS idx_inventory_lifecycle_order_item_status
  ON inventory_lifecycle_events(order_item_id, status)
  WHERE order_item_id IS NOT NULL;

-- Safe handover lineage needs the latest completed full stocktake for a source. Active-session
-- indexing does not help this historical lookup; keep the exact existing freshness rules but make
-- the source + newest completed checkpoint lookup index-backed.
CREATE INDEX IF NOT EXISTS idx_inventory_stocktake_completed_source_time
  ON inventory_stocktake_sessions(inventory_source, completed_at DESC)
  WHERE status = 'completed' AND completed_at IS NOT NULL;

PRAGMA optimize;
