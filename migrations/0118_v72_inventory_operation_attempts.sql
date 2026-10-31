-- Stage 4.2B: separate evidence of a REQUEST attempt, not a physical stock movement.
-- No historical backfill: absent entries never imply success or an employee error.
CREATE TABLE IF NOT EXISTS inventory_operation_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  attempt_key TEXT NOT NULL,
  request_id TEXT,
  operation_type TEXT NOT NULL CHECK(operation_type IN ('arrival','writeoff','manual_set','transfer')),
  outcome TEXT NOT NULL CHECK(outcome IN ('rejected','uncertain','replayed')),
  inventory_source TEXT CHECK(inventory_source IN ('warehouse','boutique')),
  variant_id INTEGER,
  reason_code TEXT NOT NULL,
  reason_message TEXT NOT NULL,
  actor_user_id INTEGER,
  actor_label TEXT,
  recorded_at TEXT NOT NULL,
  UNIQUE(attempt_key,inventory_source,variant_id)
);
CREATE INDEX IF NOT EXISTS idx_inventory_operation_attempts_exact
  ON inventory_operation_attempts(inventory_source,variant_id,id DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_operation_attempts_request
  ON inventory_operation_attempts(request_id,recorded_at DESC);
