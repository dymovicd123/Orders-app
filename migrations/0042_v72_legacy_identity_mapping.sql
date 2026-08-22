-- Step 112: identity mapping and explicit legacy decisions.
-- This migration creates only legacy audit/mapping tables.
-- It does NOT modify orders, order_items, payments, workshop_tasks, customers, managers, catalog, or inventory.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS legacy_import_manager_map (
  batch_id TEXT NOT NULL,
  manager_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  order_count INTEGER NOT NULL DEFAULT 0,
  candidate_count INTEGER NOT NULL DEFAULT 0,
  target_manager_id INTEGER,
  mapping_action TEXT NOT NULL,
  resolution_status TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (batch_id, manager_name),
  FOREIGN KEY (batch_id) REFERENCES legacy_import_batches(batch_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS legacy_import_customer_map (
  batch_id TEXT NOT NULL,
  legacy_order_id TEXT NOT NULL,
  customer_raw TEXT,
  phone_normalized TEXT,
  phone_length INTEGER NOT NULL DEFAULT 0,
  display_name_candidate TEXT,
  city TEXT,
  target_customer_id INTEGER,
  mapping_action TEXT NOT NULL,
  resolution_status TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (batch_id, legacy_order_id),
  FOREIGN KEY (batch_id, legacy_order_id)
    REFERENCES legacy_stage_orders(batch_id, legacy_order_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS legacy_import_decisions (
  batch_id TEXT NOT NULL,
  decision_type TEXT NOT NULL,
  entity_key TEXT NOT NULL,
  source_value TEXT,
  operational_value TEXT,
  preserve_raw INTEGER NOT NULL DEFAULT 1,
  affected_count INTEGER NOT NULL DEFAULT 0,
  resolution_status TEXT NOT NULL,
  rule_note TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (batch_id, decision_type, entity_key),
  FOREIGN KEY (batch_id) REFERENCES legacy_import_batches(batch_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_legacy_manager_map_status
  ON legacy_import_manager_map(batch_id, resolution_status, mapping_action);

CREATE INDEX IF NOT EXISTS idx_legacy_customer_map_action
  ON legacy_import_customer_map(batch_id, mapping_action, phone_normalized);

CREATE INDEX IF NOT EXISTS idx_legacy_customer_map_target
  ON legacy_import_customer_map(batch_id, target_customer_id);

CREATE INDEX IF NOT EXISTS idx_legacy_decisions_type
  ON legacy_import_decisions(batch_id, decision_type, resolution_status);
