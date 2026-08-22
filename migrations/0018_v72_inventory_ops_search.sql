-- Step 16: structured inventory search and faster stock/boutique queries.
-- No destructive changes. These indexes only help the unified warehouse/boutique UI.

CREATE INDEX IF NOT EXISTS idx_inventory_stock_source_product_qty
  ON inventory_stock(inventory_source, product_name_snapshot, quantity);

CREATE INDEX IF NOT EXISTS idx_inventory_stock_source_variant_attrs
  ON inventory_stock(inventory_source, product_name_snapshot, gender_snapshot, color_snapshot, material_snapshot, length_snapshot, size_snapshot);

CREATE INDEX IF NOT EXISTS idx_inventory_movements_source_created
  ON inventory_movements(inventory_source, created_at);
