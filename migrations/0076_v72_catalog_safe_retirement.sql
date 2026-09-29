PRAGMA foreign_keys = ON;

-- Catalog safe retirement (Branch2-first).
-- Working Catalog/Inventory entities may be retired without deleting order/history facts.
-- Retired executions/products remain as historical identities; re-adding later creates a fresh
-- active execution/SKU generation instead of reviving old stock/reservations.

CREATE TABLE IF NOT EXISTS catalog_retirement_operations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL UNIQUE,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('execution', 'product')),
  entity_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  product_name TEXT NOT NULL,
  material TEXT,
  length TEXT,
  variant_count INTEGER NOT NULL DEFAULT 0,
  physical_quantity INTEGER NOT NULL DEFAULT 0,
  stock_reserved_quantity INTEGER NOT NULL DEFAULT 0,
  active_reservation_quantity INTEGER NOT NULL DEFAULT 0,
  open_order_item_count INTEGER NOT NULL DEFAULT 0,
  reason TEXT,
  created_by TEXT,
  status TEXT NOT NULL DEFAULT 'started' CHECK (status IN ('started', 'completed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_catalog_retirement_operations_entity
  ON catalog_retirement_operations(entity_type, entity_id, created_at DESC);

CREATE TABLE IF NOT EXISTS catalog_retirement_variants (
  retirement_id INTEGER NOT NULL REFERENCES catalog_retirement_operations(id) ON DELETE CASCADE,
  variant_id INTEGER NOT NULL,
  stock_position_id INTEGER,
  product_id INTEGER NOT NULL,
  category TEXT,
  gender TEXT,
  color TEXT,
  material TEXT,
  length TEXT,
  size_label TEXT,
  warehouse_quantity INTEGER NOT NULL DEFAULT 0,
  warehouse_reserved_quantity INTEGER NOT NULL DEFAULT 0,
  boutique_quantity INTEGER NOT NULL DEFAULT 0,
  boutique_reserved_quantity INTEGER NOT NULL DEFAULT 0,
  active_reservation_quantity INTEGER NOT NULL DEFAULT 0,
  captured_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (retirement_id, variant_id)
);

CREATE INDEX IF NOT EXISTS idx_catalog_retirement_variants_variant
  ON catalog_retirement_variants(variant_id, retirement_id DESC);

SELECT 'catalog safe retirement schema ready' AS migration_marker;
