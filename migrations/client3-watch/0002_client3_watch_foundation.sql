-- CLIENT3 ONLY: extension of the existing client3_old_client D1.
-- Never run against orders_db_prod or orders_db_branch2.
-- Additive schema: no customer/order/stock/payment row backfill or deletion.
CREATE TABLE IF NOT EXISTS watch_brands (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE CHECK (code IN ('TAUWACH','WACHIZEN')),
  name TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1))
);
INSERT OR IGNORE INTO watch_brands (code,name) VALUES ('TAUWACH','TAUWACH'),('WACHIZEN','WACHIZEN');

CREATE TABLE IF NOT EXISTS watch_manager_brands (
  manager_id INTEGER NOT NULL REFERENCES managers(id) ON DELETE CASCADE,
  brand_id INTEGER NOT NULL REFERENCES watch_brands(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (manager_id,brand_id)
);
CREATE INDEX IF NOT EXISTS idx_watch_manager_brands_brand ON watch_manager_brands(brand_id,manager_id);

-- Separate outward-facing watch model name from globally UNIQUE legacy catalog_products.name.
-- A canonical catalog_product_id / catalog_variant_id maps back to the trusted Main
-- inventory, reserves, issue, Return and Exchange ledger; do not create sales without it.
CREATE TABLE IF NOT EXISTS watch_products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  brand_id INTEGER NOT NULL REFERENCES watch_brands(id),
  model_name TEXT NOT NULL CHECK (length(trim(model_name))>0),
  catalog_product_id INTEGER UNIQUE REFERENCES catalog_products(id),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (brand_id, model_name COLLATE NOCASE)
);
CREATE INDEX IF NOT EXISTS idx_watch_products_brand ON watch_products(brand_id,is_active,model_name);

CREATE TABLE IF NOT EXISTS watch_variants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  watch_product_id INTEGER NOT NULL REFERENCES watch_products(id) ON DELETE RESTRICT,
  catalog_variant_id INTEGER UNIQUE REFERENCES catalog_variants(id),
  gender TEXT NOT NULL CHECK (gender IN ('male','female')),
  movement TEXT NOT NULL CHECK (movement IN ('quartz','mechanical')),
  bracelet_material TEXT NOT NULL CHECK (bracelet_material IN ('steel','leather','rubber')),
  dial_color TEXT NOT NULL CHECK (
    dial_color IN ('black','white','silver','gold','green','orange','brown','multicolor')
  ),
  bracelet_color TEXT NOT NULL DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (
    (bracelet_material='leather' AND length(trim(bracelet_color))>0)
    OR (bracelet_material<>'leather' AND bracelet_color='')
  ),
  UNIQUE (watch_product_id,gender,movement,bracelet_material,dial_color,bracelet_color)
);
CREATE INDEX IF NOT EXISTS idx_watch_variants_product ON watch_variants(watch_product_id,is_active);

-- An order always belongs to exactly one brand; manager entitlement is enforced
-- against watch_manager_brands in the server handler, never by client filters alone.
CREATE TABLE IF NOT EXISTS watch_order_details (
  order_id INTEGER PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,
  brand_id INTEGER NOT NULL REFERENCES watch_brands(id),
  recipient_name TEXT NOT NULL CHECK (length(trim(recipient_name))>0),
  recipient_phone TEXT NOT NULL CHECK (length(trim(recipient_phone))>0),
  delivery_full_address TEXT NOT NULL CHECK (length(trim(delivery_full_address))>0),
  postal_code TEXT NOT NULL CHECK (length(trim(postal_code))>0),
  city TEXT NOT NULL CHECK (length(trim(city))>0),
  delivery_method TEXT NOT NULL CHECK (length(trim(delivery_method))>0),
  urgent INTEGER NOT NULL DEFAULT 0 CHECK (urgent IN (0,1)),
  shipping_deadline_at TEXT NOT NULL CHECK (strftime('%s',shipping_deadline_at) IS NOT NULL),
  deadline_timezone TEXT NOT NULL DEFAULT 'Asia/Almaty' CHECK (deadline_timezone='Asia/Almaty'),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_watch_order_details_brand_deadline
  ON watch_order_details(brand_id,shipping_deadline_at,urgent);
CREATE TRIGGER IF NOT EXISTS trg_watch_order_brand_immutable
  BEFORE UPDATE OF brand_id ON watch_order_details
  WHEN NEW.brand_id<>OLD.brand_id
BEGIN
  SELECT RAISE(ABORT,'watch_order_brand_immutable');
END;

-- Engraving is per SOLD item, not a reusable physical SKU attribute.
CREATE TABLE IF NOT EXISTS watch_order_item_details (
  order_item_id INTEGER PRIMARY KEY REFERENCES order_items(id) ON DELETE CASCADE,
  watch_variant_id INTEGER NOT NULL REFERENCES watch_variants(id),
  engraving_text TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_watch_order_item_details_variant
  ON watch_order_item_details(watch_variant_id);

-- "Ready" means engraving prepared, NOT shipped, paid, received or stock decremented.
CREATE TABLE IF NOT EXISTS watch_logistics_jobs (
  order_id INTEGER PRIMARY KEY REFERENCES watch_order_details(order_id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','engraving','ready')),
  ready_at TEXT,
  ready_by_user_id INTEGER REFERENCES app_users(id),
  ready_request_id TEXT UNIQUE,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK ((status='ready' AND ready_at IS NOT NULL) OR (status<>'ready' AND ready_at IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_watch_logistics_status
  ON watch_logistics_jobs(status,updated_at);

CREATE TABLE IF NOT EXISTS watch_logistics_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES watch_order_details(order_id),
  actor_user_id INTEGER REFERENCES app_users(id),
  previous_status TEXT,
  next_status TEXT NOT NULL CHECK (next_status IN ('pending','engraving','ready')),
  note TEXT,
  request_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_watch_logistics_events_order
  ON watch_logistics_events(order_id,id);
CREATE TRIGGER IF NOT EXISTS trg_watch_logistics_events_no_update
  BEFORE UPDATE ON watch_logistics_events BEGIN
  SELECT RAISE(ABORT,'immutable_watch_logistics_audit');
END;
CREATE TRIGGER IF NOT EXISTS trg_watch_logistics_events_no_delete
  BEFORE DELETE ON watch_logistics_events BEGIN
  SELECT RAISE(ABORT,'immutable_watch_logistics_audit');
END;
