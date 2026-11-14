-- Isolated reversal of a unified Return/Cancel V2 contract posting.
-- Restoring an unshipped reservation never creates physical stock.
-- Cancellation is allowed only while no shipped return has been physically received.
CREATE TABLE IF NOT EXISTS return_v2_unified_cancellations (
  posting_id INTEGER PRIMARY KEY REFERENCES return_v2_unified_postings(id),
  request_id TEXT NOT NULL UNIQUE,
  return_id INTEGER NOT NULL UNIQUE REFERENCES returns(id),
  order_id INTEGER NOT NULL REFERENCES orders(id),
  cancelled_at TEXT NOT NULL,
  reason TEXT NOT NULL,
  shipped_goods_unreceived_confirmed INTEGER NOT NULL CHECK(shipped_goods_unreceived_confirmed IN (0,1)),
  reservations_restore_confirmed INTEGER NOT NULL CHECK(reservations_restore_confirmed IN (0,1)),
  refund_recovered_at TEXT,
  recovery_method TEXT,
  reversed_amount INTEGER NOT NULL CHECK(reversed_amount>=0),
  initial_total INTEGER NOT NULL CHECK(initial_total>=0),
  initial_received INTEGER NOT NULL CHECK(initial_received>=0)
);
CREATE INDEX IF NOT EXISTS idx_return_v2_unified_cancellations_order
 ON return_v2_unified_cancellations(order_id, cancelled_at DESC);
