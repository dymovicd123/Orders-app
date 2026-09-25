PRAGMA foreign_keys = ON;


-- Stage03 H8 manual-acceptance reset. Branch2 only.
-- Preserve auth/users, managers, reference dictionaries, production-like catalog and all non-test physical stock.
-- Remove transactional residue from earlier Branch2 tests, then add isolated BR2-H8 fixtures.

DELETE FROM critical_operation_entities;
DELETE FROM critical_operations;

DELETE FROM financial_events;
DELETE FROM cash_register_entries;
DELETE FROM activity_log;
DELETE FROM archive_runs;
DELETE FROM retained_order_summaries;

DELETE FROM inventory_operation_evidence;
DELETE FROM inventory_operation_request_fingerprints;
DELETE FROM inventory_handover_reviews;
DELETE FROM inventory_transfer_items;
DELETE FROM inventory_transfer_documents;
DELETE FROM inventory_stocktake_items;
DELETE FROM inventory_stocktake_sessions;
DELETE FROM inventory_stock_checks;
DELETE FROM inventory_movement_reversals;
DELETE FROM inventory_lifecycle_events;
DELETE FROM inventory_operations;

DELETE FROM return_workshop_task_reversals;
DELETE FROM financial_integrity_repairs;
DELETE FROM exchange_items;
DELETE FROM exchanges;
DELETE FROM return_items;
DELETE FROM returns;
DELETE FROM workshop_tasks;
DELETE FROM payments;
DELETE FROM inventory_reservations;
DELETE FROM catalog_identity_order_item_links;
DELETE FROM order_items;
DELETE FROM orders;
DELETE FROM customers;

DELETE FROM order_search_orders_fts;
DELETE FROM order_search_items_fts;
DELETE FROM order_search_payments_fts;

-- No orders remain, so no reservation aggregate may survive.
UPDATE inventory_stock
SET reserved_quantity = 0,
    updated_at = CURRENT_TIMESTAMP
WHERE COALESCE(reserved_quantity, 0) <> 0;

-- Clean only our isolated H8 fixture catalog from an earlier reset, if this reset is retried.
DELETE FROM catalog_input_aliases
WHERE variant_id IN (
  SELECT v.id
  FROM catalog_variants v
  JOIN catalog_products p ON p.id = v.product_id
  WHERE p.name LIKE 'BR2-H8-%'
);
DELETE FROM catalog_product_aliases
WHERE product_id IN (SELECT id FROM catalog_products WHERE name LIKE 'BR2-H8-%');
DELETE FROM inventory_stock
WHERE product_id IN (SELECT id FROM catalog_products WHERE name LIKE 'BR2-H8-%')
   OR variant_id IN (
     SELECT v.id FROM catalog_variants v
     JOIN catalog_products p ON p.id = v.product_id
     WHERE p.name LIKE 'BR2-H8-%'
   );
DELETE FROM catalog_products WHERE name LIKE 'BR2-H8-%';

-- Reset only transactional AUTOINCREMENT counters. Catalog/master ids are intentionally preserved.
DELETE FROM sqlite_sequence WHERE name IN (
  'customers','orders','order_items','payments','returns','return_items',
  'workshop_tasks','exchanges','exchange_items','activity_log','archive_runs',
  'cash_register_entries','financial_events','retained_order_summaries',
  'inventory_reservations','inventory_handover_reviews','inventory_stocktake_items',
  'inventory_stock_checks','inventory_transfer_documents','inventory_transfer_items',
  'inventory_operation_evidence','financial_integrity_repairs','return_workshop_task_reversals'
);

-- Cash history must start visually clean for the new acceptance cycle, without changing the enabled/disabled policy.
UPDATE cash_register_settings
SET opening_amount = 0,
    initialized_at = CURRENT_TIMESTAMP,
    activated_at = CASE WHEN auto_tracking_enabled = 1 THEN CURRENT_TIMESTAMP ELSE activated_at END,
    updated_at = CURRENT_TIMESTAMP
WHERE id = 1;

-- ---------------------------------------------------------------------------
-- Isolated test Catalog fixtures.
-- All fixture names start with BR2-H8- so they are easy to search and remove.
-- ---------------------------------------------------------------------------

INSERT INTO catalog_products(name, category, is_active, gender_scope, created_at, updated_at)
VALUES
  ('BR2-H8-A ОСНОВНОЙ', 'adult', 1, 'female', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('BR2-H8-B МАЛЫЙ ОСТАТОК', 'adult', 1, 'female', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('BR2-H8-C БЕЗ ЦЕНЫ', 'adult', 1, 'female', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('BR2-H8-D ЦЕХ', 'adult', 1, 'female', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('BR2-H8-E ДЕТСКИЙ', 'child', 1, 'female', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

-- A: two price-key executions on the same product, useful for Catalog re-price testing.
INSERT INTO catalog_stock_positions(product_id, category, gender_scope, material, length, is_default, is_active, sort_order, created_at, updated_at)
SELECT id, 'adult', 'female', 'СТАНДАРТ', 'СТАНДАРТ', 1, 1, 10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM catalog_products WHERE name='BR2-H8-A ОСНОВНОЙ';
INSERT INTO catalog_stock_positions(product_id, category, gender_scope, material, length, is_default, is_active, sort_order, created_at, updated_at)
SELECT id, 'adult', 'female', 'ПРЕМИУМ', 'СТАНДАРТ', 0, 1, 20, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM catalog_products WHERE name='BR2-H8-A ОСНОВНОЙ';

INSERT INTO catalog_stock_positions(product_id, category, gender_scope, material, length, is_default, is_active, sort_order, created_at, updated_at)
SELECT id, 'adult', 'female', 'СТАНДАРТ', 'СТАНДАРТ', 1, 1, 10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM catalog_products WHERE name='BR2-H8-B МАЛЫЙ ОСТАТОК';
INSERT INTO catalog_stock_positions(product_id, category, gender_scope, material, length, is_default, is_active, sort_order, created_at, updated_at)
SELECT id, 'adult', 'female', 'СТАНДАРТ', 'СТАНДАРТ', 1, 1, 10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM catalog_products WHERE name='BR2-H8-C БЕЗ ЦЕНЫ';
INSERT INTO catalog_stock_positions(product_id, category, gender_scope, material, length, is_default, is_active, sort_order, created_at, updated_at)
SELECT id, 'adult', 'female', 'СТАНДАРТ', 'СТАНДАРТ', 1, 1, 10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM catalog_products WHERE name='BR2-H8-D ЦЕХ';
INSERT INTO catalog_stock_positions(product_id, category, gender_scope, material, length, is_default, is_active, sort_order, created_at, updated_at)
SELECT id, 'child', 'female', 'СТАНДАРТ', 'СТАНДАРТ', 1, 1, 10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM catalog_products WHERE name='BR2-H8-E ДЕТСКИЙ';

INSERT INTO catalog_variants(product_id, stock_position_id, category, gender, color, material, length, size_label, is_active, sort_order, created_at, updated_at)
SELECT p.id, sp.id, 'adult', 'ЖЕН', 'ЧЕРНЫЙ', 'СТАНДАРТ', 'СТАНДАРТ', '42', 1, 10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM catalog_products p JOIN catalog_stock_positions sp ON sp.product_id=p.id AND sp.material='СТАНДАРТ' AND sp.length='СТАНДАРТ'
WHERE p.name='BR2-H8-A ОСНОВНОЙ';
INSERT INTO catalog_variants(product_id, stock_position_id, category, gender, color, material, length, size_label, is_active, sort_order, created_at, updated_at)
SELECT p.id, sp.id, 'adult', 'ЖЕН', 'СИНИЙ', 'ПРЕМИУМ', 'СТАНДАРТ', '42', 1, 20, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM catalog_products p JOIN catalog_stock_positions sp ON sp.product_id=p.id AND sp.material='ПРЕМИУМ' AND sp.length='СТАНДАРТ'
WHERE p.name='BR2-H8-A ОСНОВНОЙ';
INSERT INTO catalog_variants(product_id, stock_position_id, category, gender, color, material, length, size_label, is_active, sort_order, created_at, updated_at)
SELECT p.id, sp.id, 'adult', 'ЖЕН', 'КРАСНЫЙ', 'СТАНДАРТ', 'СТАНДАРТ', '44', 1, 10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM catalog_products p JOIN catalog_stock_positions sp ON sp.product_id=p.id
WHERE p.name='BR2-H8-B МАЛЫЙ ОСТАТОК';
INSERT INTO catalog_variants(product_id, stock_position_id, category, gender, color, material, length, size_label, is_active, sort_order, created_at, updated_at)
SELECT p.id, sp.id, 'adult', 'ЖЕН', 'ЗЕЛЕНЫЙ', 'СТАНДАРТ', 'СТАНДАРТ', '46', 1, 10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM catalog_products p JOIN catalog_stock_positions sp ON sp.product_id=p.id
WHERE p.name='BR2-H8-C БЕЗ ЦЕНЫ';
INSERT INTO catalog_variants(product_id, stock_position_id, category, gender, color, material, length, size_label, is_active, sort_order, created_at, updated_at)
SELECT p.id, sp.id, 'adult', 'ЖЕН', 'ЗОЛОТОЙ', 'СТАНДАРТ', 'СТАНДАРТ', '48', 1, 10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM catalog_products p JOIN catalog_stock_positions sp ON sp.product_id=p.id
WHERE p.name='BR2-H8-D ЦЕХ';
INSERT INTO catalog_variants(product_id, stock_position_id, category, gender, color, material, length, size_label, is_active, sort_order, created_at, updated_at)
SELECT p.id, sp.id, 'child', 'ЖЕН', 'БЕЛЫЙ', 'СТАНДАРТ', 'СТАНДАРТ', '8', 1, 10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM catalog_products p JOIN catalog_stock_positions sp ON sp.product_id=p.id
WHERE p.name='BR2-H8-E ДЕТСКИЙ';

-- Current Catalog recommendations. C intentionally has no row: final price must be entered manually.
INSERT INTO catalog_execution_prices(stock_position_id, category, cost_price, sale_price, created_at, updated_at)
SELECT sp.id, 'adult', 600, 1000, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM catalog_stock_positions sp JOIN catalog_products p ON p.id=sp.product_id
WHERE p.name='BR2-H8-A ОСНОВНОЙ' AND sp.material='СТАНДАРТ';
INSERT INTO catalog_execution_prices(stock_position_id, category, cost_price, sale_price, created_at, updated_at)
SELECT sp.id, 'adult', 800, 1300, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM catalog_stock_positions sp JOIN catalog_products p ON p.id=sp.product_id
WHERE p.name='BR2-H8-A ОСНОВНОЙ' AND sp.material='ПРЕМИУМ';
INSERT INTO catalog_execution_prices(stock_position_id, category, cost_price, sale_price, created_at, updated_at)
SELECT sp.id, 'adult', 900, 1500, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM catalog_stock_positions sp JOIN catalog_products p ON p.id=sp.product_id
WHERE p.name='BR2-H8-B МАЛЫЙ ОСТАТОК';
INSERT INTO catalog_execution_prices(stock_position_id, category, cost_price, sale_price, created_at, updated_at)
SELECT sp.id, 'adult', 1200, 2000, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM catalog_stock_positions sp JOIN catalog_products p ON p.id=sp.product_id
WHERE p.name='BR2-H8-D ЦЕХ';
INSERT INTO catalog_execution_prices(stock_position_id, category, cost_price, sale_price, created_at, updated_at)
SELECT sp.id, 'child', 400, 700, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM catalog_stock_positions sp JOIN catalog_products p ON p.id=sp.product_id
WHERE p.name='BR2-H8-E ДЕТСКИЙ';

-- Deterministic stock for the acceptance scenarios.
-- A standard: W10 / B4
INSERT INTO inventory_stock(inventory_source, product_id, variant_id, product_name_snapshot, gender_snapshot, color_snapshot, material_snapshot, length_snapshot, size_snapshot, quantity, reserved_quantity, last_action, last_source_ref, created_at, updated_at)
SELECT 'warehouse', p.id, v.id, p.name, v.gender, v.color, v.material, v.length, v.size_label, 10, 0, 'Stage03 H8 test baseline', 'BR2-H8-RESET', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM catalog_products p JOIN catalog_variants v ON v.product_id=p.id WHERE p.name='BR2-H8-A ОСНОВНОЙ' AND v.material='СТАНДАРТ';
INSERT INTO inventory_stock(inventory_source, product_id, variant_id, product_name_snapshot, gender_snapshot, color_snapshot, material_snapshot, length_snapshot, size_snapshot, quantity, reserved_quantity, last_action, last_source_ref, created_at, updated_at)
SELECT 'boutique', p.id, v.id, p.name, v.gender, v.color, v.material, v.length, v.size_label, 4, 0, 'Stage03 H8 test baseline', 'BR2-H8-RESET', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM catalog_products p JOIN catalog_variants v ON v.product_id=p.id WHERE p.name='BR2-H8-A ОСНОВНОЙ' AND v.material='СТАНДАРТ';

-- A premium: W6 / B2
INSERT INTO inventory_stock(inventory_source, product_id, variant_id, product_name_snapshot, gender_snapshot, color_snapshot, material_snapshot, length_snapshot, size_snapshot, quantity, reserved_quantity, last_action, last_source_ref, created_at, updated_at)
SELECT 'warehouse', p.id, v.id, p.name, v.gender, v.color, v.material, v.length, v.size_label, 6, 0, 'Stage03 H8 test baseline', 'BR2-H8-RESET', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM catalog_products p JOIN catalog_variants v ON v.product_id=p.id WHERE p.name='BR2-H8-A ОСНОВНОЙ' AND v.material='ПРЕМИУМ';
INSERT INTO inventory_stock(inventory_source, product_id, variant_id, product_name_snapshot, gender_snapshot, color_snapshot, material_snapshot, length_snapshot, size_snapshot, quantity, reserved_quantity, last_action, last_source_ref, created_at, updated_at)
SELECT 'boutique', p.id, v.id, p.name, v.gender, v.color, v.material, v.length, v.size_label, 2, 0, 'Stage03 H8 test baseline', 'BR2-H8-RESET', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM catalog_products p JOIN catalog_variants v ON v.product_id=p.id WHERE p.name='BR2-H8-A ОСНОВНОЙ' AND v.material='ПРЕМИУМ';

-- B low stock: W2 / B0
INSERT INTO inventory_stock(inventory_source, product_id, variant_id, product_name_snapshot, gender_snapshot, color_snapshot, material_snapshot, length_snapshot, size_snapshot, quantity, reserved_quantity, last_action, last_source_ref, created_at, updated_at)
SELECT 'warehouse', p.id, v.id, p.name, v.gender, v.color, v.material, v.length, v.size_label, 2, 0, 'Stage03 H8 test baseline', 'BR2-H8-RESET', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM catalog_products p JOIN catalog_variants v ON v.product_id=p.id WHERE p.name='BR2-H8-B МАЛЫЙ ОСТАТОК';

-- C no Catalog price: W5 / B5
INSERT INTO inventory_stock(inventory_source, product_id, variant_id, product_name_snapshot, gender_snapshot, color_snapshot, material_snapshot, length_snapshot, size_snapshot, quantity, reserved_quantity, last_action, last_source_ref, created_at, updated_at)
SELECT 'warehouse', p.id, v.id, p.name, v.gender, v.color, v.material, v.length, v.size_label, 5, 0, 'Stage03 H8 test baseline', 'BR2-H8-RESET', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM catalog_products p JOIN catalog_variants v ON v.product_id=p.id WHERE p.name='BR2-H8-C БЕЗ ЦЕНЫ';
INSERT INTO inventory_stock(inventory_source, product_id, variant_id, product_name_snapshot, gender_snapshot, color_snapshot, material_snapshot, length_snapshot, size_snapshot, quantity, reserved_quantity, last_action, last_source_ref, created_at, updated_at)
SELECT 'boutique', p.id, v.id, p.name, v.gender, v.color, v.material, v.length, v.size_label, 5, 0, 'Stage03 H8 test baseline', 'BR2-H8-RESET', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM catalog_products p JOIN catalog_variants v ON v.product_id=p.id WHERE p.name='BR2-H8-C БЕЗ ЦЕНЫ';

-- E child: W5 / B1
INSERT INTO inventory_stock(inventory_source, product_id, variant_id, product_name_snapshot, gender_snapshot, color_snapshot, material_snapshot, length_snapshot, size_snapshot, quantity, reserved_quantity, last_action, last_source_ref, created_at, updated_at)
SELECT 'warehouse', p.id, v.id, p.name, v.gender, v.color, v.material, v.length, v.size_label, 5, 0, 'Stage03 H8 test baseline', 'BR2-H8-RESET', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM catalog_products p JOIN catalog_variants v ON v.product_id=p.id WHERE p.name='BR2-H8-E ДЕТСКИЙ';
INSERT INTO inventory_stock(inventory_source, product_id, variant_id, product_name_snapshot, gender_snapshot, color_snapshot, material_snapshot, length_snapshot, size_snapshot, quantity, reserved_quantity, last_action, last_source_ref, created_at, updated_at)
SELECT 'boutique', p.id, v.id, p.name, v.gender, v.color, v.material, v.length, v.size_label, 1, 0, 'Stage03 H8 test baseline', 'BR2-H8-RESET', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM catalog_products p JOIN catalog_variants v ON v.product_id=p.id WHERE p.name='BR2-H8-E ДЕТСКИЙ';

