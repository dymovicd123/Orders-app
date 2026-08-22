PRAGMA foreign_keys = ON;

-- Step 94: a warehouse position is a stable group defined by
-- base product + adult/child type + gender policy + material + length.
-- Colors and sizes remain ordinary catalog variants inside that position.
CREATE TABLE IF NOT EXISTS catalog_stock_positions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES catalog_products(id) ON DELETE CASCADE,
  category TEXT NOT NULL DEFAULT 'adult' CHECK (category IN ('adult', 'child')),
  gender_scope TEXT NOT NULL DEFAULT 'unisex' CHECK (gender_scope IN ('female', 'male', 'unisex')),
  material TEXT NOT NULL DEFAULT '',
  length TEXT NOT NULL DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_catalog_stock_positions_unique
  ON catalog_stock_positions(
    product_id,
    category,
    gender_scope,
    material,
    length
  );

CREATE INDEX IF NOT EXISTS idx_catalog_stock_positions_product
  ON catalog_stock_positions(product_id, is_active, sort_order);

ALTER TABLE catalog_variants ADD COLUMN stock_position_id INTEGER REFERENCES catalog_stock_positions(id);
CREATE INDEX IF NOT EXISTS idx_catalog_variants_stock_position
  ON catalog_variants(stock_position_id, is_active, sort_order);

-- Preserve all existing variants. Legacy groups containing both male and female
-- variants are interpreted as unisex. Single-gender groups remain gender-specific.
INSERT OR IGNORE INTO catalog_stock_positions (
  product_id,
  category,
  gender_scope,
  material,
  length,
  is_active,
  sort_order,
  created_at,
  updated_at
)
SELECT
  v.product_id,
  COALESCE(NULLIF(v.category, ''), 'adult') AS category,
  CASE
    WHEN SUM(CASE WHEN UPPER(TRIM(COALESCE(v.gender, ''))) LIKE '%ЖЕН%' THEN 1 ELSE 0 END) > 0
     AND SUM(CASE WHEN UPPER(TRIM(COALESCE(v.gender, ''))) LIKE '%МУЖ%' THEN 1 ELSE 0 END) > 0
      THEN 'unisex'
    WHEN SUM(CASE WHEN UPPER(TRIM(COALESCE(v.gender, ''))) LIKE '%МУЖ%' THEN 1 ELSE 0 END) > 0
      THEN 'male'
    WHEN SUM(CASE WHEN UPPER(TRIM(COALESCE(v.gender, ''))) LIKE '%ЖЕН%' THEN 1 ELSE 0 END) > 0
      THEN 'female'
    ELSE 'unisex'
  END AS gender_scope,
  UPPER(TRIM(COALESCE(v.material, ''))) AS material,
  UPPER(TRIM(COALESCE(v.length, ''))) AS length,
  MAX(COALESCE(v.is_active, 1)) AS is_active,
  MIN(COALESCE(v.sort_order, 0)) AS sort_order,
  MIN(COALESCE(v.created_at, datetime('now'))) AS created_at,
  MAX(COALESCE(v.updated_at, datetime('now'))) AS updated_at
FROM catalog_variants v
GROUP BY
  v.product_id,
  COALESCE(NULLIF(v.category, ''), 'adult'),
  UPPER(TRIM(COALESCE(v.material, ''))),
  UPPER(TRIM(COALESCE(v.length, '')));

UPDATE catalog_variants
SET stock_position_id = (
  SELECT sp.id
  FROM catalog_stock_positions sp
  WHERE sp.product_id = catalog_variants.product_id
    AND sp.category = COALESCE(NULLIF(catalog_variants.category, ''), 'adult')
    AND sp.material = UPPER(TRIM(COALESCE(catalog_variants.material, '')))
    AND sp.length = UPPER(TRIM(COALESCE(catalog_variants.length, '')))
  ORDER BY sp.id
  LIMIT 1
)
WHERE stock_position_id IS NULL;
