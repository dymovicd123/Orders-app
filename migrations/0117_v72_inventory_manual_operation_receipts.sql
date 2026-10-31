-- Stage 4.2A: one durable, immutable performer receipt for each completed manual
-- inventory operation. Inserted in the same D1 transaction as physical movements.
-- Legacy movements deliberately have no receipt: their performer is unknown.
CREATE TABLE IF NOT EXISTS inventory_manual_operation_receipts (
  operation_id TEXT PRIMARY KEY REFERENCES inventory_operations(operation_id),
  actor_user_id INTEGER,
  actor_label TEXT,
  recorded_at TEXT NOT NULL,
  CHECK (actor_user_id IS NULL OR actor_user_id > 0)
);
