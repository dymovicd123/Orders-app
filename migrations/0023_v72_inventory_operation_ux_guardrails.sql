-- Step 20: inventory operation UX guardrails.
-- No schema change is required.
-- Backend logic now prevents writeoff/manual-set/transfer from creating new inventory variants.
-- Arrival remains the only manual operation that can create new products/variants.

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO app_settings (key, value, updated_at)
VALUES ('step20_inventory_operation_ux_guardrails', 'applied', datetime('now'))
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;
