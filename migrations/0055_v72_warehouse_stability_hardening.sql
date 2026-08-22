-- Step 188K: warehouse stability + retry safety for manual inventory operations.
-- Additive only. Does not alter current physical quantities or reservations.

CREATE TABLE IF NOT EXISTS inventory_operation_request_fingerprints (
  operation_id TEXT PRIMARY KEY REFERENCES inventory_operations(operation_id) ON DELETE CASCADE,
  request_fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_inventory_operation_request_fingerprints_created
  ON inventory_operation_request_fingerprints(created_at DESC);
