-- Step 188A: human-oriented inventory model.
-- Physical quantity stays in inventory_stock.quantity.
-- Active order promises live in inventory_reservations and no longer subtract physical stock until shipment.
-- Unknown order input is kept as an unresolved snapshot instead of silently creating catalog rows.

CREATE TABLE IF NOT EXISTS inventory_model_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS inventory_reservations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  order_item_id INTEGER NOT NULL UNIQUE REFERENCES order_items(id) ON DELETE CASCADE,
  inventory_source TEXT NOT NULL CHECK (inventory_source IN ('warehouse', 'boutique')),
  product_id INTEGER REFERENCES catalog_products(id),
  variant_id INTEGER REFERENCES catalog_variants(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  status TEXT NOT NULL CHECK (status IN ('active', 'fulfilled', 'released', 'unresolved')),
  reference_type TEXT NOT NULL DEFAULT 'order',
  reference_id TEXT,
  unresolved_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  fulfilled_at TEXT,
  released_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_inventory_reservations_active_variant
  ON inventory_reservations (status, inventory_source, variant_id);
CREATE INDEX IF NOT EXISTS idx_inventory_reservations_order
  ON inventory_reservations (order_id, status, order_item_id);

CREATE TABLE IF NOT EXISTS catalog_input_aliases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  input_key TEXT NOT NULL UNIQUE,
  variant_id INTEGER NOT NULL REFERENCES catalog_variants(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_catalog_input_aliases_variant ON catalog_input_aliases (variant_id);

-- A baseline makes the live conversion retry-safe. Re-running this migration does not add stock twice.
CREATE TABLE IF NOT EXISTS inventory_v2_baseline_stock (
  stock_id INTEGER PRIMARY KEY REFERENCES inventory_stock(id) ON DELETE CASCADE,
  legacy_quantity INTEGER NOT NULL,
  captured_at TEXT NOT NULL
);

INSERT OR IGNORE INTO inventory_v2_baseline_stock (stock_id, legacy_quantity, captured_at)
SELECT id, quantity, datetime('now') FROM inventory_stock
WHERE NOT EXISTS (SELECT 1 FROM inventory_model_meta WHERE key = 'human_inventory_v2' AND value = 'active');

INSERT OR IGNORE INTO inventory_reservations (
  order_id, order_item_id, inventory_source, product_id, variant_id, quantity, status,
  reference_type, reference_id, unresolved_reason, created_at, updated_at
)
SELECT
  oi.order_id,
  oi.id,
  CASE WHEN oi.source_type = 'boutique' THEN 'boutique' ELSE 'warehouse' END,
  oi.product_id,
  oi.variant_id,
  MAX(1, oi.quantity),
  CASE WHEN oi.variant_id IS NULL OR oi.product_id IS NULL THEN 'unresolved' ELSE 'active' END,
  'order',
  o.external_id,
  CASE WHEN oi.product_id IS NULL THEN 'product' WHEN oi.variant_id IS NULL THEN 'variant' ELSE NULL END,
  COALESCE(NULLIF(oi.created_at, ''), datetime('now')),
  datetime('now')
FROM order_items oi
JOIN orders o ON o.id = oi.order_id
WHERE NOT EXISTS (SELECT 1 FROM inventory_model_meta WHERE key = 'human_inventory_v2' AND value = 'active')
  AND oi.quantity > 0
  AND COALESCE(oi.is_workshop, 0) = 0
  AND COALESCE(o.shipping_status, 'not_sent') <> 'sent'
  AND COALESCE(o.order_status, 'active') NOT IN ('deleted', 'archived')
  AND COALESCE(o.archived_at, '') = '';

-- Pending rows that never touched inventory may not have a stock row yet.
INSERT INTO inventory_stock (
  inventory_source, product_id, variant_id, product_name_snapshot, gender_snapshot, color_snapshot,
  material_snapshot, length_snapshot, size_snapshot, quantity, reserved_quantity,
  last_action, last_source_ref, created_at, updated_at
)
SELECT
  r.inventory_source, oi.product_id, oi.variant_id, oi.product_name_snapshot,
  oi.gender_snapshot, oi.color_snapshot, oi.material_snapshot, oi.length_snapshot, oi.size_snapshot,
  0, 0, 'Переход на резервирование', 'step188a', datetime('now'), datetime('now')
FROM inventory_reservations r
JOIN order_items oi ON oi.id = r.order_item_id
WHERE NOT EXISTS (SELECT 1 FROM inventory_model_meta WHERE key = 'human_inventory_v2' AND value = 'active')
  AND r.status = 'active'
  AND r.variant_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM inventory_stock s
    WHERE s.inventory_source = r.inventory_source AND s.variant_id = r.variant_id
  )
GROUP BY r.inventory_source, r.variant_id;

INSERT OR IGNORE INTO inventory_v2_baseline_stock (stock_id, legacy_quantity, captured_at)
SELECT id, quantity, datetime('now') FROM inventory_stock
WHERE NOT EXISTS (SELECT 1 FROM inventory_model_meta WHERE key = 'human_inventory_v2' AND value = 'active');

-- Old normal auto-writeoff orders already reduced quantity. Restore those units to physical stock;
-- availability stays unchanged because the same units become reservations.
UPDATE inventory_stock
SET quantity = COALESCE((SELECT b.legacy_quantity FROM inventory_v2_baseline_stock b WHERE b.stock_id = inventory_stock.id), quantity)
  + COALESCE((
    SELECT SUM(r.quantity)
    FROM inventory_reservations r
    JOIN order_items oi ON oi.id = r.order_item_id
    WHERE r.status = 'active'
      AND r.inventory_source = inventory_stock.inventory_source
      AND r.variant_id = inventory_stock.variant_id
      AND COALESCE(oi.stock_writeoff_status, '') IN ('written_off', 'negative')
  ), 0)
WHERE NOT EXISTS (SELECT 1 FROM inventory_model_meta WHERE key = 'human_inventory_v2' AND value = 'active')
  AND id IN (SELECT stock_id FROM inventory_v2_baseline_stock);

-- Keep one aggregate reservation number on the canonical first stock row for fast reads.
UPDATE inventory_stock
SET reserved_quantity = CASE
  WHEN id = (
    SELECT MIN(s2.id) FROM inventory_stock s2
    WHERE s2.inventory_source = inventory_stock.inventory_source
      AND s2.variant_id = inventory_stock.variant_id
  ) THEN COALESCE((
    SELECT SUM(r.quantity) FROM inventory_reservations r
    WHERE r.status = 'active'
      AND r.inventory_source = inventory_stock.inventory_source
      AND r.variant_id = inventory_stock.variant_id
  ), 0)
  ELSE 0
END,
updated_at = datetime('now')
WHERE NOT EXISTS (SELECT 1 FROM inventory_model_meta WHERE key = 'human_inventory_v2' AND value = 'active')
  AND variant_id IS NOT NULL;

UPDATE order_items
SET stock_writeoff_status = CASE
  WHEN id IN (SELECT order_item_id FROM inventory_reservations WHERE status = 'active') THEN 'reserved'
  WHEN id IN (SELECT order_item_id FROM inventory_reservations WHERE status = 'unresolved') THEN 'catalog_unresolved'
  ELSE stock_writeoff_status
END,
stock_quantity_before = NULL,
stock_quantity_after = NULL
WHERE NOT EXISTS (SELECT 1 FROM inventory_model_meta WHERE key = 'human_inventory_v2' AND value = 'active')
  AND id IN (SELECT order_item_id FROM inventory_reservations);

INSERT OR REPLACE INTO inventory_model_meta (key, value, updated_at)
VALUES ('human_inventory_v2', 'active', datetime('now'));
