PRAGMA foreign_keys=ON;
-- Catalog Integrity R3: durable per-location evidence and transactional proof of physical SKU consolidation.
-- Never fabricate inventory_movements, writeoffs or order-item mutations.
CREATE TABLE IF NOT EXISTS catalog_variant_consolidation_stock_rows (
  consolidation_id INTEGER NOT NULL REFERENCES catalog_variant_consolidations(id),
  inventory_source TEXT NOT NULL CHECK(inventory_source IN ('warehouse','boutique')),
  source_stock_id INTEGER NOT NULL REFERENCES inventory_stock(id),
  target_stock_id_before INTEGER REFERENCES inventory_stock(id),
  source_quantity_before INTEGER NOT NULL CHECK(source_quantity_before >= 0),
  target_quantity_before INTEGER NOT NULL CHECK(target_quantity_before >= 0),
  target_reserved_before INTEGER NOT NULL CHECK(target_reserved_before >= 0),
  combined_quantity_after INTEGER NOT NULL CHECK(combined_quantity_after >= 0),
  PRIMARY KEY(consolidation_id, inventory_source)
);
CREATE TABLE IF NOT EXISTS catalog_variant_consolidation_validations (
  consolidation_id INTEGER PRIMARY KEY REFERENCES catalog_variant_consolidations(id),
  passed INTEGER NOT NULL CHECK(passed=1),
  checked_at TEXT NOT NULL
);
