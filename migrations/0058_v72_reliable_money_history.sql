-- Step 189C: reliable append-only money history.
-- Current order/payment/return state remains the source of truth for balances.
-- This table records what happened to money over time and is never used to mutate an order.
-- No FK to orders on purpose: future retention may remove old detailed orders while the compact money history remains readable.

CREATE TABLE IF NOT EXISTS financial_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key TEXT NOT NULL UNIQUE,
  order_id INTEGER,
  external_order_id TEXT NOT NULL,
  event_date TEXT NOT NULL,
  event_at TEXT NOT NULL,
  event_type TEXT NOT NULL,
  related_type TEXT,
  amount_delta INTEGER NOT NULL CHECK (amount_delta <> 0),
  payment_method TEXT,
  source_type TEXT NOT NULL,
  source_id INTEGER,
  source_ref TEXT,
  reason TEXT,
  comment TEXT,
  is_backfill INTEGER NOT NULL DEFAULT 0 CHECK (is_backfill IN (0, 1)),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_financial_events_date
  ON financial_events(event_date DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_financial_events_order
  ON financial_events(order_id, event_at DESC, id DESC);

-- Existing payments become the trustworthy baseline. We do not invent payment states that no longer exist.
INSERT OR IGNORE INTO financial_events (
  event_key, order_id, external_order_id, event_date, event_at, event_type, related_type,
  amount_delta, payment_method, source_type, source_id, source_ref, reason, comment, is_backfill, created_at
)
SELECT
  '189c:baseline:payment:' || p.id,
  p.order_id,
  o.external_id,
  p.payment_date,
  COALESCE(NULLIF(p.created_at, ''), p.payment_date || 'T12:00:00.000Z'),
  CASE
    WHEN EXISTS (SELECT 1 FROM exchanges e WHERE e.payment_id = p.id AND e.financial_action = 'extra_payment') THEN 'exchange_extra'
    WHEN p.payment_kind = 'debt_close' THEN 'debt_close'
    WHEN p.payment_kind = 'extra' THEN 'order_extra'
    ELSE 'order_payment'
  END,
  NULL,
  p.amount,
  p.method,
  'payment',
  p.id,
  'payments:' || p.id,
  'baseline',
  p.comment,
  1,
  strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM payments p
JOIN orders o ON o.id = p.order_id
WHERE COALESCE(p.amount, 0) > 0;

-- Returns are preserved even when they were later cancelled: the cancellation is a separate event below.
INSERT OR IGNORE INTO financial_events (
  event_key, order_id, external_order_id, event_date, event_at, event_type, related_type,
  amount_delta, payment_method, source_type, source_id, source_ref, reason, comment, is_backfill, created_at
)
SELECT
  '189c:baseline:return:' || r.id || ':created',
  r.order_id,
  o.external_id,
  r.return_date,
  COALESCE(NULLIF(r.created_at, ''), r.return_date || 'T12:00:00.000Z'),
  CASE
    WHEN EXISTS (SELECT 1 FROM exchanges e WHERE e.refund_return_id = r.id) THEN 'exchange_refund'
    ELSE 'order_refund'
  END,
  NULL,
  -ABS(r.amount),
  r.payment_method,
  'return',
  r.id,
  'returns:' || r.id,
  'baseline',
  r.comment,
  1,
  strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM returns r
JOIN orders o ON o.id = r.order_id
WHERE COALESCE(r.amount, 0) > 0;

INSERT OR IGNORE INTO financial_events (
  event_key, order_id, external_order_id, event_date, event_at, event_type, related_type,
  amount_delta, payment_method, source_type, source_id, source_ref, reason, comment, is_backfill, created_at
)
SELECT
  '189c:baseline:return:' || r.id || ':cancelled',
  r.order_id,
  o.external_id,
  substr(COALESCE(NULLIF(r.cancelled_at, ''), NULLIF(r.created_at, ''), r.return_date), 1, 10),
  COALESCE(NULLIF(r.cancelled_at, ''), NULLIF(r.created_at, ''), r.return_date || 'T12:00:00.000Z'),
  'refund_reversal',
  CASE
    WHEN EXISTS (SELECT 1 FROM exchanges e WHERE e.refund_return_id = r.id) THEN 'exchange_refund'
    ELSE 'order_refund'
  END,
  ABS(r.amount),
  r.payment_method,
  'return',
  r.id,
  'returns:' || r.id,
  CASE WHEN EXISTS (SELECT 1 FROM exchanges e WHERE e.refund_return_id = r.id) THEN 'exchange_cancel' ELSE 'return_cancel' END,
  COALESCE(NULLIF(r.cancellation_comment, ''), r.comment),
  1,
  strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM returns r
JOIN orders o ON o.id = r.order_id
WHERE COALESCE(r.amount, 0) > 0
  AND COALESCE(r.status, 'completed') = 'cancelled';

-- A cancelled exchange with an extra payment normally no longer has its payment row.
-- The exchange record still proves both the original extra payment and its later cancellation.
INSERT OR IGNORE INTO financial_events (
  event_key, order_id, external_order_id, event_date, event_at, event_type, related_type,
  amount_delta, payment_method, source_type, source_id, source_ref, reason, comment, is_backfill, created_at
)
SELECT
  '189c:baseline:exchange:' || e.id || ':extra-created',
  e.order_id,
  o.external_id,
  e.exchange_date,
  COALESCE(NULLIF(e.created_at, ''), e.exchange_date || 'T12:00:00.000Z'),
  'exchange_extra',
  NULL,
  ABS(e.financial_amount),
  e.payment_method,
  'exchange',
  e.id,
  'exchanges:' || e.id,
  'baseline',
  e.comment,
  1,
  strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM exchanges e
JOIN orders o ON o.id = e.order_id
WHERE e.financial_action = 'extra_payment'
  AND COALESCE(e.financial_amount, 0) > 0
  AND COALESCE(e.status, 'completed') = 'cancelled'
  AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.id = e.payment_id);

INSERT OR IGNORE INTO financial_events (
  event_key, order_id, external_order_id, event_date, event_at, event_type, related_type,
  amount_delta, payment_method, source_type, source_id, source_ref, reason, comment, is_backfill, created_at
)
SELECT
  '189c:baseline:exchange:' || e.id || ':extra-cancelled',
  e.order_id,
  o.external_id,
  substr(COALESCE(NULLIF(e.cancelled_at, ''), NULLIF(e.created_at, ''), e.exchange_date), 1, 10),
  COALESCE(NULLIF(e.cancelled_at, ''), NULLIF(e.created_at, ''), e.exchange_date || 'T12:00:00.000Z'),
  'payment_reversal',
  'exchange_extra',
  -ABS(e.financial_amount),
  e.payment_method,
  'exchange',
  e.id,
  'exchanges:' || e.id,
  'exchange_cancel',
  COALESCE(NULLIF(e.cancellation_comment, ''), e.comment),
  1,
  strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM exchanges e
JOIN orders o ON o.id = e.order_id
WHERE e.financial_action = 'extra_payment'
  AND COALESCE(e.financial_amount, 0) > 0
  AND COALESCE(e.status, 'completed') = 'cancelled';

INSERT INTO app_settings (key, value, updated_at)
VALUES ('financial_history_model', '189c-v1', strftime('%Y-%m-%dT%H:%M:%fZ','now'))
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;
