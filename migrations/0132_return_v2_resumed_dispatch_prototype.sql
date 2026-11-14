-- Isolated, opt-in shipment of a proven restored UN-SHIPPED reservation.
-- The authoritative dispatch header, movement and this journal commit in one batch.
-- No original V2 Return, debt, cash, or cancelled return-item is modified.
CREATE TABLE IF NOT EXISTS return_v2_resumed_dispatches (
  request_id TEXT PRIMARY KEY REFERENCES order_dispatches(request_id),
  posting_id INTEGER NOT NULL REFERENCES return_v2_unified_postings(id),
  order_id INTEGER NOT NULL REFERENCES orders(id),
  order_item_id INTEGER NOT NULL REFERENCES order_items(id),
  quantity INTEGER NOT NULL CHECK(quantity > 0),
  expected_order_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(posting_id,order_item_id)
);
CREATE INDEX IF NOT EXISTS idx_return_v2_resumed_dispatches_order
 ON return_v2_resumed_dispatches(order_id,created_at DESC);
