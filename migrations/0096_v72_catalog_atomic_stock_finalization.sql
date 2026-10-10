PRAGMA foreign_keys=ON;
-- One-step decision and SKU retirement. No employee lock and no intermediate
-- corrected-but-still-active source SKU. All rows are written in one D1 batch.
CREATE TABLE IF NOT EXISTS catalog_variant_consolidation_stock_decisions (
  consolidation_id INTEGER NOT NULL REFERENCES catalog_variant_consolidations(id),
  inventory_source TEXT NOT NULL CHECK(inventory_source IN ('warehouse','boutique')),
  source_stock_id INTEGER NOT NULL REFERENCES inventory_stock(id),
  keeper_stock_id_before INTEGER REFERENCES inventory_stock(id),
  decision_method TEXT NOT NULL CHECK(decision_method IN ('sum','keep_source','keep_keeper','physical_count')),
  source_quantity_before INTEGER NOT NULL CHECK(source_quantity_before>=0),
  keeper_quantity_before INTEGER NOT NULL CHECK(keeper_quantity_before>=0),
  final_quantity INTEGER NOT NULL CHECK(final_quantity>=0),
  adjustment_quantity INTEGER NOT NULL,
  reason TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CHECK(adjustment_quantity=final_quantity-source_quantity_before-keeper_quantity_before),
  CHECK(decision_method='sum' OR length(trim(COALESCE(reason,'')))>=12),
  PRIMARY KEY(consolidation_id,inventory_source)
);
CREATE INDEX IF NOT EXISTS idx_catalog_finalization_decision_method
  ON catalog_variant_consolidation_stock_decisions(decision_method,created_at DESC);
