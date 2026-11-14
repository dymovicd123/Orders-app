-- Experimental Return V2 cancellation ledger. Additive; no live handler writes this.
-- One cancellation per posted V2 Return; request_id is unique across operations.
-- The record and its linked refund reversal must be inserted in the same D1 batch.
CREATE TABLE IF NOT EXISTS return_v2_cancellations (
  preparation_id INTEGER PRIMARY KEY REFERENCES return_v2_postings(preparation_id),
  request_id TEXT NOT NULL UNIQUE,
  return_id INTEGER NOT NULL UNIQUE REFERENCES returns(id),
  order_id INTEGER NOT NULL REFERENCES orders(id),
  cancelled_at TEXT NOT NULL,
  reason TEXT NOT NULL,
  reversed_amount INTEGER NOT NULL CHECK (reversed_amount >= 0),
  original_contract_total INTEGER NOT NULL CHECK (original_contract_total >= 0),
  original_paid_in INTEGER NOT NULL CHECK (original_paid_in >= 0)
);
CREATE INDEX IF NOT EXISTS idx_return_v2_cancellations_order
 ON return_v2_cancellations(order_id, cancelled_at DESC);
