-- Step 192B1: stable warehouse obligation lineage for safe late-handover review.
-- No inventory_stock mutation. Existing rows keep NULL and use their immutable order_item id/created_at as fallback.
ALTER TABLE order_items ADD COLUMN inventory_obligation_key TEXT;
ALTER TABLE order_items ADD COLUMN inventory_obligation_origin_at TEXT;

CREATE INDEX IF NOT EXISTS idx_order_items_inventory_obligation_key
  ON order_items(order_id, inventory_obligation_key);
