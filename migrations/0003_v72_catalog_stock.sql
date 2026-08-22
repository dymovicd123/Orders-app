PRAGMA foreign_keys = ON;

-- v72 catalog/stock import support.
-- Run once on the local D1 database before generated/import_test1_catalog_stock.sql.

ALTER TABLE catalog_products ADD COLUMN external_id TEXT;
ALTER TABLE catalog_variants ADD COLUMN external_id TEXT;
ALTER TABLE catalog_variants ADD COLUMN category TEXT NOT NULL DEFAULT 'adult' CHECK (category IN ('adult', 'child'));
ALTER TABLE inventory_stock ADD COLUMN external_product_id TEXT;
ALTER TABLE inventory_stock ADD COLUMN external_variant_id TEXT;
ALTER TABLE inventory_movements ADD COLUMN external_product_id TEXT;
ALTER TABLE inventory_movements ADD COLUMN external_variant_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_catalog_products_external_id
  ON catalog_products(external_id)
  WHERE external_id IS NOT NULL AND external_id <> '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_catalog_variants_external_id
  ON catalog_variants(external_id)
  WHERE external_id IS NOT NULL AND external_id <> '';

CREATE INDEX IF NOT EXISTS idx_inventory_stock_external_variant
  ON inventory_stock(inventory_source, external_variant_id);

CREATE INDEX IF NOT EXISTS idx_inventory_movements_external_variant
  ON inventory_movements(inventory_source, external_variant_id);
