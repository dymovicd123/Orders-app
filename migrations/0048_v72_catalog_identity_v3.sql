PRAGMA foreign_keys = ON;

-- Step 188D: canonical catalog identity.
-- Execution identity: product + material + length.
-- Stock combination identity inside an execution: audience type + gender + color + size.
-- NULL/blank material or length is the same business value as STANDARD.

CREATE TABLE IF NOT EXISTS catalog_identity_position_merges (
  old_position_id INTEGER PRIMARY KEY,
  keeper_position_id INTEGER NOT NULL,
  reason TEXT NOT NULL,
  merged_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS catalog_identity_variant_merges (
  old_variant_id INTEGER PRIMARY KEY,
  keeper_variant_id INTEGER NOT NULL,
  reason TEXT NOT NULL,
  merged_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS catalog_identity_stock_merges (
  old_stock_id INTEGER PRIMARY KEY,
  keeper_stock_id INTEGER NOT NULL,
  inventory_source TEXT NOT NULL,
  variant_id INTEGER NOT NULL,
  quantity_before INTEGER NOT NULL,
  reserved_before INTEGER NOT NULL,
  merged_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS catalog_identity_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Retry/resume baseline. Captured once before any stock-row merge.
-- The rollup below is always rebuilt from this immutable baseline, never from a
-- keeper row that may already have been updated by an interrupted previous run.
CREATE TABLE IF NOT EXISTS catalog_identity_stock_baseline (
  stock_id INTEGER PRIMARY KEY,
  inventory_source TEXT NOT NULL,
  variant_id INTEGER NOT NULL,
  quantity_before INTEGER NOT NULL,
  reserved_before INTEGER NOT NULL,
  captured_at TEXT NOT NULL
);
INSERT OR IGNORE INTO catalog_identity_stock_baseline(
  stock_id, inventory_source, variant_id, quantity_before, reserved_before, captured_at
)
SELECT id, inventory_source, variant_id, COALESCE(quantity, 0), COALESCE(reserved_quantity, 0), CURRENT_TIMESTAMP
FROM inventory_stock
WHERE variant_id IS NOT NULL;

DROP INDEX IF EXISTS idx_catalog_stock_positions_active_unique;
DROP INDEX IF EXISTS idx_catalog_stock_positions_default_unique;
DROP INDEX IF EXISTS idx_catalog_variants_position_unique;
DROP INDEX IF EXISTS idx_catalog_variants_unique;
DROP INDEX IF EXISTS idx_inventory_stock_variant_unique;

UPDATE catalog_stock_positions
SET material = CASE WHEN TRIM(COALESCE(material, '')) = '' THEN 'СТАНДАРТ' ELSE UPPER(TRIM(material)) END,
    length = CASE WHEN TRIM(COALESCE(length, '')) = '' THEN 'СТАНДАРТ' ELSE UPPER(TRIM(length)) END,
    updated_at = CURRENT_TIMESTAMP;

-- Build an execution for every legacy variant that lost stock_position_id.
INSERT INTO catalog_stock_positions (
  product_id, category, gender_scope, material, length, is_default, is_active, sort_order, created_at, updated_at
)
SELECT
  v.product_id,
  'adult',
  'unisex',
  CASE WHEN TRIM(COALESCE(v.material, '')) = '' THEN 'СТАНДАРТ' ELSE UPPER(TRIM(v.material)) END,
  CASE WHEN TRIM(COALESCE(v.length, '')) = '' THEN 'СТАНДАРТ' ELSE UPPER(TRIM(v.length)) END,
  0,
  MAX(COALESCE(v.is_active, 1)),
  MIN(COALESCE(v.sort_order, 0)),
  MIN(COALESCE(v.created_at, CURRENT_TIMESTAMP)),
  CURRENT_TIMESTAMP
FROM catalog_variants v
WHERE v.stock_position_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM catalog_stock_positions sp
    WHERE sp.product_id = v.product_id
      AND sp.material = CASE WHEN TRIM(COALESCE(v.material, '')) = '' THEN 'СТАНДАРТ' ELSE UPPER(TRIM(v.material)) END
      AND sp.length = CASE WHEN TRIM(COALESCE(v.length, '')) = '' THEN 'СТАНДАРТ' ELSE UPPER(TRIM(v.length)) END
      AND sp.is_active = 1
  )
GROUP BY v.product_id,
  CASE WHEN TRIM(COALESCE(v.material, '')) = '' THEN 'СТАНДАРТ' ELSE UPPER(TRIM(v.material)) END,
  CASE WHEN TRIM(COALESCE(v.length, '')) = '' THEN 'СТАНДАРТ' ELSE UPPER(TRIM(v.length)) END;

-- One keeper execution per product + material + length. Category/gender_scope are legacy metadata only now.
DROP TABLE IF EXISTS _step188d_position_map;
CREATE TEMP TABLE _step188d_position_map AS
SELECT sp.id AS old_id,
       (
         SELECT candidate.id
         FROM catalog_stock_positions candidate
         WHERE candidate.product_id = sp.product_id
           AND candidate.material = sp.material
           AND candidate.length = sp.length
         ORDER BY candidate.is_active DESC,
                  (SELECT COUNT(*) FROM catalog_variants cv WHERE cv.stock_position_id = candidate.id) DESC,
                  candidate.id ASC
         LIMIT 1
       ) AS keeper_id
FROM catalog_stock_positions sp;

INSERT OR REPLACE INTO catalog_identity_position_merges(old_position_id, keeper_position_id, reason, merged_at)
SELECT old_id, keeper_id, 'product+material+length', CURRENT_TIMESTAMP
FROM _step188d_position_map WHERE old_id <> keeper_id;

UPDATE catalog_variants
SET stock_position_id = COALESCE(
  (SELECT keeper_id FROM _step188d_position_map m WHERE m.old_id = catalog_variants.stock_position_id),
  (
    SELECT sp.id FROM catalog_stock_positions sp
    WHERE sp.product_id = catalog_variants.product_id
      AND sp.material = CASE WHEN TRIM(COALESCE(catalog_variants.material, '')) = '' THEN 'СТАНДАРТ' ELSE UPPER(TRIM(catalog_variants.material)) END
      AND sp.length = CASE WHEN TRIM(COALESCE(catalog_variants.length, '')) = '' THEN 'СТАНДАРТ' ELSE UPPER(TRIM(catalog_variants.length)) END
      AND sp.is_active = 1
    ORDER BY sp.id ASC LIMIT 1
  )
);

UPDATE catalog_stock_positions
SET is_active = CASE WHEN id IN (SELECT keeper_id FROM _step188d_position_map) THEN 1 ELSE 0 END,
    is_default = 0,
    category = CASE WHEN id IN (SELECT keeper_id FROM _step188d_position_map) THEN 'adult' ELSE category END,
    gender_scope = CASE WHEN id IN (SELECT keeper_id FROM _step188d_position_map) THEN 'unisex' ELSE gender_scope END,
    updated_at = CURRENT_TIMESTAMP
WHERE id IN (SELECT old_id FROM _step188d_position_map);

-- Normalize concrete stock-combination attributes. Material/length are inherited from execution.
UPDATE catalog_variants
SET category = CASE WHEN COALESCE(category, 'adult') = 'child' THEN 'child' ELSE 'adult' END,
    gender = UPPER(TRIM(COALESCE(gender, ''))),
    color = CASE WHEN TRIM(COALESCE(color, '')) = '' THEN 'БЕЗ ЦВЕТА' ELSE UPPER(TRIM(color)) END,
    size_label = CASE
      WHEN UPPER(TRIM(COALESCE(size_label, ''))) IN ('', 'БЕЗ РАЗМЕРА', 'БЕЗРАЗМЕРА', 'Б/Р') THEN ''
      ELSE UPPER(TRIM(size_label))
    END,
    material = (SELECT sp.material FROM catalog_stock_positions sp WHERE sp.id = catalog_variants.stock_position_id),
    length = (SELECT sp.length FROM catalog_stock_positions sp WHERE sp.id = catalog_variants.stock_position_id),
    updated_at = CURRENT_TIMESTAMP
WHERE stock_position_id IS NOT NULL;

-- One keeper variant per execution + type + gender + color + size.
DROP TABLE IF EXISTS _step188d_variant_map;
CREATE TEMP TABLE _step188d_variant_map AS
SELECT v.id AS old_id,
       (
         SELECT candidate.id FROM catalog_variants candidate
         WHERE candidate.stock_position_id = v.stock_position_id
           AND candidate.category = v.category
           AND COALESCE(candidate.gender, '') = COALESCE(v.gender, '')
           AND COALESCE(candidate.color, '') = COALESCE(v.color, '')
           AND COALESCE(candidate.size_label, '') = COALESCE(v.size_label, '')
         ORDER BY candidate.is_active DESC, candidate.id ASC
         LIMIT 1
       ) AS keeper_id
FROM catalog_variants v
WHERE v.stock_position_id IS NOT NULL;

INSERT OR REPLACE INTO catalog_identity_variant_merges(old_variant_id, keeper_variant_id, reason, merged_at)
SELECT old_id, keeper_id, 'execution+type+gender+color+size', CURRENT_TIMESTAMP
FROM _step188d_variant_map WHERE old_id <> keeper_id;

-- Move all operational references before deactivating duplicate catalog rows.
UPDATE order_items SET variant_id = (SELECT keeper_id FROM _step188d_variant_map m WHERE m.old_id = order_items.variant_id)
WHERE variant_id IN (SELECT old_id FROM _step188d_variant_map WHERE old_id <> keeper_id);
UPDATE workshop_tasks SET variant_id = (SELECT keeper_id FROM _step188d_variant_map m WHERE m.old_id = workshop_tasks.variant_id)
WHERE variant_id IN (SELECT old_id FROM _step188d_variant_map WHERE old_id <> keeper_id);
UPDATE inventory_movements SET variant_id = (SELECT keeper_id FROM _step188d_variant_map m WHERE m.old_id = inventory_movements.variant_id)
WHERE variant_id IN (SELECT old_id FROM _step188d_variant_map WHERE old_id <> keeper_id);
UPDATE inventory_reservations SET variant_id = (SELECT keeper_id FROM _step188d_variant_map m WHERE m.old_id = inventory_reservations.variant_id)
WHERE variant_id IN (SELECT old_id FROM _step188d_variant_map WHERE old_id <> keeper_id);
UPDATE catalog_input_aliases SET variant_id = (SELECT keeper_id FROM _step188d_variant_map m WHERE m.old_id = catalog_input_aliases.variant_id)
WHERE variant_id IN (SELECT old_id FROM _step188d_variant_map WHERE old_id <> keeper_id);

-- inventory_stock needs a rollup because the new keeper can already have a row in the same source.
-- First canonicalize current references. The immutable pre-merge baseline above remains unchanged.
UPDATE inventory_stock SET variant_id = (SELECT keeper_id FROM _step188d_variant_map m WHERE m.old_id = inventory_stock.variant_id)
WHERE variant_id IN (SELECT old_id FROM _step188d_variant_map WHERE old_id <> keeper_id);

DROP TABLE IF EXISTS _step188d_stock_rollup;
CREATE TEMP TABLE _step188d_stock_rollup AS
SELECT
  MIN(b.stock_id) AS keeper_stock_id,
  b.inventory_source,
  COALESCE((SELECT m.keeper_id FROM _step188d_variant_map m WHERE m.old_id = b.variant_id), b.variant_id) AS variant_id,
  SUM(COALESCE(b.quantity_before, 0)) AS total_quantity,
  SUM(COALESCE(b.reserved_before, 0)) AS total_reserved
FROM catalog_identity_stock_baseline b
GROUP BY b.inventory_source,
  COALESCE((SELECT m.keeper_id FROM _step188d_variant_map m WHERE m.old_id = b.variant_id), b.variant_id);

INSERT OR REPLACE INTO catalog_identity_stock_merges(
  old_stock_id, keeper_stock_id, inventory_source, variant_id, quantity_before, reserved_before, merged_at
)
SELECT b.stock_id, r.keeper_stock_id, b.inventory_source, r.variant_id, b.quantity_before, b.reserved_before, CURRENT_TIMESTAMP
FROM catalog_identity_stock_baseline b
JOIN _step188d_stock_rollup r
  ON r.inventory_source = b.inventory_source
 AND r.variant_id = COALESCE((SELECT m.keeper_id FROM _step188d_variant_map m WHERE m.old_id = b.variant_id), b.variant_id)
WHERE b.stock_id <> r.keeper_stock_id;

-- Absolute assignment from the immutable baseline makes this section retry-safe.
-- An interrupted run can repeat the UPDATE without adding the same duplicate stock twice.
UPDATE inventory_stock
SET quantity = (SELECT total_quantity FROM _step188d_stock_rollup r WHERE r.keeper_stock_id = inventory_stock.id),
    reserved_quantity = (SELECT total_reserved FROM _step188d_stock_rollup r WHERE r.keeper_stock_id = inventory_stock.id),
    updated_at = CURRENT_TIMESTAMP
WHERE id IN (SELECT keeper_stock_id FROM _step188d_stock_rollup);

DELETE FROM inventory_stock
WHERE id IN (SELECT stock_id FROM catalog_identity_stock_baseline)
  AND id NOT IN (SELECT keeper_stock_id FROM _step188d_stock_rollup);

UPDATE catalog_variants
SET is_active = 0,
    updated_at = CURRENT_TIMESTAMP
WHERE id IN (SELECT old_id FROM _step188d_variant_map WHERE old_id <> keeper_id);

-- Synchronize stock snapshots to the canonical combination. Historical order/movement snapshots remain untouched.
UPDATE inventory_stock
SET product_id = (SELECT v.product_id FROM catalog_variants v WHERE v.id = inventory_stock.variant_id),
    product_name_snapshot = (
      SELECT p.name FROM catalog_variants v JOIN catalog_products p ON p.id = v.product_id WHERE v.id = inventory_stock.variant_id
    ),
    gender_snapshot = (SELECT NULLIF(v.gender, '') FROM catalog_variants v WHERE v.id = inventory_stock.variant_id),
    color_snapshot = (SELECT NULLIF(v.color, '') FROM catalog_variants v WHERE v.id = inventory_stock.variant_id),
    material_snapshot = (SELECT sp.material FROM catalog_variants v JOIN catalog_stock_positions sp ON sp.id = v.stock_position_id WHERE v.id = inventory_stock.variant_id),
    length_snapshot = (SELECT sp.length FROM catalog_variants v JOIN catalog_stock_positions sp ON sp.id = v.stock_position_id WHERE v.id = inventory_stock.variant_id),
    size_snapshot = (SELECT NULLIF(v.size_label, '') FROM catalog_variants v WHERE v.id = inventory_stock.variant_id),
    updated_at = CURRENT_TIMESTAMP
WHERE variant_id IS NOT NULL;

-- Rebuild final uniqueness around the canonical hierarchy.
CREATE UNIQUE INDEX IF NOT EXISTS idx_catalog_stock_positions_execution_unique
  ON catalog_stock_positions(product_id, material, length)
  WHERE is_active = 1;
CREATE UNIQUE INDEX IF NOT EXISTS idx_catalog_variants_combination_unique
  ON catalog_variants(stock_position_id, category, COALESCE(gender, ''), COALESCE(color, ''), COALESCE(size_label, ''))
  WHERE stock_position_id IS NOT NULL AND is_active = 1;
CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_stock_variant_unique
  ON inventory_stock(inventory_source, variant_id)
  WHERE variant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_catalog_stock_positions_execution_lookup
  ON catalog_stock_positions(product_id, material, length, is_active);
CREATE INDEX IF NOT EXISTS idx_catalog_variants_combination_lookup
  ON catalog_variants(stock_position_id, category, gender, color, size_label, is_active);

-- Safe current-work backfill. This is intentionally conservative:
-- only exact active product names + an existing execution + known reference values are linked.
-- Already-sent normal legacy rows are left as historical cleanup and never change physical stock here.
CREATE TABLE IF NOT EXISTS catalog_identity_order_item_links (
  order_item_id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL,
  variant_id INTEGER NOT NULL,
  resolution TEXT NOT NULL,
  linked_at TEXT NOT NULL
);

DROP TABLE IF EXISTS _step188d_safe_order_links;
CREATE TEMP TABLE _step188d_safe_order_links (
  order_item_id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL,
  external_id TEXT NOT NULL,
  is_workshop INTEGER NOT NULL,
  inventory_source TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  execution_id INTEGER,
  category TEXT NOT NULL,
  gender TEXT NOT NULL,
  color TEXT NOT NULL,
  material TEXT NOT NULL,
  length TEXT NOT NULL,
  size_label TEXT NOT NULL,
  variant_id INTEGER
);

INSERT OR IGNORE INTO _step188d_safe_order_links (
  order_item_id, order_id, external_id, is_workshop, inventory_source, quantity,
  product_id, execution_id, category, gender, color, material, length, size_label, variant_id
)
SELECT
  oi.id,
  oi.order_id,
  o.external_id,
  COALESCE(oi.is_workshop, 0),
  CASE WHEN LOWER(TRIM(COALESCE(oi.source_type, ''))) IN ('boutique', 'бутик') THEN 'boutique' ELSE 'warehouse' END,
  CASE WHEN COALESCE(oi.quantity, 0) > 0 THEN oi.quantity ELSE 1 END,
  p.id,
  NULL,
  CASE
    WHEN LOWER(TRIM(COALESCE(oi.audience_type, ''))) LIKE '%дет%' THEN 'child'
    WHEN TRIM(COALESCE(oi.size_snapshot, '')) <> ''
      AND TRIM(COALESCE(oi.size_snapshot, '')) NOT GLOB '*[^0-9]*'
      AND CAST(TRIM(oi.size_snapshot) AS INTEGER) BETWEEN 1 AND 12 THEN 'child'
    ELSE 'adult'
  END,
  CASE
    WHEN UPPER(TRIM(COALESCE(oi.gender_snapshot, ''))) LIKE '%ЖЕН%' THEN 'ЖЕН'
    WHEN UPPER(TRIM(COALESCE(oi.gender_snapshot, ''))) LIKE '%МУЖ%' THEN 'МУЖ'
    ELSE UPPER(TRIM(COALESCE(oi.gender_snapshot, '')))
  END,
  CASE WHEN TRIM(COALESCE(oi.color_snapshot, '')) = '' THEN 'БЕЗ ЦВЕТА' ELSE UPPER(TRIM(oi.color_snapshot)) END,
  CASE WHEN TRIM(COALESCE(oi.material_snapshot, '')) = '' THEN 'СТАНДАРТ' ELSE UPPER(TRIM(oi.material_snapshot)) END,
  CASE WHEN TRIM(COALESCE(oi.length_snapshot, '')) = '' THEN 'СТАНДАРТ' ELSE UPPER(TRIM(oi.length_snapshot)) END,
  CASE
    WHEN UPPER(TRIM(COALESCE(oi.size_snapshot, ''))) IN ('', 'БЕЗ РАЗМЕРА', 'БЕЗРАЗМЕРА', 'Б/Р') THEN ''
    ELSE UPPER(TRIM(oi.size_snapshot))
  END,
  NULL
FROM order_items oi
JOIN orders o ON o.id = oi.order_id
JOIN catalog_products p
  ON p.is_active = 1
 AND UPPER(TRIM(p.name)) = UPPER(TRIM(oi.product_name_snapshot))
WHERE oi.quantity > 0
  AND (oi.product_id IS NULL OR oi.variant_id IS NULL OR COALESCE(oi.stock_writeoff_status, '') = 'catalog_unresolved')
  AND COALESCE(o.order_status, 'active') NOT IN ('deleted', 'archived')
  AND COALESCE(o.archived_at, '') = ''
  AND (
    COALESCE(oi.is_workshop, 0) = 1
    OR COALESCE(o.shipping_status, 'not_sent') <> 'sent'
  )
  AND (
    SELECT COUNT(*) FROM catalog_products px
    WHERE px.is_active = 1 AND UPPER(TRIM(px.name)) = UPPER(TRIM(oi.product_name_snapshot))
  ) = 1
  AND (
    COALESCE(oi.is_workshop, 0) = 1
    OR NOT EXISTS (
      SELECT 1 FROM inventory_reservations rx
      WHERE rx.order_item_id = oi.id AND rx.status NOT IN ('unresolved')
    )
  );

-- Unknown gender/reference values are real human-review cases and stay out of this safe backfill.
DELETE FROM _step188d_safe_order_links
WHERE gender NOT IN ('', 'ЖЕН', 'МУЖ');

DELETE FROM _step188d_safe_order_links
WHERE NOT EXISTS (
  SELECT 1 FROM reference_values rv
  WHERE rv.kind = 'color' AND rv.is_active = 1 AND UPPER(TRIM(rv.value)) = _step188d_safe_order_links.color
);

DELETE FROM _step188d_safe_order_links
WHERE size_label <> '' AND NOT EXISTS (
  SELECT 1 FROM reference_values rv
  WHERE rv.is_active = 1
    AND rv.kind = CASE WHEN _step188d_safe_order_links.category = 'child' THEN 'child_age' ELSE 'size' END
    AND UPPER(TRIM(rv.value)) = _step188d_safe_order_links.size_label
);

UPDATE _step188d_safe_order_links
SET execution_id = (
  SELECT sp.id FROM catalog_stock_positions sp
  WHERE sp.product_id = _step188d_safe_order_links.product_id
    AND sp.is_active = 1
    AND sp.material = _step188d_safe_order_links.material
    AND sp.length = _step188d_safe_order_links.length
  ORDER BY sp.id ASC LIMIT 1
);

-- A new material/length is a new execution and remains a deliberate administrator decision.
DELETE FROM _step188d_safe_order_links WHERE execution_id IS NULL;

-- Color/size/type/gender are dynamic concrete combinations under a known execution.
INSERT OR IGNORE INTO catalog_variants (
  product_id, stock_position_id, category, gender, color, material, length, size_label,
  is_active, sort_order, created_at, updated_at
)
SELECT DISTINCT
  c.product_id, c.execution_id, c.category,
  NULLIF(c.gender, ''), NULLIF(c.color, ''), c.material, c.length, NULLIF(c.size_label, ''),
  1, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM _step188d_safe_order_links c
WHERE NOT EXISTS (
  SELECT 1 FROM catalog_variants v
  WHERE v.stock_position_id = c.execution_id AND v.is_active = 1
    AND COALESCE(v.category, 'adult') = c.category
    AND COALESCE(v.gender, '') = c.gender
    AND COALESCE(v.color, '') = c.color
    AND COALESCE(v.size_label, '') = c.size_label
);

UPDATE _step188d_safe_order_links
SET variant_id = (
  SELECT v.id FROM catalog_variants v
  WHERE v.stock_position_id = _step188d_safe_order_links.execution_id
    AND v.is_active = 1
    AND COALESCE(v.category, 'adult') = _step188d_safe_order_links.category
    AND COALESCE(v.gender, '') = _step188d_safe_order_links.gender
    AND COALESCE(v.color, '') = _step188d_safe_order_links.color
    AND COALESCE(v.size_label, '') = _step188d_safe_order_links.size_label
  ORDER BY v.id ASC LIMIT 1
);
DELETE FROM _step188d_safe_order_links WHERE variant_id IS NULL;

INSERT OR REPLACE INTO catalog_identity_order_item_links(order_item_id, product_id, variant_id, resolution, linked_at)
SELECT order_item_id, product_id, variant_id,
       CASE WHEN is_workshop = 1 THEN 'exact_execution_known_attributes_workshop' ELSE 'exact_execution_known_attributes_identity_only' END,
       CURRENT_TIMESTAMP
FROM _step188d_safe_order_links;

UPDATE order_items
SET product_id = (SELECT c.product_id FROM _step188d_safe_order_links c WHERE c.order_item_id = order_items.id),
    variant_id = (SELECT c.variant_id FROM _step188d_safe_order_links c WHERE c.order_item_id = order_items.id),
    stock_writeoff_status = CASE
      WHEN (SELECT c.is_workshop FROM _step188d_safe_order_links c WHERE c.order_item_id = order_items.id) = 1 THEN 'workshop'
      ELSE stock_writeoff_status
    END
WHERE id IN (SELECT order_item_id FROM _step188d_safe_order_links);

UPDATE workshop_tasks
SET product_id = (SELECT c.product_id FROM _step188d_safe_order_links c WHERE c.order_item_id = workshop_tasks.order_item_id),
    variant_id = (SELECT c.variant_id FROM _step188d_safe_order_links c WHERE c.order_item_id = workshop_tasks.order_item_id),
    updated_at = CURRENT_TIMESTAMP
WHERE order_item_id IN (SELECT order_item_id FROM _step188d_safe_order_links WHERE is_workshop = 1);

-- For legacy normal orders Step 188D repairs identity only.
-- Their old unresolved reservation/stock state is intentionally preserved for Step 188E,
-- because historic shipping/status discipline is not reliable enough for a bulk stock mutation.
-- New orders after Step 188D use the v3 resolver and reserve normally in real time.

DROP TABLE IF EXISTS _step188d_safe_order_links;


INSERT INTO catalog_identity_meta(key, value, updated_at)
VALUES ('catalog_identity_v3', 'active', CURRENT_TIMESTAMP)
ON CONFLICT(key) DO UPDATE SET value='active', updated_at=CURRENT_TIMESTAMP;

DROP TABLE IF EXISTS _step188d_stock_rollup;
DROP TABLE IF EXISTS _step188d_variant_map;
DROP TABLE IF EXISTS _step188d_position_map;

SELECT 'step188d catalog identity v3 active' AS migration_marker;
