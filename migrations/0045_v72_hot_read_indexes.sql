-- Step 173: supporting indexes for the remaining D1 read hotspots.
-- These indexes do not change business data or query results.
-- They make exchange-linked Workshop reads use persistent indexes instead of
-- rebuilding/scanning exchange rows during every list/count request.

CREATE INDEX IF NOT EXISTS idx_exchanges_new_order_item_status_date
  ON exchanges(new_order_item_id, status, exchange_date);

CREATE INDEX IF NOT EXISTS idx_exchanges_refund_return_status
  ON exchanges(refund_return_id, status);

PRAGMA optimize;
