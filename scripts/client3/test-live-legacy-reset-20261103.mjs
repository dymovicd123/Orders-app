import assert from 'node:assert/strict'
import fs from 'node:fs'
import {DatabaseSync} from 'node:sqlite'

const sqlite=new DatabaseSync(':memory:')
sqlite.exec('PRAGMA foreign_keys=ON')
for(const path of fs.readdirSync('migrations').filter(x=>/^[0-9].*\.sql$/.test(x)).sort())
  sqlite.exec(fs.readFileSync('migrations/'+path,'utf8'))
for(const path of fs.readdirSync('migrations/client3-watch').filter(x=>/^[0-9].*\.sql$/.test(x)).sort())
  sqlite.exec(fs.readFileSync('migrations/client3-watch/'+path,'utf8'))
const before=()=>sqlite.prepare('PRAGMA foreign_key_check').all()
assert.deepEqual(before(),[])

sqlite.prepare("INSERT INTO managers(id,name,role,is_active) VALUES(101,'ИСТОРИЧЕСКИЙ','Менеджер',1)").run()
sqlite.prepare("INSERT INTO app_users(id,email,login,password_hash,role,manager_id,is_active) VALUES(11,'legacy1@orders.invalid','legacy1','testhash','manager',101,1),(12,'legacy2@orders.invalid','legacy2','testhash','manager',101,1),(13,'admin@orders.invalid','admin','testhash','admin',NULL,1)").run()
sqlite.prepare("INSERT INTO orders(id,external_id,order_date,manager_id) VALUES(1,'HIST1','2026-10-01',101),(2,'HIST2','2026-10-02',101),(3,'NEW-WATCH','2026-11-03',101)").run()
sqlite.prepare("INSERT INTO order_items(id,order_id,product_name_snapshot) VALUES(1,1,'СТАРЫЙ'),(2,2,'СТАРЫЙ'),(3,3,'ЧАСЫ')").run()
sqlite.prepare("INSERT INTO payments(order_id,payment_date,method,amount) VALUES(1,'2026-10-01','KASPI',100),(2,'2026-10-02','KASPI',200),(3,'2026-11-03','KASPI',500)").run()
sqlite.prepare("INSERT INTO returns(order_id,return_date,amount) VALUES(1,'2026-10-03',100)").run()
sqlite.prepare("INSERT INTO return_items(return_id,order_item_id,product_name_snapshot) VALUES(1,1,'СТАРЫЙ')").run()
sqlite.prepare("INSERT INTO inventory_reservations(order_id,order_item_id,inventory_source,quantity,status,created_at,updated_at) VALUES(1,1,'warehouse',1,'released','2026-10-01','2026-10-01'),(2,2,'warehouse',1,'released','2026-10-02','2026-10-02')").run()
sqlite.prepare("INSERT INTO financial_events(event_key,order_id,external_order_id,event_date,event_at,event_type,amount_delta,source_type,created_at) VALUES ('historical-a',1,'HIST1','2026-10-01','2026-10-01','paid',100,'warehouse','2026-10-01'),('historical-b',2,'HIST2','2026-10-02','2026-10-02','paid',200,'warehouse','2026-10-02'),('current-c',3,'NEW-WATCH','2026-11-03','2026-11-03','paid',500,'warehouse','2026-11-03')").run()
sqlite.prepare("INSERT INTO watch_order_details(order_id,brand_id,recipient_name,recipient_phone,delivery_full_address,postal_code,city,delivery_method,shipping_deadline_at) VALUES(3,1,'NEW','555','OFFICE','050000','ALMATY','COURIER','2026-11-04T17:00:00Z')").run()
assert.deepEqual(before(),[],'Test seed must be FK-valid')

const sql=fs.readFileSync('scripts/client3/clear-old-orders-and-manager-logins-20261103.sql','utf8')
sqlite.exec('BEGIN')
try{sqlite.exec(sql);sqlite.exec('COMMIT')}
catch(e){sqlite.exec('ROLLBACK');throw e}
assert.deepEqual(before(),[],'Cleanup must keep all foreign keys valid')
const count=table=>sqlite.prepare('SELECT COUNT(*) AS n FROM '+table).get().n
assert.equal(count('orders'),1,'Only the new watch order is retained')
assert.equal(sqlite.prepare('SELECT id FROM orders').get().id,3)
assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM watch_order_details').get().n,1)
assert.equal(count('payments'),1)
assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM financial_events').get().n,1)
assert.equal(count('inventory_reservations'),0)
assert.equal(count('returns'),0)
assert.equal(count('order_items'),1)
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM app_users WHERE role='manager' AND login IS NOT NULL").get().n,0)
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM app_users WHERE role='admin' AND login='admin' AND is_active=1").get().n,1)
assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM managers WHERE id=101').get().n,1)
assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM client3_legacy_reset_20261103_targets').get().n,2)
sqlite.close()
console.log('CLIENT3_LEGACY_RESET_SQL_PASS: old orders/payments/returns/reserves gone, watches+admin+employee identities intact')
