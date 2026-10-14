import fs from 'node:fs'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'

const sql = fs.readFileSync('scripts/ops/one-off-duplicate-1734-20261015.sql', 'utf8')
assert.doesNotMatch(sql, /\bDELETE\s+FROM\b|\bDROP\s+TABLE\b|\bUPDATE\s+inventory_movements\b|\bUPDATE\s+inventory_lifecycle_events\b/i,
  'One-off must retain physical movement history and delete no business rows')
assert.match(sql, /event_type='exchange_new_out' AND status='applied'/,
  'Historical physical exchange evidence must be protected')
assert.match(sql, /UPDATE inventory_stock[\s\S]*?SET reserved_quantity=0/,
  'Only obsolete reservation quantity may be adjusted')
assert.doesNotMatch(sql, /SET\s+quantity\s*=/i, 'Physical quantity updates are forbidden')

const db = new DatabaseSync(':memory:')
db.exec(`
CREATE TABLE orders(id INTEGER PRIMARY KEY,external_id TEXT,order_status TEXT,shipping_status TEXT,order_date TEXT,total_amount INTEGER,received_amount INTEGER,debt_amount INTEGER,updated_at TEXT,comment TEXT);
CREATE TABLE order_items(id INTEGER PRIMARY KEY,order_id INTEGER,variant_id INTEGER,stock_writeoff_status TEXT,stock_quantity_before INTEGER,stock_quantity_after INTEGER);
CREATE TABLE payments(id INTEGER PRIMARY KEY,order_id INTEGER,amount INTEGER,payment_date TEXT,method TEXT,payment_kind TEXT);
CREATE TABLE exchanges(id INTEGER PRIMARY KEY,order_id INTEGER,status TEXT,financial_action TEXT,financial_amount INTEGER);
CREATE TABLE returns(id INTEGER PRIMARY KEY,order_id INTEGER);
CREATE TABLE inventory_reservations(id INTEGER PRIMARY KEY,order_id INTEGER,order_item_id INTEGER,inventory_source TEXT,variant_id INTEGER,quantity INTEGER,status TEXT,updated_at TEXT,released_at TEXT);
CREATE TABLE inventory_stock(id INTEGER PRIMARY KEY,inventory_source TEXT,variant_id INTEGER,quantity INTEGER,reserved_quantity INTEGER,last_action TEXT,last_source_ref TEXT,updated_at TEXT);
CREATE TABLE inventory_lifecycle_events(id INTEGER PRIMARY KEY,operation_type TEXT,operation_id INTEGER,event_type TEXT,status TEXT);
CREATE TABLE inventory_movements(id INTEGER PRIMARY KEY,variant_id INTEGER,quantity_delta INTEGER,reference_type TEXT,reference_id TEXT);
CREATE TABLE cash_register_entries(id INTEGER PRIMARY KEY,order_id INTEGER);
CREATE TABLE financial_events(id INTEGER PRIMARY KEY,event_key TEXT UNIQUE,order_id INTEGER,external_order_id TEXT,event_date TEXT,event_at TEXT,event_type TEXT,related_type TEXT,amount_delta INTEGER,payment_method TEXT,source_type TEXT,source_id INTEGER,source_ref TEXT,reason TEXT,comment TEXT,is_backfill INTEGER,created_at TEXT);
INSERT INTO orders VALUES(1734,'ORD-20261004144759-D27C0954','active','not_sent','2026-10-04',67500,65000,2500,'2026-10-11T14:28:00.578Z','old comment');
INSERT INTO orders VALUES(1974,'CORRECT_ORDER','active','not_sent','2026-10-04',65000,65000,0,'2026-10-14T13:48:42.535Z','correct');
INSERT INTO payments VALUES(1989,1734,65000,'2026-10-04','ТЕРМИНАЛ','primary');
INSERT INTO payments VALUES(2158,1974,65000,'2026-10-04','ТЕРМИНАЛ','primary');
INSERT INTO exchanges VALUES(78,1734,'completed','none',0);
INSERT INTO exchanges VALUES(80,1974,'completed','none',0);
INSERT INTO order_items VALUES(4263,1734,1293,'reserved',NULL,NULL);
INSERT INTO order_items VALUES(4264,1734,1345,'reserved',NULL,NULL);
INSERT INTO order_items VALUES(4583,1734,231,'fulfilled',NULL,NULL);
INSERT INTO inventory_reservations VALUES(1467,1734,4263,'boutique',1293,1,'active',NULL,NULL);
INSERT INTO inventory_reservations VALUES(1468,1734,4264,'boutique',1345,1,'active',NULL,NULL);
INSERT INTO inventory_reservations VALUES(1466,1734,4262,'warehouse',305,1,'released',NULL,NULL);
INSERT INTO inventory_reservations VALUES(1674,1734,4583,'warehouse',231,1,'fulfilled',NULL,NULL);
INSERT INTO inventory_reservations VALUES(1752,1974,4683,'boutique',1660,1,'active',NULL,NULL);
INSERT INTO inventory_reservations VALUES(1753,1974,4684,'boutique',1466,1,'active',NULL,NULL);
INSERT INTO inventory_reservations VALUES(1754,1974,4685,'warehouse',305,1,'released',NULL,NULL);
INSERT INTO inventory_reservations VALUES(1755,1974,4686,'warehouse',231,1,'fulfilled',NULL,NULL);
INSERT INTO inventory_stock VALUES(1106,'boutique',1293,0,1,'old','old','2026-10-06');
INSERT INTO inventory_stock VALUES(1285,'boutique',1345,0,1,'old','old','2026-10-06');
INSERT INTO inventory_stock VALUES(1377,'boutique',1466,1,1,'old','old','2026-10-14');
INSERT INTO inventory_stock VALUES(1822,'boutique',1660,0,1,'old','old','2026-10-14');
INSERT INTO inventory_stock VALUES(168,'warehouse',231,0,1,'old','old','2026-10-14');
INSERT INTO inventory_stock VALUES(275,'warehouse',305,2,0,'old','old','2026-10-14');
INSERT INTO inventory_lifecycle_events VALUES(134,'exchange',78,'exchange_new_out','applied');
INSERT INTO inventory_lifecycle_events VALUES(136,'exchange',80,'exchange_new_out','applied');
INSERT INTO inventory_movements VALUES(4873,231,-1,'exchange_new','78');
INSERT INTO financial_events(id,event_key,order_id,event_type,amount_delta,reason) VALUES(2055,'initial1734',1734,'order_payment',65000,'order_create');
INSERT INTO financial_events(id,event_key,order_id,event_type,amount_delta,reason) VALUES(2239,'initial1974',1974,'order_payment',65000,'order_create');
`)
const one = (statement) => db.prepare(statement).get()
db.exec(sql)
assert.equal(one("SELECT order_status v FROM orders WHERE id=1734").v, 'deleted')
assert.equal(one("SELECT order_status v FROM orders WHERE id=1974").v, 'active')
assert.equal(one("SELECT received_amount v FROM orders WHERE id=1974").v, 65000)
assert.equal(one("SELECT COUNT(*) v FROM inventory_reservations WHERE order_id=1734 AND status='active'").v, 0)
assert.equal(one("SELECT COUNT(*) v FROM inventory_reservations WHERE order_id=1974 AND status='active'").v, 2)
assert.equal(one("SELECT SUM(reserved_quantity) v FROM inventory_stock WHERE id IN (1106,1285)").v, 0)
assert.equal(one("SELECT SUM(quantity) v FROM inventory_stock WHERE id IN (1106,1285,1377,1822,168,275)").v, 3)
assert.equal(one("SELECT SUM(amount_delta) v FROM financial_events WHERE order_id=1734").v, 0)
assert.equal(one("SELECT SUM(amount_delta) v FROM financial_events WHERE order_id=1974").v, 65000)
assert.equal(one("SELECT COUNT(*) v FROM payments WHERE id IN (1989,2158) AND amount=65000").v, 2)
assert.equal(one("SELECT COUNT(*) v FROM exchanges WHERE id IN(78,80) AND status='completed'").v, 2)
assert.equal(one("SELECT COUNT(*) v FROM inventory_movements WHERE id=4873 AND quantity_delta=-1").v, 1)
assert.throws(() => db.exec(sql), /integer overflow/i, 'Replaying the one-off must fail closed')

const changed = new DatabaseSync(':memory:')
db.close()
changed.close()

console.log('ONE-OFF 1734 VERIFIED: status hidden, exactly two reservations released, finance net 0, no stock quantity or correct-order changes, rerun rejected')
