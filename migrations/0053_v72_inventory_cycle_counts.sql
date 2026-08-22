-- Step 188I: durable physical-check history for ongoing stock accuracy / cycle counts.
-- Additive only. It records successful physical checks, including checks where the quantity did not change.

CREATE TABLE IF NOT EXISTS inventory_stock_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  check_key TEXT UNIQUE,
  inventory_source TEXT NOT NULL CHECK (inventory_source IN ('warehouse', 'boutique')),
  product_id INTEGER REFERENCES catalog_products(id),
  variant_id INTEGER NOT NULL REFERENCES catalog_variants(id),
  expected_quantity INTEGER NOT NULL,
  counted_quantity INTEGER NOT NULL CHECK (counted_quantity >= 0),
  difference_quantity INTEGER NOT NULL,
  reserved_quantity INTEGER NOT NULL DEFAULT 0 CHECK (reserved_quantity >= 0),
  check_type TEXT NOT NULL,
  reference_type TEXT,
  reference_id TEXT,
  checked_by TEXT,
  checked_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_inventory_stock_checks_source_variant_time
  ON inventory_stock_checks (inventory_source, variant_id, checked_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_stock_checks_time
  ON inventory_stock_checks (checked_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_stock_checks_reference
  ON inventory_stock_checks (reference_type, reference_id, id DESC);

-- Preserve the useful physical-count history we can prove from completed Step 188E sessions.
-- Older quick checks that produced no quantity difference cannot be reconstructed and are intentionally not guessed.
INSERT OR IGNORE INTO inventory_stock_checks (
  check_key, inventory_source, product_id, variant_id,
  expected_quantity, counted_quantity, difference_quantity, reserved_quantity,
  check_type, reference_type, reference_id, checked_by, checked_at, created_at
)
SELECT
  'stocktake:' || i.session_id || ':' || i.variant_id,
  i.inventory_source,
  i.product_id,
  i.variant_id,
  i.baseline_quantity,
  COALESCE(i.applied_quantity, i.counted_quantity, i.baseline_quantity),
  COALESCE(i.applied_quantity, i.counted_quantity, i.baseline_quantity) - i.baseline_quantity,
  COALESCE(i.opening_reserved_quantity, 0),
  CASE WHEN i.session_id LIKE 'REV-%-P-%' THEN 'selective_stocktake' ELSE 'full_stocktake' END,
  'stocktake',
  i.session_id,
  s.created_by,
  COALESCE(i.counted_at, s.completed_at, i.updated_at, s.updated_at),
  COALESCE(i.counted_at, s.completed_at, i.updated_at, s.updated_at)
FROM inventory_stocktake_items i
JOIN inventory_stocktake_sessions s ON s.id = i.session_id
WHERE s.status = 'completed'
  AND i.status = 'applied'
  AND i.variant_id IS NOT NULL
  AND i.counted_quantity IS NOT NULL;

-- Changed quick/manager observations are also provable from their revision movements.
-- A movement stores quantity_after and delta, so the previous system quantity is exact.
INSERT OR IGNORE INTO inventory_stock_checks (
  check_key, inventory_source, product_id, variant_id,
  expected_quantity, counted_quantity, difference_quantity, reserved_quantity,
  check_type, reference_type, reference_id, checked_by, checked_at, created_at
)
SELECT
  'legacy-movement:' || m.id,
  m.inventory_source,
  m.product_id,
  m.variant_id,
  m.quantity_after - m.quantity_delta,
  m.quantity_after,
  m.quantity_delta,
  0,
  CASE m.reference_type
    WHEN 'transfer_stocktake' THEN 'transfer_observation'
    WHEN 'order_observation' THEN 'order_observation'
    ELSE 'quick_stocktake'
  END,
  m.reference_type,
  m.reference_id,
  NULL,
  m.created_at,
  m.created_at
FROM inventory_movements m
WHERE m.variant_id IS NOT NULL
  AND m.movement_type = 'revision'
  AND m.reference_type IN ('quick_stocktake', 'order_observation', 'transfer_stocktake')
  AND m.quantity_after >= 0;
