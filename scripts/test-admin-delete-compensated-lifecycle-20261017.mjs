// Exercise the ACTUAL lifecycle cancellation on a compensated Exchange sale,
// not a mocked stock setter. The original -1 and handover-correction +1 remain
// immutable; order deletion must not add a THIRD movement / extra stock unit.
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {cancelInventoryLifecycleEvent} from '../worker/domains/lifecycle.ts'
const sql=new DatabaseSync(':memory:')
sql.exec(`
CREATE TABLE orders(id INTEGER PRIMARY KEY,external_id TEXT);
CREATE TABLE catalog_products(id INTEGER PRIMARY KEY,name TEXT,category TEXT,is_active INTEGER);
CREATE TABLE catalog_variants(id INTEGER PRIMARY KEY,product_id INTEGER,category TEXT,gender TEXT,color TEXT,material TEXT,length TEXT,size_label TEXT,is_active INTEGER);
CREATE TABLE inventory_lifecycle_events(id INTEGER PRIMARY KEY,event_key TEXT,operation_type TEXT,operation_id INTEGER,operation_item_id INTEGER,order_id INTEGER,order_item_id INTEGER,event_type TEXT,direction TEXT,inventory_source TEXT,quantity INTEGER,product_id INTEGER,variant_id INTEGER,status TEXT,movement_id INTEGER,applied_at TEXT,created_at TEXT,cancelled_at TEXT,updated_at TEXT,resolution_comment TEXT,reversal_movement_id INTEGER);
CREATE TABLE inventory_movements(id INTEGER PRIMARY KEY,inventory_source TEXT,movement_type TEXT,variant_id INTEGER,quantity_delta INTEGER,quantity_after INTEGER,reference_type TEXT,reference_id TEXT,created_at TEXT);
CREATE TABLE inventory_stock(id INTEGER PRIMARY KEY,inventory_source TEXT,variant_id INTEGER,quantity INTEGER,reserved_quantity INTEGER);
CREATE TABLE inventory_reservations(id INTEGER PRIMARY KEY,order_item_id INTEGER,status TEXT,released_at TEXT,updated_at TEXT);
CREATE TABLE inventory_stock_checks(id INTEGER PRIMARY KEY,inventory_source TEXT,variant_id INTEGER,checked_at TEXT);
CREATE TABLE inventory_stocktake_sessions(id TEXT PRIMARY KEY,inventory_source TEXT,status TEXT,started_at TEXT);
INSERT INTO orders VALUES(9,'ORDER_TEST_9');
INSERT INTO catalog_products VALUES(1,'АБАЙ ШАПАН','adult',1);
INSERT INTO catalog_variants(id,product_id,category,is_active) VALUES(1465,1,'adult',1);
INSERT INTO inventory_stock VALUES(1,'warehouse',1465,60,1);
INSERT INTO inventory_reservations VALUES(13,15,'active',NULL,NULL);
INSERT INTO inventory_movements VALUES(12,'warehouse','sale',1465,-1,59,'exchange_new','2','2026-10-14T14:46:43.892Z');
INSERT INTO inventory_movements VALUES(13,'warehouse','revision',1465,1,60,'order_handover_correction','ORDER_TEST_9','2026-10-14T14:47:13.361Z');
INSERT INTO inventory_lifecycle_events
(id,event_key,operation_type,operation_id,operation_item_id,order_id,order_item_id,event_type,direction,inventory_source,quantity,product_id,variant_id,status,movement_id,applied_at,created_at)
VALUES (7,'exchange:2:new:8','exchange',2,8,9,15,'exchange_new_out','out','warehouse',1,1,1465,'applied',12,'2026-10-14T14:46:43.892Z','2026-10-14T14:46:43.892Z');
`)
const make=(query,params=[])=>({
  bind(...args){return make(query,args)},
  async first(){return sql.prepare(query).get(...params)||null},
  async all(){return {results:sql.prepare(query).all(...params)}},
  async run(){const result=sql.prepare(query).run(...params);return {success:true,meta:{changes:result.changes}}},
  _run(){return sql.prepare(query).run(...params)},
})
const db={prepare(query){return make(query)},async batch(statements){
  sql.exec('BEGIN')
  try{const rows=statements.map(x=>x._run());sql.exec('COMMIT');return rows}
  catch(e){sql.exec('ROLLBACK');throw e}
}}
const beforeStock=sql.prepare('SELECT quantity,reserved_quantity FROM inventory_stock WHERE id=1').get()
const beforeMovements=sql.prepare('SELECT id,quantity_delta FROM inventory_movements ORDER BY id').all()
assert.deepEqual(beforeMovements.map(x=>[x.id,x.quantity_delta]),[[12,-1],[13,1]])
const outcome=await cancelInventoryLifecycleEvent(db,7,'2026-10-17T19:00:00Z','Аннулирование ошибочного обмена')
assert.equal(outcome.cancelled,true)
assert.equal(outcome.physicalReversalSkipped,true)
assert.equal(outcome.physicalReversalReason,'already_compensated_handover')
assert.equal(outcome.quantityDelta,0)
assert.deepEqual(sql.prepare('SELECT quantity,reserved_quantity FROM inventory_stock WHERE id=1').get(),beforeStock)
assert.deepEqual(sql.prepare('SELECT id,quantity_delta FROM inventory_movements ORDER BY id').all(),beforeMovements)
const after=sql.prepare('SELECT status,reversal_movement_id,resolution_comment FROM inventory_lifecycle_events WHERE id=7').get()
assert.equal(after.status,'cancelled')
assert.equal(after.reversal_movement_id,null)
assert.match(after.resolution_comment,/уже компенсировано/)
assert.equal(sql.prepare('SELECT status FROM inventory_reservations WHERE id=13').get().status,'active',
  'The Exchange handler, not lifecycle, separately releases the active reservation')
const replay=await cancelInventoryLifecycleEvent(db,7,'2026-10-17T19:01:00Z','retry')
assert.equal(replay.already,true)
assert.deepEqual(sql.prepare('SELECT quantity,reserved_quantity FROM inventory_stock WHERE id=1').get(),beforeStock)
assert.deepEqual(sql.prepare('SELECT id,quantity_delta FROM inventory_movements ORDER BY id').all(),beforeMovements)
sql.close()
console.log('COMPENSATED_APPLIED_EXCHANGE_LIFECYCLE_EXACTLY_ONCE_NO_STOCK_DOUBLE_CREDIT_PASSED')
