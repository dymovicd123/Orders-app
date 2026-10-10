PRAGMA foreign_keys=ON;
-- Explicit administrator reclassification of a payment method for current-month orders.
-- Money values, event dates and cash register entries are never changed.
CREATE TABLE IF NOT EXISTS reference_payment_method_merges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_reference_id INTEGER NOT NULL REFERENCES reference_values(id),
  target_reference_id INTEGER NOT NULL REFERENCES reference_values(id),
  source_value TEXT NOT NULL,
  target_value TEXT NOT NULL,
  month_start TEXT NOT NULL,
  month_next TEXT NOT NULL,
  expected_rows INTEGER NOT NULL CHECK(expected_rows>=0),
  source_fingerprint TEXT NOT NULL,
  created_by TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(source_reference_id),
  CHECK(source_reference_id<>target_reference_id)
);
CREATE TABLE IF NOT EXISTS reference_payment_merge_lines (
  merge_id INTEGER NOT NULL REFERENCES reference_payment_method_merges(id),
  entity_type TEXT NOT NULL CHECK(entity_type IN ('orders','payments','financial_events','returns','exchanges')),
  entity_id INTEGER NOT NULL,
  order_id INTEGER NOT NULL,
  original_method TEXT NOT NULL,
  method_after TEXT NOT NULL,
  operation_date TEXT NOT NULL,
  original_amount INTEGER NOT NULL,
  PRIMARY KEY(merge_id,entity_type,entity_id)
);
CREATE INDEX IF NOT EXISTS idx_reference_payment_merge_lines_order
ON reference_payment_merge_lines(order_id,entity_type);
CREATE TABLE IF NOT EXISTS reference_payment_merge_validations (
  merge_id INTEGER PRIMARY KEY REFERENCES reference_payment_method_merges(id),
  passed INTEGER NOT NULL CHECK(passed=1),
  checked_at TEXT NOT NULL
);
