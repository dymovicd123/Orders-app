PRAGMA foreign_keys = ON;

-- An independent physical-quantity correction is NOT a sale or a writeoff.
-- One location at a time; keep both historical SKU identities until the
-- separate, already guarded catalog-variant consolidation is confirmed.
CREATE TABLE IF NOT EXISTS catalog_stock_reconciliation_journal (
  request_id TEXT PRIMARY KEY NOT NULL,
  source_variant_id INTEGER NOT NULL REFERENCES catalog_variants(id),
  keeper_variant_id INTEGER NOT NULL REFERENCES catalog_variants(id),
  inventory_source TEXT NOT NULL CHECK(inventory_source IN ('warehouse','boutique')),
  decision_method TEXT NOT NULL CHECK(decision_method IN ('keep_source','keep_keeper','physical_count')),
  source_stock_id INTEGER NOT NULL REFERENCES inventory_stock(id),
  keeper_stock_id INTEGER NOT NULL REFERENCES inventory_stock(id),
  source_quantity_before INTEGER NOT NULL CHECK(source_quantity_before >= 0),
  keeper_quantity_before INTEGER NOT NULL CHECK(keeper_quantity_before >= 0),
  keeper_quantity_after INTEGER NOT NULL CHECK(keeper_quantity_after >= 0),
  source_reserved_before INTEGER NOT NULL CHECK(source_reserved_before = 0),
  keeper_reserved_before INTEGER NOT NULL CHECK(keeper_reserved_before = 0),
  adjustment_quantity INTEGER NOT NULL,
  reason TEXT NOT NULL CHECK(length(trim(reason)) >= 12),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CHECK(source_variant_id <> keeper_variant_id),
  CHECK(source_stock_id <> keeper_stock_id),
  CHECK(adjustment_quantity = keeper_quantity_after - source_quantity_before - keeper_quantity_before)
);
CREATE INDEX IF NOT EXISTS idx_catalog_stock_reconciliation_pair
  ON catalog_stock_reconciliation_journal(source_variant_id,keeper_variant_id,created_at DESC);
CREATE TABLE IF NOT EXISTS catalog_stock_reconciliation_validations (
  request_id TEXT PRIMARY KEY REFERENCES catalog_stock_reconciliation_journal(request_id),
  passed INTEGER NOT NULL CHECK(passed=1),
  checked_at TEXT NOT NULL
);
