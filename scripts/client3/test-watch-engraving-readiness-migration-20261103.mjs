import assert from 'node:assert/strict'
import fs from 'node:fs'
import {DatabaseSync} from 'node:sqlite'

// Intentionally sparse real-shape schema isolates the one-time migration from
// order/stock/finance logic, so no historical "ready" is falsely expanded.
const db=new DatabaseSync(':memory:')
db.exec(`PRAGMA foreign_keys=ON;
CREATE TABLE app_users(id INTEGER PRIMARY KEY);
CREATE TABLE order_items(id INTEGER PRIMARY KEY,order_id INTEGER,quantity INTEGER);
CREATE TABLE watch_order_item_details(order_item_id INTEGER PRIMARY KEY REFERENCES order_items(id),
  engraving_text TEXT);
CREATE TABLE watch_logistics_jobs(order_id INTEGER PRIMARY KEY,status TEXT,ready_at TEXT,
  ready_by_user_id INTEGER,ready_request_id TEXT,updated_at TEXT);
CREATE TABLE watch_logistics_events(id INTEGER PRIMARY KEY,order_id INTEGER);
CREATE TABLE financial_events(id INTEGER PRIMARY KEY,amount_delta INTEGER);
CREATE TABLE inventory_stock(id INTEGER PRIMARY KEY,quantity INTEGER);
INSERT INTO app_users(id) VALUES(1);
INSERT INTO order_items VALUES(11,1,1),(21,2,1),(22,2,1),(31,3,1);
INSERT INTO watch_order_item_details VALUES
 (11,'A'),(21,'B'),(22,'C'),(31,'');
INSERT INTO watch_logistics_jobs VALUES
 (1,'ready','2026-11-01',1,'legacy1','2026-11-01'),
 (2,'ready','2026-11-01',1,'legacy2','2026-11-01'),
 (3,'ready','2026-11-01',1,'legacy3','2026-11-01');
INSERT INTO inventory_stock VALUES (1,12);
INSERT INTO financial_events VALUES (1,5000);
`)
db.exec(fs.readFileSync('migrations/client3-watch/1004_watch_item_engraving_readiness.sql','utf8'))
const rows=db.prepare('SELECT order_item_id,engraving_text FROM watch_engraving_item_readiness ORDER BY order_item_id').all()
assert.deepEqual(rows.map(x=>Number(x.order_item_id)),[11],
 'Only single-line legacy readiness can safely be inherited')
assert.equal(rows[0].engraving_text,'A')
assert.equal(db.prepare('SELECT status FROM watch_logistics_jobs WHERE order_id=1').get().status,'ready')
assert.equal(db.prepare('SELECT status FROM watch_logistics_jobs WHERE order_id=2').get().status,'engraving',
 'Multi-item legacy ready must require individual confirmation')
assert.equal(db.prepare('SELECT status FROM watch_logistics_jobs WHERE order_id=3').get().status,'ready',
 'Orders with no engraving are already ready')
assert.equal(db.prepare('SELECT quantity FROM inventory_stock WHERE id=1').get().quantity,12)
assert.equal(db.prepare('SELECT amount_delta FROM financial_events WHERE id=1').get().amount_delta,5000)
assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[])
assert(db.prepare("SELECT name FROM pragma_table_info('watch_logistics_events') WHERE name='order_item_id'").get())
db.close()
console.log('CLIENT3_ENGRAVING_MIGRATION_PASS: conservative readiness, no false-ready, no stock/money changes')
