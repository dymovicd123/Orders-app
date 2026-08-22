PRAGMA foreign_keys = ON;

-- Step 122: controllable order auto-writeoff and reversible inventory operations.
-- Existing orders, stock rows and movement history stay intact.
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO app_settings (key, value, updated_at)
VALUES ('inventory_auto_writeoff_enabled', '1', datetime('now'))
ON CONFLICT(key) DO NOTHING;

CREATE TABLE IF NOT EXISTS inventory_movement_reversals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  original_movement_id INTEGER NOT NULL UNIQUE,
  reversal_movement_id INTEGER,
  operation_reference_id TEXT,
  operation_created_at TEXT,
  comment TEXT,
  reversed_by TEXT,
  reversed_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (original_movement_id) REFERENCES inventory_movements(id),
  FOREIGN KEY (reversal_movement_id) REFERENCES inventory_movements(id)
);

CREATE INDEX IF NOT EXISTS idx_inventory_movement_reversals_operation
  ON inventory_movement_reversals(operation_reference_id, operation_created_at);

CREATE INDEX IF NOT EXISTS idx_inventory_movements_reference_created
  ON inventory_movements(reference_id, created_at);
