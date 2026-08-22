PRAGMA foreign_keys = ON;

-- Step 98: строгая модель складских позиций.
-- Одна активная позиция определяется только:
-- товар + взрослый/детский тип + материал + длина.
-- Пол является правилом позиции, а цвет и размер — внутренними вариантами.

DROP INDEX IF EXISTS idx_catalog_stock_positions_unique;
DROP INDEX IF EXISTS idx_catalog_stock_positions_active_unique;
DROP INDEX IF EXISTS idx_catalog_stock_positions_default_unique;
DROP INDEX IF EXISTS idx_catalog_variants_unique;
DROP INDEX IF EXISTS idx_catalog_variants_position_unique;

ALTER TABLE catalog_stock_positions ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0;

-- В строгой модели пустое значение видно пользователю как «СТАНДАРТ».
UPDATE catalog_stock_positions
SET material = 'СТАНДАРТ'
WHERE TRIM(COALESCE(material, '')) = '';

UPDATE catalog_stock_positions
SET length = 'СТАНДАРТ'
WHERE TRIM(COALESCE(length, '')) = '';

-- Подхватываем старые варианты, которые по какой-либо причине ещё не были
-- связаны со складской позицией. История и остатки не удаляются.
INSERT INTO catalog_stock_positions (
  product_id, category, gender_scope, material, length,
  is_default, is_active, sort_order, created_at, updated_at
)
SELECT
  v.product_id,
  CASE WHEN COALESCE(v.category, 'adult') = 'child' THEN 'child' ELSE 'adult' END,
  CASE
    WHEN SUM(CASE WHEN UPPER(TRIM(COALESCE(v.gender, ''))) LIKE '%ЖЕН%' THEN 1 ELSE 0 END) > 0
     AND SUM(CASE WHEN UPPER(TRIM(COALESCE(v.gender, ''))) LIKE '%МУЖ%' THEN 1 ELSE 0 END) > 0 THEN 'unisex'
    WHEN SUM(CASE WHEN UPPER(TRIM(COALESCE(v.gender, ''))) LIKE '%МУЖ%' THEN 1 ELSE 0 END) > 0 THEN 'male'
    ELSE 'female'
  END,
  CASE WHEN TRIM(COALESCE(v.material, '')) = '' THEN 'СТАНДАРТ' ELSE UPPER(TRIM(v.material)) END,
  CASE WHEN TRIM(COALESCE(v.length, '')) = '' THEN 'СТАНДАРТ' ELSE UPPER(TRIM(v.length)) END,
  0, 1, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM catalog_variants v
WHERE v.stock_position_id IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM catalog_stock_positions sp
    WHERE sp.product_id = v.product_id
      AND sp.category = CASE WHEN COALESCE(v.category, 'adult') = 'child' THEN 'child' ELSE 'adult' END
      AND sp.material = CASE WHEN TRIM(COALESCE(v.material, '')) = '' THEN 'СТАНДАРТ' ELSE UPPER(TRIM(v.material)) END
      AND sp.length = CASE WHEN TRIM(COALESCE(v.length, '')) = '' THEN 'СТАНДАРТ' ELSE UPPER(TRIM(v.length)) END
  )
GROUP BY
  v.product_id,
  CASE WHEN COALESCE(v.category, 'adult') = 'child' THEN 'child' ELSE 'adult' END,
  CASE WHEN TRIM(COALESCE(v.material, '')) = '' THEN 'СТАНДАРТ' ELSE UPPER(TRIM(v.material)) END,
  CASE WHEN TRIM(COALESCE(v.length, '')) = '' THEN 'СТАНДАРТ' ELSE UPPER(TRIM(v.length)) END;

UPDATE catalog_variants
SET stock_position_id = (
  SELECT sp.id
  FROM catalog_stock_positions sp
  WHERE sp.product_id = catalog_variants.product_id
    AND sp.category = CASE WHEN COALESCE(catalog_variants.category, 'adult') = 'child' THEN 'child' ELSE 'adult' END
    AND sp.material = CASE WHEN TRIM(COALESCE(catalog_variants.material, '')) = '' THEN 'СТАНДАРТ' ELSE UPPER(TRIM(catalog_variants.material)) END
    AND sp.length = CASE WHEN TRIM(COALESCE(catalog_variants.length, '')) = '' THEN 'СТАНДАРТ' ELSE UPPER(TRIM(catalog_variants.length)) END
  ORDER BY sp.is_active DESC, sp.sort_order ASC, sp.id ASC
  LIMIT 1
)
WHERE stock_position_id IS NULL;

-- Определяем правильное назначение по полу для каждой логической позиции.
DROP TABLE IF EXISTS _step98_position_scope;
CREATE TABLE _step98_position_scope AS
SELECT
  sp.product_id,
  sp.category,
  sp.material,
  sp.length,
  CASE
    -- Известные модели из утверждённого списка заказчика имеют жёсткое назначение.
    WHEN UPPER(TRIM(p.name)) IN (
      'БАЯН СҰЛУ ШАПАН', 'БАЯН СУЛУ ШАПАН', 'ЕҢЛІК ШАПАН', 'ЕНЛІК ШАПАН',
      'СӘУКЕЛЕ ШАПАН', 'САУКЕЛЕ ШАПАН', 'АЙДАР ШАПАН',
      'БАЯН СҰЛУ ЖИЛЕТ', 'БАЯН СУЛУ ЖИЛЕТ', 'ТҰМАР ЖИЛЕТ', 'ТУМАР ЖИЛЕТ',
      'АЙДАЙ ЖИЛЕТ', 'ЗЕЙНЕ ЖИЛЕТ', 'ҚОРЛАН ЖИЛЕТ', 'КОРЛАН ЖИЛЕТ',
      'АЙНҰРЫМ-АЙ КӨЙЛЕК', 'АЙНУРЫМ-АЙ КОЙЛЕК', 'БИКЕШ КӨЙЛЕК', 'БИКЕШ КОЙЛЕК',
      'КЕРБЕЗ КӨЙЛЕК', 'КЕРБЕЗ КОЙЛЕК', 'АРУ КӨЙЛЕК', 'АРУ КОЙЛЕК',
      'НӘЗІК КӨЙЛЕК', 'НАЗІК КОЙЛЕК', 'НӘЗІК КОРСЕТ', 'НАЗІК КОРСЕТ',
      'АҚ НӘЗІК КОРСЕТ', 'АК НАЗІК КОРСЕТ', 'КӨРКЕМ КОРСЕТ', 'КОРКЕМ КОРСЕТ',
      'ТҰМАР КОРСЕТ', 'ТУМАР КОРСЕТ', 'НАЗ КОРСЕТ', 'ВОРОТНИК',
      'ОРАМАЛ АТЛАС', 'ОРАМАЛ ҚҰДАҒИ', 'ОРАМАЛ КУДАГИ',
      'ШЕКЕЛІК АЙНҰРЫМ-АЙ', 'ШЕКЕЛІК АЙНУРЫМ-АЙ', 'КӨЙЛЕК', 'КОЙЛЕК'
    ) THEN 'female'
    WHEN UPPER(TRIM(p.name)) IN (
      'ҚОЗЫ КӨРПЕШ ШАПАН', 'КОЗЫ КОРПЕШ ШАПАН', 'КЕБЕК ШАПАН',
      'АЙДАР БОМБЕР', 'ҚОЗЫ КӨРПЕШ ЖИЛЕТ', 'КОЗЫ КОРПЕШ ЖИЛЕТ'
    ) THEN 'male'
    WHEN UPPER(TRIM(p.name)) IN (
      'ДАРА ШАПАН', 'САРДАР ШАПАН', 'ҚАЗЫНА ШАПАН', 'КАЗЫНА ШАПАН',
      'АЛАН БОМБЕР', 'СӘУЛЕТ ЖИЛЕТ', 'САУЛЕТ ЖИЛЕТ', 'БАЙСАЛ ЖИЛЕТ',
      'БАСҚА', 'БАСКА'
    ) THEN 'unisex'
    WHEN SUM(CASE WHEN UPPER(TRIM(COALESCE(v.gender, ''))) LIKE '%ЖЕН%' THEN 1 ELSE 0 END) > 0
     AND SUM(CASE WHEN UPPER(TRIM(COALESCE(v.gender, ''))) LIKE '%МУЖ%' THEN 1 ELSE 0 END) > 0 THEN 'unisex'
    WHEN SUM(CASE WHEN UPPER(TRIM(COALESCE(v.gender, ''))) LIKE '%МУЖ%' THEN 1 ELSE 0 END) > 0 THEN 'male'
    WHEN SUM(CASE WHEN UPPER(TRIM(COALESCE(v.gender, ''))) LIKE '%ЖЕН%' THEN 1 ELSE 0 END) > 0 THEN 'female'
    WHEN SUM(CASE WHEN sp.gender_scope = 'female' THEN 1 ELSE 0 END) > 0
     AND SUM(CASE WHEN sp.gender_scope IN ('male', 'unisex') THEN 1 ELSE 0 END) = 0 THEN 'female'
    WHEN SUM(CASE WHEN sp.gender_scope = 'male' THEN 1 ELSE 0 END) > 0
     AND SUM(CASE WHEN sp.gender_scope IN ('female', 'unisex') THEN 1 ELSE 0 END) = 0 THEN 'male'
    ELSE 'unisex'
  END AS desired_scope
FROM catalog_stock_positions sp
JOIN catalog_products p ON p.id = sp.product_id
LEFT JOIN catalog_variants v ON v.stock_position_id = sp.id
GROUP BY sp.product_id, sp.category, sp.material, sp.length;

-- Выбираем одну карточку-хранитель для каждой комбинации товар+тип+материал+длина.
DROP TABLE IF EXISTS _step98_position_map;
CREATE TABLE _step98_position_map AS
SELECT
  sp.id AS old_id,
  (
    SELECT candidate.id
    FROM catalog_stock_positions candidate
    JOIN _step98_position_scope scope
      ON scope.product_id = candidate.product_id
     AND scope.category = candidate.category
     AND scope.material = candidate.material
     AND scope.length = candidate.length
    WHERE candidate.product_id = sp.product_id
      AND candidate.category = sp.category
      AND candidate.material = sp.material
      AND candidate.length = sp.length
    ORDER BY
      candidate.is_active DESC,
      CASE WHEN candidate.gender_scope = scope.desired_scope THEN 0 ELSE 1 END,
      (SELECT COUNT(*) FROM catalog_variants cv WHERE cv.stock_position_id = candidate.id) DESC,
      candidate.sort_order ASC,
      candidate.id ASC
    LIMIT 1
  ) AS keeper_id
FROM catalog_stock_positions sp;

UPDATE catalog_variants
SET stock_position_id = (
  SELECT keeper_id FROM _step98_position_map map WHERE map.old_id = catalog_variants.stock_position_id
)
WHERE stock_position_id IN (SELECT old_id FROM _step98_position_map);

UPDATE catalog_stock_positions
SET gender_scope = (
      SELECT scope.desired_scope
      FROM _step98_position_scope scope
      WHERE scope.product_id = catalog_stock_positions.product_id
        AND scope.category = catalog_stock_positions.category
        AND scope.material = catalog_stock_positions.material
        AND scope.length = catalog_stock_positions.length
    ),
    is_active = 1,
    updated_at = CURRENT_TIMESTAMP
WHERE id IN (SELECT keeper_id FROM _step98_position_map);

UPDATE catalog_stock_positions
SET is_active = 0,
    is_default = 0,
    updated_at = CURRENT_TIMESTAMP
WHERE id IN (
  SELECT old_id FROM _step98_position_map WHERE old_id <> keeper_id
);

-- После объединения позиций возможны одинаковые внутренние варианты.
-- Выбираем один вариант-хранитель и переводим на него все рабочие ссылки.
DROP TABLE IF EXISTS _step98_variant_map;
CREATE TABLE _step98_variant_map AS
SELECT
  v.id AS old_id,
  (
    SELECT candidate.id
    FROM catalog_variants candidate
    JOIN catalog_stock_positions candidate_position ON candidate_position.id = candidate.stock_position_id
    WHERE candidate.stock_position_id = v.stock_position_id
      AND UPPER(TRIM(COALESCE(candidate.gender, ''))) = CASE
        WHEN candidate_position.gender_scope = 'female' THEN 'ЖЕН'
        WHEN candidate_position.gender_scope = 'male' THEN 'МУЖ'
        ELSE UPPER(TRIM(COALESCE(v.gender, '')))
      END
      AND UPPER(TRIM(COALESCE(candidate.color, ''))) = UPPER(TRIM(COALESCE(v.color, '')))
      AND TRIM(COALESCE(candidate.size_label, '')) = TRIM(COALESCE(v.size_label, ''))
    ORDER BY candidate.is_active DESC, candidate.id ASC
    LIMIT 1
  ) AS keeper_id
FROM catalog_variants v
WHERE v.stock_position_id IS NOT NULL;

UPDATE order_items
SET variant_id = (SELECT keeper_id FROM _step98_variant_map map WHERE map.old_id = order_items.variant_id)
WHERE variant_id IN (SELECT old_id FROM _step98_variant_map WHERE old_id <> keeper_id);

UPDATE inventory_stock
SET variant_id = (SELECT keeper_id FROM _step98_variant_map map WHERE map.old_id = inventory_stock.variant_id)
WHERE variant_id IN (SELECT old_id FROM _step98_variant_map WHERE old_id <> keeper_id);

UPDATE inventory_movements
SET variant_id = (SELECT keeper_id FROM _step98_variant_map map WHERE map.old_id = inventory_movements.variant_id)
WHERE variant_id IN (SELECT old_id FROM _step98_variant_map WHERE old_id <> keeper_id);

UPDATE workshop_tasks
SET variant_id = (SELECT keeper_id FROM _step98_variant_map map WHERE map.old_id = workshop_tasks.variant_id)
WHERE variant_id IN (SELECT old_id FROM _step98_variant_map WHERE old_id <> keeper_id);

DELETE FROM catalog_variants
WHERE id IN (SELECT old_id FROM _step98_variant_map WHERE old_id <> keeper_id);

-- В каждой точке оставляем одну строку остатка на вариант, суммируя количество.
DROP TABLE IF EXISTS _step98_stock_rollup;
CREATE TABLE _step98_stock_rollup AS
SELECT
  MIN(id) AS keeper_id,
  inventory_source,
  variant_id,
  SUM(COALESCE(quantity, 0)) AS total_quantity,
  SUM(COALESCE(reserved_quantity, 0)) AS total_reserved
FROM inventory_stock
WHERE variant_id IS NOT NULL
GROUP BY inventory_source, variant_id;

UPDATE inventory_stock
SET quantity = (SELECT total_quantity FROM _step98_stock_rollup rollup WHERE rollup.keeper_id = inventory_stock.id),
    reserved_quantity = (SELECT total_reserved FROM _step98_stock_rollup rollup WHERE rollup.keeper_id = inventory_stock.id),
    updated_at = CURRENT_TIMESTAMP
WHERE id IN (SELECT keeper_id FROM _step98_stock_rollup);

DELETE FROM inventory_stock
WHERE variant_id IS NOT NULL
  AND id NOT IN (SELECT keeper_id FROM _step98_stock_rollup);

-- Все активные варианты наследуют неизменяемые поля своей позиции.
UPDATE catalog_variants
SET category = (SELECT sp.category FROM catalog_stock_positions sp WHERE sp.id = catalog_variants.stock_position_id),
    material = (SELECT sp.material FROM catalog_stock_positions sp WHERE sp.id = catalog_variants.stock_position_id),
    length = (SELECT sp.length FROM catalog_stock_positions sp WHERE sp.id = catalog_variants.stock_position_id),
    gender = CASE
      WHEN (SELECT sp.gender_scope FROM catalog_stock_positions sp WHERE sp.id = catalog_variants.stock_position_id) = 'female' THEN 'ЖЕН'
      WHEN (SELECT sp.gender_scope FROM catalog_stock_positions sp WHERE sp.id = catalog_variants.stock_position_id) = 'male' THEN 'МУЖ'
      ELSE UPPER(TRIM(COALESCE(gender, '')))
    END,
    updated_at = CURRENT_TIMESTAMP
WHERE stock_position_id IS NOT NULL;

-- Снимки текущего остатка синхронизируем с каноническим вариантом.
UPDATE inventory_stock
SET product_id = (SELECT v.product_id FROM catalog_variants v WHERE v.id = inventory_stock.variant_id),
    product_name_snapshot = (
      SELECT p.name FROM catalog_variants v JOIN catalog_products p ON p.id = v.product_id WHERE v.id = inventory_stock.variant_id
    ),
    gender_snapshot = (SELECT v.gender FROM catalog_variants v WHERE v.id = inventory_stock.variant_id),
    color_snapshot = (SELECT v.color FROM catalog_variants v WHERE v.id = inventory_stock.variant_id),
    material_snapshot = (SELECT v.material FROM catalog_variants v WHERE v.id = inventory_stock.variant_id),
    length_snapshot = (SELECT v.length FROM catalog_variants v WHERE v.id = inventory_stock.variant_id),
    size_snapshot = (SELECT v.size_label FROM catalog_variants v WHERE v.id = inventory_stock.variant_id),
    updated_at = CURRENT_TIMESTAMP
WHERE variant_id IS NOT NULL;

-- Одна предсказуемая основная позиция на товар и тип.
UPDATE catalog_stock_positions SET is_default = 0;
UPDATE catalog_stock_positions
SET is_default = 1,
    updated_at = CURRENT_TIMESTAMP
WHERE id IN (
  SELECT chosen.id
  FROM catalog_stock_positions chosen
  WHERE chosen.is_active = 1
    AND chosen.id = (
      SELECT candidate.id
      FROM catalog_stock_positions candidate
      WHERE candidate.product_id = chosen.product_id
        AND candidate.category = chosen.category
        AND candidate.is_active = 1
      ORDER BY
        CASE WHEN candidate.material = 'СТАНДАРТ' AND candidate.length = 'СТАНДАРТ' THEN 0 ELSE 1 END,
        candidate.sort_order ASC,
        candidate.id ASC
      LIMIT 1
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_catalog_stock_positions_active_unique
  ON catalog_stock_positions(product_id, category, material, length)
  WHERE is_active = 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_catalog_stock_positions_default_unique
  ON catalog_stock_positions(product_id, category)
  WHERE is_active = 1 AND is_default = 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_catalog_variants_position_unique
  ON catalog_variants(
    stock_position_id,
    COALESCE(gender, ''),
    COALESCE(color, ''),
    COALESCE(size_label, '')
  )
  WHERE stock_position_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_catalog_stock_positions_product
  ON catalog_stock_positions(product_id, is_active, is_default, sort_order);

DROP TABLE IF EXISTS _step98_stock_rollup;
DROP TABLE IF EXISTS _step98_variant_map;
DROP TABLE IF EXISTS _step98_position_map;
DROP TABLE IF EXISTS _step98_position_scope;

SELECT 'step98 strict stock positions applied' AS migration_marker;
