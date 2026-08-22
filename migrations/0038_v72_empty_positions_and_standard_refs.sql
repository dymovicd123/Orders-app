-- Step 100: empty stock positions + canonical reference values.
INSERT INTO reference_values (kind, value, is_active, sort_order, created_at, updated_at)
SELECT 'material', 'СТАНДАРТ', 1, -100, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (
  SELECT 1 FROM reference_values WHERE kind = 'material' AND UPPER(TRIM(value)) = 'СТАНДАРТ'
);

INSERT INTO reference_values (kind, value, is_active, sort_order, created_at, updated_at)
SELECT 'color', 'БЕЗ ЦВЕТА', 1, -100, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (
  SELECT 1 FROM reference_values WHERE kind = 'color' AND UPPER(TRIM(value)) = 'БЕЗ ЦВЕТА'
);

UPDATE reference_values SET is_active = 1, updated_at = CURRENT_TIMESTAMP
WHERE kind = 'material' AND UPPER(TRIM(value)) = 'СТАНДАРТ';

UPDATE reference_values SET is_active = 1, updated_at = CURRENT_TIMESTAMP
WHERE kind = 'color' AND UPPER(TRIM(value)) = 'БЕЗ ЦВЕТА';
