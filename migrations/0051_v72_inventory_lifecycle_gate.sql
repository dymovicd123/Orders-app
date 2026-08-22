-- Step 188G: canonical inventory lifecycle gate for returns and exchanges.
-- Canonical physical items move immediately. Unknown/workshop items wait here until an
-- administrator resolves the exact catalog identity. This table never changes stock by itself.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS inventory_lifecycle_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key TEXT NOT NULL UNIQUE,
  operation_type TEXT NOT NULL CHECK (operation_type IN ('return', 'exchange')),
  operation_id INTEGER NOT NULL,
  operation_item_id INTEGER,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  order_item_id INTEGER REFERENCES order_items(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('return_in', 'exchange_old_in', 'exchange_new_out')),
  direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  inventory_source TEXT NOT NULL CHECK (inventory_source IN ('warehouse', 'boutique')),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  product_id INTEGER REFERENCES catalog_products(id),
  variant_id INTEGER REFERENCES catalog_variants(id),
  product_name_snapshot TEXT NOT NULL,
  audience_type TEXT,
  gender_snapshot TEXT,
  color_snapshot TEXT,
  material_snapshot TEXT,
  length_snapshot TEXT,
  size_snapshot TEXT,
  is_workshop INTEGER NOT NULL DEFAULT 0 CHECK (is_workshop IN (0, 1)),
  status TEXT NOT NULL CHECK (status IN ('pending', 'applied', 'cancelled')),
  pending_reason TEXT,
  movement_id INTEGER REFERENCES inventory_movements(id),
  reversal_movement_id INTEGER REFERENCES inventory_movements(id),
  resolution_comment TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  applied_at TEXT,
  cancelled_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_inventory_lifecycle_pending
  ON inventory_lifecycle_events(status, event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_lifecycle_operation
  ON inventory_lifecycle_events(operation_type, operation_id, id);
CREATE INDEX IF NOT EXISTS idx_inventory_lifecycle_order
  ON inventory_lifecycle_events(order_id, order_item_id, status);
CREATE INDEX IF NOT EXISTS idx_inventory_lifecycle_variant
  ON inventory_lifecycle_events(inventory_source, variant_id, status);

-- Conservative backfill for already-completed pre-188G operations. Only rows with an exact
-- canonical variant and matching historical movement are adopted. Ambiguous legacy snapshot
-- movements are deliberately NOT guessed; cancellation code will block them for manual review.
INSERT OR IGNORE INTO inventory_lifecycle_events (
  event_key, operation_type, operation_id, operation_item_id, order_id, order_item_id,
  event_type, direction, inventory_source, quantity, product_id, variant_id,
  product_name_snapshot, audience_type, gender_snapshot, color_snapshot, material_snapshot,
  length_snapshot, size_snapshot, is_workshop, status, pending_reason, movement_id,
  created_at, updated_at, applied_at
)
SELECT
  'return:' || r.id || ':item:' || ri.id,
  'return', r.id, ri.id, r.order_id, ri.order_item_id,
  'return_in', 'in', ri.inventory_source, MAX(1, ri.quantity), oi.product_id, oi.variant_id,
  ri.product_name_snapshot, oi.audience_type, ri.gender_snapshot, ri.color_snapshot,
  ri.material_snapshot, ri.length_snapshot, ri.size_snapshot, COALESCE(oi.is_workshop, 0),
  'applied', NULL,
  (
    SELECT MIN(im.id) FROM inventory_movements im
    WHERE im.reference_type = 'return'
      AND im.reference_id = 'return:' || r.id
      AND im.inventory_source = ri.inventory_source
      AND im.variant_id = oi.variant_id
      AND im.quantity_delta = MAX(1, ri.quantity)
  ),
  COALESCE(NULLIF(ri.created_at, ''), NULLIF(r.created_at, ''), CURRENT_TIMESTAMP),
  CURRENT_TIMESTAMP,
  COALESCE(NULLIF(ri.created_at, ''), NULLIF(r.created_at, ''), CURRENT_TIMESTAMP)
FROM returns r
JOIN return_items ri ON ri.return_id = r.id
JOIN order_items oi ON oi.id = ri.order_item_id
WHERE COALESCE(r.status, 'completed') <> 'cancelled'
  AND COALESCE(ri.restocked, 0) = 1
  AND ri.inventory_source IN ('warehouse', 'boutique')
  AND COALESCE(oi.is_workshop, 0) = 0
  AND oi.variant_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM inventory_movements im
    WHERE im.reference_type = 'return'
      AND im.reference_id = 'return:' || r.id
      AND im.inventory_source = ri.inventory_source
      AND im.variant_id = oi.variant_id
      AND im.quantity_delta = MAX(1, ri.quantity)
  );

INSERT OR IGNORE INTO inventory_lifecycle_events (
  event_key, operation_type, operation_id, operation_item_id, order_id, order_item_id,
  event_type, direction, inventory_source, quantity, product_id, variant_id,
  product_name_snapshot, audience_type, gender_snapshot, color_snapshot, material_snapshot,
  length_snapshot, size_snapshot, is_workshop, status, pending_reason, movement_id,
  created_at, updated_at, applied_at
)
SELECT
  'exchange:' || e.id || ':old',
  'exchange', e.id, ei.id, e.order_id, e.old_order_item_id,
  'exchange_old_in', 'in', e.old_return_source, MAX(1, e.old_quantity), oi.product_id, oi.variant_id,
  COALESCE(ei.product_name_snapshot, oi.product_name_snapshot), oi.audience_type,
  COALESCE(ei.gender_snapshot, oi.gender_snapshot), COALESCE(ei.color_snapshot, oi.color_snapshot),
  COALESCE(ei.material_snapshot, oi.material_snapshot), COALESCE(ei.length_snapshot, oi.length_snapshot),
  COALESCE(ei.size_snapshot, oi.size_snapshot), COALESCE(oi.is_workshop, 0),
  'applied', NULL,
  (
    SELECT MIN(im.id) FROM inventory_movements im
    WHERE im.reference_type = 'exchange'
      AND im.reference_id = 'exchange:' || e.id
      AND im.inventory_source = e.old_return_source
      AND im.variant_id = oi.variant_id
      AND im.quantity_delta = MAX(1, e.old_quantity)
  ),
  COALESCE(NULLIF(e.created_at, ''), CURRENT_TIMESTAMP), CURRENT_TIMESTAMP,
  COALESCE(NULLIF(e.created_at, ''), CURRENT_TIMESTAMP)
FROM exchanges e
JOIN order_items oi ON oi.id = e.old_order_item_id
LEFT JOIN exchange_items ei ON ei.id = (
  SELECT x.id FROM exchange_items x WHERE x.exchange_id = e.id AND x.role = 'old' ORDER BY x.id ASC LIMIT 1
)
WHERE COALESCE(e.status, 'completed') <> 'cancelled'
  AND e.old_return_source IN ('warehouse', 'boutique')
  AND COALESCE(oi.is_workshop, 0) = 0
  AND oi.variant_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM inventory_movements im
    WHERE im.reference_type = 'exchange'
      AND im.reference_id = 'exchange:' || e.id
      AND im.inventory_source = e.old_return_source
      AND im.variant_id = oi.variant_id
      AND im.quantity_delta = MAX(1, e.old_quantity)
  );

INSERT OR IGNORE INTO inventory_lifecycle_events (
  event_key, operation_type, operation_id, operation_item_id, order_id, order_item_id,
  event_type, direction, inventory_source, quantity, product_id, variant_id,
  product_name_snapshot, audience_type, gender_snapshot, color_snapshot, material_snapshot,
  length_snapshot, size_snapshot, is_workshop, status, pending_reason, movement_id,
  created_at, updated_at, applied_at
)
SELECT
  'exchange:' || e.id || ':new',
  'exchange', e.id, ei.id, e.order_id, e.new_order_item_id,
  'exchange_new_out', 'out', CASE WHEN oi.source_type = 'boutique' THEN 'boutique' ELSE 'warehouse' END,
  MAX(1, oi.quantity), oi.product_id, oi.variant_id,
  COALESCE(ei.product_name_snapshot, oi.product_name_snapshot), oi.audience_type,
  COALESCE(ei.gender_snapshot, oi.gender_snapshot), COALESCE(ei.color_snapshot, oi.color_snapshot),
  COALESCE(ei.material_snapshot, oi.material_snapshot), COALESCE(ei.length_snapshot, oi.length_snapshot),
  COALESCE(ei.size_snapshot, oi.size_snapshot), COALESCE(oi.is_workshop, 0),
  'applied', NULL,
  (
    SELECT MIN(im.id) FROM inventory_movements im
    WHERE im.reference_type = 'exchange_new'
      AND im.reference_id = CAST(e.id AS TEXT)
      AND im.inventory_source = CASE WHEN oi.source_type = 'boutique' THEN 'boutique' ELSE 'warehouse' END
      AND im.variant_id = oi.variant_id
      AND im.quantity_delta = -MAX(1, oi.quantity)
  ),
  COALESCE(NULLIF(e.created_at, ''), CURRENT_TIMESTAMP), CURRENT_TIMESTAMP,
  COALESCE(NULLIF(e.created_at, ''), CURRENT_TIMESTAMP)
FROM exchanges e
JOIN order_items oi ON oi.id = e.new_order_item_id
LEFT JOIN exchange_items ei ON ei.id = (
  SELECT x.id FROM exchange_items x WHERE x.exchange_id = e.id AND x.role = 'new' ORDER BY x.id ASC LIMIT 1
)
WHERE COALESCE(e.status, 'completed') <> 'cancelled'
  AND e.new_order_item_id IS NOT NULL
  AND COALESCE(oi.is_workshop, 0) = 0
  AND oi.variant_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM inventory_movements im
    WHERE im.reference_type = 'exchange_new'
      AND im.reference_id = CAST(e.id AS TEXT)
      AND im.inventory_source = CASE WHEN oi.source_type = 'boutique' THEN 'boutique' ELSE 'warehouse' END
      AND im.variant_id = oi.variant_id
      AND im.quantity_delta = -MAX(1, oi.quantity)
  );

-- Pre-188G workshop exchange returns never touched stock but the intended destination is stored
-- on exchanges.old_return_source, so they can safely enter the new pending intake queue.
INSERT OR IGNORE INTO inventory_lifecycle_events (
  event_key, operation_type, operation_id, operation_item_id, order_id, order_item_id,
  event_type, direction, inventory_source, quantity, product_id, variant_id,
  product_name_snapshot, audience_type, gender_snapshot, color_snapshot, material_snapshot,
  length_snapshot, size_snapshot, is_workshop, status, pending_reason,
  created_at, updated_at
)
SELECT
  'exchange:' || e.id || ':old',
  'exchange', e.id, ei.id, e.order_id, e.old_order_item_id,
  'exchange_old_in', 'in', e.old_return_source, MAX(1, e.old_quantity), oi.product_id, NULL,
  COALESCE(ei.product_name_snapshot, oi.product_name_snapshot), oi.audience_type,
  COALESCE(ei.gender_snapshot, oi.gender_snapshot), COALESCE(ei.color_snapshot, oi.color_snapshot),
  COALESCE(ei.material_snapshot, oi.material_snapshot), COALESCE(ei.length_snapshot, oi.length_snapshot),
  COALESCE(ei.size_snapshot, oi.size_snapshot), 1, 'pending', 'workshop_intake',
  COALESCE(NULLIF(e.created_at, ''), CURRENT_TIMESTAMP), CURRENT_TIMESTAMP
FROM exchanges e
JOIN order_items oi ON oi.id = e.old_order_item_id
LEFT JOIN exchange_items ei ON ei.id = (
  SELECT x.id FROM exchange_items x WHERE x.exchange_id = e.id AND x.role = 'old' ORDER BY x.id ASC LIMIT 1
)
WHERE COALESCE(e.status, 'completed') <> 'cancelled'
  AND e.old_return_source IN ('warehouse', 'boutique')
  AND COALESCE(oi.is_workshop, 0) = 1;

-- A pre-188G unresolved replacement exchange had an unresolved reservation and therefore no
-- physical write-off. It is safe to resume as a pending outgoing lifecycle event.
INSERT OR IGNORE INTO inventory_lifecycle_events (
  event_key, operation_type, operation_id, operation_item_id, order_id, order_item_id,
  event_type, direction, inventory_source, quantity, product_id, variant_id,
  product_name_snapshot, audience_type, gender_snapshot, color_snapshot, material_snapshot,
  length_snapshot, size_snapshot, is_workshop, status, pending_reason,
  created_at, updated_at
)
SELECT
  'exchange:' || e.id || ':new',
  'exchange', e.id, ei.id, e.order_id, e.new_order_item_id,
  'exchange_new_out', 'out', r.inventory_source, MAX(1, r.quantity), oi.product_id, oi.variant_id,
  COALESCE(ei.product_name_snapshot, oi.product_name_snapshot), oi.audience_type,
  COALESCE(ei.gender_snapshot, oi.gender_snapshot), COALESCE(ei.color_snapshot, oi.color_snapshot),
  COALESCE(ei.material_snapshot, oi.material_snapshot), COALESCE(ei.length_snapshot, oi.length_snapshot),
  COALESCE(ei.size_snapshot, oi.size_snapshot), 0, 'pending', COALESCE(NULLIF(r.unresolved_reason, ''), 'variant'),
  COALESCE(NULLIF(e.created_at, ''), CURRENT_TIMESTAMP), CURRENT_TIMESTAMP
FROM exchanges e
JOIN order_items oi ON oi.id = e.new_order_item_id
JOIN inventory_reservations r ON r.order_item_id = e.new_order_item_id AND r.status = 'unresolved'
LEFT JOIN exchange_items ei ON ei.id = (
  SELECT x.id FROM exchange_items x WHERE x.exchange_id = e.id AND x.role = 'new' ORDER BY x.id ASC LIMIT 1
)
WHERE COALESCE(e.status, 'completed') <> 'cancelled'
  AND e.new_order_item_id IS NOT NULL
  AND COALESCE(oi.is_workshop, 0) = 0;
