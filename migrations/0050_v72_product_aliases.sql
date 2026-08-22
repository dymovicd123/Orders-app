-- Step 188F1: safe product-only typo learning.
-- A confirmed alias points only to catalog_products and therefore cannot rewrite
-- color, size, material, length, gender or execution identity.

CREATE TABLE IF NOT EXISTS catalog_product_aliases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  alias_key TEXT NOT NULL UNIQUE,
  raw_value TEXT NOT NULL,
  product_id INTEGER NOT NULL REFERENCES catalog_products(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_catalog_product_aliases_product
  ON catalog_product_aliases (product_id);
