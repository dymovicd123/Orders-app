-- A never-reserved, never-dispatched item can leave the customer contract
-- without any physical or reserved stock adjustment. Existing journal rows,
-- return history, stock and payments remain unchanged by this schema upgrade.
CREATE TABLE return_v2_unified_lines_next (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  posting_id INTEGER NOT NULL REFERENCES return_v2_unified_postings(id),
  order_item_id INTEGER NOT NULL REFERENCES order_items(id),
  action TEXT NOT NULL CHECK(action IN (
    'physical_return_pending','cancel_unshipped_reservation',
    'cancel_unresolved_reservation','cancel_workshop_obligation',
    'cancel_unreserved_obligation'
  )),
  contracted_quantity INTEGER NOT NULL CHECK(contracted_quantity>0),
  original_line_quantity INTEGER NOT NULL CHECK(original_line_quantity>=contracted_quantity),
  sold_unit_price INTEGER NOT NULL CHECK(sold_unit_price>=0),
  contract_reduction INTEGER NOT NULL CHECK(contract_reduction>=0),
  reservation_id INTEGER REFERENCES inventory_reservations(id),
  reservation_release INTEGER NOT NULL DEFAULT 0 CHECK(reservation_release>=0),
  stock_quantity_change INTEGER NOT NULL DEFAULT 0 CHECK(stock_quantity_change=0),
  receipt_intent TEXT NOT NULL DEFAULT 'pending'
    CHECK(receipt_intent IN ('pending','warehouse','boutique','no_stock','not_applicable')),
  UNIQUE(posting_id,order_item_id)
);
INSERT INTO return_v2_unified_lines_next (
  id,posting_id,order_item_id,action,contracted_quantity,original_line_quantity,
  sold_unit_price,contract_reduction,reservation_id,reservation_release,
  stock_quantity_change,receipt_intent
) SELECT
  id,posting_id,order_item_id,action,contracted_quantity,original_line_quantity,
  sold_unit_price,contract_reduction,reservation_id,reservation_release,
  stock_quantity_change,receipt_intent
FROM return_v2_unified_lines;
DROP TABLE return_v2_unified_lines;
ALTER TABLE return_v2_unified_lines_next RENAME TO return_v2_unified_lines;
CREATE INDEX idx_return_v2_unified_lines_item ON return_v2_unified_lines(order_item_id);
CREATE INDEX idx_return_v2_unified_lines_receipt
  ON return_v2_unified_lines(posting_id,action,receipt_intent);
