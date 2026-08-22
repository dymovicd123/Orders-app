-- Step 27: logical orders archive.
-- Archive is read-only historical mode: records stay in the same tables so reports keep seeing them.

ALTER TABLE orders ADD COLUMN archived_at TEXT;
ALTER TABLE orders ADD COLUMN archived_by TEXT;
ALTER TABLE orders ADD COLUMN archive_reason TEXT;
ALTER TABLE orders ADD COLUMN archive_batch_id TEXT;

CREATE INDEX IF NOT EXISTS idx_orders_archive_status_date
  ON orders(order_status, order_date, archived_at);

CREATE INDEX IF NOT EXISTS idx_orders_archive_batch
  ON orders(archive_batch_id);

CREATE TABLE IF NOT EXISTS archive_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id TEXT NOT NULL UNIQUE,
  cutoff_date TEXT NOT NULL,
  include_not_sent INTEGER NOT NULL DEFAULT 0,
  reason TEXT,
  archived_count INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO app_settings (key, value, updated_at)
VALUES ('step27_orders_archive_applied', 'true', datetime('now'))
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;
