-- Step 97: исправление привязки вариантов к складским позициям по полу.
-- Цвет и размер не создают новую складскую позицию.
-- Позиция определяется товаром + типом + материалом + длиной + назначением по полу.

-- Женские варианты из ошибочно созданной унисекс-позиции переносим
-- в существующую женскую позицию с теми же товаром, типом, материалом и длиной.
UPDATE catalog_variants
SET stock_position_id = (
  SELECT fixed.id
  FROM catalog_stock_positions current
  JOIN catalog_stock_positions fixed
    ON fixed.product_id = current.product_id
   AND fixed.category = current.category
   AND COALESCE(fixed.material, '') = COALESCE(current.material, '')
   AND COALESCE(fixed.length, '') = COALESCE(current.length, '')
   AND fixed.gender_scope = 'female'
   AND fixed.is_active = 1
  WHERE current.id = catalog_variants.stock_position_id
    AND current.gender_scope = 'unisex'
  ORDER BY fixed.sort_order, fixed.id
  LIMIT 1
)
WHERE UPPER(COALESCE(gender, '')) = 'ЖЕН'
  AND stock_position_id IN (
    SELECT current.id
    FROM catalog_stock_positions current
    WHERE current.gender_scope = 'unisex'
      AND EXISTS (
        SELECT 1
        FROM catalog_stock_positions fixed
        WHERE fixed.product_id = current.product_id
          AND fixed.category = current.category
          AND COALESCE(fixed.material, '') = COALESCE(current.material, '')
          AND COALESCE(fixed.length, '') = COALESCE(current.length, '')
          AND fixed.gender_scope = 'female'
          AND fixed.is_active = 1
      )
  );

-- То же для мужских вариантов.
UPDATE catalog_variants
SET stock_position_id = (
  SELECT fixed.id
  FROM catalog_stock_positions current
  JOIN catalog_stock_positions fixed
    ON fixed.product_id = current.product_id
   AND fixed.category = current.category
   AND COALESCE(fixed.material, '') = COALESCE(current.material, '')
   AND COALESCE(fixed.length, '') = COALESCE(current.length, '')
   AND fixed.gender_scope = 'male'
   AND fixed.is_active = 1
  WHERE current.id = catalog_variants.stock_position_id
    AND current.gender_scope = 'unisex'
  ORDER BY fixed.sort_order, fixed.id
  LIMIT 1
)
WHERE UPPER(COALESCE(gender, '')) = 'МУЖ'
  AND stock_position_id IN (
    SELECT current.id
    FROM catalog_stock_positions current
    WHERE current.gender_scope = 'unisex'
      AND EXISTS (
        SELECT 1
        FROM catalog_stock_positions fixed
        WHERE fixed.product_id = current.product_id
          AND fixed.category = current.category
          AND COALESCE(fixed.material, '') = COALESCE(current.material, '')
          AND COALESCE(fixed.length, '') = COALESCE(current.length, '')
          AND fixed.gender_scope = 'male'
          AND fixed.is_active = 1
      )
  );

-- Пустые ошибочные унисекс-позиции отключаем, историю не удаляем.
UPDATE catalog_stock_positions
SET is_active = 0, updated_at = CURRENT_TIMESTAMP
WHERE gender_scope = 'unisex'
  AND NOT EXISTS (
    SELECT 1 FROM catalog_variants v WHERE v.stock_position_id = catalog_stock_positions.id
  )
  AND EXISTS (
    SELECT 1
    FROM catalog_stock_positions fixed
    WHERE fixed.product_id = catalog_stock_positions.product_id
      AND fixed.category = catalog_stock_positions.category
      AND COALESCE(fixed.material, '') = COALESCE(catalog_stock_positions.material, '')
      AND COALESCE(fixed.length, '') = COALESCE(catalog_stock_positions.length, '')
      AND fixed.gender_scope IN ('female', 'male')
      AND fixed.is_active = 1
  );
