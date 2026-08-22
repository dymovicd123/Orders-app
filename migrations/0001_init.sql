PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS managers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone_normalized TEXT NOT NULL UNIQUE,
  display_name TEXT,
  city TEXT,
  first_order_at TEXT,
  last_order_at TEXT,
  orders_count INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS catalog_products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL DEFAULT 'adult' CHECK (category IN ('adult', 'child')),
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS catalog_variants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES catalog_products(id) ON DELETE CASCADE,
  gender TEXT,
  color TEXT,
  material TEXT,
  length TEXT,
  size_label TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  external_id TEXT NOT NULL UNIQUE,
  order_date TEXT NOT NULL,
  manager_id INTEGER REFERENCES managers(id),
  customer_id INTEGER REFERENCES customers(id),
  city TEXT,
  delivery_type TEXT,
  source_type TEXT NOT NULL DEFAULT 'warehouse' CHECK (source_type IN ('warehouse', 'boutique')),
  workshop_status TEXT NOT NULL DEFAULT 'in_workshop' CHECK (workshop_status IN ('in_workshop', 'ready', 'shipped', 'cancelled')),
  ready_at TEXT,
  warehouse_received_at TEXT,
  order_status TEXT NOT NULL DEFAULT 'active' CHECK (order_status IN ('active', 'closed', 'archived', 'deleted')),
  total_amount INTEGER NOT NULL DEFAULT 0,
  received_amount INTEGER NOT NULL DEFAULT 0,
  debt_amount INTEGER NOT NULL DEFAULT 0,
  return_amount INTEGER NOT NULL DEFAULT 0,
  comment TEXT,
  archived_month TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES catalog_products(id),
  variant_id INTEGER REFERENCES catalog_variants(id),
  product_name_snapshot TEXT NOT NULL,
  gender_snapshot TEXT,
  color_snapshot TEXT,
  material_snapshot TEXT,
  length_snapshot TEXT,
  size_snapshot TEXT,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price INTEGER NOT NULL DEFAULT 0,
  line_total INTEGER NOT NULL DEFAULT 0,
  is_workshop INTEGER NOT NULL DEFAULT 0,
  source_type TEXT NOT NULL DEFAULT 'warehouse' CHECK (source_type IN ('warehouse', 'boutique')),
  workshop_comment TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  payment_date TEXT NOT NULL,
  method TEXT NOT NULL,
  amount INTEGER NOT NULL,
  payment_kind TEXT NOT NULL DEFAULT 'primary' CHECK (payment_kind IN ('primary', 'debt_close', 'extra')),
  comment TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS returns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  manager_id INTEGER REFERENCES managers(id),
  return_date TEXT NOT NULL,
  amount INTEGER NOT NULL DEFAULT 0,
  comment TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS return_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  return_id INTEGER NOT NULL REFERENCES returns(id) ON DELETE CASCADE,
  order_item_id INTEGER REFERENCES order_items(id),
  product_name_snapshot TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  amount INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS inventory_stock (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inventory_source TEXT NOT NULL CHECK (inventory_source IN ('warehouse', 'boutique')),
  product_id INTEGER REFERENCES catalog_products(id),
  variant_id INTEGER REFERENCES catalog_variants(id),
  product_name_snapshot TEXT NOT NULL,
  gender_snapshot TEXT,
  color_snapshot TEXT,
  material_snapshot TEXT,
  length_snapshot TEXT,
  size_snapshot TEXT,
  quantity INTEGER NOT NULL DEFAULT 0,
  reserved_quantity INTEGER NOT NULL DEFAULT 0,
  last_action TEXT,
  last_source_ref TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS inventory_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inventory_source TEXT NOT NULL CHECK (inventory_source IN ('warehouse', 'boutique')),
  movement_type TEXT NOT NULL CHECK (movement_type IN ('revision', 'arrival', 'sale', 'return', 'manual_set', 'writeoff', 'delete')),
  product_id INTEGER REFERENCES catalog_products(id),
  variant_id INTEGER REFERENCES catalog_variants(id),
  product_name_snapshot TEXT NOT NULL,
  gender_snapshot TEXT,
  color_snapshot TEXT,
  material_snapshot TEXT,
  length_snapshot TEXT,
  size_snapshot TEXT,
  quantity_delta INTEGER NOT NULL,
  quantity_after INTEGER NOT NULL DEFAULT 0,
  reference_type TEXT,
  reference_id TEXT,
  comment TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  manager_id INTEGER REFERENCES managers(id),
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  planned_amount INTEGER NOT NULL DEFAULT 0,
  salary_base INTEGER NOT NULL DEFAULT 0,
  bonus_hit_percent REAL NOT NULL DEFAULT 0,
  bonus_miss_percent REAL NOT NULL DEFAULT 0,
  sales_amount INTEGER NOT NULL DEFAULT 0,
  return_amount INTEGER NOT NULL DEFAULT 0,
  fact_amount INTEGER NOT NULL DEFAULT 0,
  completion_rate REAL NOT NULL DEFAULT 0,
  bonus_amount INTEGER NOT NULL DEFAULT 0,
  total_salary INTEGER NOT NULL DEFAULT 0,
  comment TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS attendance_days (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_date TEXT NOT NULL,
  manager_id INTEGER NOT NULL REFERENCES managers(id),
  start_time TEXT,
  end_time TEXT,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (work_date, manager_id)
);

CREATE INDEX IF NOT EXISTS idx_orders_order_date ON orders(order_date);
CREATE INDEX IF NOT EXISTS idx_orders_manager_id ON orders(manager_id);
CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON orders(customer_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_catalog_variants_unique
  ON catalog_variants(
    product_id,
    COALESCE(gender, ''),
    COALESCE(color, ''),
    COALESCE(material, ''),
    COALESCE(length, ''),
    COALESCE(size_label, '')
  );
CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_stock_unique
  ON inventory_stock(
    inventory_source,
    product_name_snapshot,
    COALESCE(gender_snapshot, ''),
    COALESCE(color_snapshot, ''),
    COALESCE(material_snapshot, ''),
    COALESCE(length_snapshot, ''),
    COALESCE(size_snapshot, '')
  );
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_payments_order_id ON payments(order_id);
CREATE INDEX IF NOT EXISTS idx_returns_order_id ON returns(order_id);
CREATE INDEX IF NOT EXISTS idx_inventory_stock_lookup ON inventory_stock(inventory_source, product_name_snapshot, quantity);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_ref ON inventory_movements(inventory_source, movement_type, reference_type, reference_id);
CREATE INDEX IF NOT EXISTS idx_plans_period ON plans(period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_attendance_work_date ON attendance_days(work_date);
