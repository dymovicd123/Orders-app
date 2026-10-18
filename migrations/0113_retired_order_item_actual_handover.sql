-- Retired SKU physical handover is a business confirmation, NOT a stock
-- movement. Physical stock was already removed by catalog retirement.
CREATE TABLE IF NOT EXISTS retired_order_item_issues (
  order_item_id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL,
  retired_variant_id INTEGER NOT NULL,
  quantity INTEGER NOT NULL CHECK(quantity > 0),
  original_writeoff_status TEXT NOT NULL DEFAULT 'catalog_retired',
  confirmed_by TEXT NOT NULL,
  confirmed_at TEXT NOT NULL,
  confirmation_reason TEXT NOT NULL DEFAULT 'physically_delivered_after_catalog_retirement'
  -- No FK: audit must survive administrative order deletion.
);
CREATE INDEX IF NOT EXISTS idx_retired_order_item_issues_order
  ON retired_order_item_issues(order_id, confirmed_at);
