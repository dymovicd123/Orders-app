-- Legacy import control and audit schema.
-- Step 113 used this schema in an isolated local trial.
-- Step 114 creates the same schema inside the atomic production import.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS legacy_import_order_audit (
  batch_id TEXT NOT NULL,
  legacy_order_id TEXT NOT NULL,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  raw_manager_name TEXT,
  raw_customer TEXT,
  raw_shipping_status TEXT,
  shipping_status_known INTEGER NOT NULL DEFAULT 0,
  manager_snapshot_only INTEGER NOT NULL DEFAULT 0,
  customer_snapshot_only INTEGER NOT NULL DEFAULT 0,
  source_sheet TEXT,
  source_row INTEGER,
  raw_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (batch_id, legacy_order_id),
  UNIQUE (batch_id, order_id),
  FOREIGN KEY (batch_id) REFERENCES legacy_import_batches(batch_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS legacy_import_workshop_audit (
  batch_id TEXT NOT NULL,
  item_key TEXT NOT NULL,
  workshop_task_id INTEGER REFERENCES workshop_tasks(id) ON DELETE CASCADE,
  status_raw TEXT,
  decision_required INTEGER NOT NULL DEFAULT 0,
  product_mismatch INTEGER NOT NULL DEFAULT 0,
  color_mismatch INTEGER NOT NULL DEFAULT 0,
  size_mismatch INTEGER NOT NULL DEFAULT 0,
  raw_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (batch_id, item_key),
  UNIQUE (batch_id, workshop_task_id),
  FOREIGN KEY (batch_id) REFERENCES legacy_import_batches(batch_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS legacy_import_trial_runs (
  batch_id TEXT PRIMARY KEY,
  run_kind TEXT NOT NULL DEFAULT 'local_trial',
  status TEXT NOT NULL DEFAULT 'created',
  baseline_orders INTEGER NOT NULL DEFAULT 0,
  baseline_source_orders INTEGER NOT NULL DEFAULT 0,
  baseline_non_source_orders INTEGER NOT NULL DEFAULT 0,
  baseline_non_source_order_items INTEGER NOT NULL DEFAULT 0,
  baseline_non_source_payments INTEGER NOT NULL DEFAULT 0,
  baseline_non_source_workshop_tasks INTEGER NOT NULL DEFAULT 0,
  baseline_non_source_returns INTEGER NOT NULL DEFAULT 0,
  baseline_non_source_return_items INTEGER NOT NULL DEFAULT 0,
  baseline_non_source_exchanges INTEGER NOT NULL DEFAULT 0,
  baseline_non_source_exchange_items INTEGER NOT NULL DEFAULT 0,
  baseline_customers INTEGER NOT NULL DEFAULT 0,
  expected_new_customers INTEGER NOT NULL DEFAULT 0,
  baseline_inventory_stock_rows INTEGER NOT NULL DEFAULT 0,
  baseline_inventory_stock_quantity INTEGER NOT NULL DEFAULT 0,
  baseline_inventory_movement_rows INTEGER NOT NULL DEFAULT 0,
  baseline_inventory_movement_delta INTEGER NOT NULL DEFAULT 0,
  baseline_catalog_products INTEGER NOT NULL DEFAULT 0,
  baseline_catalog_variants INTEGER NOT NULL DEFAULT 0,
  baseline_managers INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  notes TEXT,
  FOREIGN KEY (batch_id) REFERENCES legacy_import_batches(batch_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS legacy_import_trial_checks (
  batch_id TEXT NOT NULL,
  phase TEXT NOT NULL,
  check_name TEXT NOT NULL,
  expected_value INTEGER NOT NULL,
  actual_value INTEGER NOT NULL,
  passed INTEGER NOT NULL CHECK (passed IN (0, 1)),
  note TEXT,
  checked_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (batch_id, phase, check_name),
  FOREIGN KEY (batch_id) REFERENCES legacy_import_batches(batch_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_legacy_order_audit_order
  ON legacy_import_order_audit(batch_id, order_id);

CREATE INDEX IF NOT EXISTS idx_legacy_workshop_audit_task
  ON legacy_import_workshop_audit(batch_id, workshop_task_id);

CREATE INDEX IF NOT EXISTS idx_legacy_trial_checks_failed
  ON legacy_import_trial_checks(batch_id, phase, passed);
