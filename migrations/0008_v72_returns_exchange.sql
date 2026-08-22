PRAGMA foreign_keys = ON;

-- Step 06: stronger returns and size/product exchange flow.
-- Existing `returns` and `return_items` tables came from the first schema.
-- These columns make returns item-aware and allow optional stock restock.
ALTER TABLE return_items ADD COLUMN inventory_source TEXT;
ALTER TABLE return_items ADD COLUMN restocked INTEGER NOT NULL DEFAULT 0;
ALTER TABLE return_items ADD COLUMN gender_snapshot TEXT;
ALTER TABLE return_items ADD COLUMN color_snapshot TEXT;
ALTER TABLE return_items ADD COLUMN material_snapshot TEXT;
ALTER TABLE return_items ADD COLUMN length_snapshot TEXT;
ALTER TABLE return_items ADD COLUMN size_snapshot TEXT;

CREATE TABLE IF NOT EXISTS exchanges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  manager_id INTEGER REFERENCES managers(id),
  exchange_date TEXT NOT NULL,
  old_order_item_id INTEGER REFERENCES order_items(id),
  old_quantity INTEGER NOT NULL DEFAULT 1,
  old_return_source TEXT CHECK (old_return_source IN ('none', 'warehouse', 'boutique')) DEFAULT 'none',
  new_order_item_id INTEGER REFERENCES order_items(id),
  new_source_type TEXT NOT NULL DEFAULT 'warehouse' CHECK (new_source_type IN ('warehouse', 'boutique', 'workshop')),
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'cancelled')),
  comment TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS exchange_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exchange_id INTEGER NOT NULL REFERENCES exchanges(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('old', 'new')),
  order_item_id INTEGER REFERENCES order_items(id),
  product_name_snapshot TEXT NOT NULL,
  gender_snapshot TEXT,
  color_snapshot TEXT,
  material_snapshot TEXT,
  length_snapshot TEXT,
  size_snapshot TEXT,
  quantity INTEGER NOT NULL DEFAULT 1,
  inventory_source TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_exchanges_order_id ON exchanges(order_id, exchange_date);
CREATE INDEX IF NOT EXISTS idx_exchange_items_exchange_id ON exchange_items(exchange_id);
CREATE INDEX IF NOT EXISTS idx_return_items_return_id ON return_items(return_id);
