-- Step 190.4: storage/database hygiene.
-- Preserves compact order history before future physical month cleanup and removes proven one-shot legacy import staging.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS retained_order_summaries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  original_order_id INTEGER NOT NULL,
  external_id TEXT NOT NULL,
  order_date TEXT NOT NULL,
  customer_id INTEGER,
  customer_phone TEXT,
  customer_name TEXT,
  manager_id INTEGER,
  manager_name TEXT,
  city TEXT,
  delivery_type TEXT,
  source_type TEXT,
  total_amount INTEGER NOT NULL DEFAULT 0,
  received_amount INTEGER NOT NULL DEFAULT 0,
  debt_amount INTEGER NOT NULL DEFAULT 0,
  return_amount INTEGER NOT NULL DEFAULT 0,
  order_status TEXT,
  shipping_status TEXT,
  shipping_date TEXT,
  item_count INTEGER NOT NULL DEFAULT 0,
  payment_count INTEGER NOT NULL DEFAULT 0,
  return_count INTEGER NOT NULL DEFAULT 0,
  item_summary TEXT,
  retained_reason TEXT NOT NULL DEFAULT 'storage_cleanup',
  retained_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(original_order_id),
  UNIQUE(external_id)
);

CREATE INDEX IF NOT EXISTS idx_retained_order_summaries_customer_date
  ON retained_order_summaries(customer_id, order_date DESC, original_order_id DESC);
CREATE INDEX IF NOT EXISTS idx_retained_order_summaries_date
  ON retained_order_summaries(order_date DESC, original_order_id DESC);

-- These two indexes used to be created dynamically by the Worker. The schema now owns them.
CREATE INDEX IF NOT EXISTS idx_workshop_tasks_variant_id ON workshop_tasks(variant_id);
CREATE INDEX IF NOT EXISTS idx_workshop_tasks_product_id ON workshop_tasks(product_id);

-- Exact duplicate index definitions. Keep the newer, more descriptive equivalents.
DROP INDEX IF EXISTS idx_inventory_stock_lookup;
DROP INDEX IF EXISTS idx_inventory_stock_variant_lookup;

-- Proven one-shot Test1/import staging and its audit/mapping layer. Child tables first.
DROP TABLE IF EXISTS legacy_import_customer_map;
DROP TABLE IF EXISTS legacy_import_decisions;
DROP TABLE IF EXISTS legacy_import_entity_map;
DROP TABLE IF EXISTS legacy_import_manager_map;
DROP TABLE IF EXISTS legacy_import_order_audit;
DROP TABLE IF EXISTS legacy_import_trial_checks;
DROP TABLE IF EXISTS legacy_import_trial_runs;
DROP TABLE IF EXISTS legacy_import_workshop_audit;
DROP TABLE IF EXISTS legacy_incremental_checks;
DROP TABLE IF EXISTS legacy_incremental_item_resolution;
DROP TABLE IF EXISTS legacy_incremental_order_matches;
DROP TABLE IF EXISTS legacy_incremental_order_plan;
DROP TABLE IF EXISTS legacy_incremental_runs;
DROP TABLE IF EXISTS legacy_incremental_source_signatures;
DROP TABLE IF EXISTS legacy_incremental_stock_plan;
DROP TABLE IF EXISTS legacy_incremental_target_signatures;
DROP TABLE IF EXISTS legacy_stage_exchange_lines;
DROP TABLE IF EXISTS legacy_stage_ignored_rows;
DROP TABLE IF EXISTS legacy_stage_issues;
DROP TABLE IF EXISTS legacy_stage_payments;
DROP TABLE IF EXISTS legacy_stage_returns;
DROP TABLE IF EXISTS legacy_stage_stock_reviews;
DROP TABLE IF EXISTS legacy_stage_workshop;
DROP TABLE IF EXISTS legacy_stage_order_items;
DROP TABLE IF EXISTS legacy_stage_orders;
DROP TABLE IF EXISTS legacy_import_batches;

PRAGMA optimize;
