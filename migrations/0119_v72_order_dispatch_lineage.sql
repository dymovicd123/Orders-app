-- Stage 5: durable selective shipment lineage. Empty on creation: old global
-- "sent" rows are not silently backfilled into fictitious shipment batches.
-- This schema does not by itself switch existing shipping writes.
CREATE TABLE IF NOT EXISTS order_dispatches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  request_id TEXT NOT NULL UNIQUE,
  dispatch_date TEXT NOT NULL,
  created_at TEXT NOT NULL,
  actor TEXT,
  status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','partially_cancelled','cancelled')),
  cancelled_at TEXT,
  cancel_actor TEXT,
  note TEXT
);
CREATE INDEX IF NOT EXISTS idx_order_dispatches_order
  ON order_dispatches(order_id, id DESC);

CREATE TABLE IF NOT EXISTS order_dispatch_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dispatch_id INTEGER NOT NULL REFERENCES order_dispatches(id),
  order_item_id INTEGER NOT NULL REFERENCES order_items(id),
  source_type TEXT NOT NULL CHECK (source_type IN ('warehouse','boutique','workshop')),
  variant_id INTEGER REFERENCES catalog_variants(id),
  reservation_id INTEGER REFERENCES inventory_reservations(id),
  movement_id INTEGER REFERENCES inventory_movements(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  cancelled_quantity INTEGER NOT NULL DEFAULT 0 CHECK (cancelled_quantity >= 0 AND cancelled_quantity <= quantity),
  created_at TEXT NOT NULL,
  UNIQUE(dispatch_id,order_item_id)
);
CREATE INDEX IF NOT EXISTS idx_order_dispatch_items_item
  ON order_dispatch_items(order_item_id, dispatch_id);
CREATE INDEX IF NOT EXISTS idx_order_dispatch_items_reservation
  ON order_dispatch_items(reservation_id);

-- Each correction is a new, append-only event. The original shipment and its
-- original SKU/source/quantity are retained even after a cancelled issue.
CREATE TABLE IF NOT EXISTS order_dispatch_corrections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dispatch_item_id INTEGER NOT NULL REFERENCES order_dispatch_items(id),
  request_id TEXT NOT NULL UNIQUE,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  stock_restored INTEGER NOT NULL CHECK (stock_restored IN (0,1)),
  reason TEXT NOT NULL,
  actor TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_order_dispatch_corrections_item
  ON order_dispatch_corrections(dispatch_item_id,id DESC);
