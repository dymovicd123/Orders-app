PRAGMA foreign_keys = ON;

-- Granular Catalog retirement history.
-- Whole product/execution retirement remains in catalog_retirement_operations.
-- This table records operator-driven exact-SKU and local subgroup retirements so
-- the "Удалённые" UI can present one durable history without guessing from inactive rows.

CREATE TABLE IF NOT EXISTS catalog_retirement_history_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL CHECK (event_type IN ('variant', 'group')),
  product_id INTEGER NOT NULL,
  product_name TEXT NOT NULL,
  stock_position_id INTEGER,
  material TEXT,
  length TEXT,
  category TEXT,
  gender TEXT,
  color TEXT,
  size_label TEXT,
  variant_count INTEGER NOT NULL DEFAULT 1,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_catalog_retirement_history_events_created
  ON catalog_retirement_history_events(created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_catalog_retirement_history_events_product
  ON catalog_retirement_history_events(product_id, created_at DESC);

SELECT 'catalog granular retirement history ready' AS migration_marker;
