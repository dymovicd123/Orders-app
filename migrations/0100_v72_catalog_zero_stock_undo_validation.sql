PRAGMA foreign_keys=ON;
-- Immutable evidence that an undo generation actually restored a zero-stock
-- source SKU within the SAME guarded D1 batch.
CREATE TABLE IF NOT EXISTS catalog_variant_zero_stock_undo_validations (
 generation_event_id INTEGER PRIMARY KEY REFERENCES catalog_variant_merge_generation_events(id),
 root_consolidation_id INTEGER NOT NULL REFERENCES catalog_variant_consolidations(id),
 source_variant_id INTEGER NOT NULL REFERENCES catalog_variants(id),
 original_stock_rows INTEGER NOT NULL CHECK(original_stock_rows>0),
 passed INTEGER NOT NULL CHECK(passed=1),
 created_by TEXT NOT NULL,
 checked_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_zero_stock_undo_validation_root
 ON catalog_variant_zero_stock_undo_validations(root_consolidation_id);
