-- Step 188E: server-backed inventory stocktake sessions.
-- Additive only. Does not change current physical or reserved quantities.

CREATE TABLE IF NOT EXISTS inventory_stocktake_sessions (
  id TEXT PRIMARY KEY,
  inventory_source TEXT NOT NULL CHECK (inventory_source IN ('warehouse', 'boutique')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
  created_by TEXT,
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  cancelled_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_stocktake_active_source
ON inventory_stocktake_sessions(inventory_source)
WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_inventory_stocktake_sessions_status
ON inventory_stocktake_sessions(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS inventory_stocktake_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES inventory_stocktake_sessions(id) ON DELETE CASCADE,
  inventory_source TEXT NOT NULL CHECK (inventory_source IN ('warehouse', 'boutique')),
  stock_id INTEGER REFERENCES inventory_stock(id),
  product_id INTEGER REFERENCES catalog_products(id),
  variant_id INTEGER REFERENCES catalog_variants(id),
  product_name_snapshot TEXT NOT NULL,
  category_snapshot TEXT,
  gender_snapshot TEXT,
  color_snapshot TEXT,
  material_snapshot TEXT,
  length_snapshot TEXT,
  size_snapshot TEXT,
  opening_quantity INTEGER NOT NULL DEFAULT 0,
  opening_reserved_quantity INTEGER NOT NULL DEFAULT 0,
  baseline_quantity INTEGER NOT NULL DEFAULT 0,
  counted_quantity INTEGER,
  counted_at TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'counted', 'recount_required', 'applied')),
  conflict_quantity INTEGER,
  applied_quantity INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_stocktake_item_stock
ON inventory_stocktake_items(session_id, stock_id)
WHERE stock_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_stocktake_item_variant
ON inventory_stocktake_items(session_id, variant_id)
WHERE variant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_stocktake_items_session
ON inventory_stocktake_items(session_id, status, id);
