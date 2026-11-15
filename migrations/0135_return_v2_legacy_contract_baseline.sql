-- Compatibility journal for historical completed Return V1 records.
-- The original returns, return_items, receipts, payments, and stock are never
-- rewritten. On the first Return V2, proven old physical returns are removed
-- from the customer contract exactly once in the SAME atomic transaction.
-- All changes to the old customer contract are separately journalled.
CREATE TABLE IF NOT EXISTS return_v2_legacy_baselines (
  posting_id INTEGER PRIMARY KEY REFERENCES return_v2_unified_postings(id),
  order_id INTEGER NOT NULL REFERENCES orders(id),
  original_sale INTEGER NOT NULL CHECK(original_sale>=0),
  normalized_sale INTEGER NOT NULL CHECK(normalized_sale>=0),
  reduction INTEGER NOT NULL CHECK(reduction>=0),
  CHECK(original_sale-normalized_sale=reduction)
);
CREATE TABLE IF NOT EXISTS return_v2_legacy_baseline_returns (
  return_id INTEGER PRIMARY KEY REFERENCES returns(id),
  posting_id INTEGER NOT NULL REFERENCES return_v2_unified_postings(id),
  order_id INTEGER NOT NULL REFERENCES orders(id),
  original_cash_refund INTEGER NOT NULL CHECK(original_cash_refund>=0)
);
CREATE INDEX IF NOT EXISTS idx_return_v2_legacy_returns_posting
  ON return_v2_legacy_baseline_returns(posting_id);
CREATE TABLE IF NOT EXISTS return_v2_legacy_baseline_items (
  return_item_id INTEGER PRIMARY KEY REFERENCES return_items(id),
  posting_id INTEGER NOT NULL REFERENCES return_v2_unified_postings(id),
  order_item_id INTEGER NOT NULL REFERENCES order_items(id),
  quantity INTEGER NOT NULL CHECK(quantity>0),
  sold_unit_price INTEGER NOT NULL CHECK(sold_unit_price>=0),
  reduction INTEGER NOT NULL CHECK(reduction>=0),
  CHECK(reduction=quantity*sold_unit_price)
);
CREATE INDEX IF NOT EXISTS idx_return_v2_legacy_items_posting
  ON return_v2_legacy_baseline_items(posting_id);
