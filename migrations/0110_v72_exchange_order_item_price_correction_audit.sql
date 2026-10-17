PRAGMA foreign_keys=ON;
-- Immutable record of corrections to the PRICE WRITTEN IN THE ORDER.
-- The exchange's original execution plan and its real money/stock movements
-- remain untouched. Used only for exchange-linked order item corrections.
CREATE TABLE IF NOT EXISTS exchange_order_item_price_corrections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL UNIQUE,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  order_item_id INTEGER NOT NULL REFERENCES order_items(id),
  exchange_id INTEGER NOT NULL REFERENCES exchanges(id),
  original_exchange_unit_price INTEGER NOT NULL CHECK(original_exchange_unit_price >= 0),
  old_unit_price INTEGER NOT NULL CHECK(old_unit_price >= 0),
  new_unit_price INTEGER NOT NULL CHECK(new_unit_price >= 0),
  quantity_at_correction INTEGER NOT NULL CHECK(quantity_at_correction > 0),
  actor_label TEXT NOT NULL,
  corrected_at TEXT NOT NULL,
  CHECK(old_unit_price <> new_unit_price),
  CHECK(length(trim(actor_label)) >= 1)
);
CREATE INDEX IF NOT EXISTS idx_exchange_order_price_lineage
  ON exchange_order_item_price_corrections(exchange_id,order_item_id,id);
CREATE TRIGGER IF NOT EXISTS exchange_order_price_history_immutable_update
BEFORE UPDATE ON exchange_order_item_price_corrections
BEGIN SELECT RAISE(ABORT,'Exchange price correction history is immutable'); END;
CREATE TRIGGER IF NOT EXISTS exchange_order_price_history_immutable_delete
BEFORE DELETE ON exchange_order_item_price_corrections
BEGIN SELECT RAISE(ABORT,'Exchange price correction history is immutable'); END;
