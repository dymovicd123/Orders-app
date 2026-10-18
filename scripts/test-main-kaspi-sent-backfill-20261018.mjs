import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
const sql=readFileSync('scripts/ops/kaspi-sent-history-recovery-20261018.sql','utf8')
assert(sql.includes("o.shipping_status,'not_sent')='sent'"))
assert(sql.includes("o.order_status,'active')='active'"))
assert(sql.includes("p.comment='kaspi_sent_history_recovery_v1'"))
assert(sql.includes("c.request_id='kaspi-shipping-payment:'||o.id||':v1'"))
assert(sql.includes("event_key,order_id,external_order_id"))
assert(sql.includes("'kaspi_sent_history_recovery'"))
assert(sql.includes("is_backfill,created_at"))
assert(!sql.includes('DELETE FROM'))
const db=new DatabaseSync(':memory:')
db.exec(`
CREATE TABLE orders(
 id INTEGER PRIMARY KEY,external_id TEXT,order_payment_method TEXT,order_status TEXT,
 archived_at TEXT,shipping_status TEXT,shipping_date TEXT,total_amount INTEGER,
 received_amount INTEGER,debt_amount INTEGER,updated_at TEXT);
CREATE TABLE payments(
 id INTEGER PRIMARY KEY AUTOINCREMENT,order_id INTEGER,payment_date TEXT,method TEXT,
 amount INTEGER,payment_kind TEXT,comment TEXT,created_at TEXT);
CREATE TABLE critical_operations(request_id TEXT PRIMARY KEY);
CREATE TABLE financial_events(
 id INTEGER PRIMARY KEY AUTOINCREMENT,event_key TEXT UNIQUE,order_id INTEGER,
 external_order_id TEXT,event_date TEXT,event_at TEXT,event_type TEXT,related_type TEXT,
 amount_delta INTEGER,payment_method TEXT,source_type TEXT,source_id INTEGER,
 source_ref TEXT,reason TEXT,comment TEXT,is_backfill INTEGER,created_at TEXT);
INSERT INTO orders VALUES
 (1,'O1','КАСПИ МАГАЗИН','active','', 'sent','2026-10-04',25000,0,25000,NULL),
 (2,'O2','КАСПИ МАГАЗИН','active','', 'sent','2026-10-08',20000,5000,15000,NULL),
 (3,'O3','КАСПИ МАГАЗИН','active','', 'not_sent',NULL,17000,0,17000,NULL),
 (4,'O4','КАСПИ МАГАЗИН','active','', 'sent','2026-10-12',10000,10000,0,NULL),
 (5,'O5','КАСПИ МАГАЗИН','deleted','', 'sent','2026-10-12',12000,0,12000,NULL),
 (6,'O6','КАСПИ МАГАЗИН','active','2026-10-09','sent','2026-10-12',9000,0,9000,NULL),
 (7,'O7','КАСПИ МАГАЗИН','active','', 'sent','2026-10-13',6000,0,6000,NULL),
 (8,'O8','ТЕРМИНАЛ','active','', 'sent','2026-10-13',11000,0,11000,NULL);
INSERT INTO payments(order_id,payment_date,method,amount,payment_kind) VALUES(2,'2026-10-08','КАСПИ МАГАЗИН',5000,'primary'),(4,'2026-10-12','КАСПИ МАГАЗИН',10000,'primary');
INSERT INTO critical_operations VALUES('kaspi-shipping-payment:7:v1');
`)
db.exec(sql)
db.exec(sql)
const rows=db.prepare("SELECT order_id, amount, payment_date FROM payments WHERE comment='kaspi_sent_history_recovery_v1' ORDER BY order_id").all()
assert.deepEqual(rows,[{order_id:1,amount:25000,payment_date:'2026-10-04'},{order_id:2,amount:15000,payment_date:'2026-10-08'}])
assert.equal(db.prepare("SELECT COUNT(*) n FROM financial_events WHERE reason='kaspi_sent_history_recovery'").get().n,2)
assert.equal(db.prepare("SELECT SUM(amount_delta) s FROM financial_events").get().s,40000)
assert.equal(db.prepare("SELECT COUNT(*) n FROM financial_events WHERE is_backfill=1").get().n,2)
assert.deepEqual(db.prepare("SELECT received_amount,debt_amount FROM orders WHERE id=2").get(),{received_amount:20000,debt_amount:0})
assert.equal(db.prepare("SELECT debt_amount FROM orders WHERE id=1").get().debt_amount,0)
assert.equal(db.prepare("SELECT debt_amount FROM orders WHERE id=3").get().debt_amount,17000)
assert.equal(db.prepare("SELECT debt_amount FROM orders WHERE id=5").get().debt_amount,12000)
assert.equal(db.prepare("SELECT debt_amount FROM orders WHERE id=6").get().debt_amount,9000)
assert.equal(db.prepare("SELECT debt_amount FROM orders WHERE id=7").get().debt_amount,6000)
assert.equal(db.prepare("SELECT received_amount FROM orders WHERE id=8").get().received_amount,0)
console.log('MAIN_KASPI_HISTORICAL_BACKFILL_RERUN_NO_DUPLICATES_AND_STATUS_ISOLATION_PASSED')
