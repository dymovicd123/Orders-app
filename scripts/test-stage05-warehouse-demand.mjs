import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
const text = readFileSync(new URL('../worker/domains/warehouse-demand.ts', import.meta.url), 'utf8')
const match = text.match(/export const warehouseDemandSql = String\.raw`([\s\S]*?)`;/)
assert.ok(match, 'SQL contract present')
const sql = match[1]
assert.ok(!/inventory_stock\b/i.test(sql), 'warehouse stock cannot influence sold statistics')
const db = new DatabaseSync(':memory:')
db.exec(`
CREATE TABLE orders (id INTEGER PRIMARY KEY, shipping_status TEXT, shipping_date TEXT, order_status TEXT);
CREATE TABLE order_items (
  id INTEGER PRIMARY KEY, order_id INTEGER, product_name_snapshot TEXT,
  color_snapshot TEXT, size_snapshot TEXT, material_snapshot TEXT, length_snapshot TEXT, gender_snapshot TEXT,
  audience_type TEXT, is_workshop INTEGER, source_type TEXT, quantity INTEGER,
  unit_price INTEGER, line_total INTEGER, stock_writeoff_status TEXT
);
CREATE TABLE returns (id INTEGER PRIMARY KEY, return_date TEXT, status TEXT);
CREATE TABLE return_items (return_id INTEGER, order_item_id INTEGER, quantity INTEGER);
CREATE TABLE exchanges (id INTEGER PRIMARY KEY, refund_return_id INTEGER, status TEXT);
INSERT INTO orders VALUES
 (1,'sent','2026-10-10','active'),
 (2,'not_sent',NULL,'active'),
 (3,'sent','2026-10-10','deleted'),
 (4,'sent','2026-10-10','active'),
 (5,'sent','2026-10-10','active');
INSERT INTO order_items VALUES
 (1,1,'Кардиган','Серый','52','Шерсть','','Жен','adult',0,'warehouse',3,30000,90000,'written_off'),
 (2,2,'Не выдан','Синий','46','','','','adult',0,'warehouse',10,5000,50000,'reserved'),
 (3,3,'Удалён','Синий','46','','','','adult',0,'warehouse',5,5000,25000,'written_off'),
 (4,4,'Кардиган','Хаки','48','Шерсть','','Жен','adult',0,'boutique',2,0,0,'written_off'),
 (5,5,'Кардиган','Серый','52','Шерсть','','Жен','adult',0,'warehouse',1,30000,30000,'written_off');
INSERT INTO returns VALUES
 (1,'2026-10-12','completed'),
 (2,'2026-10-12','cancelled'),
 (3,'2026-11-01','completed'),
 (4,'2026-10-12','completed');
INSERT INTO return_items VALUES (1,1,1),(2,1,2),(3,1,2),(4,5,1);
INSERT INTO exchanges VALUES (1,4,'completed');
`)
const rows = db.prepare(sql).all('2026-10-31','2026-10-01','2026-10-31')
const grey = rows.find(x=>x.product === 'Кардиган' && x.color === 'Серый')
const khaki = rows.find(x=>x.product === 'Кардиган' && x.color === 'Хаки')
assert.equal(rows.length, 2, 'not sent, deleted excluded')
assert.equal(grey.sold, 4)
assert.equal(grey.returned, 1, 'exclude cancelled, future and exchange-linked returns')
assert.equal(grey.net, 3)
assert.equal(grey.priced_quantity, 3)
assert.equal(grey.known_revenue, 90000)
assert.equal(khaki.sold, 2)
assert.equal(khaki.priced_quantity, 0, 'missing price not fake zero-price sale')
assert.equal(khaki.known_revenue, 0)
console.log('STAGE05_DEMAND_READONLY_SQL_RETURN_AND_PRICE_COVERAGE_PASSED')
