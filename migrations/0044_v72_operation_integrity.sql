PRAGMA foreign_keys = ON;

-- Step 146/147: make debt closing, returns and exchanges reversible and internally consistent.
-- This migration also repairs duplicate debt-close payments created by the old endpoint.
-- IMPORTANT: production uses the dedicated Step 147 remote repair runner because the
-- existing production database predates Wrangler's migration history table.

ALTER TABLE exchanges ADD COLUMN old_workshop_task_quantity INTEGER;
ALTER TABLE exchanges ADD COLUMN old_item_stock_writeoff_status TEXT;

CREATE TABLE IF NOT EXISTS return_workshop_task_reversals (
  return_id INTEGER NOT NULL REFERENCES returns(id) ON DELETE CASCADE,
  workshop_task_id INTEGER NOT NULL REFERENCES workshop_tasks(id) ON DELETE CASCADE,
  previous_status TEXT NOT NULL,
  previous_quantity INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (return_id, workshop_task_id)
);

CREATE INDEX IF NOT EXISTS idx_return_workshop_task_reversals_return
  ON return_workshop_task_reversals(return_id);

CREATE TABLE IF NOT EXISTS financial_integrity_repairs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repair_key TEXT NOT NULL,
  order_id INTEGER NOT NULL,
  payment_id INTEGER,
  action TEXT NOT NULL,
  old_amount INTEGER NOT NULL DEFAULT 0,
  new_amount INTEGER NOT NULL DEFAULT 0,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (repair_key, payment_id)
);

DROP TABLE IF EXISTS _step146_debt_close_repair;
CREATE TABLE _step146_debt_close_repair AS
WITH non_debt AS (
  SELECT
    o.id AS order_id,
    MAX(0, COALESCE(o.total_amount, 0) - COALESCE(SUM(CASE WHEN p.payment_kind <> 'debt_close' THEN MAX(0, p.amount) ELSE 0 END), 0)) AS capacity
  FROM orders o
  LEFT JOIN payments p ON p.order_id = o.id
  GROUP BY o.id
),
ranked AS (
  SELECT
    p.id AS payment_id,
    p.order_id,
    MAX(0, p.amount) AS old_amount,
    COALESCE(n.capacity, 0) AS capacity,
    COALESCE(
      SUM(MAX(0, p.amount)) OVER (
        PARTITION BY p.order_id
        ORDER BY p.id
        ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
      ),
      0
    ) AS prior_debt_amount
  FROM payments p
  JOIN non_debt n ON n.order_id = p.order_id
  WHERE p.payment_kind = 'debt_close'
)
SELECT
  payment_id,
  order_id,
  old_amount,
  CASE
    WHEN capacity - prior_debt_amount <= 0 THEN 0
    WHEN old_amount <= capacity - prior_debt_amount THEN old_amount
    ELSE capacity - prior_debt_amount
  END AS allowed_amount
FROM ranked;

INSERT INTO financial_integrity_repairs (
  repair_key, order_id, payment_id, action, old_amount, new_amount, details, created_at
)
SELECT
  'step146_duplicate_debt_close',
  repair.order_id,
  repair.payment_id,
  CASE WHEN repair.allowed_amount <= 0 THEN 'deleted_overflow_payment' ELSE 'reduced_overflow_payment' END,
  repair.old_amount,
  repair.allowed_amount,
  'Old debt-closing endpoint accepted repeated payments without updating the order aggregate.',
  datetime('now')
FROM _step146_debt_close_repair repair
WHERE repair.allowed_amount <> repair.old_amount
  AND NOT EXISTS (
    SELECT 1
    FROM financial_integrity_repairs existing
    WHERE existing.repair_key = 'step146_duplicate_debt_close'
      AND existing.payment_id = repair.payment_id
  );

UPDATE payments
SET amount = (
  SELECT allowed_amount
  FROM _step146_debt_close_repair repair
  WHERE repair.payment_id = payments.id
)
WHERE id IN (
  SELECT payment_id
  FROM _step146_debt_close_repair
  WHERE allowed_amount > 0 AND allowed_amount < old_amount
);

DELETE FROM payments
WHERE id IN (
  SELECT payment_id
  FROM _step146_debt_close_repair
  WHERE allowed_amount <= 0
);

DROP TABLE IF EXISTS _step146_debt_close_repair;

UPDATE orders
SET received_amount = COALESCE((
      SELECT SUM(MAX(0, p.amount))
      FROM payments p
      WHERE p.order_id = orders.id
    ), 0),
    return_amount = COALESCE((
      SELECT SUM(MAX(0, r.amount))
      FROM returns r
      WHERE r.order_id = orders.id
        AND COALESCE(r.status, 'completed') <> 'cancelled'
    ), 0),
    debt_amount = MAX(
      0,
      COALESCE(total_amount, 0) - COALESCE((
        SELECT SUM(MAX(0, p.amount))
        FROM payments p
        WHERE p.order_id = orders.id
      ), 0)
    ),
    updated_at = datetime('now');

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT,
  value TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

UPDATE app_settings
SET value = 'applied', updated_at = datetime('now')
WHERE key = 'step146_operation_integrity';

INSERT INTO app_settings (key, value, updated_at)
SELECT 'step146_operation_integrity', 'applied', datetime('now')
WHERE NOT EXISTS (
  SELECT 1 FROM app_settings WHERE key = 'step146_operation_integrity'
);
