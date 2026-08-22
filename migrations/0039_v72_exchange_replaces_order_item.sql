-- Step 103: an exchange replaces the selected order item instead of appending a second active item.
-- Run once before deploying Step 103.

ALTER TABLE workshop_tasks ADD COLUMN order_item_id INTEGER REFERENCES order_items(id);
ALTER TABLE exchanges ADD COLUMN old_workshop_task_id INTEGER REFERENCES workshop_tasks(id);
ALTER TABLE exchanges ADD COLUMN old_workshop_task_status TEXT;
ALTER TABLE exchanges ADD COLUMN old_item_replaced_at TEXT;
ALTER TABLE exchanges ADD COLUMN old_item_replacement_reversed_at TEXT;

CREATE INDEX IF NOT EXISTS idx_workshop_tasks_order_item_id
  ON workshop_tasks(order_item_id);
CREATE INDEX IF NOT EXISTS idx_exchanges_old_workshop_task_id
  ON exchanges(old_workshop_task_id);

-- Link historical workshop rows to the exact order item whenever the snapshots identify it.
UPDATE workshop_tasks
SET order_item_id = (
  SELECT oi.id
  FROM order_items oi
  WHERE oi.order_id = workshop_tasks.order_id
    AND COALESCE(oi.is_workshop, 0) = 1
    AND UPPER(TRIM(COALESCE(oi.product_name_snapshot, ''))) = UPPER(TRIM(COALESCE(workshop_tasks.product_name_snapshot, '')))
    AND UPPER(TRIM(COALESCE(oi.gender_snapshot, ''))) = UPPER(TRIM(COALESCE(workshop_tasks.gender_snapshot, '')))
    AND UPPER(TRIM(COALESCE(oi.color_snapshot, ''))) = UPPER(TRIM(COALESCE(workshop_tasks.color_snapshot, '')))
    AND UPPER(TRIM(COALESCE(oi.material_snapshot, ''))) = UPPER(TRIM(COALESCE(workshop_tasks.material_snapshot, '')))
    AND UPPER(TRIM(COALESCE(oi.length_snapshot, ''))) = UPPER(TRIM(COALESCE(workshop_tasks.length_snapshot, '')))
    AND UPPER(TRIM(COALESCE(oi.size_snapshot, ''))) = UPPER(TRIM(COALESCE(workshop_tasks.size_snapshot, '')))
  ORDER BY CASE WHEN COALESCE(oi.quantity, 0) > 0 THEN 0 ELSE 1 END, oi.id ASC
  LIMIT 1
)
WHERE order_item_id IS NULL;

-- Remember the old workshop row and its state before repairing already completed exchanges.
UPDATE exchanges
SET old_workshop_task_id = (
      SELECT wt.id
      FROM workshop_tasks wt
      WHERE wt.order_item_id = exchanges.old_order_item_id
      ORDER BY CASE wt.status WHEN 'active' THEN 0 WHEN 'ready' THEN 1 WHEN 'done' THEN 2 ELSE 3 END, wt.id ASC
      LIMIT 1
    ),
    old_workshop_task_status = (
      SELECT wt.status
      FROM workshop_tasks wt
      WHERE wt.order_item_id = exchanges.old_order_item_id
      ORDER BY CASE wt.status WHEN 'active' THEN 0 WHEN 'ready' THEN 1 WHEN 'done' THEN 2 ELSE 3 END, wt.id ASC
      LIMIT 1
    )
WHERE status = 'completed'
  AND old_item_replaced_at IS NULL
  AND EXISTS (
    SELECT 1 FROM order_items oi
    WHERE oi.id = exchanges.old_order_item_id
      AND COALESCE(oi.is_workshop, 0) = 1
  );

-- Remove the exchanged quantity from the old workshop task.
UPDATE workshop_tasks
SET quantity = MAX(
      0,
      quantity - COALESCE((
        SELECT SUM(e.old_quantity)
        FROM exchanges e
        WHERE e.old_workshop_task_id = workshop_tasks.id
          AND e.status = 'completed'
          AND e.old_item_replaced_at IS NULL
      ), 0)
    ),
    status = CASE
      WHEN quantity - COALESCE((
        SELECT SUM(e.old_quantity)
        FROM exchanges e
        WHERE e.old_workshop_task_id = workshop_tasks.id
          AND e.status = 'completed'
          AND e.old_item_replaced_at IS NULL
      ), 0) <= 0 THEN 'cancelled'
      ELSE status
    END,
    updated_at = datetime('now')
WHERE id IN (
  SELECT old_workshop_task_id
  FROM exchanges
  WHERE status = 'completed'
    AND old_item_replaced_at IS NULL
    AND old_workshop_task_id IS NOT NULL
);

-- Hide the old order item (or reduce it for a partial exchange).
UPDATE order_items
SET quantity = MAX(
      0,
      quantity - COALESCE((
        SELECT SUM(e.old_quantity)
        FROM exchanges e
        WHERE e.old_order_item_id = order_items.id
          AND e.status = 'completed'
          AND e.old_item_replaced_at IS NULL
      ), 0)
    ),
    line_total = unit_price * MAX(
      0,
      quantity - COALESCE((
        SELECT SUM(e.old_quantity)
        FROM exchanges e
        WHERE e.old_order_item_id = order_items.id
          AND e.status = 'completed'
          AND e.old_item_replaced_at IS NULL
      ), 0)
    )
WHERE id IN (
  SELECT old_order_item_id
  FROM exchanges
  WHERE status = 'completed'
    AND old_item_replaced_at IS NULL
    AND old_order_item_id IS NOT NULL
);

UPDATE exchanges
SET old_item_replaced_at = COALESCE(created_at, datetime('now'))
WHERE status = 'completed'
  AND old_item_replaced_at IS NULL;

-- Recalculate the order-level workshop badge after old tasks have been retired.
UPDATE orders
SET workshop_status = CASE
      WHEN EXISTS (
        SELECT 1 FROM workshop_tasks wt
        WHERE wt.order_id = orders.id AND wt.status = 'active'
      ) THEN 'in_workshop'
      WHEN EXISTS (
        SELECT 1 FROM workshop_tasks wt
        WHERE wt.order_id = orders.id AND wt.status IN ('ready', 'done')
      ) THEN 'ready'
      WHEN EXISTS (
        SELECT 1 FROM workshop_tasks wt
        WHERE wt.order_id = orders.id
      ) THEN 'cancelled'
      ELSE workshop_status
    END,
    updated_at = datetime('now')
WHERE id IN (SELECT DISTINCT order_id FROM exchanges);
