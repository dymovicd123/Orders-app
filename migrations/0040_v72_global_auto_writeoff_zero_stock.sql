PRAGMA foreign_keys = ON;

-- Step 106: one global auto-writeoff switch for both warehouse and boutique.
-- The switch starts disabled and is enabled from the Inventory UI by an administrator.
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO app_settings (key, value, updated_at)
VALUES ('inventory_auto_writeoff_enabled', '0', datetime('now'))
ON CONFLICT(key) DO NOTHING;
