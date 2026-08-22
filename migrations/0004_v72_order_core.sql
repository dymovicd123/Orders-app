PRAGMA foreign_keys = ON;

-- v72 order core: creation with item variants, stock write-off, workshop tasks.
ALTER TABLE orders ADD COLUMN shipping_status TEXT NOT NULL DEFAULT 'not_sent' CHECK (shipping_status IN ('not_sent', 'sent'));
ALTER TABLE orders ADD COLUMN shipping_date TEXT;

ALTER TABLE order_items ADD COLUMN audience_type TEXT;
ALTER TABLE order_items ADD COLUMN stock_writeoff_status TEXT NOT NULL DEFAULT 'none';
ALTER TABLE order_items ADD COLUMN stock_quantity_before INTEGER;
ALTER TABLE order_items ADD COLUMN stock_quantity_after INTEGER;

CREATE TABLE IF NOT EXISTS workshop_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  external_order_id TEXT NOT NULL,
  product_id INTEGER REFERENCES catalog_products(id),
  variant_id INTEGER REFERENCES catalog_variants(id),
  product_name_snapshot TEXT NOT NULL,
  gender_snapshot TEXT,
  color_snapshot TEXT,
  material_snapshot TEXT,
  length_snapshot TEXT,
  size_snapshot TEXT,
  quantity INTEGER NOT NULL DEFAULT 1,
  comment TEXT,
  urgent INTEGER NOT NULL DEFAULT 0,
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ready', 'done', 'cancelled')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_workshop_tasks_status ON workshop_tasks(status, created_at);
CREATE INDEX IF NOT EXISTS idx_workshop_tasks_order_id ON workshop_tasks(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_variant_id ON order_items(variant_id);
CREATE INDEX IF NOT EXISTS idx_inventory_stock_variant_lookup ON inventory_stock(inventory_source, variant_id);
