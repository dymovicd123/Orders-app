PRAGMA foreign_keys = ON;

-- Safe Catalog restore (Branch2-first).
-- Restore never reactivates retired SKU rows or warehouse state.
-- It records a new working generation and keeps the retirement/history immutable.

CREATE TABLE IF NOT EXISTS catalog_retirement_restores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  retirement_id INTEGER NOT NULL REFERENCES catalog_retirement_operations(id) ON DELETE RESTRICT,
  request_id TEXT NOT NULL UNIQUE,
  restored_by TEXT,
  status TEXT NOT NULL DEFAULT 'started' CHECK (status IN ('started', 'completed')),
  restored_variant_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_catalog_retirement_restores_retirement
  ON catalog_retirement_restores(retirement_id, created_at DESC);

CREATE TABLE IF NOT EXISTS catalog_retirement_restore_variants (
  restore_id INTEGER NOT NULL REFERENCES catalog_retirement_restores(id) ON DELETE CASCADE,
  retired_variant_id INTEGER NOT NULL,
  active_variant_id INTEGER NOT NULL,
  active_stock_position_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (restore_id, retired_variant_id)
);

CREATE INDEX IF NOT EXISTS idx_catalog_retirement_restore_variants_active
  ON catalog_retirement_restore_variants(active_variant_id, restore_id DESC);

SELECT 'catalog safe restore schema ready' AS migration_marker;
