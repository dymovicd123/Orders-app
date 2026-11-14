-- Return V2 protected preparatory journal. Additive only; NOT an actual Return/payment.
-- No existing Worker routes write these tables. No old order, payment or stock is modified.
-- A later transactional posting stage must explicitly validate and consume a prepared proposal.
CREATE TABLE IF NOT EXISTS return_v2_prepared_operations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL UNIQUE,
  payload_fingerprint TEXT NOT NULL,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  baseline_total INTEGER NOT NULL CHECK (baseline_total >= 0),
  baseline_received INTEGER NOT NULL CHECK (baseline_received >= 0),
  reduced_value INTEGER NOT NULL CHECK (reduced_value >= 0),
  projected_total INTEGER NOT NULL CHECK (projected_total >= 0),
  planned_refund INTEGER NOT NULL CHECK (planned_refund >= 0),
  planned_refund_method TEXT,
  status TEXT NOT NULL DEFAULT 'prepared' CHECK (status = 'prepared'),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_return_v2_prepared_order
 ON return_v2_prepared_operations(order_id, id DESC);

CREATE TABLE IF NOT EXISTS return_v2_prepared_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  operation_id INTEGER NOT NULL REFERENCES return_v2_prepared_operations(id) ON DELETE CASCADE,
  order_item_id INTEGER NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  sold_unit_price INTEGER NOT NULL CHECK (sold_unit_price >= 0),
  reduced_value INTEGER NOT NULL CHECK (reduced_value >= 0),
  physical_state TEXT NOT NULL DEFAULT 'unconfirmed' CHECK (physical_state = 'unconfirmed'),
  UNIQUE(operation_id, order_item_id)
);
CREATE INDEX IF NOT EXISTS idx_return_v2_prepared_items_order_item
 ON return_v2_prepared_items(order_item_id);
