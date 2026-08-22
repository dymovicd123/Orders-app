-- Step 18: inventory auto write-off hard audit.
-- No stock data is changed here. These indexes only make the audit endpoint faster.

CREATE INDEX IF NOT EXISTS idx_order_items_stock_audit
  ON order_items(order_id, is_workshop, stock_writeoff_status, source_type, variant_id);

CREATE INDEX IF NOT EXISTS idx_exchange_items_role_order_item
  ON exchange_items(role, order_item_id);

CREATE INDEX IF NOT EXISTS idx_inventory_movements_audit_ref
  ON inventory_movements(inventory_source, movement_type, reference_type, reference_id, quantity_delta, variant_id);
