-- Additive, immutable idempotency journal for safe order-only metadata changes
-- following a verified Return V2. No money or stock is stored or reinterpreted.
CREATE TABLE IF NOT EXISTS return_v2_metadata_edits (
  request_id TEXT PRIMARY KEY NOT NULL,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  intent_json TEXT NOT NULL,
  previous_updated_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  actor_label TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_return_v2_metadata_edits_order
 ON return_v2_metadata_edits(order_id, created_at DESC);
