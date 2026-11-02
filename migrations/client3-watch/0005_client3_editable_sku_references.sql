-- Third tenant ONLY. Keep all row IDs and historical order/SKU links.
-- Main's reference editing stores ordinary text including embedded spaces.
PRAGMA defer_foreign_keys=ON;

CREATE TABLE watch_reference_values_v5 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN (
    'movements','bracelets','dials','leatherColors','paymentMethods','deliveryMethods'
  )),
  value TEXT NOT NULL CHECK(length(trim(value)) BETWEEN 1 AND 80),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(kind,value COLLATE NOCASE)
);
INSERT INTO watch_reference_values_v5(id,kind,value,is_active,created_at)
SELECT id,kind,value,is_active,created_at FROM watch_reference_values;
DROP TABLE watch_reference_values;
ALTER TABLE watch_reference_values_v5 RENAME TO watch_reference_values;
CREATE INDEX IF NOT EXISTS idx_watch_ref_kind_active
  ON watch_reference_values(kind,is_active,value);

INSERT OR IGNORE INTO watch_reference_values(kind,value) VALUES
 ('movements','quartz'),('movements','mechanical'),
 ('bracelets','steel'),('bracelets','leather'),('bracelets','rubber'),
 ('dials','black'),('dials','white'),('dials','silver'),('dials','gold'),
 ('dials','green'),('dials','orange'),('dials','brown'),('dials','multicolor');

-- Lift fixed movement/bracelet/dial enum constraints. The shared reference list
-- and server validation now own these choices. Keep fixed male/female rule and
-- the original leather strap / no strap identity semantics intact.
CREATE TABLE watch_variants_v5 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  watch_product_id INTEGER NOT NULL REFERENCES watch_products(id) ON DELETE RESTRICT,
  catalog_variant_id INTEGER UNIQUE REFERENCES catalog_variants(id),
  gender TEXT NOT NULL CHECK (gender IN ('male','female')),
  movement TEXT NOT NULL CHECK (length(trim(movement)) BETWEEN 1 AND 80),
  bracelet_material TEXT NOT NULL CHECK (length(trim(bracelet_material)) BETWEEN 1 AND 80),
  dial_color TEXT NOT NULL CHECK (length(trim(dial_color)) BETWEEN 1 AND 80),
  bracelet_color TEXT NOT NULL DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (
    (bracelet_material='leather' AND length(trim(bracelet_color))>0)
    OR (bracelet_material<>'leather' AND bracelet_color='')
  ),
  UNIQUE (watch_product_id,gender,movement,bracelet_material,dial_color,bracelet_color)
);
INSERT INTO watch_variants_v5
 (id,watch_product_id,catalog_variant_id,gender,movement,bracelet_material,dial_color,bracelet_color,is_active,created_at)
SELECT id,watch_product_id,catalog_variant_id,gender,movement,bracelet_material,dial_color,bracelet_color,is_active,created_at
FROM watch_variants;
DROP INDEX IF EXISTS idx_watch_variants_product;
DROP TABLE watch_variants;
ALTER TABLE watch_variants_v5 RENAME TO watch_variants;
CREATE INDEX idx_watch_variants_product ON watch_variants(watch_product_id,is_active);
