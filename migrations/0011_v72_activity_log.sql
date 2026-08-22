PRAGMA foreign_keys = ON;

-- Step 09: единый журнал действий по заказам.
-- Нужен, чтобы видеть создание, редактирование, оплаты, возвраты, обмены,
-- отмены, складовые/цеховые изменения без поиска по разным таблицам.
CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id INTEGER,
  order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  external_order_id TEXT,
  title TEXT NOT NULL,
  details TEXT,
  amount INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_activity_log_created_at ON activity_log(created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_activity_log_order_id ON activity_log(order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_log_entity ON activity_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_event_type ON activity_log(event_type, created_at DESC);
