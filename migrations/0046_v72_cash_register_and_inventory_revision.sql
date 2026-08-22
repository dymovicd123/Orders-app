-- Step 174: office cash register / collection ledger.
-- Inventory arrival + revision changes are UI-only; this migration only adds cash accounting schema.

ALTER TABLE returns ADD COLUMN payment_method TEXT;

CREATE TABLE IF NOT EXISTS cash_register_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  opening_amount INTEGER NOT NULL DEFAULT 0 CHECK (opening_amount >= 0),
  initialized_at TEXT,
  auto_tracking_enabled INTEGER NOT NULL DEFAULT 0 CHECK (auto_tracking_enabled IN (0, 1)),
  activated_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cash_register_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  occurred_at TEXT NOT NULL,
  business_date TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  amount INTEGER NOT NULL CHECK (amount >= 0),
  entry_type TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT,
  source_key TEXT NOT NULL UNIQUE,
  order_id INTEGER,
  external_order_id TEXT,
  payment_method TEXT,
  comment TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cash_register_entries_date_id
  ON cash_register_entries (business_date DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_cash_register_entries_order
  ON cash_register_entries (order_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_cash_register_entries_source
  ON cash_register_entries (source_type, source_id);

-- New cash payments are counted only after auto tracking is explicitly enabled.
-- Primary payments on backlog orders created before activation stay outside the cash ledger
-- even if an old order is edited later and its payment rows are rebuilt. New debt/extra
-- payments are always real post-activation cash events and are therefore tracked.
CREATE TRIGGER IF NOT EXISTS trg_cash_payment_insert
AFTER INSERT ON payments
WHEN EXISTS (
  SELECT 1
  FROM cash_register_settings s
  LEFT JOIN orders o ON o.id = NEW.order_id
  WHERE s.id = 1
    AND s.auto_tracking_enabled = 1
    AND (
      COALESCE(NEW.payment_kind, 'primary') IN ('debt_close', 'extra')
      OR COALESCE(o.created_at, '') >= COALESCE(s.activated_at, '')
    )
)
AND (
  TRIM(COALESCE(NEW.method, '')) IN ('НАЛИЧКА', 'НАЛИЧНЫЕ', 'CASH', 'cash')
  OR COALESCE(NEW.method, '') LIKE '%НАЛИЧ%'
  OR COALESCE(NEW.method, '') LIKE '%налич%'
)
BEGIN
  INSERT OR IGNORE INTO cash_register_entries (
    occurred_at, business_date, direction, amount, entry_type,
    source_type, source_id, source_key, order_id, external_order_id,
    payment_method, comment, created_by, created_at
  )
  SELECT
    COALESCE(NULLIF(NEW.created_at, ''), datetime('now')),
    COALESCE(NULLIF(NEW.payment_date, ''), date('now', '+5 hours')),
    'in',
    MAX(0, COALESCE(NEW.amount, 0)),
    CASE COALESCE(NEW.payment_kind, 'primary')
      WHEN 'debt_close' THEN 'payment_debt'
      WHEN 'extra' THEN 'payment_extra'
      ELSE 'payment_primary'
    END,
    'payment',
    CAST(NEW.id AS TEXT),
    'payment:' || NEW.id,
    NEW.order_id,
    o.external_id,
    NEW.method,
    COALESCE(NULLIF(NEW.comment, ''), 'Наличная оплата по заказу ' || COALESCE(o.external_id, '#' || NEW.order_id)),
    'Автоучёт',
    COALESCE(NULLIF(NEW.created_at, ''), datetime('now'))
  FROM orders o
  WHERE o.id = NEW.order_id;
END;

-- If a payment row is removed during edit/cancellation, reverse only a payment
-- that was previously captured by the cash register. Historical rows entered
-- before activation therefore never change the opening balance. If the whole
-- order was already cancelled, the order-cancellation entry owns the refund and
-- this trigger must not subtract the same cash a second time during later cleanup.
CREATE TRIGGER IF NOT EXISTS trg_cash_payment_delete
AFTER DELETE ON payments
WHEN EXISTS (
  SELECT 1 FROM cash_register_entries
  WHERE source_key = 'payment:' || OLD.id
)
AND NOT EXISTS (
  SELECT 1 FROM cash_register_entries
  WHERE source_key = 'order-cancel:' || OLD.order_id || ':payment:' || OLD.id
)
BEGIN
  INSERT OR IGNORE INTO cash_register_entries (
    occurred_at, business_date, direction, amount, entry_type,
    source_type, source_id, source_key, order_id, external_order_id,
    payment_method, comment, created_by, created_at
  )
  SELECT
    datetime('now'),
    date('now', '+5 hours'),
    'out',
    orig.amount,
    'payment_reversal',
    'payment_reversal',
    CAST(OLD.id AS TEXT),
    'payment-reversal:' || OLD.id,
    OLD.order_id,
    COALESCE(orig.external_order_id, o.external_id),
    COALESCE(orig.payment_method, OLD.method),
    'Отмена / замена наличной оплаты' || CASE WHEN COALESCE(o.external_id, '') <> '' THEN ' · ' || o.external_id ELSE '' END,
    'Автоучёт',
    datetime('now')
  FROM cash_register_entries orig
  LEFT JOIN orders o ON o.id = OLD.order_id
  WHERE orig.source_key = 'payment:' || OLD.id
    AND NOT EXISTS (
      SELECT 1 FROM cash_register_entries rev
      WHERE rev.source_key = 'payment-reversal:' || OLD.id
    )
  LIMIT 1;
END;

-- A cash refund physically leaves the office cash register.
CREATE TRIGGER IF NOT EXISTS trg_cash_return_insert
AFTER INSERT ON returns
WHEN EXISTS (
  SELECT 1 FROM cash_register_settings
  WHERE id = 1 AND auto_tracking_enabled = 1
)
AND COALESCE(NEW.status, 'completed') <> 'cancelled'
AND (
  TRIM(COALESCE(NEW.payment_method, '')) IN ('НАЛИЧКА', 'НАЛИЧНЫЕ', 'CASH', 'cash')
  OR COALESCE(NEW.payment_method, '') LIKE '%НАЛИЧ%'
  OR COALESCE(NEW.payment_method, '') LIKE '%налич%'
)
BEGIN
  INSERT OR IGNORE INTO cash_register_entries (
    occurred_at, business_date, direction, amount, entry_type,
    source_type, source_id, source_key, order_id, external_order_id,
    payment_method, comment, created_by, created_at
  )
  SELECT
    COALESCE(NULLIF(NEW.created_at, ''), datetime('now')),
    COALESCE(NULLIF(NEW.return_date, ''), date('now', '+5 hours')),
    'out',
    MAX(0, COALESCE(NEW.amount, 0)),
    CASE WHEN EXISTS (
      SELECT 1 FROM exchanges e WHERE e.refund_return_id = NEW.id
    ) THEN 'exchange_refund' ELSE 'order_refund' END,
    'return',
    CAST(NEW.id AS TEXT),
    'return:' || NEW.id,
    NEW.order_id,
    o.external_id,
    NEW.payment_method,
    COALESCE(NULLIF(NEW.comment, ''), 'Возврат наличных по заказу ' || COALESCE(o.external_id, '#' || NEW.order_id)),
    'Автоучёт',
    COALESCE(NULLIF(NEW.created_at, ''), datetime('now'))
  FROM orders o
  WHERE o.id = NEW.order_id;
END;

-- Cancelling a recorded cash refund puts the money back into the register.
CREATE TRIGGER IF NOT EXISTS trg_cash_return_cancel
AFTER UPDATE OF status ON returns
WHEN COALESCE(OLD.status, 'completed') <> 'cancelled'
 AND COALESCE(NEW.status, 'completed') = 'cancelled'
 AND EXISTS (
   SELECT 1 FROM cash_register_entries
   WHERE source_key = 'return:' || NEW.id
 )
BEGIN
  INSERT OR IGNORE INTO cash_register_entries (
    occurred_at, business_date, direction, amount, entry_type,
    source_type, source_id, source_key, order_id, external_order_id,
    payment_method, comment, created_by, created_at
  )
  SELECT
    datetime('now'),
    date('now', '+5 hours'),
    'in',
    orig.amount,
    'return_reversal',
    'return_reversal',
    CAST(NEW.id AS TEXT),
    'return-reversal:' || NEW.id,
    NEW.order_id,
    orig.external_order_id,
    orig.payment_method,
    'Отмена возврата наличных' || CASE WHEN COALESCE(orig.external_order_id, '') <> '' THEN ' · ' || orig.external_order_id ELSE '' END,
    'Автоучёт',
    datetime('now')
  FROM cash_register_entries orig
  WHERE orig.source_key = 'return:' || NEW.id
    AND NOT EXISTS (
      SELECT 1 FROM cash_register_entries rev
      WHERE rev.source_key = 'return-reversal:' || NEW.id
    )
  LIMIT 1;
END;

-- Administrative order deletion means the customer payment is being cancelled.
-- After auto tracking starts, cash must leave the office register even when the
-- original cash payment predates activation and is therefore already included in
-- the one-time opening physical balance. A source key per payment makes this
-- idempotent and also prevents a later archival cleanup from subtracting it twice.
CREATE TRIGGER IF NOT EXISTS trg_cash_order_deleted
AFTER UPDATE OF order_status ON orders
WHEN COALESCE(OLD.order_status, '') <> 'deleted'
 AND NEW.order_status = 'deleted'
 AND EXISTS (
   SELECT 1 FROM cash_register_settings
   WHERE id = 1 AND auto_tracking_enabled = 1
 )
BEGIN
  INSERT OR IGNORE INTO cash_register_entries (
    occurred_at, business_date, direction, amount, entry_type,
    source_type, source_id, source_key, order_id, external_order_id,
    payment_method, comment, created_by, created_at
  )
  SELECT
    datetime('now'),
    date('now', '+5 hours'),
    'out',
    MAX(0, COALESCE(p.amount, 0)),
    'order_cancel_payment',
    'order_cancel',
    CAST(p.id AS TEXT),
    'order-cancel:' || NEW.id || ':payment:' || p.id,
    NEW.id,
    NEW.external_id,
    p.method,
    'Удалён заказ ' || COALESCE(NEW.external_id, '#' || NEW.id) || ' · возврат наличной оплаты',
    'Автоучёт',
    datetime('now')
  FROM payments p
  WHERE p.order_id = NEW.id
    AND (
      TRIM(COALESCE(p.method, '')) IN ('НАЛИЧКА', 'НАЛИЧНЫЕ', 'CASH', 'cash')
      OR COALESCE(p.method, '') LIKE '%НАЛИЧ%'
      OR COALESCE(p.method, '') LIKE '%налич%'
    )
    AND NOT EXISTS (
      SELECT 1 FROM cash_register_entries rev
      WHERE rev.source_key IN (
        'payment-reversal:' || p.id,
        'order-cancel:' || NEW.id || ':payment:' || p.id
      )
    );
END;

-- Once the exchange row receives the payment/refund linkage, relabel the
-- automatically captured cash movement so the journal explains its origin.
CREATE TRIGGER IF NOT EXISTS trg_cash_exchange_payment_link
AFTER UPDATE OF payment_id ON exchanges
WHEN NEW.payment_id IS NOT NULL
BEGIN
  UPDATE cash_register_entries
  SET entry_type = 'exchange_extra',
      source_type = 'exchange',
      source_id = CAST(NEW.id AS TEXT),
      comment = COALESCE(NULLIF(NEW.comment, ''), 'Доплата наличными по обмену #' || NEW.id)
  WHERE source_key = 'payment:' || NEW.payment_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_cash_exchange_refund_link
AFTER UPDATE OF refund_return_id ON exchanges
WHEN NEW.refund_return_id IS NOT NULL
BEGIN
  UPDATE cash_register_entries
  SET entry_type = 'exchange_refund',
      source_type = 'exchange',
      source_id = CAST(NEW.id AS TEXT),
      comment = COALESCE(NULLIF(NEW.comment, ''), 'Возврат наличных по обмену #' || NEW.id)
  WHERE source_key = 'return:' || NEW.refund_return_id;
END;
