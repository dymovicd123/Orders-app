import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
const sql=readFileSync('scripts/ops/asiya-23-kaspi-legacy-paid-20261019.sql','utf8')
const targets=[[1877,28000],[1887,55000],[1888,16000],[1889,28000],[1890,35000],[1891,45000],[1893,110000],[1894,22500],[1895,22500],[1896,16000],[1897,22500],[1898,20000],[1899,82500],[1900,20000],[1920,27500],[1921,16000],[1922,16000],[1923,16000],[1924,16000],[1925,16000],[1926,16000],[1927,16000],[1928,16000]]
assert.equal(targets.length,23)
assert.equal(targets.reduce((s,x)=>s+x[1],0),678500)
assert(!/\\b(?:UPDATE|DELETE|INSERT INTO)\\s+(?:inventory_stock|order_items|workshop_tasks|cash_register_entries)\\b/i.test(sql))
assert(!/UPDATE orders[\\s\\S]*?shipping_status\\s*=/i.test(sql))
function seeded(){
 const d=new DatabaseSync(':memory:')
 d.exec(`
 CREATE TABLE orders(
 id INTEGER PRIMARY KEY,external_id TEXT,manager_id INTEGER,
 order_payment_method TEXT,order_status TEXT,archived_at TEXT,shipping_status TEXT,
 order_date TEXT,total_amount INTEGER,received_amount INTEGER,debt_amount INTEGER,
 return_amount INTEGER,updated_at TEXT);
 CREATE TABLE payments(
 id INTEGER PRIMARY KEY AUTOINCREMENT,order_id INTEGER,payment_date TEXT,
 method TEXT,amount INTEGER,payment_kind TEXT,comment TEXT,created_at TEXT);
 CREATE TABLE financial_events(
 id INTEGER PRIMARY KEY AUTOINCREMENT,event_key TEXT UNIQUE,order_id INTEGER,
 external_order_id TEXT,event_date TEXT,event_at TEXT,event_type TEXT,related_type TEXT,
 amount_delta INTEGER,payment_method TEXT,source_type TEXT,source_id INTEGER,
 source_ref TEXT,reason TEXT,comment TEXT,is_backfill INTEGER,created_at TEXT);
 CREATE TABLE inventory_stock(id INTEGER PRIMARY KEY,quantity INTEGER);
 INSERT INTO inventory_stock VALUES(1,20);
 `)
 const put=d.prepare(`INSERT INTO orders(
 id,external_id,manager_id,order_payment_method,order_status,
 archived_at,shipping_status,order_date,total_amount,received_amount,debt_amount,return_amount)
 VALUES (?,'ORD-'||?,436,'КАСПИ МАГАЗИН','active','','not_sent','2026-10-10',?,0,?,0)`)
 for (const [id,amount] of targets)put.run(id,id,amount,amount)
 d.exec("INSERT INTO orders VALUES(9999,'OTHER',999,'КАСПИ МАГАЗИН','active','','not_sent','2026-10-10',10000,0,10000,0,NULL)")
 return d
}
const db=seeded()
db.exec(sql)
db.exec(sql)
const pays=db.prepare("SELECT order_id,amount,payment_kind,payment_date FROM payments ORDER BY order_id").all()
assert.equal(pays.length,23)
assert.deepEqual(pays.map(p=>[p.order_id,p.amount]),targets)
assert(pays.every(p=>p.payment_kind==='primary'&&p.payment_date==='2026-10-10'))
const event=db.prepare("SELECT order_id,amount_delta,event_type,reason,is_backfill FROM financial_events ORDER BY order_id").all()
assert.equal(event.length,23)
assert.equal(event.reduce((s,r)=>s+r.amount_delta,0),678500)
assert(event.every(e=>e.event_type==='order_payment'&&e.reason==='kaspi_asiya_legacy_assumed_paid'&&e.is_backfill===1))
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM orders WHERE manager_id=436 AND received_amount=total_amount AND debt_amount=0 AND shipping_status='not_sent'").get().n,23)
assert.equal(db.prepare("SELECT debt_amount FROM orders WHERE id=9999").get().debt_amount,10000)
assert.equal(db.prepare("SELECT quantity FROM inventory_stock WHERE id=1").get().quantity,20)
for(const update of [
 "UPDATE orders SET manager_id=999 WHERE id=1900",
 "UPDATE orders SET shipping_status='sent' WHERE id=1900",
 "UPDATE orders SET order_payment_method='НАЛИЧКА' WHERE id=1900",
 "UPDATE orders SET archived_at='2026-10-19' WHERE id=1900",
 "UPDATE orders SET debt_amount=1 WHERE id=1900",
 "UPDATE orders SET total_amount=21000 WHERE id=1900",
 "UPDATE orders SET return_amount=100 WHERE id=1900",
 "INSERT INTO payments (order_id,payment_date,method,amount) VALUES (1900,'2026-10-19','КАСПИ МАГАЗИН',1000)",
]){
 const bad=seeded()
 bad.exec(update)
 bad.exec(sql)
 assert.equal(bad.prepare("SELECT COUNT(*) AS n FROM payments WHERE comment='kaspi_asiya_unshipped_assumed_paid_20261019'").get().n,0,update)
 assert.equal(bad.prepare("SELECT COUNT(*) AS n FROM financial_events").get().n,0,update)
}
console.log('ASIYA_KASPI_23_EXACT_COHORT_GUARDED_PAID_REPLAY_NO_STOCK_OR_SHIPPING_PASSED')
