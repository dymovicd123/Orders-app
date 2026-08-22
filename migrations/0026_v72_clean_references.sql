PRAGMA foreign_keys = ON;

-- Step 23: чистые справочники.
-- Менеджеры берутся из "Команды", товары из "Склад → Товары", способы оплаты из "Финансов".
-- В справочниках остаются только вспомогательные списки для форм.

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO reference_values (kind, value, is_active, sort_order, created_at, updated_at)
VALUES
  ('product_type', 'ШАПАН', 1, 1, datetime('now'), datetime('now')),
  ('product_type', 'КАМЗОЛ', 1, 2, datetime('now'), datetime('now')),
  ('product_type', 'КОМПЛЕКТ', 1, 3, datetime('now'), datetime('now')),
  ('product_type', 'БАС КИІМ', 1, 4, datetime('now'), datetime('now')),
  ('product_type', 'БЕЛДІК', 1, 5, datetime('now'), datetime('now')),
  ('return_reason', 'НЕ ПОДОШЁЛ РАЗМЕР', 1, 1, datetime('now'), datetime('now')),
  ('return_reason', 'ОБМЕН', 1, 2, datetime('now'), datetime('now')),
  ('return_reason', 'ОТКАЗ КЛИЕНТА', 1, 3, datetime('now'), datetime('now')),
  ('return_reason', 'БРАК', 1, 4, datetime('now'), datetime('now')),
  ('return_reason', 'ОШИБКА ЗАКАЗА', 1, 5, datetime('now'), datetime('now')),
  ('writeoff_reason', 'БРАК', 1, 1, datetime('now'), datetime('now')),
  ('writeoff_reason', 'ПОРЧА', 1, 2, datetime('now'), datetime('now')),
  ('writeoff_reason', 'ПОТЕРЯ', 1, 3, datetime('now'), datetime('now')),
  ('writeoff_reason', 'РЕВИЗИЯ', 1, 4, datetime('now'), datetime('now')),
  ('writeoff_reason', 'ДРУГОЕ', 1, 5, datetime('now'), datetime('now'))
ON CONFLICT(kind, value) DO UPDATE SET
  is_active = excluded.is_active,
  sort_order = excluded.sort_order,
  updated_at = excluded.updated_at;

INSERT INTO app_settings (key, value, updated_at)
VALUES ('reference_model', 'clean_references_v1', datetime('now'))
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;
