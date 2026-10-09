-- Stage04-A: isolated Workshop settlement ledger foundation.
-- No migration-time data changes, no legacy workshop/orders backfill, and no implicit debt.
-- The immutable journal records work charges, payments, and compensating corrections.
-- event_key makes retries idempotent; related_event_id ties reversals to prior facts.
-- NULL amount on a completion explicitly means "price not confirmed", NEVER zero cost.

CREATE TABLE IF NOT EXISTS workshop_settlement_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key TEXT NOT NULL UNIQUE CHECK (length(trim(event_key)) > 0),
  event_type TEXT NOT NULL CHECK (event_type IN (
    'completion', 'completion_reversal', 'price_adjustment',
    'payment', 'payment_reversal', 'opening_balance', 'balance_adjustment'
  )),
  business_date TEXT NOT NULL CHECK (
    business_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
  ),
  occurred_at TEXT NOT NULL,
  workshop_task_id INTEGER,
  order_id INTEGER,
  order_item_id INTEGER,
  external_order_id TEXT,
  product_name_snapshot TEXT,
  details_snapshot TEXT,
  quantity INTEGER CHECK (quantity IS NULL OR quantity > 0),
  unit_cost INTEGER CHECK (unit_cost IS NULL OR unit_cost >= 0),
  amount_delta INTEGER,
  related_event_id INTEGER REFERENCES workshop_settlement_events(id),
  comment TEXT,
  actor_user_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (
    (event_type = 'completion' AND workshop_task_id IS NOT NULL AND quantity IS NOT NULL
      AND ((unit_cost IS NULL AND amount_delta IS NULL)
        OR (unit_cost IS NOT NULL AND amount_delta = unit_cost * quantity)))
    OR (event_type = 'completion_reversal' AND related_event_id IS NOT NULL
      AND (amount_delta IS NULL OR amount_delta <= 0))
    OR (event_type = 'price_adjustment' AND related_event_id IS NOT NULL
      AND amount_delta IS NOT NULL)
    OR (event_type = 'payment' AND quantity IS NULL AND unit_cost IS NULL
      AND amount_delta < 0)
    OR (event_type = 'payment_reversal' AND related_event_id IS NOT NULL
      AND quantity IS NULL AND unit_cost IS NULL AND amount_delta > 0)
    OR (event_type IN ('opening_balance', 'balance_adjustment')
      AND amount_delta IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_workshop_settlement_date
  ON workshop_settlement_events(business_date DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_workshop_settlement_task
  ON workshop_settlement_events(workshop_task_id, id DESC)
  WHERE workshop_task_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_workshop_settlement_related
  ON workshop_settlement_events(related_event_id)
  WHERE related_event_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_workshop_settlement_one_reversal
  ON workshop_settlement_events(related_event_id)
  WHERE event_type IN ('completion_reversal','payment_reversal');

-- Corrections must be compensating new entries, not silent edits to money history.
CREATE TRIGGER IF NOT EXISTS trg_workshop_settlement_no_update
BEFORE UPDATE ON workshop_settlement_events
BEGIN
  SELECT RAISE(ABORT, 'Workshop settlement events are immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_workshop_settlement_no_delete
BEFORE DELETE ON workshop_settlement_events
BEGIN
  SELECT RAISE(ABORT, 'Workshop settlement events are immutable');
END;
