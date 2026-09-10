-- O1: additive access paths only. No business rows or warehouse rules change.
-- Every finance EXISTS(payment_id) can seek instead of scanning exchange history.
CREATE INDEX IF NOT EXISTS idx_o1_exchanges_payment_finance
  ON exchanges(payment_id, financial_action, status);

-- Match the canonical normalized-time ordering (stored timestamps have mixed formats).
CREATE INDEX IF NOT EXISTS idx_o1_stock_checks_normalized_time
  ON inventory_stock_checks(inventory_source, variant_id, datetime(checked_at) DESC, id DESC, checked_at);

-- Full-stocktake exclusion needs an exact SKU + session lookup, not all SKU checks.
CREATE INDEX IF NOT EXISTS idx_o1_stock_checks_exact_stocktake
  ON inventory_stock_checks(inventory_source, variant_id, reference_id)
  WHERE reference_type = 'stocktake';
