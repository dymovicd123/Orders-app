import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

const source = readFileSync('worker/domains/warehouse-attention.ts', 'utf8')
const match = source.match(/db\.prepare\(\s*`(WITH reservation_totals AS \([\s\S]*?LIMIT \?)`\s*\)\.bind\(shortageFetchLimit\)/)
assert(match, 'Missing real shortage detail SQL')
const sql = match[1]
const db = new DatabaseSync(':memory:')
db.exec(`
 CREATE TABLE inventory_reservations (id INTEGER PRIMARY KEY, order_id INTEGER, order_item_id INTEGER, inventory_source TEXT, variant_id INTEGER, status TEXT, quantity INTEGER);
 CREATE TABLE inventory_stock (id INTEGER PRIMARY KEY, inventory_source TEXT, variant_id INTEGER, product_id INTEGER, product_name_snapshot TEXT, gender_snapshot TEXT, color_snapshot TEXT, material_snapshot TEXT, length_snapshot TEXT, size_snapshot TEXT, quantity INTEGER);
 CREATE TABLE catalog_products (id INTEGER PRIMARY KEY, name TEXT);
 CREATE TABLE catalog_variants (id INTEGER PRIMARY KEY, product_id INTEGER, category TEXT, gender TEXT, color TEXT, material TEXT, length TEXT, size_label TEXT);
 CREATE TABLE orders (id INTEGER PRIMARY KEY, external_id TEXT, order_date TEXT, order_status TEXT, archived_at TEXT);
 CREATE TABLE order_items (id INTEGER PRIMARY KEY, order_id INTEGER);
 INSERT INTO catalog_products VALUES (11,'БАЯН СҰЛУ ШАПАН');
 INSERT INTO catalog_variants VALUES (1829,11,'adult','МУЖ','ОРАНЖЕВЫЙ','СТАНДАРТ','СТАНДАРТ','52');
 INSERT INTO catalog_variants VALUES (1828,11,'adult','МУЖ','ХАКИ','СТАНДАРТ','СТАНДАРТ','48');
 INSERT INTO inventory_stock VALUES (1,'boutique',1829,11,'БАЯН СҰЛУ ШАПАН','МУЖ','ОРАНЖЕВЫЙ','СТАНДАРТ','СТАНДАРТ','52',0);
 INSERT INTO inventory_stock VALUES (2,'boutique',1828,11,'БАЯН СҰЛУ ШАПАН','МУЖ','ХАКИ','СТАНДАРТ','СТАНДАРТ','48',2);
 INSERT INTO orders VALUES (100,'ORD-OLD','2026-10-07','active','');
 INSERT INTO orders VALUES (101,'ORD-NEW','2026-10-20','active','');
 INSERT INTO orders VALUES (102,'ORD-RETIRED','2026-10-21','archived','2026-10-21');
 INSERT INTO order_items VALUES (1000,100),(1001,101),(1002,102),(1003,100);
 INSERT INTO inventory_reservations VALUES (1,100,1000,'boutique',1829,'released',1);
 INSERT INTO inventory_reservations VALUES (2,100,1000,'boutique',1829,'active',1);
 INSERT INTO inventory_reservations VALUES (3,101,1001,'boutique',1829,'active',1);
 INSERT INTO inventory_reservations VALUES (4,102,1002,'boutique',1829,'released',1);
 INSERT INTO inventory_reservations VALUES (5,100,1003,'boutique',1828,'active',1);
`)
const rows = db.prepare(sql).all(50)
assert.equal(rows.length, 1, 'Positive stock with one reservation is not an anomaly')
assert.equal(rows[0].variant_id, 1829)
assert.equal(rows[0].physical, 0)
assert.equal(rows[0].reserved, 2, 'Released historical reservation excluded')
assert.equal(rows[0].latest_order_id, 101)
assert.equal(rows[0].latest_external_id, 'ORD-NEW')
assert.equal(rows[0].latest_order_date, '2026-10-20')
db.exec("UPDATE inventory_stock SET quantity=2 WHERE variant_id=1829")
assert.equal(db.prepare(sql).all(50).length, 0, 'Recorded receipt removes shortage')
db.exec("DELETE FROM inventory_stock WHERE variant_id=1829")
assert.equal(db.prepare(sql).all(50).length, 1, 'Missing stock row is treated as zero Physical')
db.close()
console.log('BRANCH2_STOCK_ATTENTION_LIVE_SQL_PASSED')
