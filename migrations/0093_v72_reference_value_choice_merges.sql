PRAGMA foreign_keys=ON;
-- Deliberate reference-choice consolidation; originals remain in history.
CREATE TABLE IF NOT EXISTS reference_value_merges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK(kind IN ('city','delivery_type')),
  source_reference_id INTEGER NOT NULL REFERENCES reference_values(id),
  target_reference_id INTEGER NOT NULL REFERENCES reference_values(id),
  source_value TEXT NOT NULL,
  target_value TEXT NOT NULL,
  month_start TEXT NOT NULL,
  month_next TEXT NOT NULL,
  expected_orders INTEGER NOT NULL CHECK(expected_orders>=0),
  created_by TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(source_reference_id)
);
CREATE TABLE IF NOT EXISTS reference_value_merge_orders (
  merge_id INTEGER NOT NULL REFERENCES reference_value_merges(id),
  order_id INTEGER NOT NULL REFERENCES orders(id),
  original_value TEXT NOT NULL,
  target_value TEXT NOT NULL,
  PRIMARY KEY(merge_id,order_id)
);
CREATE TABLE IF NOT EXISTS reference_value_merge_validations(
  merge_id INTEGER PRIMARY KEY REFERENCES reference_value_merges(id),
  passed INTEGER NOT NULL CHECK(passed=1),
  checked_at TEXT NOT NULL
);
