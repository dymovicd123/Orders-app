import assert from 'node:assert/strict'
import fs from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

// Baseline: the current third D1 has two legacy orders. Never convert those
// into fictional dispatch history, watch brands or new stock during migration.
const db=new DatabaseSync(':memory:')
db.exec('PRAGMA foreign_keys=ON')
db.exec([
 'CREATE TABLE orders(id INTEGER PRIMARY KEY,shipping_status TEXT);',
 'CREATE TABLE order_items(id INTEGER PRIMARY KEY,order_id INTEGER REFERENCES orders(id));',
 'CREATE TABLE app_users(id INTEGER PRIMARY KEY);',
 'CREATE TABLE managers(id INTEGER PRIMARY KEY);',
 'CREATE TABLE catalog_products(id INTEGER PRIMARY KEY);',
 'CREATE TABLE catalog_variants(id INTEGER PRIMARY KEY);',
 'CREATE TABLE inventory_reservations(id INTEGER PRIMARY KEY);',
 'CREATE TABLE inventory_movements(id INTEGER PRIMARY KEY);',
 'CREATE TABLE inventory_stock(id INTEGER PRIMARY KEY,quantity INTEGER,reserved_quantity INTEGER);',
 'CREATE TABLE payments(id INTEGER PRIMARY KEY,order_id INTEGER REFERENCES orders(id),amount INTEGER);',
 "INSERT INTO orders VALUES(101,'sent'),(102,'not_sent');",
 'INSERT INTO order_items VALUES(201,101),(202,102);',
 'INSERT INTO app_users VALUES(1),(2),(3),(4);',
 'INSERT INTO managers VALUES(1),(2),(3);',
 'INSERT INTO catalog_products VALUES(1),(2);',
 'INSERT INTO catalog_variants VALUES(1),(2);',
 'INSERT INTO inventory_stock VALUES(1,4,0),(2,7,0);',
 'INSERT INTO payments VALUES(1,101,10000),(2,102,20000);',
].join('\n'))
const counts=()=>({
 orders:db.prepare('SELECT count(*) AS n FROM orders').get().n,
 items:db.prepare('SELECT count(*) AS n FROM order_items').get().n,
 payments:db.prepare('SELECT count(*) AS n FROM payments').get().n,
 users:db.prepare('SELECT count(*) AS n FROM app_users').get().n,
 managers:db.prepare('SELECT count(*) AS n FROM managers').get().n,
 stock:db.prepare('SELECT * FROM inventory_stock ORDER BY id').all(),
 sent:db.prepare('SELECT shipping_status FROM orders WHERE id=101').get().shipping_status,
})
const baseline=counts()
const original=fs.readFileSync('migrations/0119_v72_order_dispatch_lineage.sql','utf8')
const target=fs.readFileSync('migrations/client3-watch/0001_client3_stage5_dispatch_lineage.sql','utf8')
assert.equal(target.slice(target.indexOf('-- Stage 5:')),original,
 'Client3 dispatch DDL must exactly match the verified Main Stage5 migration')
const files=[
 'migrations/client3-watch/0001_client3_stage5_dispatch_lineage.sql',
 'migrations/client3-watch/0002_client3_watch_foundation.sql',
 'migrations/client3-watch/0003_watch_manager_brand_audit.sql',
]
for(const file of files)db.exec(fs.readFileSync(file,'utf8'))
assert.deepEqual(counts(),baseline,'Schema migrations must not change legacy records')
assert.equal(db.prepare('SELECT count(*) AS n FROM order_dispatches').get().n,0)
assert.equal(db.prepare('SELECT count(*) AS n FROM order_dispatch_items').get().n,0)
assert.equal(db.prepare('SELECT count(*) AS n FROM order_dispatch_corrections').get().n,0)
assert.equal(db.prepare('SELECT count(*) AS n FROM watch_order_details').get().n,0)
assert.equal(db.prepare('SELECT count(*) AS n FROM watch_order_item_details').get().n,0)
assert.equal(db.prepare('SELECT count(*) AS n FROM watch_logistics_jobs').get().n,0)
assert.equal(db.prepare('SELECT count(*) AS n FROM watch_manager_brands').get().n,0)
assert.deepEqual(db.prepare('SELECT code FROM watch_brands ORDER BY code').all(),[
 {code:'TAUWACH'},{code:'WACHIZEN'}])
assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[])
for(const file of files)db.exec(fs.readFileSync(file,'utf8'))
assert.deepEqual(counts(),baseline,'Replaying additive DDL must leave legacy data untouched')
assert.equal(db.prepare('SELECT count(*) AS n FROM watch_brands').get().n,2)
assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[])

// Exercise the exact new referential graph without leaving invented dispatches.
db.exec('SAVEPOINT simulate_stage5')
db.prepare("INSERT INTO order_dispatches(order_id,request_id,dispatch_date,created_at,status) VALUES(101,'dispatch-test','2026-11-02','2026-11-02','sent')").run()
db.prepare("INSERT INTO order_dispatch_items(dispatch_id,order_item_id,source_type,variant_id,quantity,created_at) VALUES(1,201,'warehouse',1,1,'2026-11-02')").run()
db.prepare("INSERT INTO order_dispatch_corrections(dispatch_item_id,request_id,quantity,stock_restored,reason,created_at) VALUES(1,'correction-test',1,0,'test only','2026-11-02')").run()
assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[])
assert.throws(()=>db.prepare("INSERT INTO order_dispatch_items(dispatch_id,order_item_id,source_type,quantity,created_at) VALUES(1,201,'warehouse',2,'2026-11-02')").run(),
 /UNIQUE|constraint/i,'One dispatch cannot duplicate the same order item')
db.exec('ROLLBACK TO simulate_stage5; RELEASE simulate_stage5')
assert.equal(db.prepare('SELECT count(*) AS n FROM order_dispatches').get().n,0)
assert.deepEqual(counts(),baseline)
db.close()
console.log('CLIENT3_STAGE5_MIGRATION_CHAIN_PASS: source parity, 2 legacy orders unchanged, 0001->0002->0003, FK, repeat, empty lineage')
