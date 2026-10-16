PRAGMA foreign_keys=ON;
-- An auditable restriction of INDIVIDUAL manual movement undo following a verified
-- physical zero count. This is NOT a movement reversal, stock movement or delete.
-- The actual reversal receipt table is intentionally never spoofed.
CREATE TABLE IF NOT EXISTS catalog_manual_movement_finalizations (
  movement_id INTEGER PRIMARY KEY REFERENCES inventory_movements(id),
  source_variant_id INTEGER NOT NULL REFERENCES catalog_variants(id),
  keeper_variant_id INTEGER NOT NULL REFERENCES catalog_variants(id),
  stock_check_id INTEGER NOT NULL REFERENCES inventory_stock_checks(id),
  movement_delta INTEGER NOT NULL,
  reason TEXT NOT NULL CHECK(length(trim(reason)) >= 12),
  finalized_by TEXT NOT NULL,
  finalized_at TEXT NOT NULL,
  CHECK(source_variant_id <> keeper_variant_id)
);
CREATE INDEX IF NOT EXISTS idx_catalog_manual_finalization_source
ON catalog_manual_movement_finalizations(source_variant_id,keeper_variant_id);

-- Stop every reversal pathway, including requests that started before finalization.
-- D1 db.batch() rolls back any earlier stock movement on a raised constraint error.
CREATE TRIGGER IF NOT EXISTS catalog_manual_finalization_reversal_guard
BEFORE INSERT ON inventory_movement_reversals
WHEN EXISTS (SELECT 1 FROM catalog_manual_movement_finalizations f
             WHERE f.movement_id=NEW.original_movement_id)
BEGIN
 SELECT RAISE(ABORT,'This historical movement was finalized by a physical stock check; use a new stock correction');
END;
