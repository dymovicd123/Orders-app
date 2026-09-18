import { DatabaseSync } from 'node:sqlite'
import { listInventoryLifecyclePending } from '../worker/domains/lifecycle.ts'

const check = (condition, message) => { if (!condition) throw new Error(message) }

class Statement {
  constructor(db, sql, bindings = []) { this.db = db; this.sql = sql; this.bindings = bindings }
  bind(...bindings) { return new Statement(this.db, this.sql, bindings) }
  async all() { return { results: this.db.prepare(this.sql).all(...this.bindings) } }
  async first() { return this.db.prepare(this.sql).get(...this.bindings) ?? null }
}
class TestD1 {
  constructor() { this.sqlite = new DatabaseSync(':memory:') }
  prepare(sql) { return new Statement(this.sqlite, sql) }
}

const db = new TestD1()
db.sqlite.exec(`
  CREATE TABLE catalog_products (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'adult',
    is_active INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE catalog_variants (
    id INTEGER PRIMARY KEY,
    product_id INTEGER NOT NULL,
    category TEXT,
    gender TEXT,
    color TEXT,
    material TEXT,
    length TEXT,
    size_label TEXT,
    is_active INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE orders (
    id INTEGER PRIMARY KEY,
    external_id TEXT,
    order_date TEXT
  );
  CREATE TABLE order_items (
    id INTEGER PRIMARY KEY,
    order_id INTEGER NOT NULL,
    product_id INTEGER,
    variant_id INTEGER
  );
  CREATE TABLE inventory_lifecycle_events (
    id INTEGER PRIMARY KEY,
    event_key TEXT,
    event_type TEXT,
    direction TEXT,
    operation_type TEXT,
    operation_id INTEGER,
    order_id INTEGER NOT NULL,
    order_item_id INTEGER,
    inventory_source TEXT,
    quantity INTEGER,
    product_id INTEGER,
    variant_id INTEGER,
    product_name_snapshot TEXT,
    audience_type TEXT,
    gender_snapshot TEXT,
    color_snapshot TEXT,
    material_snapshot TEXT,
    length_snapshot TEXT,
    size_snapshot TEXT,
    is_workshop INTEGER,
    status TEXT,
    pending_reason TEXT,
    created_at TEXT
  );

  INSERT INTO catalog_products(id, name, category, is_active) VALUES
    (1, 'КАНОН ТОВАР', 'adult', 1),
    (2, 'ДРУГОЙ ТОВАР', 'adult', 1);
  INSERT INTO catalog_variants(id, product_id, category, gender, color, material, length, size_label, is_active) VALUES
    (101, 1, 'adult', 'ЖЕН', 'КРАСНЫЙ', 'СТАНДАРТ', 'СТАНДАРТ', '46', 1),
    (102, 1, 'adult', 'ЖЕН', 'СИНИЙ', 'СТАНДАРТ', 'СТАНДАРТ', '48', 1);
  INSERT INTO orders(id, external_id, order_date) VALUES
    (1, 'ORD-1', '2026-09-18'),
    (2, 'ORD-2', '2026-09-18'),
    (3, 'ORD-3', '2026-09-18'),
    (4, 'ORD-4', '2026-09-18'),
    (5, 'ORD-5', '2026-09-18');
  INSERT INTO order_items(id, order_id, product_id, variant_id) VALUES
    (11, 1, 1, 101),
    (12, 2, 1, NULL),
    (13, 3, 1, NULL),
    (14, 4, 2, NULL),
    (15, 5, 1, 101);

  -- Exact inbound through the repaired/current order_item variant: Warehouse Attention owns it.
  INSERT INTO inventory_lifecycle_events VALUES
    (1, 'e1', 'return_in', 'in', 'return', 1, 1, 11, 'warehouse', 1, 1, NULL,
     'СТАРОЕ ИМЯ', 'adult', 'ЖЕН', 'КРАСНЫЙ', 'СТАНДАРТ', 'СТАНДАРТ', '46', 0, 'pending', 'variant', '2026-09-18T01:00:00Z');

  -- Exact inbound through event.variant_id: also normal known intake.
  INSERT INTO inventory_lifecycle_events VALUES
    (2, 'e2', 'exchange_old_in', 'in', 'exchange', 2, 2, 12, 'warehouse', 1, 1, 102,
     'СТАРОЕ ИМЯ', 'adult', 'ЖЕН', 'СИНИЙ', 'СТАНДАРТ', 'СТАНДАРТ', '48', 0, 'pending', 'variant', '2026-09-18T02:00:00Z');

  -- Exact inbound recovered only from product + event-time SKU facts: still known intake.
  INSERT INTO inventory_lifecycle_events VALUES
    (3, 'e3', 'return_in', 'in', 'return', 3, 3, 13, 'warehouse', 1, 1, NULL,
     'СТАРОЕ ИМЯ', 'adult', 'ЖЕН', 'КРАСНЫЙ', 'СТАНДАРТ', 'СТАНДАРТ', '46', 0, 'pending', 'variant', '2026-09-18T03:00:00Z');

  -- No exact SKU exists for this product/facts: manual lifecycle queue must keep it.
  INSERT INTO inventory_lifecycle_events VALUES
    (4, 'e4', 'return_in', 'in', 'return', 4, 4, 14, 'warehouse', 1, 2, NULL,
     'НЕИЗВЕСТНЫЙ', 'adult', 'МУЖ', 'ЗЕЛЁНЫЙ', 'СТАНДАРТ', 'СТАНДАРТ', '60', 0, 'pending', 'variant', '2026-09-18T04:00:00Z');

  -- Outgoing physical movement remains manual even when identity is exact.
  INSERT INTO inventory_lifecycle_events VALUES
    (5, 'e5', 'exchange_new_out', 'out', 'exchange', 5, 5, 15, 'warehouse', 1, 1, 101,
     'ИСТОРИЧЕСКОЕ ИМЯ', 'adult', 'ЖЕН', 'КРАСНЫЙ', 'СТАНДАРТ', 'СТАНДАРТ', '46', 0, 'pending', NULL, '2026-09-18T05:00:00Z');
`)

const result = await listInventoryLifecyclePending(db, new URL('https://qa.local/api/inventory/lifecycle/pending?limit=60'))
check(result.ok === true, 'Manual lifecycle queue did not load')
check(result.count === 2, 'Manual lifecycle count still includes exact known inbound rows')
check(result.items.length === 2, 'Manual lifecycle item list still duplicates known intake')
check(result.items.map((row) => row.id).join(',') === '4,5', 'Manual lifecycle queue removed the wrong rows')
check(result.items[0].productName === 'НЕИЗВЕСТНЫЙ', 'Unresolved lifecycle evidence snapshot was not preserved')
check(result.items[1].direction === 'out', 'Exact outgoing movement was incorrectly hidden with known inbound intake')

const ids = db.sqlite.prepare("SELECT id FROM inventory_lifecycle_events WHERE status = 'pending' ORDER BY id").all().map((row) => row.id)
check(ids.join(',') === '1,2,3,4,5', 'Listing the manual queue mutated lifecycle history')

console.log('STAGE01 LIFECYCLE MANUAL QUEUE R21 PASSED — exact known inbound is owned by Warehouse Attention, while unresolved and outgoing lifecycle work remains in the admin queue')
