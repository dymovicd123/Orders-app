-- CLIENT3 QA / watch-only additive schema.
-- Keep legacy watch_variants and v5 UNMODIFIED: v5 has a historical
-- uniqueness constraint that forbids a third generation of the same SKU.
-- v6 stores the truthful attributes of subsequent independent generations.
-- There is intentionally NO uniqueness across historical generations.
-- Active-identity uniqueness is checked in the guarded watch_variant INSERT.
-- No historical rows, stock, reservations, orders or money are mutated.
CREATE TABLE IF NOT EXISTS watch_variant_attributes_v6 (
  watch_variant_id INTEGER PRIMARY KEY REFERENCES watch_variants(id) ON DELETE RESTRICT,
  watch_product_id INTEGER NOT NULL REFERENCES watch_products(id),
  gender TEXT NOT NULL CHECK(gender IN ('male','female')),
  movement TEXT NOT NULL CHECK(length(trim(movement)) BETWEEN 1 AND 80),
  bracelet_material TEXT NOT NULL CHECK(length(trim(bracelet_material)) BETWEEN 1 AND 80),
  dial_color TEXT NOT NULL CHECK(length(trim(dial_color)) BETWEEN 1 AND 80),
  bracelet_color TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_watch_v6_product_identity
 ON watch_variant_attributes_v6(watch_product_id,gender,movement,bracelet_material,dial_color,bracelet_color);
