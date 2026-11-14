-- Isolated unified Return V2 posting prototype. NOT enabled in Worker routes.
-- This journal distinguishes contractual cancellation of unissued goods from a physical Return.
-- Its cancellation and versioned money consumers must be implemented before activation.
CREATE TABLE IF NOT EXISTS return_v2_unified_postings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL UNIQUE,
  intent_fingerprint TEXT NOT NULL,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  return_id INTEGER NOT NULL UNIQUE REFERENCES returns(id),
  posted_at TEXT NOT NULL,
  initial_total INTEGER NOT NULL CHECK(initial_total>=0),
  final_total INTEGER NOT NULL CHECK(final_total>=0),
  initial_received INTEGER NOT NULL CHECK(initial_received>=0),
  cash_refund INTEGER NOT NULL CHECK(cash_refund>=0),
  refund_method TEXT,
  full_termination INTEGER NOT NULL CHECK(full_termination IN (0,1)),
  CHECK(initial_total>=final_total)
);
CREATE INDEX IF NOT EXISTS idx_return_v2_unified_postings_order ON return_v2_unified_postings(order_id,id DESC);

CREATE TABLE IF NOT EXISTS return_v2_unified_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  posting_id INTEGER NOT NULL REFERENCES return_v2_unified_postings(id),
  order_item_id INTEGER NOT NULL REFERENCES order_items(id),
  action TEXT NOT NULL CHECK(action IN ('physical_return_pending','cancel_unshipped_reservation','cancel_unresolved_reservation')),
  contracted_quantity INTEGER NOT NULL CHECK(contracted_quantity>0),
  original_line_quantity INTEGER NOT NULL CHECK(original_line_quantity>=contracted_quantity),
  sold_unit_price INTEGER NOT NULL CHECK(sold_unit_price>=0),
  contract_reduction INTEGER NOT NULL CHECK(contract_reduction>=0),
  reservation_id INTEGER REFERENCES inventory_reservations(id),
  reservation_release INTEGER NOT NULL DEFAULT 0 CHECK(reservation_release>=0),
  stock_quantity_change INTEGER NOT NULL DEFAULT 0 CHECK(stock_quantity_change=0),
  UNIQUE(posting_id,order_item_id)
);
CREATE INDEX IF NOT EXISTS idx_return_v2_unified_lines_item ON return_v2_unified_lines(order_item_id);
