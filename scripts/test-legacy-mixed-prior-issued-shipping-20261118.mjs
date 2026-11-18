import assert from 'node:assert/strict'
import fs from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {readPriorIssuedItemIds} from '../worker/domains/order-prior-issued-origin.ts'
import {buildOrderShipmentPlan} from '../worker/domains/order-shipment-plan.ts'
import {dispatchSelectedCompleteOrderLines} from '../worker/domains/order-dispatch.ts'
import {getOrder} from '../worker/domains/orders-write.ts'

const sql=new DatabaseSync(':memory:')
for(const f of fs.readdirSync('migrations').filter(s=>/^\d+.*\.sql$/.test(s)).sort())
  sql.exec(fs.readFileSync('migrations/'+f,'utf8'))
if(!sql.prepare("SELECT 1 FROM pragma_table_info('orders') WHERE name='manager_snapshot_name'").get())
  sql.exec('ALTER TABLE orders ADD COLUMN manager_snapshot_name TEXT')
const stmt=(q,p=[])=>({
  bind(...a){return stmt(q,a)},
  async first(){return sql.prepare(q).get(...p)||null},
  async all(){return {results:sql.prepare(q).all(...p)}},
  async run(){const result=sql.prepare(q).run(...p);return {meta:{changes:Number(result.changes),last_row_id:Number(result.lastInsertRowid)}}},
})
const db={
  prepare:q=>stmt(q),
  async batch(items){
    sql.exec('SAVEPOINT mixed_prior_issued')
    try{const out=[];for(const i of items)out.push(await i.run());sql.exec('RELEASE mixed_prior_issued');return out}
    catch(e){sql.exec('ROLLBACK TO mixed_prior_issued');sql.exec('RELEASE mixed_prior_issued');throw e}
  },
}
sql.exec(`
INSERT OR IGNORE INTO managers(id,name) VALUES(1,'Legacy Mixed Shipping QA');
INSERT INTO catalog_products(id,name,category,is_active) VALUES
(982001,'LEGACY MIXED PHYSICAL ITEM','adult',1);
INSERT INTO catalog_variants(id,product_id,gender,color,material,length,size_label,is_active)
VALUES (982011,982001,'ЖЕН','БЕЖЕВЫЙ','СТАНДАРТ','СТАНДАРТ','50',1);
INSERT INTO inventory_stock(id,inventory_source,product_id,variant_id,product_name_snapshot,
gender_snapshot,color_snapshot,material_snapshot,length_snapshot,size_snapshot,quantity,reserved_quantity)
VALUES(982021,'warehouse',982001,982011,'LEGACY MIXED PHYSICAL ITEM','ЖЕН','БЕЖЕВЫЙ','СТАНДАРТ','СТАНДАРТ','50',6,0);
INSERT INTO inventory_model_meta(key,value,updated_at)
VALUES('human_inventory_v2','active','2026-11-01T00:00:00Z')
ON CONFLICT(key) DO UPDATE SET value='active';
INSERT INTO orders(id,external_id,order_date,manager_id,order_status,source_type,workshop_status,
shipping_status,created_at,updated_at)
VALUES(9846,'ORD-LEGACY-MIXED-9846','2026-11-01',1,'active','warehouse','ready','not_sent',
'2026-11-01T09:21:57Z','2026-11-10T06:24:33Z');
INSERT INTO order_items(id,order_id,product_id,variant_id,product_name_snapshot,
quantity,unit_price,line_total,is_workshop,source_type,stock_writeoff_status,created_at)
VALUES
(98461,9846,982001,982011,'FIRST ALREADY SENT',1,500,500,0,'warehouse','fulfilled','2026-11-01T09:21:57Z'),
(98462,9846,982001,982011,'SECOND PRIOR ISSUE',1,500,500,0,'warehouse','fulfilled','2026-11-01T09:21:57Z'),
(98463,9846,NULL,NULL,'THIRD WORKSHOP SENT',1,500,500,1,'warehouse','workshop','2026-11-01T09:21:57Z');
INSERT INTO inventory_reservations(order_id,order_item_id,inventory_source,product_id,variant_id,
quantity,status,created_at,updated_at)
VALUES
(9846,98461,'warehouse',982001,982011,1,'fulfilled','2026-11-01T09:21:57Z','2026-11-10T06:24:33Z'),
(9846,98462,'warehouse',982001,982011,1,'fulfilled','2026-11-01T09:21:57Z','2026-11-08T06:49:24Z');
INSERT INTO workshop_tasks(order_id,external_order_id,order_item_id,product_name_snapshot,
quantity,status,created_at,updated_at)
VALUES(9846,'ORD-LEGACY-MIXED-9846',98463,'THIRD WORKSHOP SENT',1,'done',
'2026-11-01T09:21:57Z','2026-11-10T06:24:33Z');
INSERT INTO order_dispatches(id,order_id,request_id,dispatch_date,created_at,actor,status)
VALUES(984601,9846,'legacy-mixed-existing-9846','2026-11-10','2026-11-10T06:24:33Z','QA','sent');
INSERT INTO order_dispatch_items(dispatch_id,order_item_id,source_type,variant_id,
reservation_id,quantity,created_at)
VALUES
(984601,98461,'warehouse',982011,
 (SELECT id FROM inventory_reservations WHERE order_item_id=98461),1,'2026-11-10T06:24:33Z'),
(984601,98463,'workshop',NULL,NULL,1,'2026-11-10T06:24:33Z');
INSERT INTO activity_log(event_type,entity_type,entity_id,order_id,title,created_at)
VALUES('order_stock_handover_reconciled','order_item',98462,9846,'Verified handover',
'2026-11-08T06:49:24Z');
`)
const stockBefore={...sql.prepare('SELECT quantity,reserved_quantity FROM inventory_stock WHERE id=982021').get()}
const movementsBefore=sql.prepare('SELECT COUNT(*) AS n FROM inventory_movements').get().n
const proven=await readPriorIssuedItemIds(db,9846)
assert.deepEqual([...proven],[98462],'Only proven physical handover unlocks no-deduction dispatch')
const order=await getOrder(db,9846)
const reservations=sql.prepare('SELECT order_item_id,quantity,status,variant_id,inventory_source FROM inventory_reservations WHERE order_id=9846').all()
const plan=buildOrderShipmentPlan(order,reservations,proven)
assert.equal(plan.canConfirmIssuedOnly,false,'Mixed prior dispatched order does not qualify for all-lines V1 status-only flow')
assert.equal(plan.selectedCount,1,'Only the historical prior handover can still be confirmed')
const first=plan.lines.find(x=>x.orderItemId===98461)
const second=plan.lines.find(x=>x.orderItemId===98462)
const workshop=plan.lines.find(x=>x.orderItemId===98463)
assert.equal(first?.readyQuantity,0)
assert.equal(workshop?.readyQuantity,0)
assert.equal(second?.dispatchPriorIssued,true)
assert.equal(second?.readyQuantity,1)
assert.equal(second?.selectable,true)
const result=await dispatchSelectedCompleteOrderLines(db,9846,{
 requestId:'qa-legacy-mixed-issued-9846-01',
 items:[{orderItemId:98462,quantity:1}],
 actor:'QA verified already sent no physical write',
 dispatchDate:'2026-11-18',
})
assert.equal(result.ok,true)
assert.equal(result.shippedQuantity,1)
assert.equal(sql.prepare('SELECT shipping_status FROM orders WHERE id=9846').get().shipping_status,'sent')
assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM order_dispatch_items WHERE order_item_id IN(98461,98462,98463) AND cancelled_quantity=0').get().n,3)
assert.equal(sql.prepare('SELECT status FROM inventory_reservations WHERE order_item_id=98462').get().status,'fulfilled')
assert.equal(sql.prepare('SELECT stock_writeoff_status FROM order_items WHERE id=98462').get().stock_writeoff_status,'fulfilled')
assert.deepEqual({...sql.prepare('SELECT quantity,reserved_quantity FROM inventory_stock WHERE id=982021').get()},stockBefore)
assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM inventory_movements').get().n,movementsBefore,'No duplicate physical issuance')
const repeat=await dispatchSelectedCompleteOrderLines(db,9846,{
 requestId:'qa-legacy-mixed-issued-9846-01',items:[{orderItemId:98462,quantity:1}],actor:'QA',dispatchDate:'2026-11-18',
})
assert.equal(repeat.alreadyCommitted,true)
assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM order_dispatch_items WHERE order_item_id=98462').get().n,1,'Idempotent ledger')
assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM inventory_movements').get().n,movementsBefore)
const unreadable={...order,id:9847,shipping_status:'not_sent',items:order.items.map(x=>x.id===98462?{...x,id:999999,shipmentSentQuantity:null}:x)}
const unknown=buildOrderShipmentPlan(unreadable,reservations,new Set())
assert.equal(unknown.lines.find(x=>x.orderItemId===999999).selectable,false,'No evidence = no inferred prior handover')
sql.close()
console.log('LEGACY_MIXED_PRIOR_ISSUED_DISPATCH_PASS: three lines fully sent, exact receipt, no inventory change, idempotent, no false proof')
