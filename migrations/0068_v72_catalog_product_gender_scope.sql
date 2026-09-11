PRAGMA foreign_keys = ON;

-- Step 0068 / Catalog Gender Scope R1
-- Product-level gender is the default used by forms, not a hard constraint:
--   female -> transaction forms auto-use ЖЕН
--   male   -> transaction forms auto-use МУЖ
--   unisex -> a human chooses ЖЕН or МУЖ for the concrete SKU/order line
-- Historical snapshots are intentionally preserved. Only canonical catalog links/current stock are repaired.

ALTER TABLE catalog_products
  ADD COLUMN gender_scope TEXT NOT NULL DEFAULT 'unisex'
  CHECK (gender_scope IN ('female','male','unisex'));

CREATE TABLE IF NOT EXISTS catalog_gender_scope_repairs (
  product_id INTEGER PRIMARY KEY,
  product_name TEXT NOT NULL,
  previous_scope TEXT NOT NULL,
  assigned_scope TEXT NOT NULL,
  rule_key TEXT NOT NULL,
  repaired_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS catalog_gender_variant_repairs (
  old_variant_id INTEGER PRIMARY KEY,
  keeper_variant_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  target_gender TEXT NOT NULL,
  repair_mode TEXT NOT NULL CHECK (repair_mode IN ('in_place','merge','retire_unused_unisex_blank')),
  repaired_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS catalog_gender_stock_baseline (
  stock_id INTEGER PRIMARY KEY,
  inventory_source TEXT NOT NULL,
  variant_id INTEGER NOT NULL,
  quantity_before INTEGER NOT NULL,
  reserved_before INTEGER NOT NULL,
  captured_at TEXT NOT NULL
);

-- Capture the default before changing it so the cleanup is auditable.
INSERT OR IGNORE INTO catalog_gender_scope_repairs(product_id, product_name, previous_scope, assigned_scope, rule_key, repaired_at)
SELECT id, name, gender_scope, gender_scope, 'baseline', CURRENT_TIMESTAMP
FROM catalog_products;

-- Client-approved one-gender models from the historical strict catalog rules.
UPDATE catalog_products SET gender_scope = 'female', updated_at = CURRENT_TIMESTAMP
WHERE UPPER(TRIM(name)) IN (
  'БАЯН СҰЛУ ШАПАН','БАЯН СУЛУ ШАПАН','ЕҢЛІК ШАПАН','ЕНЛІК ШАПАН','СӘУКЕЛЕ ШАПАН','САУКЕЛЕ ШАПАН','АЙДАР ШАПАН',
  'БАЯН СҰЛУ ЖИЛЕТ','БАЯН СУЛУ ЖИЛЕТ','ТҰМАР ЖИЛЕТ','ТУМАР ЖИЛЕТ','АЙДАЙ ЖИЛЕТ','ЗЕЙНЕ ЖИЛЕТ','ҚОРЛАН ЖИЛЕТ','КОРЛАН ЖИЛЕТ',
  'АЙНҰРЫМ-АЙ КӨЙЛЕК','АЙНУРЫМ-АЙ КОЙЛЕК','БИКЕШ КӨЙЛЕК','БИКЕШ КОЙЛЕК','КЕРБЕЗ КӨЙЛЕК','КЕРБЕЗ КОЙЛЕК','АРУ КӨЙЛЕК','АРУ КОЙЛЕК',
  'НӘЗІК КӨЙЛЕК','НАЗІК КОЙЛЕК','НӘЗІК КОРСЕТ','НАЗІК КОРСЕТ','АҚ НӘЗІК КОРСЕТ','АК НАЗІК КОРСЕТ','КӨРКЕМ КОРСЕТ','КОРКЕМ КОРСЕТ',
  'ТҰМАР КОРСЕТ','ТУМАР КОРСЕТ','НАЗ КОРСЕТ','ВОРОТНИК','ОРАМАЛ АТЛАС','ОРАМАЛ ҚҰДАҒИ','ОРАМАЛ КУДАГИ',
  'ШЕКЕЛІК АЙНҰРЫМ-АЙ','ШЕКЕЛІК АЙНУРЫМ-АЙ','КӨЙЛЕК','КОЙЛЕК'
);

UPDATE catalog_products SET gender_scope = 'male', updated_at = CURRENT_TIMESTAMP
WHERE UPPER(TRIM(name)) IN (
  'ҚОЗЫ КӨРПЕШ ШАПАН','КОЗЫ КОРПЕШ ШАПАН','КЕБЕК ШАПАН','АЙДАР БОМБЕР','ҚОЗЫ КӨРПЕШ ЖИЛЕТ','КОЗЫ КОРПЕШ ЖИЛЕТ'
);

UPDATE catalog_products SET gender_scope = 'unisex', updated_at = CURRENT_TIMESTAMP
WHERE UPPER(TRIM(name)) IN (
  'ДАРА ШАПАН','САРДАР ШАПАН','ҚАЗЫНА ШАПАН','КАЗЫНА ШАПАН','АЛАН БОМБЕР','СӘУЛЕТ ЖИЛЕТ','САУЛЕТ ЖИЛЕТ','БАЙСАЛ ЖИЛЕТ','БАСҚА','БАСКА'
);

-- For models not covered by the approved list, infer only when the active catalog is unanimous.
-- Mixed/blank-only models stay unisex rather than being guessed.
UPDATE catalog_products AS p
SET gender_scope = CASE
      WHEN EXISTS(SELECT 1 FROM catalog_variants v WHERE v.product_id=p.id AND v.is_active=1 AND UPPER(TRIM(COALESCE(v.gender,'')))='ЖЕН')
       AND NOT EXISTS(SELECT 1 FROM catalog_variants v WHERE v.product_id=p.id AND v.is_active=1 AND UPPER(TRIM(COALESCE(v.gender,'')))='МУЖ')
       AND NOT EXISTS(SELECT 1 FROM catalog_variants v WHERE v.product_id=p.id AND v.is_active=1 AND TRIM(COALESCE(v.gender,''))='') THEN 'female'
      WHEN EXISTS(SELECT 1 FROM catalog_variants v WHERE v.product_id=p.id AND v.is_active=1 AND UPPER(TRIM(COALESCE(v.gender,'')))='МУЖ')
       AND NOT EXISTS(SELECT 1 FROM catalog_variants v WHERE v.product_id=p.id AND v.is_active=1 AND UPPER(TRIM(COALESCE(v.gender,'')))='ЖЕН')
       AND NOT EXISTS(SELECT 1 FROM catalog_variants v WHERE v.product_id=p.id AND v.is_active=1 AND TRIM(COALESCE(v.gender,''))='') THEN 'male'
      ELSE 'unisex'
    END,
    updated_at = CURRENT_TIMESTAMP
WHERE UPPER(TRIM(name)) NOT IN (
  'БАЯН СҰЛУ ШАПАН','БАЯН СУЛУ ШАПАН','ЕҢЛІК ШАПАН','ЕНЛІК ШАПАН','СӘУКЕЛЕ ШАПАН','САУКЕЛЕ ШАПАН','АЙДАР ШАПАН',
  'БАЯН СҰЛУ ЖИЛЕТ','БАЯН СУЛУ ЖИЛЕТ','ТҰМАР ЖИЛЕТ','ТУМАР ЖИЛЕТ','АЙДАЙ ЖИЛЕТ','ЗЕЙНЕ ЖИЛЕТ','ҚОРЛАН ЖИЛЕТ','КОРЛАН ЖИЛЕТ',
  'АЙНҰРЫМ-АЙ КӨЙЛЕК','АЙНУРЫМ-АЙ КОЙЛЕК','БИКЕШ КӨЙЛЕК','БИКЕШ КОЙЛЕК','КЕРБЕЗ КӨЙЛЕК','КЕРБЕЗ КОЙЛЕК','АРУ КӨЙЛЕК','АРУ КОЙЛЕК',
  'НӘЗІК КӨЙЛЕК','НАЗІК КОЙЛЕК','НӘЗІК КОРСЕТ','НАЗІК КОРСЕТ','АҚ НӘЗІК КОРСЕТ','АК НАЗІК КОРСЕТ','КӨРКЕМ КОРСЕТ','КОРКЕМ КОРСЕТ',
  'ТҰМАР КОРСЕТ','ТУМАР КОРСЕТ','НАЗ КОРСЕТ','ВОРОТНИК','ОРАМАЛ АТЛАС','ОРАМАЛ ҚҰДАҒИ','ОРАМАЛ КУДАГИ','ШЕКЕЛІК АЙНҰРЫМ-АЙ','ШЕКЕЛІК АЙНУРЫМ-АЙ','КӨЙЛЕК','КОЙЛЕК',
  'ҚОЗЫ КӨРПЕШ ШАПАН','КОЗЫ КОРПЕШ ШАПАН','КЕБЕК ШАПАН','АЙДАР БОМБЕР','ҚОЗЫ КӨРПЕШ ЖИЛЕТ','КОЗЫ КОРПЕШ ЖИЛЕТ',
  'ДАРА ШАПАН','САРДАР ШАПАН','ҚАЗЫНА ШАПАН','КАЗЫНА ШАПАН','АЛАН БОМБЕР','СӘУЛЕТ ЖИЛЕТ','САУЛЕТ ЖИЛЕТ','БАЙСАЛ ЖИЛЕТ','БАСҚА','БАСКА'
);

UPDATE catalog_gender_scope_repairs
SET assigned_scope=(SELECT p.gender_scope FROM catalog_products p WHERE p.id=catalog_gender_scope_repairs.product_id),
    rule_key=CASE
      WHEN (SELECT p.gender_scope FROM catalog_products p WHERE p.id=catalog_gender_scope_repairs.product_id)='female' THEN 'approved_or_unanimous_female'
      WHEN (SELECT p.gender_scope FROM catalog_products p WHERE p.id=catalog_gender_scope_repairs.product_id)='male' THEN 'approved_or_unanimous_male'
      ELSE 'approved_or_conservative_unisex'
    END,
    repaired_at=CURRENT_TIMESTAMP;

-- Build a deterministic map only for blank variants of products with a known default.
DROP TABLE IF EXISTS _step0068_gender_map;
CREATE TABLE _step0068_gender_map AS
SELECT
  v.id AS old_id,
  v.product_id,
  CASE p.gender_scope WHEN 'female' THEN 'ЖЕН' ELSE 'МУЖ' END AS target_gender,
  COALESCE(
  (
    SELECT MIN(target.id)
    FROM catalog_variants target
    WHERE target.product_id=v.product_id
      AND COALESCE(target.stock_position_id,-1)=COALESCE(v.stock_position_id,-1)
      AND COALESCE(target.category,'adult')=COALESCE(v.category,'adult')
      AND UPPER(TRIM(COALESCE(target.color,'')))=UPPER(TRIM(COALESCE(v.color,'')))
      AND TRIM(COALESCE(target.size_label,''))=TRIM(COALESCE(v.size_label,''))
      AND target.is_active=1
      AND UPPER(TRIM(COALESCE(target.gender,'')))=CASE p.gender_scope WHEN 'female' THEN 'ЖЕН' ELSE 'МУЖ' END
  ),
  (
    SELECT MIN(target.id)
    FROM catalog_variants target
    WHERE target.product_id=v.product_id
      AND COALESCE(target.stock_position_id,-1)=COALESCE(v.stock_position_id,-1)
      AND COALESCE(target.category,'adult')=COALESCE(v.category,'adult')
      AND UPPER(TRIM(COALESCE(target.color,'')))=UPPER(TRIM(COALESCE(v.color,'')))
      AND TRIM(COALESCE(target.size_label,''))=TRIM(COALESCE(v.size_label,''))
      AND target.is_active=1
      AND TRIM(COALESCE(target.gender,''))=''
  ),
  v.id
) AS keeper_id
FROM catalog_variants v
JOIN catalog_products p ON p.id=v.product_id
WHERE v.is_active=1
  AND p.gender_scope IN ('female','male')
  AND TRIM(COALESCE(v.gender,''))='';

INSERT OR IGNORE INTO catalog_gender_variant_repairs(old_variant_id,keeper_variant_id,product_id,target_gender,repair_mode,repaired_at)
SELECT old_id,keeper_id,product_id,target_gender,CASE WHEN old_id=keeper_id THEN 'in_place' ELSE 'merge' END,CURRENT_TIMESTAMP
FROM _step0068_gender_map;

-- Capture every stock row participating in a merge, including an already-existing keeper row.
INSERT OR IGNORE INTO catalog_gender_stock_baseline(stock_id,inventory_source,variant_id,quantity_before,reserved_before,captured_at)
SELECT s.id,s.inventory_source,s.variant_id,COALESCE(s.quantity,0),COALESCE(s.reserved_quantity,0),CURRENT_TIMESTAMP
FROM inventory_stock s
WHERE s.variant_id IN (SELECT old_id FROM _step0068_gender_map UNION SELECT keeper_id FROM _step0068_gender_map);

DROP INDEX IF EXISTS idx_inventory_stock_variant_unique;

-- Canonical references. Historical textual snapshots are not rewritten.
UPDATE order_items SET variant_id=(SELECT keeper_id FROM _step0068_gender_map m WHERE m.old_id=order_items.variant_id)
WHERE variant_id IN (SELECT old_id FROM _step0068_gender_map WHERE old_id<>keeper_id);
UPDATE inventory_movements SET variant_id=(SELECT keeper_id FROM _step0068_gender_map m WHERE m.old_id=inventory_movements.variant_id)
WHERE variant_id IN (SELECT old_id FROM _step0068_gender_map WHERE old_id<>keeper_id);
UPDATE workshop_tasks SET variant_id=(SELECT keeper_id FROM _step0068_gender_map m WHERE m.old_id=workshop_tasks.variant_id)
WHERE variant_id IN (SELECT old_id FROM _step0068_gender_map WHERE old_id<>keeper_id);
UPDATE inventory_reservations SET variant_id=(SELECT keeper_id FROM _step0068_gender_map m WHERE m.old_id=inventory_reservations.variant_id)
WHERE variant_id IN (SELECT old_id FROM _step0068_gender_map WHERE old_id<>keeper_id);
UPDATE catalog_input_aliases SET variant_id=(SELECT keeper_id FROM _step0068_gender_map m WHERE m.old_id=catalog_input_aliases.variant_id)
WHERE variant_id IN (SELECT old_id FROM _step0068_gender_map WHERE old_id<>keeper_id);
UPDATE inventory_lifecycle_events SET variant_id=(SELECT keeper_id FROM _step0068_gender_map m WHERE m.old_id=inventory_lifecycle_events.variant_id)
WHERE variant_id IN (SELECT old_id FROM _step0068_gender_map WHERE old_id<>keeper_id);
UPDATE inventory_transfer_items SET variant_id=(SELECT keeper_id FROM _step0068_gender_map m WHERE m.old_id=inventory_transfer_items.variant_id)
WHERE variant_id IN (SELECT old_id FROM _step0068_gender_map WHERE old_id<>keeper_id);
UPDATE inventory_stock_checks SET variant_id=(SELECT keeper_id FROM _step0068_gender_map m WHERE m.old_id=inventory_stock_checks.variant_id)
WHERE variant_id IN (SELECT old_id FROM _step0068_gender_map WHERE old_id<>keeper_id);
UPDATE inventory_stocktake_items SET variant_id=(SELECT keeper_id FROM _step0068_gender_map m WHERE m.old_id=inventory_stocktake_items.variant_id)
WHERE variant_id IN (SELECT old_id FROM _step0068_gender_map WHERE old_id<>keeper_id);

-- Rebuild affected current stock from the immutable baseline so duplicate rows merge without double counting.
DROP TABLE IF EXISTS _step0068_stock_rollup;
CREATE TABLE _step0068_stock_rollup AS
SELECT
  MIN(b.stock_id) AS keeper_stock_id,
  b.inventory_source,
  COALESCE((SELECT m.keeper_id FROM _step0068_gender_map m WHERE m.old_id=b.variant_id), b.variant_id) AS variant_id,
  SUM(b.quantity_before) AS quantity,
  SUM(b.reserved_before) AS reserved_quantity
FROM catalog_gender_stock_baseline b
WHERE b.variant_id IN (SELECT old_id FROM _step0068_gender_map UNION SELECT keeper_id FROM _step0068_gender_map)
GROUP BY b.inventory_source, COALESCE((SELECT m.keeper_id FROM _step0068_gender_map m WHERE m.old_id=b.variant_id), b.variant_id);

UPDATE inventory_stock
SET variant_id=(SELECT r.variant_id FROM _step0068_stock_rollup r WHERE r.keeper_stock_id=inventory_stock.id),
    quantity=(SELECT r.quantity FROM _step0068_stock_rollup r WHERE r.keeper_stock_id=inventory_stock.id),
    reserved_quantity=(SELECT r.reserved_quantity FROM _step0068_stock_rollup r WHERE r.keeper_stock_id=inventory_stock.id),
    updated_at=CURRENT_TIMESTAMP
WHERE id IN (SELECT keeper_stock_id FROM _step0068_stock_rollup);

DELETE FROM inventory_stock
WHERE id IN (SELECT stock_id FROM catalog_gender_stock_baseline)
  AND id NOT IN (SELECT keeper_stock_id FROM _step0068_stock_rollup);

-- Correct the surviving fixed-scope variants and retire merged duplicates.
UPDATE catalog_variants
SET gender=(SELECT target_gender FROM _step0068_gender_map m WHERE m.old_id=catalog_variants.id),
    updated_at=CURRENT_TIMESTAMP
WHERE id IN (SELECT old_id FROM _step0068_gender_map WHERE old_id=keeper_id);

UPDATE catalog_variants
SET is_active=0, updated_at=CURRENT_TIMESTAMP
WHERE id IN (SELECT old_id FROM _step0068_gender_map WHERE old_id<>keeper_id);

-- Current stock snapshots follow the canonical variant. Historical order/movement snapshots stay untouched.
UPDATE inventory_stock
SET product_id=(SELECT v.product_id FROM catalog_variants v WHERE v.id=inventory_stock.variant_id),
    product_name_snapshot=(SELECT p.name FROM catalog_variants v JOIN catalog_products p ON p.id=v.product_id WHERE v.id=inventory_stock.variant_id),
    gender_snapshot=(SELECT NULLIF(v.gender,'') FROM catalog_variants v WHERE v.id=inventory_stock.variant_id),
    color_snapshot=(SELECT NULLIF(v.color,'') FROM catalog_variants v WHERE v.id=inventory_stock.variant_id),
    material_snapshot=(SELECT NULLIF(v.material,'') FROM catalog_variants v WHERE v.id=inventory_stock.variant_id),
    length_snapshot=(SELECT NULLIF(v.length,'') FROM catalog_variants v WHERE v.id=inventory_stock.variant_id),
    size_snapshot=(SELECT NULLIF(v.size_label,'') FROM catalog_variants v WHERE v.id=inventory_stock.variant_id),
    updated_at=CURRENT_TIMESTAMP
WHERE variant_id IN (SELECT keeper_id FROM _step0068_gender_map);

-- Unisex rows with no gender and no operational footprint are pure placeholders: retire them.
-- Anything ambiguous that has stock/history remains visible for a human choice instead of being guessed.
INSERT OR IGNORE INTO catalog_gender_variant_repairs(old_variant_id,keeper_variant_id,product_id,target_gender,repair_mode,repaired_at)
SELECT v.id,v.id,v.product_id,'', 'retire_unused_unisex_blank',CURRENT_TIMESTAMP
FROM catalog_variants v JOIN catalog_products p ON p.id=v.product_id
WHERE v.is_active=1 AND p.gender_scope='unisex' AND TRIM(COALESCE(v.gender,''))=''
  AND NOT EXISTS(SELECT 1 FROM inventory_stock s WHERE s.variant_id=v.id AND (COALESCE(s.quantity,0)<>0 OR COALESCE(s.reserved_quantity,0)<>0))
  AND NOT EXISTS(SELECT 1 FROM order_items oi WHERE oi.variant_id=v.id)
  AND NOT EXISTS(SELECT 1 FROM inventory_movements im WHERE im.variant_id=v.id)
  AND NOT EXISTS(SELECT 1 FROM workshop_tasks wt WHERE wt.variant_id=v.id)
  AND NOT EXISTS(SELECT 1 FROM inventory_reservations ir WHERE ir.variant_id=v.id)
  AND NOT EXISTS(SELECT 1 FROM inventory_lifecycle_events le WHERE le.variant_id=v.id)
  AND NOT EXISTS(SELECT 1 FROM inventory_transfer_items ti WHERE ti.variant_id=v.id)
  AND NOT EXISTS(SELECT 1 FROM inventory_stock_checks sc WHERE sc.variant_id=v.id)
  AND NOT EXISTS(SELECT 1 FROM inventory_stocktake_items si WHERE si.variant_id=v.id);

UPDATE catalog_variants
SET is_active=0, updated_at=CURRENT_TIMESTAMP
WHERE id IN (SELECT old_variant_id FROM catalog_gender_variant_repairs WHERE repair_mode='retire_unused_unisex_blank');

CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_stock_variant_unique
  ON inventory_stock(inventory_source,variant_id) WHERE variant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_catalog_products_gender_scope
  ON catalog_products(gender_scope,is_active,name);

DROP TABLE IF EXISTS _step0068_gender_map;
DROP TABLE IF EXISTS _step0068_stock_rollup;
