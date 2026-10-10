PRAGMA foreign_keys = ON;

-- Catalog Integrity R2: soft consolidation of equivalent active SKU identities.
-- Never rewrite stock balances, order items, reservations, movements or snapshots.
-- A merge record tracks the canonical active SKU while the old SKU remains historical.
CREATE TABLE IF NOT EXISTS catalog_variant_consolidations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_variant_id INTEGER NOT NULL UNIQUE REFERENCES catalog_variants(id),
  target_variant_id INTEGER NOT NULL REFERENCES catalog_variants(id),
  product_id INTEGER NOT NULL REFERENCES catalog_products(id),
  source_color TEXT,
  target_color TEXT,
  material TEXT,
  length TEXT,
  category TEXT,
  gender TEXT,
  size_label TEXT,
  source_physical_quantity INTEGER NOT NULL DEFAULT 0,
  source_reserved_quantity INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at TEXT NOT NULL,
  CHECK(source_variant_id <> target_variant_id)
);
CREATE INDEX IF NOT EXISTS idx_catalog_variant_consolidations_target
  ON catalog_variant_consolidations(target_variant_id, created_at DESC);
