import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
const db=new DatabaseSync(':memory:')
db.exec("PRAGMA foreign_keys=ON")
db.exec([
 "CREATE TABLE orders(id INTEGER PRIMARY KEY,order_status TEXT)",
 "CREATE TABLE order_items(id INTEGER PRIMARY KEY,order_id INTEGER REFERENCES orders(id))",
 "CREATE TABLE exchanges(id INTEGER PRIMARY KEY,order_id INTEGER REFERENCES orders(id))",
].join(';')+';')
db.exec("INSERT INTO orders VALUES(42,'active')")
db.exec("INSERT INTO order_items VALUES(7,42)")
db.exec("INSERT INTO exchanges VALUES(11,42)")
const sql="SELECT name,sql FROM sqlite_master WHERE type='table' AND name IN ('orders','order_items','exchanges') ORDER BY name"
const before=db.prepare(sql).all()
const migrationPaths=['migrations/0110_v72_exchange_order_item_price_correction_audit.sql','migrations/0111_v72_admin_order_delete_saga_journal.sql']
for(const p of migrationPaths)db.exec(readFileSync(p,'utf8'))
for(const p of migrationPaths)db.exec(readFileSync(p,'utf8')) // additive and reapplicable
assert.deepEqual(db.prepare(sql).all(),before,'Migrations cannot alter existing financial/inventory tables')
for(const table of ['exchange_order_item_price_corrections','admin_order_delete_sagas','admin_order_delete_saga_steps'])
 assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name=?").get(table).n,1)
const fields=['request_id','order_id','order_item_id','exchange_id','role','original_exchange_unit_price','old_unit_price','new_unit_price','quantity_at_correction','actor_label','corrected_at']
const bind=['P_PRICE_01',42,7,11,'old',1000,1000,1200,1,'manager','2026-10-17']
const insert='INSERT INTO exchange_order_item_price_corrections ('+fields.join(',')+') VALUES ('+fields.map(()=>'?').join(',')+')'
db.prepare(insert).run(...bind)
assert.throws(()=>db.exec("UPDATE exchange_order_item_price_corrections SET new_unit_price=1500 WHERE request_id='P_PRICE_01'"),/immutable/)
assert.throws(()=>db.exec("DELETE FROM exchange_order_item_price_corrections WHERE request_id='P_PRICE_01'"),/immutable/)
assert.throws(()=>db.prepare(insert).run(...bind),/UNIQUE/)
assert.throws(()=>db.prepare(insert).run('P_BAD',42,7,11,'invalid',1000,1000,1500,1,'manager','2026-10-17'),/CHECK/)
assert.throws(()=>db.prepare(insert).run('P_WRONG_FK',42,9999,11,'old',1000,1000,1300,1,'manager','2026-10-17'),/FOREIGN KEY/)
const addSaga=db.prepare("INSERT INTO admin_order_delete_sagas (request_id,order_id,status,preview_fingerprint,plan_json,next_step,created_at,updated_at) VALUES(?,?,?,?,?,0,?,?)")
const fp='a'.repeat(64)
addSaga.run('SAGA_A',42,'planned',fp,'[]','2026-10-17','2026-10-17')
assert.throws(()=>addSaga.run('SAGA_B',42,'planned',fp,'[]','2026-10-17','2026-10-17'),/UNIQUE/,'No overlapping admin delete sagas')
db.exec("UPDATE admin_order_delete_sagas SET status='cancelled' WHERE request_id='SAGA_A'")
addSaga.run('SAGA_B',42,'planned',fp,'[]','2026-10-17','2026-10-17')
const addStep=db.prepare("INSERT INTO admin_order_delete_saga_steps (saga_request_id,step_index,operation_type,operation_id,cancel_request_id) VALUES(?,?,?,?,?)")
addStep.run('SAGA_B',0,'exchange',11,'SAGA_B:exchange:11')
assert.throws(()=>addStep.run('SAGA_B',1,'return',22,'SAGA_B:exchange:11'),/UNIQUE/)
assert.throws(()=>addStep.run('SAGA_B',1,'wrong',22,'SAGA_B:invalid'),/CHECK/)
assert.equal(db.prepare('SELECT COUNT(*) AS n FROM admin_order_delete_saga_steps').get().n,1)
assert.equal(db.prepare('SELECT COUNT(*) AS n FROM orders').get().n,1)
db.close()
console.log('BRANCH2_0110_0111_ADDITIVE_IMMUTABLE_SAGA_SCHEMA_TEST_PASSED')
