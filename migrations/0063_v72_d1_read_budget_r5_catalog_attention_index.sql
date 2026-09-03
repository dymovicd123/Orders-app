-- D1 Read Budget R5.2: target the actual Warehouse Attention hotspot measured in Production.
-- Additive only. No order, stock, reservation, return, lifecycle, workshop, or catalog row is changed.
-- The current catalog-attention query starts from orders and repeatedly probes all order items by
-- order_id. Restrict that lookup to the unresolved, non-excluded subset the query already requires.

CREATE INDEX IF NOT EXISTS idx_order_items_catalog_attention_order
  ON order_items(order_id, id)
  WHERE quantity > 0
    AND (product_id IS NULL OR variant_id IS NULL)
    AND COALESCE(stock_writeoff_status, '') NOT IN (
      'catalog_excluded',
      'catalog_excluded_history',
      'workshop_no_catalog'
    );

PRAGMA optimize;
