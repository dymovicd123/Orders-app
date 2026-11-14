-- Return V2 posting prototype: additive evidence only, not activated in Worker HTTP.
-- Snapshot versions are captured by the prepared step for a future posting CAS.
ALTER TABLE return_v2_prepared_operations ADD COLUMN baseline_order_updated_at TEXT;
ALTER TABLE return_v2_prepared_items ADD COLUMN baseline_order_item_quantity INTEGER
 CHECK (baseline_order_item_quantity IS NULL OR baseline_order_item_quantity > 0);

-- Posting is tracked separately: earlier 0124 keeps its immutable 'prepared' status.
-- One preparation can produce exactly one Return; a retry can only read it.
CREATE TABLE IF NOT EXISTS return_v2_postings (
  preparation_id INTEGER PRIMARY KEY REFERENCES return_v2_prepared_operations(id),
  return_id INTEGER NOT NULL UNIQUE REFERENCES returns(id),
  order_id INTEGER NOT NULL REFERENCES orders(id),
  posted_at TEXT NOT NULL,
  contract_total_after INTEGER NOT NULL CHECK(contract_total_after >= 0),
  net_held_after INTEGER NOT NULL CHECK(net_held_after >= 0)
);
CREATE INDEX IF NOT EXISTS idx_return_v2_postings_order
 ON return_v2_postings(order_id,posted_at DESC);
