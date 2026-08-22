PRAGMA foreign_keys = ON;

-- Step 17: manual inventory operations use catalog variant ids when possible.
-- No source swap is done here. Current stock values stay as they are;
-- final warehouse/boutique stock will be re-imported later from the old Google Sheets source.

CREATE INDEX IF NOT EXISTS idx_inventory_stock_source_variant_manual
  ON inventory_stock(inventory_source, variant_id);

CREATE INDEX IF NOT EXISTS idx_inventory_movements_variant_manual
  ON inventory_movements(inventory_source, variant_id, created_at);

CREATE INDEX IF NOT EXISTS idx_catalog_variants_product_active_manual
  ON catalog_variants(product_id, is_active, sort_order);
