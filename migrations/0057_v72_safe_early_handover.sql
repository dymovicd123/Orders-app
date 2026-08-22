-- Step 188K.3: safe early handover and delayed-order reconciliation.
-- Additive only. No existing stock, reservation, order, workshop, payment, return, exchange or stocktake row is changed by this migration.
-- Each row stores one explicit human answer about where one stock item physically was during one completed revision/check.

CREATE TABLE IF NOT EXISTS inventory_handover_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  order_item_id INTEGER NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  reservation_id INTEGER NOT NULL REFERENCES inventory_reservations(id) ON DELETE CASCADE,
  decision TEXT NOT NULL CHECK (decision IN ('still_here', 'issued_before_checkpoint')),
  checkpoint_id INTEGER NOT NULL,
  checkpoint_type TEXT NOT NULL,
  checkpoint_at TEXT NOT NULL,
  reviewed_by TEXT,
  reviewed_at TEXT NOT NULL,
  UNIQUE(order_item_id, checkpoint_id)
);

CREATE INDEX IF NOT EXISTS idx_inventory_handover_reviews_order
  ON inventory_handover_reviews(order_id, order_item_id, checkpoint_at DESC, checkpoint_id DESC);

CREATE INDEX IF NOT EXISTS idx_inventory_handover_reviews_checkpoint
  ON inventory_handover_reviews(checkpoint_at DESC, checkpoint_id DESC, id DESC);

-- Existing meta row used only as a deterministic CAS collision target inside reconciliation batches.
INSERT OR IGNORE INTO inventory_model_meta (key, value, updated_at)
VALUES ('safe_early_handover_v1_guard', 'ready', strftime('%Y-%m-%dT%H:%M:%fZ','now'));
