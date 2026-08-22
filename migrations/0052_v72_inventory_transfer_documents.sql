-- Step 188H: reliable physical transfers between Warehouse and Boutique.
-- Transfer documents make multi-SKU moves idempotent, grouped and safely reversible.

CREATE TABLE IF NOT EXISTS inventory_transfer_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  external_id TEXT NOT NULL UNIQUE,
  request_id TEXT NOT NULL UNIQUE,
  request_fingerprint TEXT NOT NULL,
  from_source TEXT NOT NULL CHECK (from_source IN ('warehouse', 'boutique')),
  to_source TEXT NOT NULL CHECK (to_source IN ('warehouse', 'boutique')),
  status TEXT NOT NULL DEFAULT 'applied' CHECK (status IN ('applied', 'reversed')),
  comment TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  reversed_by TEXT,
  reversed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_inventory_transfer_documents_created
  ON inventory_transfer_documents (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_transfer_documents_status
  ON inventory_transfer_documents (status, created_at DESC);

CREATE TABLE IF NOT EXISTS inventory_transfer_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transfer_id INTEGER NOT NULL REFERENCES inventory_transfer_documents(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES catalog_products(id),
  variant_id INTEGER NOT NULL REFERENCES catalog_variants(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  from_quantity_before INTEGER NOT NULL,
  from_quantity_after INTEGER NOT NULL,
  to_quantity_before INTEGER NOT NULL,
  to_quantity_after INTEGER NOT NULL,
  source_reserved_quantity INTEGER NOT NULL DEFAULT 0,
  source_shortage_after INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE (transfer_id, variant_id)
);

CREATE INDEX IF NOT EXISTS idx_inventory_transfer_items_variant
  ON inventory_transfer_items (variant_id, transfer_id);
CREATE INDEX IF NOT EXISTS idx_inventory_transfer_items_transfer
  ON inventory_transfer_items (transfer_id, id);
