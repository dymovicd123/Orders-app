-- Step 111: безопасный staging старой системы.
-- Этот файл НЕ изменяет orders/order_items/payments/workshop_tasks, каталог или склад.
-- Ручные BEGIN/COMMIT намеренно не используются: Wrangler/D1 управляет выполнением файла.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS legacy_import_batches (
  batch_id TEXT PRIMARY KEY,
  source_name TEXT NOT NULL,
  source_sha256 TEXT NOT NULL,
  old_system_sha256 TEXT,
  new_db_backup_sha256 TEXT,
  status TEXT NOT NULL DEFAULT 'staged',
  expected_orders INTEGER NOT NULL DEFAULT 0,
  expected_order_items INTEGER NOT NULL DEFAULT 0,
  expected_payments_raw INTEGER NOT NULL DEFAULT 0,
  expected_payments_importable INTEGER NOT NULL DEFAULT 0,
  expected_workshop_tasks INTEGER NOT NULL DEFAULT 0,
  expected_returns INTEGER NOT NULL DEFAULT 0,
  expected_exchange_operations INTEGER NOT NULL DEFAULT 0,
  expected_exchange_lines INTEGER NOT NULL DEFAULT 0,
  expected_ignored_rows INTEGER NOT NULL DEFAULT 0,
  expected_stock_review_rows INTEGER NOT NULL DEFAULT 0,
  source_totals_json TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS legacy_stage_orders (
  batch_id TEXT NOT NULL,
  source_sheet TEXT NOT NULL,
  source_row INTEGER NOT NULL,
  legacy_order_id TEXT NOT NULL,
  order_date TEXT NOT NULL,
  manager_name TEXT,
  customer_raw TEXT,
  city TEXT,
  delivery_type TEXT,
  total_amount INTEGER NOT NULL DEFAULT 0,
  received_amount INTEGER NOT NULL DEFAULT 0,
  debt_amount INTEGER NOT NULL DEFAULT 0,
  payment_status_raw TEXT,
  return_flag INTEGER NOT NULL DEFAULT 0,
  comment TEXT,
  created_at TEXT,
  ready_date TEXT,
  workshop_comment TEXT,
  updated_at TEXT,
  workshop_urgent INTEGER NOT NULL DEFAULT 0,
  workshop_due_date TEXT,
  shipping_status_raw TEXT,
  shipping_status_normalized TEXT NOT NULL DEFAULT 'unknown',
  shipping_date TEXT,
  raw_json TEXT NOT NULL,
  PRIMARY KEY (batch_id, legacy_order_id),
  FOREIGN KEY (batch_id) REFERENCES legacy_import_batches(batch_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS legacy_stage_order_items (
  batch_id TEXT NOT NULL,
  source_sheet TEXT NOT NULL,
  source_row INTEGER NOT NULL,
  legacy_order_id TEXT NOT NULL,
  item_index INTEGER NOT NULL,
  item_key TEXT NOT NULL,
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  is_workshop INTEGER NOT NULL DEFAULT 0,
  audience_type TEXT NOT NULL DEFAULT 'adult',
  gender TEXT,
  color TEXT,
  material TEXT,
  length TEXT,
  size_label TEXT,
  source_type TEXT NOT NULL DEFAULT 'warehouse',
  workshop_comment TEXT,
  legacy_product_id TEXT,
  legacy_variant_id TEXT,
  fact_exists_raw TEXT,
  fact_source_raw TEXT,
  fact_reason_raw TEXT,
  raw_json TEXT NOT NULL,
  PRIMARY KEY (batch_id, item_key),
  FOREIGN KEY (batch_id, legacy_order_id) REFERENCES legacy_stage_orders(batch_id, legacy_order_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS legacy_stage_payments (
  batch_id TEXT NOT NULL,
  source_sheet TEXT NOT NULL,
  source_row INTEGER NOT NULL,
  payment_key TEXT NOT NULL,
  legacy_order_id TEXT NOT NULL,
  payment_date TEXT NOT NULL,
  method_raw TEXT NOT NULL,
  method_normalized TEXT NOT NULL,
  amount INTEGER NOT NULL,
  payment_kind_raw TEXT,
  payment_kind_normalized TEXT NOT NULL DEFAULT 'primary',
  comment TEXT,
  created_at TEXT,
  disposition TEXT NOT NULL DEFAULT 'import',
  exclusion_reason TEXT,
  raw_json TEXT NOT NULL,
  PRIMARY KEY (batch_id, payment_key),
  FOREIGN KEY (batch_id) REFERENCES legacy_import_batches(batch_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS legacy_stage_workshop (
  batch_id TEXT NOT NULL,
  source_sheet TEXT NOT NULL,
  source_row INTEGER NOT NULL,
  item_key TEXT NOT NULL,
  legacy_order_id TEXT NOT NULL,
  order_date TEXT,
  manager_name TEXT,
  customer_raw TEXT,
  city TEXT,
  delivery_type TEXT,
  product_name_raw TEXT,
  color_raw TEXT,
  size_raw TEXT,
  quantity_raw INTEGER NOT NULL DEFAULT 1,
  workshop_source TEXT,
  status_raw TEXT,
  status_normalized TEXT NOT NULL,
  ready_date TEXT,
  order_comment TEXT,
  workshop_comment TEXT,
  service_comment TEXT,
  updated_at TEXT,
  urgent INTEGER NOT NULL DEFAULT 0,
  due_date TEXT,
  product_mismatch INTEGER NOT NULL DEFAULT 0,
  color_mismatch INTEGER NOT NULL DEFAULT 0,
  size_mismatch INTEGER NOT NULL DEFAULT 0,
  raw_json TEXT NOT NULL,
  PRIMARY KEY (batch_id, item_key),
  FOREIGN KEY (batch_id, item_key) REFERENCES legacy_stage_order_items(batch_id, item_key) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS legacy_stage_returns (
  batch_id TEXT NOT NULL,
  source_sheet TEXT NOT NULL,
  source_row INTEGER NOT NULL,
  return_key TEXT NOT NULL,
  legacy_order_id TEXT NOT NULL,
  return_date TEXT NOT NULL,
  amount_derived INTEGER NOT NULL DEFAULT 0,
  amount_rule TEXT NOT NULL,
  comment TEXT,
  created_at TEXT,
  raw_json TEXT NOT NULL,
  PRIMARY KEY (batch_id, return_key),
  FOREIGN KEY (batch_id, legacy_order_id) REFERENCES legacy_stage_orders(batch_id, legacy_order_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS legacy_stage_exchange_lines (
  batch_id TEXT NOT NULL,
  source_sheet TEXT NOT NULL,
  source_row INTEGER NOT NULL,
  legacy_exchange_id TEXT NOT NULL,
  line_no INTEGER NOT NULL,
  legacy_order_id TEXT NOT NULL,
  manager_name TEXT,
  exchange_at TEXT,
  order_item_index INTEGER NOT NULL,
  item_key TEXT,
  old_product TEXT,
  old_color TEXT,
  old_size TEXT,
  old_material TEXT,
  old_length TEXT,
  old_source TEXT,
  return_destination TEXT,
  old_quantity INTEGER NOT NULL DEFAULT 1,
  new_product TEXT,
  new_color TEXT,
  new_size TEXT,
  new_material TEXT,
  new_length TEXT,
  new_source TEXT,
  new_quantity INTEGER NOT NULL DEFAULT 1,
  financial_amount INTEGER NOT NULL DEFAULT 0,
  payment_method TEXT,
  comment TEXT,
  created_at TEXT,
  old_variant_legacy_id TEXT,
  new_variant_legacy_id TEXT,
  new_matches_current_item INTEGER NOT NULL DEFAULT 0,
  raw_json TEXT NOT NULL,
  PRIMARY KEY (batch_id, legacy_exchange_id, line_no),
  FOREIGN KEY (batch_id, legacy_order_id) REFERENCES legacy_stage_orders(batch_id, legacy_order_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS legacy_stage_stock_reviews (
  batch_id TEXT NOT NULL,
  source_sheet TEXT NOT NULL,
  source_row INTEGER NOT NULL,
  review_id TEXT NOT NULL,
  legacy_order_id TEXT,
  order_exists INTEGER NOT NULL DEFAULT 0,
  status_raw TEXT,
  reason TEXT,
  raw_json TEXT NOT NULL,
  PRIMARY KEY (batch_id, review_id),
  FOREIGN KEY (batch_id) REFERENCES legacy_import_batches(batch_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS legacy_stage_ignored_rows (
  batch_id TEXT NOT NULL,
  source_sheet TEXT NOT NULL,
  source_row INTEGER NOT NULL,
  legacy_key TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  reason TEXT NOT NULL,
  raw_json TEXT NOT NULL,
  PRIMARY KEY (batch_id, source_sheet, source_row),
  FOREIGN KEY (batch_id) REFERENCES legacy_import_batches(batch_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS legacy_stage_issues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id TEXT NOT NULL,
  severity TEXT NOT NULL,
  code TEXT NOT NULL,
  entity_type TEXT,
  entity_key TEXT,
  source_sheet TEXT,
  source_row INTEGER,
  message TEXT NOT NULL,
  details_json TEXT,
  resolution_status TEXT NOT NULL DEFAULT 'open',
  resolution_note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (batch_id) REFERENCES legacy_import_batches(batch_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS legacy_import_entity_map (
  batch_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  legacy_key TEXT NOT NULL,
  target_table TEXT NOT NULL,
  target_id INTEGER NOT NULL,
  source_sheet TEXT,
  source_row INTEGER,
  raw_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (batch_id, entity_type, legacy_key),
  FOREIGN KEY (batch_id) REFERENCES legacy_import_batches(batch_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_legacy_stage_orders_date ON legacy_stage_orders(batch_id, order_date);
CREATE INDEX IF NOT EXISTS idx_legacy_stage_items_order ON legacy_stage_order_items(batch_id, legacy_order_id, item_index);
CREATE INDEX IF NOT EXISTS idx_legacy_stage_payments_order ON legacy_stage_payments(batch_id, legacy_order_id, disposition);
CREATE INDEX IF NOT EXISTS idx_legacy_stage_workshop_status ON legacy_stage_workshop(batch_id, status_normalized);
CREATE INDEX IF NOT EXISTS idx_legacy_stage_returns_order ON legacy_stage_returns(batch_id, legacy_order_id);
CREATE INDEX IF NOT EXISTS idx_legacy_stage_exchange_order ON legacy_stage_exchange_lines(batch_id, legacy_order_id, legacy_exchange_id);
CREATE INDEX IF NOT EXISTS idx_legacy_stage_issues_severity ON legacy_stage_issues(batch_id, severity, resolution_status);
