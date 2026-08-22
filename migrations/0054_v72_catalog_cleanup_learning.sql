-- Step 188J: controlled catalog cleanup + narrow value learning.
-- Remote installer executes this file through the D1 /query batch path (--command), not the /import path (--file).
-- Historical snapshots remain untouched. Canonical identities and operational references are repaired.

CREATE TABLE IF NOT EXISTS catalog_value_aliases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('color','material','length','size','child_age')),
  alias_key TEXT NOT NULL,
  raw_value TEXT NOT NULL,
  canonical_value TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(kind, alias_key)
);
CREATE INDEX IF NOT EXISTS idx_catalog_value_aliases_canonical
  ON catalog_value_aliases(kind, canonical_value);

-- Standardize the old Step 166 merge audit in environments where the historical helper table never existed.
CREATE TABLE IF NOT EXISTS catalog_product_merge_repairs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repair_key TEXT NOT NULL UNIQUE,
  keeper_product_id INTEGER NOT NULL,
  merged_product_id INTEGER NOT NULL,
  keeper_name TEXT NOT NULL,
  merged_name TEXT NOT NULL,
  variants_moved INTEGER NOT NULL DEFAULT 0,
  variants_merged INTEGER NOT NULL DEFAULT 0,
  stock_rows_merged INTEGER NOT NULL DEFAULT 0,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS catalog_cleanup_position_baseline (
  repair_key TEXT NOT NULL,
  position_id INTEGER NOT NULL,
  product_id_before INTEGER NOT NULL,
  material_before TEXT NOT NULL,
  length_before TEXT NOT NULL,
  is_active_before INTEGER NOT NULL,
  captured_at TEXT NOT NULL,
  PRIMARY KEY(repair_key, position_id)
);

CREATE TABLE IF NOT EXISTS catalog_cleanup_variant_baseline (
  repair_key TEXT NOT NULL,
  variant_id INTEGER NOT NULL,
  product_id_before INTEGER NOT NULL,
  stock_position_id_before INTEGER,
  material_before TEXT,
  color_before TEXT,
  is_active_before INTEGER NOT NULL,
  captured_at TEXT NOT NULL,
  PRIMARY KEY(repair_key, variant_id)
);
CREATE TABLE IF NOT EXISTS catalog_cleanup_stock_baseline (
  repair_key TEXT NOT NULL,
  stock_id INTEGER NOT NULL,
  inventory_source TEXT NOT NULL,
  variant_id INTEGER NOT NULL,
  quantity_before INTEGER NOT NULL,
  reserved_before INTEGER NOT NULL,
  captured_at TEXT NOT NULL,
  PRIMARY KEY(repair_key, stock_id)
);
CREATE TABLE IF NOT EXISTS catalog_cleanup_stock_merges (
  repair_key TEXT NOT NULL,
  old_stock_id INTEGER NOT NULL,
  keeper_stock_id INTEGER NOT NULL,
  inventory_source TEXT NOT NULL,
  variant_id INTEGER NOT NULL,
  quantity_before INTEGER NOT NULL,
  reserved_before INTEGER NOT NULL,
  merged_at TEXT NOT NULL,
  PRIMARY KEY(repair_key, old_stock_id)
);

-- Reference dictionary is the authority when it already contains the intended business value.
-- New genuinely distinct values are promoted to the dictionary rather than left as perpetual anomalies.
INSERT OR IGNORE INTO reference_values(kind, value, is_active, sort_order, created_at, updated_at)
SELECT 'color','ГОРЧИЧНЫЙ',1,COALESCE((SELECT MAX(sort_order) FROM reference_values WHERE kind='color'),0)+10,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP;
INSERT OR IGNORE INTO reference_values(kind, value, is_active, sort_order, created_at, updated_at)
SELECT 'color','СВЕТЛЫЙ ГОРЧИЧНЫЙ',1,COALESCE((SELECT MAX(sort_order) FROM reference_values WHERE kind='color'),0)+10,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP;
INSERT OR IGNORE INTO reference_values(kind, value, is_active, sort_order, created_at, updated_at)
SELECT 'color','МОЛОЧНЫЙ',1,COALESCE((SELECT MAX(sort_order) FROM reference_values WHERE kind='color'),0)+10,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP;
INSERT OR IGNORE INTO reference_values(kind, value, is_active, sort_order, created_at, updated_at)
SELECT 'material','КОСТЮМНЫЙ МАТЕРИАЛ',1,COALESCE((SELECT MAX(sort_order) FROM reference_values WHERE kind='material'),0)+10,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP;
UPDATE reference_values SET is_active=1,updated_at=CURRENT_TIMESTAMP WHERE kind='color' AND UPPER(TRIM(value)) IN ('ГОРЧИЧНЫЙ','СВЕТЛЫЙ ГОРЧИЧНЫЙ','МОЛОЧНЫЙ');
UPDATE reference_values SET is_active=1,updated_at=CURRENT_TIMESTAMP WHERE kind='material' AND UPPER(TRIM(value))='КОСТЮМНЫЙ МАТЕРИАЛ';
UPDATE reference_values SET is_active=1,updated_at=CURRENT_TIMESTAMP WHERE kind='material' AND UPPER(TRIM(value)) IN ('ЛЁНЬ','ДЖИНСА');
UPDATE reference_values SET is_active=1,updated_at=CURRENT_TIMESTAMP WHERE kind='color' AND UPPER(TRIM(value))='ГОЛУБОЙ';

-- Narrow aliases: one fact maps only to the same fact kind. Never map a whole SKU here.
INSERT INTO catalog_value_aliases(kind, alias_key, raw_value, canonical_value, created_at, updated_at) VALUES
  ('material','ЛЕН','ЛЕН','ЛЁНЬ',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  ('material','КОСТЮМНЫЙ МАТА','КОСТЮМНЫЙ МАТА','КОСТЮМНЫЙ МАТЕРИАЛ',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  ('color','ДЖИНСА ГОЛУБОЙ','ДЖИНСА ГОЛУБОЙ','ГОЛУБОЙ',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  ('color','ГОРЧИЧНАЯ','ГОРЧИЧНАЯ','ГОРЧИЧНЫЙ',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
ON CONFLICT(kind, alias_key) DO NOTHING;

-- Product spellings learned from proven historical merges/typos.
-- alias_key uses the same product identity folding as the Worker for these concrete spellings.
INSERT INTO catalog_product_aliases(alias_key, raw_value, product_id, created_at, updated_at)
SELECT 'АИНУРИМ АИ КОИЛЕК','АЙНУРЫМ АЙ КОЙЛЕК',10,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
WHERE EXISTS(SELECT 1 FROM catalog_products WHERE id=10 AND is_active=1)
ON CONFLICT(alias_key) DO NOTHING;
INSERT INTO catalog_product_aliases(alias_key, raw_value, product_id, created_at, updated_at)
SELECT 'САУЛЕТ ЖИЛЕТ','САУЛЕТ ЖИЛЕТ',30,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
WHERE EXISTS(SELECT 1 FROM catalog_products WHERE id=30 AND is_active=1)
ON CONFLICT(alias_key) DO NOTHING;
INSERT INTO catalog_product_aliases(alias_key, raw_value, product_id, created_at, updated_at)
SELECT 'ЕНИЛИК ШАПАН','ЕҢІЛІК ШАПАН',2,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
WHERE EXISTS(SELECT 1 FROM catalog_products WHERE id=2 AND is_active=1)
ON CONFLICT(alias_key) DO NOTHING;
INSERT INTO catalog_product_aliases(alias_key, raw_value, product_id, created_at, updated_at)
SELECT 'УДАЛИТЬ','УДАЛИТЬ',2,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
WHERE EXISTS(SELECT 1 FROM catalog_products WHERE id=2 AND is_active=1)
ON CONFLICT(alias_key) DO NOTHING;
INSERT INTO catalog_product_aliases(alias_key, raw_value, product_id, created_at, updated_at)
SELECT 'РУКОВА','РУКОВА',50,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
WHERE EXISTS(SELECT 1 FROM catalog_products WHERE id=50 AND is_active=1)
ON CONFLICT(alias_key) DO NOTHING;
INSERT INTO catalog_product_aliases(alias_key, raw_value, product_id, created_at, updated_at)
SELECT 'ТАКИЯ','ТАҚИЯ',46,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
WHERE EXISTS(SELECT 1 FROM catalog_products WHERE id=46 AND is_active=1)
ON CONFLICT(alias_key) DO NOTHING;
INSERT INTO catalog_product_aliases(alias_key, raw_value, product_id, created_at, updated_at)
SELECT 'БАСКА','БАСКА',21,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
WHERE EXISTS(SELECT 1 FROM catalog_products WHERE id=21 AND is_active=1)
ON CONFLICT(alias_key) DO NOTHING;

-- Capture immutable before-state once. It makes the stock rollup retry-safe.
INSERT OR IGNORE INTO catalog_cleanup_position_baseline(repair_key,position_id,product_id_before,material_before,length_before,is_active_before,captured_at)
SELECT 'step188j-catalog-cleanup-v1',id,product_id,UPPER(TRIM(COALESCE(material,'СТАНДАРТ'))),UPPER(TRIM(COALESCE(length,'СТАНДАРТ'))),COALESCE(is_active,1),CURRENT_TIMESTAMP
FROM catalog_stock_positions;
INSERT OR IGNORE INTO catalog_cleanup_variant_baseline(repair_key,variant_id,product_id_before,stock_position_id_before,material_before,color_before,is_active_before,captured_at)
SELECT 'step188j-catalog-cleanup-v1',id,product_id,stock_position_id,UPPER(TRIM(COALESCE(material,''))),UPPER(TRIM(COALESCE(color,''))),COALESCE(is_active,1),CURRENT_TIMESTAMP
FROM catalog_variants;
INSERT OR IGNORE INTO catalog_cleanup_stock_baseline(repair_key,stock_id,inventory_source,variant_id,quantity_before,reserved_before,captured_at)
SELECT 'step188j-catalog-cleanup-v1',id,inventory_source,variant_id,COALESCE(quantity,0),COALESCE(reserved_quantity,0),CURRENT_TIMESTAMP
FROM inventory_stock WHERE variant_id IS NOT NULL;

DROP TABLE IF EXISTS _step188j_affected_positions;
CREATE TABLE _step188j_affected_positions AS
SELECT position_id AS id
FROM catalog_cleanup_position_baseline
WHERE repair_key='step188j-catalog-cleanup-v1'
  AND (product_id_before=34 OR material_before IN ('ЛЕН','КОСТЮМНЫЙ МАТА'))
UNION
SELECT stock_position_id_before AS id
FROM catalog_cleanup_variant_baseline
WHERE repair_key='step188j-catalog-cleanup-v1' AND stock_position_id_before IS NOT NULL
  AND color_before IN ('ГОРЧИЧНАЯ','ДЖИНСА ГОЛУБОЙ');

DROP INDEX IF EXISTS idx_catalog_stock_positions_execution_unique;
DROP INDEX IF EXISTS idx_catalog_variants_combination_unique;
DROP INDEX IF EXISTS idx_inventory_stock_variant_unique;

-- Canonicalize proven value aliases in master data. Historical order/movement snapshots are intentionally preserved.
UPDATE catalog_stock_positions SET material='ЛЁНЬ', updated_at=CURRENT_TIMESTAMP WHERE UPPER(TRIM(material))='ЛЕН';
UPDATE catalog_stock_positions SET material='КОСТЮМНЫЙ МАТЕРИАЛ', updated_at=CURRENT_TIMESTAMP WHERE UPPER(TRIM(material))='КОСТЮМНЫЙ МАТА';
UPDATE catalog_variants SET material='ЛЁНЬ', updated_at=CURRENT_TIMESTAMP WHERE UPPER(TRIM(COALESCE(material,'')))='ЛЕН';
UPDATE catalog_variants SET material='КОСТЮМНЫЙ МАТЕРИАЛ', updated_at=CURRENT_TIMESTAMP WHERE UPPER(TRIM(COALESCE(material,'')))='КОСТЮМНЫЙ МАТА';
UPDATE catalog_variants SET color='ГОЛУБОЙ', updated_at=CURRENT_TIMESTAMP WHERE UPPER(TRIM(COALESCE(color,'')))='ДЖИНСА ГОЛУБОЙ';
UPDATE catalog_variants SET color='ГОРЧИЧНЫЙ', updated_at=CURRENT_TIMESTAMP WHERE UPPER(TRIM(COALESCE(color,'')))='ГОРЧИЧНАЯ';

-- Proven duplicate product: the row later renamed to УДАЛИТЬ / historical ЕҢІЛІК is the same ЕҢЛІК ШАПАН.
-- Move its executions into keeper product 2. Product 53 РУКОВА is an empty typo of РУКАВА (50).
UPDATE catalog_stock_positions SET product_id=2, updated_at=CURRENT_TIMESTAMP WHERE product_id=34 AND EXISTS(SELECT 1 FROM catalog_products WHERE id=2 AND is_active=1);
UPDATE catalog_variants SET product_id=2, updated_at=CURRENT_TIMESTAMP WHERE product_id=34 AND EXISTS(SELECT 1 FROM catalog_products WHERE id=2 AND is_active=1);

-- One active execution per product + material + length after product/value normalization.
DROP TABLE IF EXISTS _step188j_position_map;
CREATE TABLE _step188j_position_map AS
SELECT sp.id AS old_id,
       (SELECT candidate.id FROM catalog_stock_positions candidate
        WHERE candidate.product_id=sp.product_id
          AND UPPER(TRIM(candidate.material))=UPPER(TRIM(sp.material))
          AND UPPER(TRIM(candidate.length))=UPPER(TRIM(sp.length))
        ORDER BY candidate.is_active DESC,
                 (SELECT COUNT(*) FROM catalog_variants cv WHERE cv.stock_position_id=candidate.id AND cv.is_active=1) DESC,
                 candidate.id ASC LIMIT 1) AS keeper_id
FROM catalog_stock_positions sp
WHERE EXISTS (
  SELECT 1
  FROM catalog_stock_positions affected
  JOIN _step188j_affected_positions ap ON ap.id=affected.id
  WHERE affected.product_id=sp.product_id
    AND UPPER(TRIM(affected.material))=UPPER(TRIM(sp.material))
    AND UPPER(TRIM(affected.length))=UPPER(TRIM(sp.length))
);

INSERT OR IGNORE INTO catalog_identity_position_merges(old_position_id,keeper_position_id,reason,merged_at)
SELECT old_id,keeper_id,'step188j product/value canonicalization',CURRENT_TIMESTAMP FROM _step188j_position_map WHERE old_id<>keeper_id;

UPDATE catalog_variants
SET stock_position_id=(SELECT keeper_id FROM _step188j_position_map m WHERE m.old_id=catalog_variants.stock_position_id)
WHERE stock_position_id IN (SELECT old_id FROM _step188j_position_map WHERE old_id<>keeper_id);
UPDATE catalog_stock_positions
SET is_active=CASE
      WHEN id IN (SELECT keeper_id FROM _step188j_position_map)
      THEN COALESCE((SELECT MAX(peer.is_active) FROM catalog_stock_positions peer
                     WHERE peer.product_id=catalog_stock_positions.product_id
                       AND UPPER(TRIM(peer.material))=UPPER(TRIM(catalog_stock_positions.material))
                       AND UPPER(TRIM(peer.length))=UPPER(TRIM(catalog_stock_positions.length))),is_active)
      ELSE 0 END,
    is_default=CASE WHEN id IN (SELECT keeper_id FROM _step188j_position_map) THEN is_default ELSE 0 END,
    updated_at=CURRENT_TIMESTAMP
WHERE id IN (SELECT old_id FROM _step188j_position_map WHERE old_id<>keeper_id)
   OR id IN (SELECT keeper_id FROM _step188j_position_map WHERE old_id<>keeper_id);

-- Variant product/material/length always follows the canonical execution.
UPDATE catalog_variants
SET product_id=(SELECT sp.product_id FROM catalog_stock_positions sp WHERE sp.id=catalog_variants.stock_position_id),
    material=(SELECT sp.material FROM catalog_stock_positions sp WHERE sp.id=catalog_variants.stock_position_id),
    length=(SELECT sp.length FROM catalog_stock_positions sp WHERE sp.id=catalog_variants.stock_position_id),
    color=CASE WHEN UPPER(TRIM(COALESCE(color,'')))='ГОРЧИЧНАЯ' THEN 'ГОРЧИЧНЫЙ'
               WHEN UPPER(TRIM(COALESCE(color,'')))='ДЖИНСА ГОЛУБОЙ' THEN 'ГОЛУБОЙ'
               ELSE CASE WHEN TRIM(COALESCE(color,''))='' THEN 'БЕЗ ЦВЕТА' ELSE UPPER(TRIM(color)) END END,
    updated_at=CURRENT_TIMESTAMP
WHERE stock_position_id IS NOT NULL;

-- Only variants affected by this cleanup are remapped. Unrelated inactive historical duplicates stay untouched.
DROP TABLE IF EXISTS _step188j_affected_variants;
CREATE TABLE _step188j_affected_variants AS
SELECT b.variant_id AS id
FROM catalog_cleanup_variant_baseline b
WHERE b.repair_key='step188j-catalog-cleanup-v1'
  AND (b.product_id_before=34 OR b.material_before IN ('ЛЕН','КОСТЮМНЫЙ МАТА') OR b.color_before IN ('ГОРЧИЧНАЯ','ДЖИНСА ГОЛУБОЙ'))
UNION
SELECT v.id FROM catalog_variants v
WHERE v.stock_position_id IN (
  SELECT old_id FROM _step188j_position_map WHERE old_id<>keeper_id
  UNION SELECT keeper_id FROM _step188j_position_map WHERE old_id<>keeper_id
);

-- One keeper concrete combination. Prefer an active variant, and for the ЕҢЛІК merge prefer the original keeper product's row.
DROP TABLE IF EXISTS _step188j_variant_map;
CREATE TABLE _step188j_variant_map AS
SELECT v.id AS old_id,
       (SELECT candidate.id FROM catalog_variants candidate
        WHERE candidate.stock_position_id=v.stock_position_id
          AND COALESCE(candidate.category,'adult')=COALESCE(v.category,'adult')
          AND COALESCE(candidate.gender,'')=COALESCE(v.gender,'')
          AND COALESCE(candidate.color,'')=COALESCE(v.color,'')
          AND COALESCE(candidate.size_label,'')=COALESCE(v.size_label,'')
        ORDER BY candidate.is_active DESC,
                 CASE WHEN COALESCE((SELECT b.product_id_before FROM catalog_cleanup_variant_baseline b WHERE b.repair_key='step188j-catalog-cleanup-v1' AND b.variant_id=candidate.id),candidate.product_id)=2 THEN 0 ELSE 1 END ASC,
                 (SELECT COUNT(*) FROM order_items oi WHERE oi.variant_id=candidate.id) DESC,
                 candidate.id ASC LIMIT 1) AS keeper_id
FROM catalog_variants v WHERE v.stock_position_id IS NOT NULL AND v.id IN (SELECT id FROM _step188j_affected_variants);

INSERT OR IGNORE INTO catalog_identity_variant_merges(old_variant_id,keeper_variant_id,reason,merged_at)
SELECT old_id,keeper_id,'step188j product/value canonicalization',CURRENT_TIMESTAMP FROM _step188j_variant_map WHERE old_id<>keeper_id;

-- Canonicalize every operational variant reference before duplicate rows are deactivated.
UPDATE order_items SET variant_id=(SELECT keeper_id FROM _step188j_variant_map m WHERE m.old_id=order_items.variant_id)
WHERE variant_id IN (SELECT old_id FROM _step188j_variant_map WHERE old_id<>keeper_id);
UPDATE workshop_tasks SET variant_id=(SELECT keeper_id FROM _step188j_variant_map m WHERE m.old_id=workshop_tasks.variant_id)
WHERE variant_id IN (SELECT old_id FROM _step188j_variant_map WHERE old_id<>keeper_id);
UPDATE inventory_movements SET variant_id=(SELECT keeper_id FROM _step188j_variant_map m WHERE m.old_id=inventory_movements.variant_id)
WHERE variant_id IN (SELECT old_id FROM _step188j_variant_map WHERE old_id<>keeper_id);
UPDATE inventory_reservations SET variant_id=(SELECT keeper_id FROM _step188j_variant_map m WHERE m.old_id=inventory_reservations.variant_id)
WHERE variant_id IN (SELECT old_id FROM _step188j_variant_map WHERE old_id<>keeper_id);
UPDATE inventory_lifecycle_events SET variant_id=(SELECT keeper_id FROM _step188j_variant_map m WHERE m.old_id=inventory_lifecycle_events.variant_id)
WHERE variant_id IN (SELECT old_id FROM _step188j_variant_map WHERE old_id<>keeper_id);
UPDATE inventory_transfer_items SET variant_id=(SELECT keeper_id FROM _step188j_variant_map m WHERE m.old_id=inventory_transfer_items.variant_id)
WHERE variant_id IN (SELECT old_id FROM _step188j_variant_map WHERE old_id<>keeper_id);
-- Stocktake rows are immutable historical evidence. A completed revision may contain
-- both identities that are now known to be the same SKU. Rewriting those rows to one
-- keeper would violate the historical (session_id, variant_id) uniqueness and, worse,
-- would erase the fact that the revision originally counted two legacy identities.
-- Instead, only the derived stock-check history is canonicalized. When one historical
-- stocktake produced multiple checks that now resolve to the same SKU, roll those
-- derived checks up into one canonical check while preserving all numeric totals.
DROP TABLE IF EXISTS _step188j_stocktake_check_members;
CREATE TABLE _step188j_stocktake_check_members AS
WITH mapped AS (
  SELECT c.id,
         c.inventory_source,
         c.reference_id,
         c.variant_id,
         COALESCE(m.keeper_id,c.variant_id) AS canonical_variant_id,
         c.expected_quantity,
         c.counted_quantity,
         c.reserved_quantity
  FROM inventory_stock_checks c
  LEFT JOIN _step188j_variant_map m ON m.old_id=c.variant_id
  WHERE c.reference_type='stocktake' AND c.reference_id IS NOT NULL
),
groups AS (
  SELECT inventory_source,reference_id,canonical_variant_id,
         COALESCE(MIN(CASE WHEN variant_id=canonical_variant_id THEN id END),MIN(id)) AS keeper_check_id,
         SUM(expected_quantity) AS expected_sum,
         SUM(counted_quantity) AS counted_sum,
         SUM(reserved_quantity) AS reserved_sum,
         COUNT(*) AS row_count
  FROM mapped
  GROUP BY inventory_source,reference_id,canonical_variant_id
  HAVING COUNT(*)>1
)
SELECT m.id AS check_id,g.keeper_check_id,m.inventory_source,m.reference_id,m.canonical_variant_id,
       g.expected_sum,g.counted_sum,g.reserved_sum
FROM mapped m
JOIN groups g
  ON g.inventory_source=m.inventory_source
 AND g.reference_id=m.reference_id
 AND g.canonical_variant_id=m.canonical_variant_id;

DELETE FROM inventory_stock_checks
WHERE id IN (
  SELECT check_id FROM _step188j_stocktake_check_members WHERE check_id<>keeper_check_id
);

UPDATE inventory_stock_checks
SET variant_id=(SELECT canonical_variant_id FROM _step188j_stocktake_check_members m WHERE m.keeper_check_id=inventory_stock_checks.id LIMIT 1),
    product_id=(SELECT v.product_id FROM catalog_variants v WHERE v.id=(SELECT canonical_variant_id FROM _step188j_stocktake_check_members m WHERE m.keeper_check_id=inventory_stock_checks.id LIMIT 1)),
    expected_quantity=(SELECT expected_sum FROM _step188j_stocktake_check_members m WHERE m.keeper_check_id=inventory_stock_checks.id LIMIT 1),
    counted_quantity=(SELECT counted_sum FROM _step188j_stocktake_check_members m WHERE m.keeper_check_id=inventory_stock_checks.id LIMIT 1),
    difference_quantity=(SELECT counted_sum-expected_sum FROM _step188j_stocktake_check_members m WHERE m.keeper_check_id=inventory_stock_checks.id LIMIT 1),
    reserved_quantity=(SELECT reserved_sum FROM _step188j_stocktake_check_members m WHERE m.keeper_check_id=inventory_stock_checks.id LIMIT 1),
    check_key='stocktake:' || reference_id || ':' || (SELECT canonical_variant_id FROM _step188j_stocktake_check_members m WHERE m.keeper_check_id=inventory_stock_checks.id LIMIT 1)
WHERE id IN (SELECT keeper_check_id FROM _step188j_stocktake_check_members);

UPDATE inventory_stock_checks SET variant_id=(SELECT keeper_id FROM _step188j_variant_map m WHERE m.old_id=inventory_stock_checks.variant_id)
WHERE variant_id IN (SELECT old_id FROM _step188j_variant_map WHERE old_id<>keeper_id);
UPDATE catalog_input_aliases SET variant_id=(SELECT keeper_id FROM _step188j_variant_map m WHERE m.old_id=catalog_input_aliases.variant_id)
WHERE variant_id IN (SELECT old_id FROM _step188j_variant_map WHERE old_id<>keeper_id);
UPDATE catalog_identity_order_item_links SET variant_id=(SELECT keeper_id FROM _step188j_variant_map m WHERE m.old_id=catalog_identity_order_item_links.variant_id)
WHERE variant_id IN (SELECT old_id FROM _step188j_variant_map WHERE old_id<>keeper_id);

-- Product ids follow canonical variants, while product-only workshop/pending rows from the merged product move to keeper 2.
UPDATE order_items SET product_id=2 WHERE product_id=34;
UPDATE workshop_tasks SET product_id=2 WHERE product_id=34;
UPDATE inventory_stock SET product_id=2 WHERE product_id=34;
UPDATE inventory_movements SET product_id=2 WHERE product_id=34;
UPDATE inventory_reservations SET product_id=2 WHERE product_id=34;
UPDATE inventory_lifecycle_events SET product_id=2 WHERE product_id=34;
UPDATE inventory_transfer_items SET product_id=2 WHERE product_id=34;
UPDATE inventory_stock_checks SET product_id=2 WHERE product_id=34;
UPDATE catalog_identity_order_item_links SET product_id=2 WHERE product_id=34;
UPDATE catalog_product_aliases SET product_id=2 WHERE product_id=34;

UPDATE order_items SET product_id=(SELECT v.product_id FROM catalog_variants v WHERE v.id=order_items.variant_id) WHERE variant_id IS NOT NULL;
UPDATE workshop_tasks SET product_id=(SELECT v.product_id FROM catalog_variants v WHERE v.id=workshop_tasks.variant_id) WHERE variant_id IS NOT NULL;
UPDATE inventory_movements SET product_id=(SELECT v.product_id FROM catalog_variants v WHERE v.id=inventory_movements.variant_id) WHERE variant_id IS NOT NULL;
UPDATE inventory_reservations SET product_id=(SELECT v.product_id FROM catalog_variants v WHERE v.id=inventory_reservations.variant_id) WHERE variant_id IS NOT NULL;
UPDATE inventory_lifecycle_events SET product_id=(SELECT v.product_id FROM catalog_variants v WHERE v.id=inventory_lifecycle_events.variant_id) WHERE variant_id IS NOT NULL;
UPDATE inventory_transfer_items SET product_id=(SELECT v.product_id FROM catalog_variants v WHERE v.id=inventory_transfer_items.variant_id) WHERE variant_id IS NOT NULL;
UPDATE inventory_stock_checks SET product_id=(SELECT v.product_id FROM catalog_variants v WHERE v.id=inventory_stock_checks.variant_id) WHERE variant_id IS NOT NULL;
UPDATE catalog_identity_order_item_links SET product_id=(SELECT v.product_id FROM catalog_variants v WHERE v.id=catalog_identity_order_item_links.variant_id) WHERE variant_id IS NOT NULL;

-- Retry-safe physical stock rollup from immutable pre-cleanup rows.
UPDATE inventory_stock
SET variant_id=(SELECT keeper_id FROM _step188j_variant_map m WHERE m.old_id=inventory_stock.variant_id)
WHERE variant_id IN (SELECT old_id FROM _step188j_variant_map WHERE old_id<>keeper_id);

DROP TABLE IF EXISTS _step188j_stock_rollup;
CREATE TABLE _step188j_stock_rollup AS
SELECT MIN(b.stock_id) AS keeper_stock_id,
       b.inventory_source,
       COALESCE((SELECT m.keeper_id FROM _step188j_variant_map m WHERE m.old_id=b.variant_id),b.variant_id) AS variant_id,
       SUM(COALESCE(b.quantity_before,0)) AS total_quantity,
       SUM(COALESCE(b.reserved_before,0)) AS total_reserved
FROM catalog_cleanup_stock_baseline b
WHERE b.repair_key='step188j-catalog-cleanup-v1'
GROUP BY b.inventory_source,COALESCE((SELECT m.keeper_id FROM _step188j_variant_map m WHERE m.old_id=b.variant_id),b.variant_id);

INSERT OR REPLACE INTO catalog_cleanup_stock_merges(repair_key,old_stock_id,keeper_stock_id,inventory_source,variant_id,quantity_before,reserved_before,merged_at)
SELECT 'step188j-catalog-cleanup-v1',b.stock_id,r.keeper_stock_id,b.inventory_source,r.variant_id,b.quantity_before,b.reserved_before,CURRENT_TIMESTAMP
FROM catalog_cleanup_stock_baseline b JOIN _step188j_stock_rollup r
 ON r.inventory_source=b.inventory_source
AND r.variant_id=COALESCE((SELECT m.keeper_id FROM _step188j_variant_map m WHERE m.old_id=b.variant_id),b.variant_id)
WHERE b.repair_key='step188j-catalog-cleanup-v1' AND b.stock_id<>r.keeper_stock_id;

-- Completed stocktake documents stay historically immutable. Their old variant ids and
-- snapshots remain evidence of what was counted at that time. A stock row, however, is
-- an operational pointer and duplicate stock rows are about to be removed. Null only
-- that technical pointer when it would become stale or point at a newly canonicalized
-- row; the historical quantities/variant/product/snapshots are not rewritten.
UPDATE inventory_stocktake_items
SET stock_id=NULL
WHERE stock_id IN (
        SELECT old_stock_id FROM catalog_cleanup_stock_merges WHERE repair_key='step188j-catalog-cleanup-v1'
      )
   OR variant_id IN (
        SELECT old_id FROM _step188j_variant_map WHERE old_id<>keeper_id
      );

UPDATE inventory_stock
SET quantity=(SELECT r.total_quantity FROM _step188j_stock_rollup r WHERE r.keeper_stock_id=inventory_stock.id),
    reserved_quantity=(SELECT r.total_reserved FROM _step188j_stock_rollup r WHERE r.keeper_stock_id=inventory_stock.id),
    updated_at=CURRENT_TIMESTAMP
WHERE id IN (SELECT keeper_stock_id FROM _step188j_stock_rollup);
DELETE FROM inventory_stock
WHERE id IN (SELECT stock_id FROM catalog_cleanup_stock_baseline WHERE repair_key='step188j-catalog-cleanup-v1')
  AND id NOT IN (SELECT keeper_stock_id FROM _step188j_stock_rollup);

UPDATE catalog_variants SET is_active=0,updated_at=CURRENT_TIMESTAMP
WHERE id IN (SELECT old_id FROM _step188j_variant_map WHERE old_id<>keeper_id);

-- Canonical stock snapshots. Historical order/movement snapshots remain exactly as entered.
UPDATE inventory_stock
SET product_id=(SELECT v.product_id FROM catalog_variants v WHERE v.id=inventory_stock.variant_id),
    product_name_snapshot=(SELECT p.name FROM catalog_variants v JOIN catalog_products p ON p.id=v.product_id WHERE v.id=inventory_stock.variant_id),
    gender_snapshot=(SELECT NULLIF(v.gender,'') FROM catalog_variants v WHERE v.id=inventory_stock.variant_id),
    color_snapshot=(SELECT NULLIF(v.color,'') FROM catalog_variants v WHERE v.id=inventory_stock.variant_id),
    material_snapshot=(SELECT v.material FROM catalog_variants v WHERE v.id=inventory_stock.variant_id),
    length_snapshot=(SELECT v.length FROM catalog_variants v WHERE v.id=inventory_stock.variant_id),
    size_snapshot=(SELECT NULLIF(v.size_label,'') FROM catalog_variants v WHERE v.id=inventory_stock.variant_id),
    updated_at=CURRENT_TIMESTAMP
WHERE variant_id IS NOT NULL;

-- Deactivate proven loser products only after all references have moved.
UPDATE catalog_products SET name='ЕҢІЛІК ШАПАН',is_active=0,updated_at=CURRENT_TIMESTAMP WHERE id=34 AND EXISTS(SELECT 1 FROM catalog_products WHERE id=2 AND is_active=1);
UPDATE catalog_products SET is_active=0,updated_at=CURRENT_TIMESTAMP
WHERE id=53 AND UPPER(TRIM(name))='РУКОВА' AND EXISTS(SELECT 1 FROM catalog_products WHERE id=50 AND is_active=1)
  AND NOT EXISTS(SELECT 1 FROM catalog_variants WHERE product_id=53)
  AND NOT EXISTS(SELECT 1 FROM order_items WHERE product_id=53)
  AND NOT EXISTS(SELECT 1 FROM workshop_tasks WHERE product_id=53)
  AND NOT EXISTS(SELECT 1 FROM inventory_stock WHERE product_id=53)
  AND NOT EXISTS(SELECT 1 FROM inventory_movements WHERE product_id=53)
  AND NOT EXISTS(SELECT 1 FROM inventory_reservations WHERE product_id=53)
  AND NOT EXISTS(SELECT 1 FROM inventory_lifecycle_events WHERE product_id=53)
  AND NOT EXISTS(SELECT 1 FROM inventory_transfer_items WHERE product_id=53)
  AND NOT EXISTS(SELECT 1 FROM inventory_stock_checks WHERE product_id=53);

-- Seed/update aliases again after loser deactivation so the target is unambiguous.
UPDATE catalog_product_aliases SET product_id=50,updated_at=CURRENT_TIMESTAMP WHERE alias_key='РУКОВА' AND EXISTS(SELECT 1 FROM catalog_products WHERE id=50 AND is_active=1);

-- Record controlled product repairs once.
INSERT INTO catalog_product_merge_repairs(repair_key,keeper_product_id,merged_product_id,keeper_name,merged_name,variants_moved,variants_merged,stock_rows_merged,details,created_at)
SELECT 'step188j-catalog-merge-2-34',2,34,'ЕҢЛІК ШАПАН','ЕҢІЛІК ШАПАН',
       COALESCE((SELECT COUNT(*) FROM catalog_cleanup_variant_baseline b WHERE b.repair_key='step188j-catalog-cleanup-v1' AND b.product_id_before=34 AND b.variant_id IN (SELECT old_id FROM _step188j_variant_map WHERE old_id=keeper_id)),0),
       COALESCE((SELECT COUNT(*) FROM catalog_cleanup_variant_baseline b WHERE b.repair_key='step188j-catalog-cleanup-v1' AND b.product_id_before=34 AND b.variant_id IN (SELECT old_id FROM _step188j_variant_map WHERE old_id<>keeper_id)),0),
       COALESCE((SELECT COUNT(*) FROM catalog_cleanup_stock_merges m JOIN catalog_cleanup_stock_baseline b ON b.repair_key=m.repair_key AND b.stock_id=m.old_stock_id JOIN catalog_cleanup_variant_baseline v ON v.repair_key=b.repair_key AND v.variant_id=b.variant_id WHERE m.repair_key='step188j-catalog-cleanup-v1' AND v.product_id_before=34),0),
       'Подтверждённый исторический дубль: product 34 (раньше ЕҢІЛІК ШАПАН, затем УДАЛИТЬ) объединён с ЕҢЛІК ШАПАН. Совпадающие варианты сведены, уникальные сохранены под keeper; snapshots заказов не переписывались.',CURRENT_TIMESTAMP
WHERE EXISTS(SELECT 1 FROM catalog_products WHERE id=34)
ON CONFLICT(repair_key) DO NOTHING;

INSERT INTO catalog_product_merge_repairs(repair_key,keeper_product_id,merged_product_id,keeper_name,merged_name,variants_moved,variants_merged,stock_rows_merged,details,created_at)
SELECT 'step188j-catalog-merge-50-53',50,53,'РУКАВА','РУКОВА',0,0,0,'Пустой подтверждённый typo-product РУКОВА деактивирован; ввод запоминается как alias РУКАВА.',CURRENT_TIMESTAMP
WHERE EXISTS(SELECT 1 FROM catalog_products WHERE id=53)
ON CONFLICT(repair_key) DO NOTHING;

-- Backfill only base-product identity for old workshop rows when the name is exact or a proven product alias.
-- Workshop SKU remains NULL by design.
UPDATE order_items
SET product_id=COALESCE(
  (SELECT p.id FROM catalog_products p WHERE p.is_active=1 AND UPPER(TRIM(p.name))=UPPER(TRIM(order_items.product_name_snapshot)) ORDER BY p.id LIMIT 1),
  (SELECT a.product_id FROM catalog_product_aliases a JOIN catalog_products p ON p.id=a.product_id AND p.is_active=1 WHERE UPPER(TRIM(a.raw_value))=UPPER(TRIM(order_items.product_name_snapshot)) ORDER BY a.id LIMIT 1)
),
variant_id=NULL,
stock_writeoff_status='workshop'
WHERE COALESCE(is_workshop,0)=1 AND product_id IS NULL
  AND COALESCE(
    (SELECT p.id FROM catalog_products p WHERE p.is_active=1 AND UPPER(TRIM(p.name))=UPPER(TRIM(order_items.product_name_snapshot)) ORDER BY p.id LIMIT 1),
    (SELECT a.product_id FROM catalog_product_aliases a JOIN catalog_products p ON p.id=a.product_id AND p.is_active=1 WHERE UPPER(TRIM(a.raw_value))=UPPER(TRIM(order_items.product_name_snapshot)) ORDER BY a.id LIMIT 1)
  ) IS NOT NULL;

UPDATE workshop_tasks
SET product_id=COALESCE(
  (SELECT oi.product_id FROM order_items oi WHERE oi.id=workshop_tasks.order_item_id AND oi.product_id IS NOT NULL),
  (SELECT p.id FROM catalog_products p WHERE p.is_active=1 AND UPPER(TRIM(p.name))=UPPER(TRIM(workshop_tasks.product_name_snapshot)) ORDER BY p.id LIMIT 1),
  (SELECT a.product_id FROM catalog_product_aliases a JOIN catalog_products p ON p.id=a.product_id AND p.is_active=1 WHERE UPPER(TRIM(a.raw_value))=UPPER(TRIM(workshop_tasks.product_name_snapshot)) ORDER BY a.id LIMIT 1)
),
variant_id=NULL,
updated_at=CURRENT_TIMESTAMP
WHERE product_id IS NULL
  AND COALESCE(
    (SELECT oi.product_id FROM order_items oi WHERE oi.id=workshop_tasks.order_item_id AND oi.product_id IS NOT NULL),
    (SELECT p.id FROM catalog_products p WHERE p.is_active=1 AND UPPER(TRIM(p.name))=UPPER(TRIM(workshop_tasks.product_name_snapshot)) ORDER BY p.id LIMIT 1),
    (SELECT a.product_id FROM catalog_product_aliases a JOIN catalog_products p ON p.id=a.product_id AND p.is_active=1 WHERE UPPER(TRIM(a.raw_value))=UPPER(TRIM(workshop_tasks.product_name_snapshot)) ORDER BY a.id LIMIT 1)
  ) IS NOT NULL;

-- Exact historical normal anomaly with proven target. Identity only: no present-day stock movement is manufactured.
UPDATE order_items SET product_id=41,variant_id=356,stock_writeoff_status=CASE WHEN COALESCE(stock_writeoff_status,'') IN ('','legacy_imported','catalog_unresolved') THEN 'catalog_linked_history' ELSE stock_writeoff_status END
WHERE id=1223 AND UPPER(TRIM(product_name_snapshot))='КОРСЕТ' AND UPPER(TRIM(color_snapshot))='ДЖИНСА ГОЛУБОЙ' AND UPPER(TRIM(material_snapshot))='ДЖИНСА' AND TRIM(COALESCE(size_snapshot,''))='42'
  AND EXISTS(SELECT 1 FROM catalog_variants WHERE id=356 AND product_id=41 AND is_active=1 AND color='ГОЛУБОЙ' AND material='ДЖИНСА' AND COALESCE(size_label,'')='42');
UPDATE order_items SET product_id=25,variant_id=NULL,stock_writeoff_status='workshop'
WHERE id=1224 AND COALESCE(is_workshop,0)=1 AND UPPER(TRIM(product_name_snapshot))='ҚОЗЫ КӨРПЕШ ЖИЛЕТ' AND UPPER(TRIM(color_snapshot))='ДЖИНСА ГОЛУБОЙ' AND UPPER(TRIM(material_snapshot))='ДЖИНСА'
  AND EXISTS(SELECT 1 FROM catalog_products WHERE id=25 AND is_active=1);
UPDATE workshop_tasks SET product_id=25,variant_id=NULL,updated_at=CURRENT_TIMESTAMP
WHERE id=545 AND UPPER(TRIM(product_name_snapshot))='ҚОЗЫ КӨРПЕШ ЖИЛЕТ' AND UPPER(TRIM(color_snapshot))='ДЖИНСА ГОЛУБОЙ' AND UPPER(TRIM(material_snapshot))='ДЖИНСА'
  AND EXISTS(SELECT 1 FROM catalog_products WHERE id=25 AND is_active=1);

-- Rebuild uniqueness around the cleaned canonical hierarchy.
CREATE UNIQUE INDEX IF NOT EXISTS idx_catalog_stock_positions_execution_unique
  ON catalog_stock_positions(product_id,material,length) WHERE is_active=1;
CREATE UNIQUE INDEX IF NOT EXISTS idx_catalog_variants_combination_unique
  ON catalog_variants(stock_position_id,category,COALESCE(gender,''),COALESCE(color,''),COALESCE(size_label,''))
  WHERE stock_position_id IS NOT NULL AND is_active=1;
CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_stock_variant_unique
  ON inventory_stock(inventory_source,variant_id) WHERE variant_id IS NOT NULL;

INSERT INTO catalog_identity_meta(key,value,updated_at) VALUES('catalog_cleanup_188j','active',CURRENT_TIMESTAMP)
ON CONFLICT(key) DO UPDATE SET value='active',updated_at=CURRENT_TIMESTAMP;

DROP TABLE IF EXISTS _step188j_stock_rollup;
DROP TABLE IF EXISTS _step188j_stocktake_check_members;
DROP TABLE IF EXISTS _step188j_variant_map;
DROP TABLE IF EXISTS _step188j_affected_variants;
DROP TABLE IF EXISTS _step188j_position_map;
DROP TABLE IF EXISTS _step188j_affected_positions;

SELECT 'step188j catalog cleanup + controlled learning active' AS migration_marker;
