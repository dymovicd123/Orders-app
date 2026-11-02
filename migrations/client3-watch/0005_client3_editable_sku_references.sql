-- CLIENT3 ONLY. Add separate tables: NEVER drop, rename or ALTER existing
-- Main-derived tables/triggers. Cloudflare D1's existing deep catalog triggers
-- can reject any schema recompilation, even unrelated ALTER TABLE operations.
CREATE TABLE IF NOT EXISTS watch_reference_values_v5 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK(kind IN ('movements','bracelets','dials')),
  value TEXT NOT NULL CHECK(length(trim(value)) BETWEEN 1 AND 80),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(kind,value COLLATE NOCASE)
);
CREATE INDEX IF NOT EXISTS idx_watch_ref_v5_active ON watch_reference_values_v5(kind,is_active,value);
INSERT OR IGNORE INTO watch_reference_values_v5(kind,value) VALUES
 ('movements','quartz'),('movements','mechanical'),
 ('bracelets','steel'),('bracelets','leather'),('bracelets','rubber'),
 ('dials','black'),('dials','white'),('dials','silver'),('dials','gold'),
 ('dials','green'),('dials','orange'),('dials','brown'),('dials','multicolor');

-- Attached 1:1 to legacy watch_variants without changing it or its sold-item FKs.
-- New custom values use an inert, unique legacy-compatible anchor in watch_variants;
-- actual display and canonical SKU identities come from this extension.
CREATE TABLE IF NOT EXISTS watch_variant_attributes_v5 (
  watch_variant_id INTEGER PRIMARY KEY REFERENCES watch_variants(id) ON DELETE RESTRICT,
  watch_product_id INTEGER NOT NULL REFERENCES watch_products(id),
  gender TEXT NOT NULL CHECK(gender IN ('male','female')),
  movement TEXT NOT NULL CHECK(length(trim(movement)) BETWEEN 1 AND 80),
  bracelet_material TEXT NOT NULL CHECK(length(trim(bracelet_material)) BETWEEN 1 AND 80),
  dial_color TEXT NOT NULL CHECK(length(trim(dial_color)) BETWEEN 1 AND 80),
  bracelet_color TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(watch_product_id,gender,movement,bracelet_material,dial_color,bracelet_color)
);
CREATE INDEX IF NOT EXISTS idx_watch_variant_attributes_product_v5 ON watch_variant_attributes_v5(watch_product_id,gender);
