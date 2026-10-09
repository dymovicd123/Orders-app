PRAGMA foreign_keys=ON;
-- Catalog Integrity R4: audited active-reservation reassignment during equivalent SKU consolidation.
-- Source order-item identity is re-pointed ONLY for valid open, unsent reservations.
-- Never rewrite original price or identity snapshots, shipped orders, money or movement history.
ALTER TABLE catalog_variant_consolidation_stock_rows ADD COLUMN source_reserved_before INTEGER NOT NULL DEFAULT 0 CHECK(source_reserved_before >= 0);

CREATE TABLE IF NOT EXISTS catalog_variant_consolidation_reservation_rows (
  consolidation_id INTEGER NOT NULL REFERENCES catalog_variant_consolidations(id),
  reservation_id INTEGER NOT NULL REFERENCES inventory_reservations(id),
  order_id INTEGER NOT NULL REFERENCES orders(id),
  order_item_id INTEGER NOT NULL REFERENCES order_items(id),
  inventory_source TEXT NOT NULL CHECK(inventory_source IN ('warehouse','boutique')),
  original_variant_id INTEGER NOT NULL REFERENCES catalog_variants(id),
  keeper_variant_id INTEGER NOT NULL REFERENCES catalog_variants(id),
  quantity INTEGER NOT NULL CHECK(quantity > 0),
  PRIMARY KEY (consolidation_id,reservation_id)
);
CREATE INDEX IF NOT EXISTS idx_catalog_variant_consolidation_reservation_item
  ON catalog_variant_consolidation_reservation_rows(order_item_id, consolidation_id);

-- If any captured active reservation remains on the old SKU, becomes non-active or
-- points at a mismatched order item, the entire D1 batch must roll back.
CREATE TABLE IF NOT EXISTS catalog_variant_consolidation_reservation_validations (
  consolidation_id INTEGER PRIMARY KEY REFERENCES catalog_variant_consolidations(id),
  passed INTEGER NOT NULL CHECK(passed=1),
  checked_at TEXT NOT NULL
);
