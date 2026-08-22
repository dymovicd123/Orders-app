-- Step 188K.2 POST-STOCKTAKE: client-confirmed catalog retirements after the completed physical stocktake.
-- IMPORTANT: history is preserved. No order_items, reservations, inventory_stock,
-- inventory_movements, or completed stocktake rows are deleted or rewritten.

CREATE TABLE IF NOT EXISTS catalog_manual_retirements (
  retirement_key TEXT NOT NULL,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('product', 'variant')),
  entity_id INTEGER NOT NULL,
  rule_key TEXT NOT NULL,
  product_id INTEGER,
  product_name TEXT,
  category TEXT,
  gender TEXT,
  color TEXT,
  material TEXT,
  length TEXT,
  size_label TEXT,
  stock_position_id INTEGER,
  previous_is_active INTEGER NOT NULL DEFAULT 1,
  warehouse_quantity INTEGER NOT NULL DEFAULT 0,
  warehouse_reserved_quantity INTEGER NOT NULL DEFAULT 0,
  boutique_quantity INTEGER NOT NULL DEFAULT 0,
  boutique_reserved_quantity INTEGER NOT NULL DEFAULT 0,
  order_item_count INTEGER NOT NULL DEFAULT 0,
  active_reservation_quantity INTEGER NOT NULL DEFAULT 0,
  reason TEXT NOT NULL,
  retired_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (retirement_key, entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_catalog_manual_retirements_product
  ON catalog_manual_retirements(product_id, entity_type, retired_at DESC);


-- D1 hardening: each client rule is inserted independently.
-- Compound SELECT is intentionally forbidden for this step.

INSERT OR IGNORE INTO catalog_manual_retirements (
  retirement_key, entity_type, entity_id, rule_key,
  product_id, product_name, category, gender, color, material, length, size_label,
  stock_position_id, previous_is_active,
  warehouse_quantity, warehouse_reserved_quantity,
  boutique_quantity, boutique_reserved_quantity,
  order_item_count, active_reservation_quantity,
  reason, retired_at
)
SELECT
  'step188k2_client_cleanup', 'variant', v.id, 'bayan_short_velour_no_color',
  p.id, p.name, COALESCE(v.category,'adult'), v.gender, v.color, v.material, v.length, v.size_label,
  v.stock_position_id, COALESCE(v.is_active,0),
  COALESCE((SELECT s.quantity FROM inventory_stock s WHERE s.inventory_source='warehouse' AND s.variant_id=v.id LIMIT 1),0),
  COALESCE((SELECT s.reserved_quantity FROM inventory_stock s WHERE s.inventory_source='warehouse' AND s.variant_id=v.id LIMIT 1),0),
  COALESCE((SELECT s.quantity FROM inventory_stock s WHERE s.inventory_source='boutique' AND s.variant_id=v.id LIMIT 1),0),
  COALESCE((SELECT s.reserved_quantity FROM inventory_stock s WHERE s.inventory_source='boutique' AND s.variant_id=v.id LIMIT 1),0),
  COALESCE((SELECT COUNT(*) FROM order_items oi WHERE oi.variant_id=v.id),0),
  COALESCE((SELECT SUM(r.quantity) FROM inventory_reservations r WHERE r.variant_id=v.id AND r.status='active'),0),
  'Подтверждено клиентом после завершённой ревизии: ошибочная или несуществующая рабочая позиция. История заказов, приходов, движений и ревизии сохранена.',
  CURRENT_TIMESTAMP
FROM catalog_variants v JOIN catalog_products p ON p.id = v.product_id
  WHERE p.name = 'БАЯН СҰЛУ ШАПАН'
    AND UPPER(TRIM(COALESCE(v.material,''))) = 'ЗАМША ВЕЛЮР'
    AND UPPER(TRIM(COALESCE(v.length,''))) = 'УКОРОЧЕННЫЙ'
    AND UPPER(TRIM(COALESCE(v.color,''))) = 'БЕЗ ЦВЕТА';

INSERT OR IGNORE INTO catalog_manual_retirements (
  retirement_key, entity_type, entity_id, rule_key,
  product_id, product_name, category, gender, color, material, length, size_label,
  stock_position_id, previous_is_active,
  warehouse_quantity, warehouse_reserved_quantity,
  boutique_quantity, boutique_reserved_quantity,
  order_item_count, active_reservation_quantity,
  reason, retired_at
)
SELECT
  'step188k2_client_cleanup', 'variant', v.id, 'enlik_standard_beige_or_wet_asphalt',
  p.id, p.name, COALESCE(v.category,'adult'), v.gender, v.color, v.material, v.length, v.size_label,
  v.stock_position_id, COALESCE(v.is_active,0),
  COALESCE((SELECT s.quantity FROM inventory_stock s WHERE s.inventory_source='warehouse' AND s.variant_id=v.id LIMIT 1),0),
  COALESCE((SELECT s.reserved_quantity FROM inventory_stock s WHERE s.inventory_source='warehouse' AND s.variant_id=v.id LIMIT 1),0),
  COALESCE((SELECT s.quantity FROM inventory_stock s WHERE s.inventory_source='boutique' AND s.variant_id=v.id LIMIT 1),0),
  COALESCE((SELECT s.reserved_quantity FROM inventory_stock s WHERE s.inventory_source='boutique' AND s.variant_id=v.id LIMIT 1),0),
  COALESCE((SELECT COUNT(*) FROM order_items oi WHERE oi.variant_id=v.id),0),
  COALESCE((SELECT SUM(r.quantity) FROM inventory_reservations r WHERE r.variant_id=v.id AND r.status='active'),0),
  'Подтверждено клиентом после завершённой ревизии: ошибочная или несуществующая рабочая позиция. История заказов, приходов, движений и ревизии сохранена.',
  CURRENT_TIMESTAMP
FROM catalog_variants v JOIN catalog_products p ON p.id = v.product_id
  WHERE p.name = 'ЕҢЛІК ШАПАН'
    AND UPPER(TRIM(COALESCE(v.gender,''))) = 'ЖЕН'
    AND COALESCE(NULLIF(UPPER(TRIM(COALESCE(v.material,''))),''),'СТАНДАРТ') = 'СТАНДАРТ'
    AND COALESCE(NULLIF(UPPER(TRIM(COALESCE(v.length,''))),''),'СТАНДАРТ') = 'СТАНДАРТ'
    AND UPPER(TRIM(COALESCE(v.color,''))) IN ('БЕЖЕВЫЙ','МОКРЫЙ АСФАЛЬТ');

INSERT OR IGNORE INTO catalog_manual_retirements (
  retirement_key, entity_type, entity_id, rule_key,
  product_id, product_name, category, gender, color, material, length, size_label,
  stock_position_id, previous_is_active,
  warehouse_quantity, warehouse_reserved_quantity,
  boutique_quantity, boutique_reserved_quantity,
  order_item_count, active_reservation_quantity,
  reason, retired_at
)
SELECT
  'step188k2_client_cleanup', 'variant', v.id, 'enlik_standard_orange',
  p.id, p.name, COALESCE(v.category,'adult'), v.gender, v.color, v.material, v.length, v.size_label,
  v.stock_position_id, COALESCE(v.is_active,0),
  COALESCE((SELECT s.quantity FROM inventory_stock s WHERE s.inventory_source='warehouse' AND s.variant_id=v.id LIMIT 1),0),
  COALESCE((SELECT s.reserved_quantity FROM inventory_stock s WHERE s.inventory_source='warehouse' AND s.variant_id=v.id LIMIT 1),0),
  COALESCE((SELECT s.quantity FROM inventory_stock s WHERE s.inventory_source='boutique' AND s.variant_id=v.id LIMIT 1),0),
  COALESCE((SELECT s.reserved_quantity FROM inventory_stock s WHERE s.inventory_source='boutique' AND s.variant_id=v.id LIMIT 1),0),
  COALESCE((SELECT COUNT(*) FROM order_items oi WHERE oi.variant_id=v.id),0),
  COALESCE((SELECT SUM(r.quantity) FROM inventory_reservations r WHERE r.variant_id=v.id AND r.status='active'),0),
  'Подтверждено клиентом после завершённой ревизии: ошибочная или несуществующая рабочая позиция. История заказов, приходов, движений и ревизии сохранена.',
  CURRENT_TIMESTAMP
FROM catalog_variants v JOIN catalog_products p ON p.id = v.product_id
  WHERE p.name = 'ЕҢЛІК ШАПАН'
    AND UPPER(TRIM(COALESCE(v.gender,''))) = 'ЖЕН'
    AND COALESCE(NULLIF(UPPER(TRIM(COALESCE(v.material,''))),''),'СТАНДАРТ') = 'СТАНДАРТ'
    AND COALESCE(NULLIF(UPPER(TRIM(COALESCE(v.length,''))),''),'СТАНДАРТ') = 'СТАНДАРТ'
    AND UPPER(TRIM(COALESCE(v.color,''))) = 'ОРАНЖЕВЫЙ';

INSERT OR IGNORE INTO catalog_manual_retirements (
  retirement_key, entity_type, entity_id, rule_key,
  product_id, product_name, category, gender, color, material, length, size_label,
  stock_position_id, previous_is_active,
  warehouse_quantity, warehouse_reserved_quantity,
  boutique_quantity, boutique_reserved_quantity,
  order_item_count, active_reservation_quantity,
  reason, retired_at
)
SELECT
  'step188k2_client_cleanup', 'variant', v.id, 'kozy_korpesh_standard_execution',
  p.id, p.name, COALESCE(v.category,'adult'), v.gender, v.color, v.material, v.length, v.size_label,
  v.stock_position_id, COALESCE(v.is_active,0),
  COALESCE((SELECT s.quantity FROM inventory_stock s WHERE s.inventory_source='warehouse' AND s.variant_id=v.id LIMIT 1),0),
  COALESCE((SELECT s.reserved_quantity FROM inventory_stock s WHERE s.inventory_source='warehouse' AND s.variant_id=v.id LIMIT 1),0),
  COALESCE((SELECT s.quantity FROM inventory_stock s WHERE s.inventory_source='boutique' AND s.variant_id=v.id LIMIT 1),0),
  COALESCE((SELECT s.reserved_quantity FROM inventory_stock s WHERE s.inventory_source='boutique' AND s.variant_id=v.id LIMIT 1),0),
  COALESCE((SELECT COUNT(*) FROM order_items oi WHERE oi.variant_id=v.id),0),
  COALESCE((SELECT SUM(r.quantity) FROM inventory_reservations r WHERE r.variant_id=v.id AND r.status='active'),0),
  'Подтверждено клиентом после завершённой ревизии: ошибочная или несуществующая рабочая позиция. История заказов, приходов, движений и ревизии сохранена.',
  CURRENT_TIMESTAMP
FROM catalog_variants v JOIN catalog_products p ON p.id = v.product_id
  WHERE p.name = 'ҚОЗЫ КӨРПЕШ ШАПАН'
    AND COALESCE(NULLIF(UPPER(TRIM(COALESCE(v.material,''))),''),'СТАНДАРТ') = 'СТАНДАРТ'
    AND COALESCE(NULLIF(UPPER(TRIM(COALESCE(v.length,''))),''),'СТАНДАРТ') = 'СТАНДАРТ';

INSERT OR IGNORE INTO catalog_manual_retirements (
  retirement_key, entity_type, entity_id, rule_key,
  product_id, product_name, category, gender, color, material, length, size_label,
  stock_position_id, previous_is_active,
  warehouse_quantity, warehouse_reserved_quantity,
  boutique_quantity, boutique_reserved_quantity,
  order_item_count, active_reservation_quantity,
  reason, retired_at
)
SELECT
  'step188k2_client_cleanup', 'variant', v.id, 'kebek_soft_fabric_male',
  p.id, p.name, COALESCE(v.category,'adult'), v.gender, v.color, v.material, v.length, v.size_label,
  v.stock_position_id, COALESCE(v.is_active,0),
  COALESCE((SELECT s.quantity FROM inventory_stock s WHERE s.inventory_source='warehouse' AND s.variant_id=v.id LIMIT 1),0),
  COALESCE((SELECT s.reserved_quantity FROM inventory_stock s WHERE s.inventory_source='warehouse' AND s.variant_id=v.id LIMIT 1),0),
  COALESCE((SELECT s.quantity FROM inventory_stock s WHERE s.inventory_source='boutique' AND s.variant_id=v.id LIMIT 1),0),
  COALESCE((SELECT s.reserved_quantity FROM inventory_stock s WHERE s.inventory_source='boutique' AND s.variant_id=v.id LIMIT 1),0),
  COALESCE((SELECT COUNT(*) FROM order_items oi WHERE oi.variant_id=v.id),0),
  COALESCE((SELECT SUM(r.quantity) FROM inventory_reservations r WHERE r.variant_id=v.id AND r.status='active'),0),
  'Подтверждено клиентом после завершённой ревизии: ошибочная или несуществующая рабочая позиция. История заказов, приходов, движений и ревизии сохранена.',
  CURRENT_TIMESTAMP
FROM catalog_variants v JOIN catalog_products p ON p.id = v.product_id
  WHERE p.name = 'КЕБЕК ШАПАН'
    AND UPPER(TRIM(COALESCE(v.material,''))) = 'МЯГКАЯ ТКАНЬ'
    AND UPPER(TRIM(COALESCE(v.gender,''))) = 'МУЖ';

INSERT OR IGNORE INTO catalog_manual_retirements (
  retirement_key, entity_type, entity_id, rule_key,
  product_id, product_name, category, gender, color, material, length, size_label,
  stock_position_id, previous_is_active,
  warehouse_quantity, warehouse_reserved_quantity,
  boutique_quantity, boutique_reserved_quantity,
  order_item_count, active_reservation_quantity,
  reason, retired_at
)
SELECT
  'step188k2_client_cleanup', 'variant', v.id, 'sardar_male_white',
  p.id, p.name, COALESCE(v.category,'adult'), v.gender, v.color, v.material, v.length, v.size_label,
  v.stock_position_id, COALESCE(v.is_active,0),
  COALESCE((SELECT s.quantity FROM inventory_stock s WHERE s.inventory_source='warehouse' AND s.variant_id=v.id LIMIT 1),0),
  COALESCE((SELECT s.reserved_quantity FROM inventory_stock s WHERE s.inventory_source='warehouse' AND s.variant_id=v.id LIMIT 1),0),
  COALESCE((SELECT s.quantity FROM inventory_stock s WHERE s.inventory_source='boutique' AND s.variant_id=v.id LIMIT 1),0),
  COALESCE((SELECT s.reserved_quantity FROM inventory_stock s WHERE s.inventory_source='boutique' AND s.variant_id=v.id LIMIT 1),0),
  COALESCE((SELECT COUNT(*) FROM order_items oi WHERE oi.variant_id=v.id),0),
  COALESCE((SELECT SUM(r.quantity) FROM inventory_reservations r WHERE r.variant_id=v.id AND r.status='active'),0),
  'Подтверждено клиентом после завершённой ревизии: ошибочная или несуществующая рабочая позиция. История заказов, приходов, движений и ревизии сохранена.',
  CURRENT_TIMESTAMP
FROM catalog_variants v JOIN catalog_products p ON p.id = v.product_id
  WHERE p.name = 'САРДАР ШАПАН'
    AND UPPER(TRIM(COALESCE(v.gender,''))) = 'МУЖ'
    AND UPPER(TRIM(COALESCE(v.color,''))) = 'БЕЛЫЙ';

INSERT OR IGNORE INTO catalog_manual_retirements (
  retirement_key, entity_type, entity_id, rule_key,
  product_id, product_name, category, gender, color, material, length, size_label,
  stock_position_id, previous_is_active,
  warehouse_quantity, warehouse_reserved_quantity,
  boutique_quantity, boutique_reserved_quantity,
  order_item_count, active_reservation_quantity,
  reason, retired_at
)
SELECT
  'step188k2_client_cleanup', 'variant', v.id, 'alan_wet_asphalt',
  p.id, p.name, COALESCE(v.category,'adult'), v.gender, v.color, v.material, v.length, v.size_label,
  v.stock_position_id, COALESCE(v.is_active,0),
  COALESCE((SELECT s.quantity FROM inventory_stock s WHERE s.inventory_source='warehouse' AND s.variant_id=v.id LIMIT 1),0),
  COALESCE((SELECT s.reserved_quantity FROM inventory_stock s WHERE s.inventory_source='warehouse' AND s.variant_id=v.id LIMIT 1),0),
  COALESCE((SELECT s.quantity FROM inventory_stock s WHERE s.inventory_source='boutique' AND s.variant_id=v.id LIMIT 1),0),
  COALESCE((SELECT s.reserved_quantity FROM inventory_stock s WHERE s.inventory_source='boutique' AND s.variant_id=v.id LIMIT 1),0),
  COALESCE((SELECT COUNT(*) FROM order_items oi WHERE oi.variant_id=v.id),0),
  COALESCE((SELECT SUM(r.quantity) FROM inventory_reservations r WHERE r.variant_id=v.id AND r.status='active'),0),
  'Подтверждено клиентом после завершённой ревизии: ошибочная или несуществующая рабочая позиция. История заказов, приходов, движений и ревизии сохранена.',
  CURRENT_TIMESTAMP
FROM catalog_variants v JOIN catalog_products p ON p.id = v.product_id
  WHERE p.name = 'АЛАН БОМБЕР'
    AND UPPER(TRIM(COALESCE(v.color,''))) = 'МОКРЫЙ АСФАЛЬТ';

INSERT OR IGNORE INTO catalog_manual_retirements (
  retirement_key, entity_type, entity_id, rule_key,
  product_id, product_name, category, gender, color, material, length, size_label,
  stock_position_id, previous_is_active,
  warehouse_quantity, warehouse_reserved_quantity,
  boutique_quantity, boutique_reserved_quantity,
  order_item_count, active_reservation_quantity,
  reason, retired_at
)
SELECT
  'step188k2_client_cleanup', 'variant', v.id, 'alan_child_dark_wet_asphalt',
  p.id, p.name, COALESCE(v.category,'adult'), v.gender, v.color, v.material, v.length, v.size_label,
  v.stock_position_id, COALESCE(v.is_active,0),
  COALESCE((SELECT s.quantity FROM inventory_stock s WHERE s.inventory_source='warehouse' AND s.variant_id=v.id LIMIT 1),0),
  COALESCE((SELECT s.reserved_quantity FROM inventory_stock s WHERE s.inventory_source='warehouse' AND s.variant_id=v.id LIMIT 1),0),
  COALESCE((SELECT s.quantity FROM inventory_stock s WHERE s.inventory_source='boutique' AND s.variant_id=v.id LIMIT 1),0),
  COALESCE((SELECT s.reserved_quantity FROM inventory_stock s WHERE s.inventory_source='boutique' AND s.variant_id=v.id LIMIT 1),0),
  COALESCE((SELECT COUNT(*) FROM order_items oi WHERE oi.variant_id=v.id),0),
  COALESCE((SELECT SUM(r.quantity) FROM inventory_reservations r WHERE r.variant_id=v.id AND r.status='active'),0),
  'Подтверждено клиентом после завершённой ревизии: ошибочная или несуществующая рабочая позиция. История заказов, приходов, движений и ревизии сохранена.',
  CURRENT_TIMESTAMP
FROM catalog_variants v JOIN catalog_products p ON p.id = v.product_id
  WHERE p.name = 'АЛАН БОМБЕР'
    AND COALESCE(v.category,'adult') = 'child'
    AND UPPER(TRIM(COALESCE(v.color,''))) = 'ТЕМНЫЙ МОКРЫЙ АСФАЛЬТ';

INSERT OR IGNORE INTO catalog_manual_retirements (
  retirement_key, entity_type, entity_id, rule_key,
  product_id, product_name, category, gender, color, material, length, size_label,
  stock_position_id, previous_is_active,
  warehouse_quantity, warehouse_reserved_quantity,
  boutique_quantity, boutique_reserved_quantity,
  order_item_count, active_reservation_quantity,
  reason, retired_at
)
SELECT
  'step188k2_client_cleanup', 'variant', v.id, 'aidai_standard_female_red',
  p.id, p.name, COALESCE(v.category,'adult'), v.gender, v.color, v.material, v.length, v.size_label,
  v.stock_position_id, COALESCE(v.is_active,0),
  COALESCE((SELECT s.quantity FROM inventory_stock s WHERE s.inventory_source='warehouse' AND s.variant_id=v.id LIMIT 1),0),
  COALESCE((SELECT s.reserved_quantity FROM inventory_stock s WHERE s.inventory_source='warehouse' AND s.variant_id=v.id LIMIT 1),0),
  COALESCE((SELECT s.quantity FROM inventory_stock s WHERE s.inventory_source='boutique' AND s.variant_id=v.id LIMIT 1),0),
  COALESCE((SELECT s.reserved_quantity FROM inventory_stock s WHERE s.inventory_source='boutique' AND s.variant_id=v.id LIMIT 1),0),
  COALESCE((SELECT COUNT(*) FROM order_items oi WHERE oi.variant_id=v.id),0),
  COALESCE((SELECT SUM(r.quantity) FROM inventory_reservations r WHERE r.variant_id=v.id AND r.status='active'),0),
  'Подтверждено клиентом после завершённой ревизии: ошибочная или несуществующая рабочая позиция. История заказов, приходов, движений и ревизии сохранена.',
  CURRENT_TIMESTAMP
FROM catalog_variants v JOIN catalog_products p ON p.id = v.product_id
  WHERE p.name = 'АЙДАЙ ЖИЛЕТ'
    AND UPPER(TRIM(COALESCE(v.gender,''))) = 'ЖЕН'
    AND UPPER(TRIM(COALESCE(v.color,''))) = 'КРАСНЫЙ'
    AND COALESCE(NULLIF(UPPER(TRIM(COALESCE(v.material,''))),''),'СТАНДАРТ') = 'СТАНДАРТ'
    AND COALESCE(NULLIF(UPPER(TRIM(COALESCE(v.length,''))),''),'СТАНДАРТ') = 'СТАНДАРТ';

INSERT OR IGNORE INTO catalog_manual_retirements (
  retirement_key, entity_type, entity_id, rule_key,
  product_id, product_name, category, gender, color, material, length, size_label,
  stock_position_id, previous_is_active,
  warehouse_quantity, warehouse_reserved_quantity,
  boutique_quantity, boutique_reserved_quantity,
  order_item_count, active_reservation_quantity,
  reason, retired_at
)
SELECT
  'step188k2_client_cleanup', 'variant', v.id, 'takiya_no_gender',
  p.id, p.name, COALESCE(v.category,'adult'), v.gender, v.color, v.material, v.length, v.size_label,
  v.stock_position_id, COALESCE(v.is_active,0),
  COALESCE((SELECT s.quantity FROM inventory_stock s WHERE s.inventory_source='warehouse' AND s.variant_id=v.id LIMIT 1),0),
  COALESCE((SELECT s.reserved_quantity FROM inventory_stock s WHERE s.inventory_source='warehouse' AND s.variant_id=v.id LIMIT 1),0),
  COALESCE((SELECT s.quantity FROM inventory_stock s WHERE s.inventory_source='boutique' AND s.variant_id=v.id LIMIT 1),0),
  COALESCE((SELECT s.reserved_quantity FROM inventory_stock s WHERE s.inventory_source='boutique' AND s.variant_id=v.id LIMIT 1),0),
  COALESCE((SELECT COUNT(*) FROM order_items oi WHERE oi.variant_id=v.id),0),
  COALESCE((SELECT SUM(r.quantity) FROM inventory_reservations r WHERE r.variant_id=v.id AND r.status='active'),0),
  'Подтверждено клиентом после завершённой ревизии: ошибочная или несуществующая рабочая позиция. История заказов, приходов, движений и ревизии сохранена.',
  CURRENT_TIMESTAMP
FROM catalog_variants v JOIN catalog_products p ON p.id = v.product_id
  WHERE p.name = 'ТАКИЯ'
    AND TRIM(COALESCE(v.gender,'')) = '';

INSERT OR IGNORE INTO catalog_manual_retirements (
  retirement_key, entity_type, entity_id, rule_key,
  product_id, product_name, category, gender, color, material, length, size_label,
  stock_position_id, previous_is_active,
  warehouse_quantity, warehouse_reserved_quantity,
  boutique_quantity, boutique_reserved_quantity,
  order_item_count, active_reservation_quantity,
  reason, retired_at
)
SELECT
  'step188k2_client_cleanup', 'variant', v.id, 'corset_product',
  p.id, p.name, COALESCE(v.category,'adult'), v.gender, v.color, v.material, v.length, v.size_label,
  v.stock_position_id, COALESCE(v.is_active,0),
  COALESCE((SELECT s.quantity FROM inventory_stock s WHERE s.inventory_source='warehouse' AND s.variant_id=v.id LIMIT 1),0),
  COALESCE((SELECT s.reserved_quantity FROM inventory_stock s WHERE s.inventory_source='warehouse' AND s.variant_id=v.id LIMIT 1),0),
  COALESCE((SELECT s.quantity FROM inventory_stock s WHERE s.inventory_source='boutique' AND s.variant_id=v.id LIMIT 1),0),
  COALESCE((SELECT s.reserved_quantity FROM inventory_stock s WHERE s.inventory_source='boutique' AND s.variant_id=v.id LIMIT 1),0),
  COALESCE((SELECT COUNT(*) FROM order_items oi WHERE oi.variant_id=v.id),0),
  COALESCE((SELECT SUM(r.quantity) FROM inventory_reservations r WHERE r.variant_id=v.id AND r.status='active'),0),
  'Подтверждено клиентом после завершённой ревизии: ошибочная или несуществующая рабочая позиция. История заказов, приходов, движений и ревизии сохранена.',
  CURRENT_TIMESTAMP
FROM catalog_variants v JOIN catalog_products p ON p.id = v.product_id
  WHERE p.name = 'КОРСЕТ';

INSERT OR IGNORE INTO catalog_manual_retirements (
  retirement_key, entity_type, entity_id, rule_key,
  product_id, product_name, category, gender, color, material, length, size_label,
  stock_position_id, previous_is_active,
  warehouse_quantity, warehouse_reserved_quantity,
  boutique_quantity, boutique_reserved_quantity,
  order_item_count, active_reservation_quantity,
  reason, retired_at
)
SELECT
  'step188k2_client_cleanup', 'variant', v.id, 'ainurym_ai_standard_female_ivory_42_44_46',
  p.id, p.name, COALESCE(v.category,'adult'), v.gender, v.color, v.material, v.length, v.size_label,
  v.stock_position_id, COALESCE(v.is_active,0),
  COALESCE((SELECT s.quantity FROM inventory_stock s WHERE s.inventory_source='warehouse' AND s.variant_id=v.id LIMIT 1),0),
  COALESCE((SELECT s.reserved_quantity FROM inventory_stock s WHERE s.inventory_source='warehouse' AND s.variant_id=v.id LIMIT 1),0),
  COALESCE((SELECT s.quantity FROM inventory_stock s WHERE s.inventory_source='boutique' AND s.variant_id=v.id LIMIT 1),0),
  COALESCE((SELECT s.reserved_quantity FROM inventory_stock s WHERE s.inventory_source='boutique' AND s.variant_id=v.id LIMIT 1),0),
  COALESCE((SELECT COUNT(*) FROM order_items oi WHERE oi.variant_id=v.id),0),
  COALESCE((SELECT SUM(r.quantity) FROM inventory_reservations r WHERE r.variant_id=v.id AND r.status='active'),0),
  'Подтверждено клиентом после завершённой ревизии: ошибочная или несуществующая рабочая позиция. История заказов, приходов, движений и ревизии сохранена.',
  CURRENT_TIMESTAMP
FROM catalog_variants v JOIN catalog_products p ON p.id = v.product_id
  WHERE p.name = 'АЙНҰРЫМ-АЙ КӨЙЛЕК'
    AND COALESCE(NULLIF(UPPER(TRIM(COALESCE(v.material,''))),''),'СТАНДАРТ') = 'СТАНДАРТ'
    AND COALESCE(NULLIF(UPPER(TRIM(COALESCE(v.length,''))),''),'СТАНДАРТ') = 'СТАНДАРТ'
    AND UPPER(TRIM(COALESCE(v.gender,''))) = 'ЖЕН'
    AND UPPER(TRIM(COALESCE(v.color,''))) = 'АЙВОРИ'
    AND TRIM(COALESCE(v.size_label,'')) IN ('42','44','46');

INSERT OR IGNORE INTO catalog_manual_retirements (
  retirement_key, entity_type, entity_id, rule_key,
  product_id, product_name, category, gender, color, material, length, size_label,
  stock_position_id, previous_is_active,
  warehouse_quantity, warehouse_reserved_quantity,
  boutique_quantity, boutique_reserved_quantity,
  order_item_count, active_reservation_quantity,
  reason, retired_at
)
SELECT
  'step188k2_client_cleanup', 'variant', v.id, 'basqa_product',
  p.id, p.name, COALESCE(v.category,'adult'), v.gender, v.color, v.material, v.length, v.size_label,
  v.stock_position_id, COALESCE(v.is_active,0),
  COALESCE((SELECT s.quantity FROM inventory_stock s WHERE s.inventory_source='warehouse' AND s.variant_id=v.id LIMIT 1),0),
  COALESCE((SELECT s.reserved_quantity FROM inventory_stock s WHERE s.inventory_source='warehouse' AND s.variant_id=v.id LIMIT 1),0),
  COALESCE((SELECT s.quantity FROM inventory_stock s WHERE s.inventory_source='boutique' AND s.variant_id=v.id LIMIT 1),0),
  COALESCE((SELECT s.reserved_quantity FROM inventory_stock s WHERE s.inventory_source='boutique' AND s.variant_id=v.id LIMIT 1),0),
  COALESCE((SELECT COUNT(*) FROM order_items oi WHERE oi.variant_id=v.id),0),
  COALESCE((SELECT SUM(r.quantity) FROM inventory_reservations r WHERE r.variant_id=v.id AND r.status='active'),0),
  'Подтверждено клиентом после завершённой ревизии: ошибочная или несуществующая рабочая позиция. История заказов, приходов, движений и ревизии сохранена.',
  CURRENT_TIMESTAMP
FROM catalog_variants v JOIN catalog_products p ON p.id = v.product_id
  WHERE p.name = 'БАСҚА';

INSERT OR IGNORE INTO catalog_manual_retirements (
  retirement_key, entity_type, entity_id, rule_key,
  product_id, product_name, category, gender, color, material, length, size_label,
  stock_position_id, previous_is_active,
  warehouse_quantity, warehouse_reserved_quantity,
  boutique_quantity, boutique_reserved_quantity,
  order_item_count, active_reservation_quantity,
  reason, retired_at
)
SELECT
  'step188k2_client_cleanup', 'variant', v.id, 'bikesh_no_color',
  p.id, p.name, COALESCE(v.category,'adult'), v.gender, v.color, v.material, v.length, v.size_label,
  v.stock_position_id, COALESCE(v.is_active,0),
  COALESCE((SELECT s.quantity FROM inventory_stock s WHERE s.inventory_source='warehouse' AND s.variant_id=v.id LIMIT 1),0),
  COALESCE((SELECT s.reserved_quantity FROM inventory_stock s WHERE s.inventory_source='warehouse' AND s.variant_id=v.id LIMIT 1),0),
  COALESCE((SELECT s.quantity FROM inventory_stock s WHERE s.inventory_source='boutique' AND s.variant_id=v.id LIMIT 1),0),
  COALESCE((SELECT s.reserved_quantity FROM inventory_stock s WHERE s.inventory_source='boutique' AND s.variant_id=v.id LIMIT 1),0),
  COALESCE((SELECT COUNT(*) FROM order_items oi WHERE oi.variant_id=v.id),0),
  COALESCE((SELECT SUM(r.quantity) FROM inventory_reservations r WHERE r.variant_id=v.id AND r.status='active'),0),
  'Подтверждено клиентом после завершённой ревизии: ошибочная или несуществующая рабочая позиция. История заказов, приходов, движений и ревизии сохранена.',
  CURRENT_TIMESTAMP
FROM catalog_variants v JOIN catalog_products p ON p.id = v.product_id
  WHERE p.name = 'БИКЕШ КӨЙЛЕК'
    AND UPPER(TRIM(COALESCE(v.color,''))) = 'БЕЗ ЦВЕТА';

INSERT OR IGNORE INTO catalog_manual_retirements (
  retirement_key, entity_type, entity_id, rule_key,
  product_id, product_name, category, gender, color, material, length, size_label,
  stock_position_id, previous_is_active,
  warehouse_quantity, warehouse_reserved_quantity,
  boutique_quantity, boutique_reserved_quantity,
  order_item_count, active_reservation_quantity,
  reason, retired_at
)
SELECT
  'step188k2_client_cleanup', 'variant', v.id, 'doker_no_gender',
  p.id, p.name, COALESCE(v.category,'adult'), v.gender, v.color, v.material, v.length, v.size_label,
  v.stock_position_id, COALESCE(v.is_active,0),
  COALESCE((SELECT s.quantity FROM inventory_stock s WHERE s.inventory_source='warehouse' AND s.variant_id=v.id LIMIT 1),0),
  COALESCE((SELECT s.reserved_quantity FROM inventory_stock s WHERE s.inventory_source='warehouse' AND s.variant_id=v.id LIMIT 1),0),
  COALESCE((SELECT s.quantity FROM inventory_stock s WHERE s.inventory_source='boutique' AND s.variant_id=v.id LIMIT 1),0),
  COALESCE((SELECT s.reserved_quantity FROM inventory_stock s WHERE s.inventory_source='boutique' AND s.variant_id=v.id LIMIT 1),0),
  COALESCE((SELECT COUNT(*) FROM order_items oi WHERE oi.variant_id=v.id),0),
  COALESCE((SELECT SUM(r.quantity) FROM inventory_reservations r WHERE r.variant_id=v.id AND r.status='active'),0),
  'Подтверждено клиентом после завершённой ревизии: ошибочная или несуществующая рабочая позиция. История заказов, приходов, движений и ревизии сохранена.',
  CURRENT_TIMESTAMP
FROM catalog_variants v JOIN catalog_products p ON p.id = v.product_id
  WHERE p.name = 'ДОКЕР'
    AND TRIM(COALESCE(v.gender,'')) = '';

INSERT OR IGNORE INTO catalog_manual_retirements (
  retirement_key, entity_type, entity_id, rule_key,
  product_id, product_name, previous_is_active,
  order_item_count, active_reservation_quantity,
  reason, retired_at
)
SELECT
  'step188k2_client_cleanup', 'product', p.id,
  CASE WHEN p.name='КОРСЕТ' THEN 'corset_product' ELSE 'basqa_product' END,
  p.id, p.name, COALESCE(p.is_active,0),
  COALESCE((SELECT COUNT(*) FROM order_items oi WHERE oi.product_id=p.id),0),
  COALESCE((SELECT SUM(r.quantity) FROM inventory_reservations r WHERE r.product_id=p.id AND r.status='active'),0),
  'Подтверждено клиентом после завершённой ревизии: ошибочный товар целиком. Рабочий интерфейс скрыт, исторические ссылки сохранены.',
  CURRENT_TIMESTAMP
FROM catalog_products p
WHERE p.name IN ('КОРСЕТ','БАСҚА');

UPDATE catalog_variants
SET is_active = 0, updated_at = CURRENT_TIMESTAMP
WHERE is_active <> 0
  AND id IN (
    SELECT entity_id FROM catalog_manual_retirements
    WHERE retirement_key='step188k2_client_cleanup' AND entity_type='variant'
  );

UPDATE catalog_products
SET is_active = 0, updated_at = CURRENT_TIMESTAMP
WHERE is_active <> 0
  AND id IN (
    SELECT entity_id FROM catalog_manual_retirements
    WHERE retirement_key='step188k2_client_cleanup' AND entity_type='product'
  );

-- Only retire an execution when every variant in it is now inactive.
-- Shared executions (for example an execution that still has valid colors) stay active.
UPDATE catalog_stock_positions
SET is_active = 0, updated_at = CURRENT_TIMESTAMP
WHERE is_active <> 0
  AND id IN (
    SELECT DISTINCT stock_position_id
    FROM catalog_manual_retirements
    WHERE retirement_key='step188k2_client_cleanup'
      AND entity_type='variant'
      AND stock_position_id IS NOT NULL
  )
  AND NOT EXISTS (
    SELECT 1 FROM catalog_variants active_variant
    WHERE active_variant.stock_position_id = catalog_stock_positions.id
      AND active_variant.is_active = 1
  );

INSERT INTO catalog_identity_meta(key, value, updated_at)
VALUES('client_cleanup_188k2','active',CURRENT_TIMESTAMP)
ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at;
