PRAGMA foreign_keys = ON;

-- Step 19: inventory UI/bulk operations support.
-- No destructive data changes here. We only add safe indexes for faster manual operations,
-- catalog lookup and movement/reconciliation screens.

CREATE INDEX IF NOT EXISTS idx_catalog_products_name_category
  ON catalog_products(name, category);

CREATE INDEX IF NOT EXISTS idx_catalog_variants_product_category
  ON catalog_variants(product_id, category, gender, color, material, length, size_label);

CREATE INDEX IF NOT EXISTS idx_inventory_movements_type_ref_created
  ON inventory_movements(movement_type, reference_type, created_at);

CREATE INDEX IF NOT EXISTS idx_inventory_stock_problem_scan
  ON inventory_stock(inventory_source, quantity, product_name_snapshot);
