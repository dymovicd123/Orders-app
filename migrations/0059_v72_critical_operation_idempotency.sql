-- Step 190.1: retry-safe critical business operations.
-- This is additive only. Existing orders/returns/exchanges/inventory are not rewritten.

CREATE TABLE IF NOT EXISTS critical_operations (
  request_id TEXT PRIMARY KEY,
  operation_type TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'started' CHECK(status IN ('started', 'completed')),
  step TEXT NOT NULL DEFAULT 'started',
  target_type TEXT,
  target_id INTEGER,
  target_ref TEXT,
  context_json TEXT,
  response_json TEXT,
  lease_token TEXT,
  lease_until_ms INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_critical_operations_status_updated
  ON critical_operations(status, updated_at);

CREATE TABLE IF NOT EXISTS critical_operation_entities (
  request_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_key TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(request_id, entity_type, entity_key),
  FOREIGN KEY(request_id) REFERENCES critical_operations(request_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_critical_operation_entities_entity
  ON critical_operation_entities(entity_type, entity_id);
