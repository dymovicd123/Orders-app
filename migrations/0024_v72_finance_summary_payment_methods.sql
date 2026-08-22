PRAGMA foreign_keys = ON;

-- Step 21: separate Finance workspace.
-- No destructive schema changes: payment methods remain in reference_values(kind='payment_method'),
-- but UI ownership moves from Справочники to Финансы.
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO reference_values (kind, value, is_active, sort_order, created_at, updated_at)
VALUES
  ('payment_method', 'КАСПИ МАГАЗИН', 1, 10, datetime('now'), datetime('now')),
  ('payment_method', 'НАЛИЧКА', 1, 20, datetime('now'), datetime('now')),
  ('payment_method', 'ТЕРМИНАЛ', 1, 30, datetime('now'), datetime('now')),
  ('payment_method', 'ХАЛЫК ПЕРЕВОД', 1, 40, datetime('now'), datetime('now')),
  ('payment_method', 'KASPI PAY', 1, 50, datetime('now'), datetime('now'))
ON CONFLICT(kind, value) DO UPDATE SET
  is_active = excluded.is_active,
  updated_at = excluded.updated_at;

INSERT INTO app_settings (key, value, updated_at)
VALUES ('step21_finance_summary_payment_methods', 'applied', datetime('now'))
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;
