-- Client3 watch aliases. Main product aliases are global, but watches require
-- two separately owned brand namespaces. Exact normalized keys only.
-- No historical orders, SKU, stock, payments or reservation rows are changed.
CREATE TABLE IF NOT EXISTS watch_model_aliases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  brand_id INTEGER NOT NULL REFERENCES watch_brands(id),
  watch_product_id INTEGER NOT NULL REFERENCES watch_products(id),
  alias_key TEXT NOT NULL CHECK(length(alias_key) BETWEEN 1 AND 160),
  alias_text TEXT NOT NULL CHECK(length(alias_text) BETWEEN 1 AND 150),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(brand_id,alias_key)
);
CREATE INDEX IF NOT EXISTS idx_watch_model_aliases_owner
ON watch_model_aliases(brand_id,watch_product_id);
