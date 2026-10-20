-- STRICT FRESH-ONLY audit schema. Exact DDL/index layout from SELECT-only
-- live production schema read 2026-10-20 GH run 39465177349.
-- Never alter/drop existing audit records; do not apply to production.
CREATE TABLE IF NOT EXISTS order_manager_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  external_id TEXT NOT NULL,
  previous_manager_id INTEGER,
  previous_manager_name TEXT,
  new_manager_id INTEGER,
  new_manager_name TEXT,
  action TEXT NOT NULL,
  source TEXT NOT NULL,
  actor_role TEXT,
  actor_label TEXT,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_order_manager_audit_external
  ON order_manager_audit(external_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_order_manager_audit_order
  ON order_manager_audit(order_id, created_at DESC, id DESC);
