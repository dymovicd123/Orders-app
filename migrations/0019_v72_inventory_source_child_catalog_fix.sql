PRAGMA foreign_keys = ON;

-- Step 16B SAFE2: one-time hotfix before Step 17.
-- Fixes warehouse/boutique labels without using TEMP tables, because Cloudflare D1 may reject TEMP table operations with SQLITE_AUTH.
-- Why this structure:
-- 1) The direct UPDATE warehouse<->boutique can fail on idx_inventory_stock_unique.
-- 2) TEMP tables can fail in D1 with "not authorized: SQLITE_AUTH".
-- 3) This migration uses a normal short-lived staging table, deletes original stock rows, reinserts swapped rows with original ids, then drops staging.
-- It is guarded by app_settings and becomes a no-op after value = applied.

BEGIN TRANSACTION;

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO app_settings (key, value, updated_at)
SELECT 'v72_step16b_inventory_source_swap', 'pending', datetime('now')
WHERE NOT EXISTS (SELECT 1 FROM app_settings WHERE key = 'v72_step16b_inventory_source_swap');

DROP TABLE IF EXISTS _inventory_stock_step16b_swap;

CREATE TABLE _inventory_stock_step16b_swap (
  id INTEGER PRIMARY KEY,
  inventory_source TEXT NOT NULL,
  product_id INTEGER,
  variant_id INTEGER,
  product_name_snapshot TEXT NOT NULL,
  gender_snapshot TEXT,
  color_snapshot TEXT,
  material_snapshot TEXT,
  length_snapshot TEXT,
  size_snapshot TEXT,
  quantity INTEGER NOT NULL DEFAULT 0,
  reserved_quantity INTEGER NOT NULL DEFAULT 0,
  last_action TEXT,
  last_source_ref TEXT,
  updated_at TEXT,
  created_at TEXT,
  external_product_id TEXT,
  external_variant_id TEXT
);

INSERT INTO _inventory_stock_step16b_swap (
  id,
  inventory_source,
  product_id,
  variant_id,
  product_name_snapshot,
  gender_snapshot,
  color_snapshot,
  material_snapshot,
  length_snapshot,
  size_snapshot,
  quantity,
  reserved_quantity,
  last_action,
  last_source_ref,
  updated_at,
  created_at,
  external_product_id,
  external_variant_id
)
SELECT
  id,
  CASE inventory_source
    WHEN 'warehouse' THEN 'boutique'
    WHEN 'boutique' THEN 'warehouse'
    ELSE inventory_source
  END AS inventory_source,
  product_id,
  variant_id,
  product_name_snapshot,
  gender_snapshot,
  color_snapshot,
  material_snapshot,
  length_snapshot,
  size_snapshot,
  quantity,
  reserved_quantity,
  last_action,
  last_source_ref,
  updated_at,
  created_at,
  external_product_id,
  external_variant_id
FROM inventory_stock
WHERE EXISTS (
  SELECT 1 FROM app_settings
  WHERE key = 'v72_step16b_inventory_source_swap' AND value = 'pending'
);

DELETE FROM inventory_stock
WHERE EXISTS (
  SELECT 1 FROM app_settings
  WHERE key = 'v72_step16b_inventory_source_swap' AND value = 'pending'
);

INSERT INTO inventory_stock (
  id,
  inventory_source,
  product_id,
  variant_id,
  product_name_snapshot,
  gender_snapshot,
  color_snapshot,
  material_snapshot,
  length_snapshot,
  size_snapshot,
  quantity,
  reserved_quantity,
  last_action,
  last_source_ref,
  updated_at,
  created_at,
  external_product_id,
  external_variant_id
)
SELECT
  id,
  inventory_source,
  product_id,
  variant_id,
  product_name_snapshot,
  gender_snapshot,
  color_snapshot,
  material_snapshot,
  length_snapshot,
  size_snapshot,
  quantity,
  reserved_quantity,
  last_action,
  last_source_ref,
  datetime('now'),
  created_at,
  external_product_id,
  external_variant_id
FROM _inventory_stock_step16b_swap
WHERE EXISTS (
  SELECT 1 FROM app_settings
  WHERE key = 'v72_step16b_inventory_source_swap' AND value = 'pending'
);

UPDATE inventory_movements
SET inventory_source = CASE inventory_source
    WHEN 'warehouse' THEN 'boutique'
    WHEN 'boutique' THEN 'warehouse'
    ELSE inventory_source
  END
WHERE EXISTS (
  SELECT 1 FROM app_settings
  WHERE key = 'v72_step16b_inventory_source_swap' AND value = 'pending'
);

UPDATE app_settings
SET value = 'applied', updated_at = datetime('now')
WHERE key = 'v72_step16b_inventory_source_swap' AND value = 'pending';

DROP TABLE IF EXISTS _inventory_stock_step16b_swap;

COMMIT;

CREATE INDEX IF NOT EXISTS idx_inventory_stock_variant_source_qty
  ON inventory_stock(inventory_source, variant_id, quantity);

CREATE INDEX IF NOT EXISTS idx_catalog_variants_category_product
  ON catalog_variants(category, product_id, is_active);

SELECT 'v72 step 16B SAFE2 inventory source swap without temp tables' AS migration_marker;
