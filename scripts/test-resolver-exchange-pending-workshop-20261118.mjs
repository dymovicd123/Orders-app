import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {catalogReviewOrderScopePredicate} from '../worker/domains/catalog-review.ts'
import {buildOrderShipmentPlan} from '../worker/domains/order-shipment-plan.ts'

const db=new DatabaseSync(':memory:')
db.exec(`
CREATE TABLE orders(id INTEGER PRIMARY KEY,shipping_status TEXT,order_status TEXT,archived_at TEXT);
CREATE TABLE order_items(id INTEGER PRIMARY KEY,order_id INTEGER,product_id INTEGER,variant_id INTEGER,is_workshop INTEGER,quantity INTEGER,stock_writeoff_status TEXT);
CREATE TABLE workshop_tasks(id INTEGER PRIMARY KEY,order_item_id INTEGER,order_id INTEGER,quantity INTEGER,status TEXT);
INSERT INTO orders VALUES(2222,'sent','active',NULL);
INSERT INTO order_items VALUES(5279,2222,79,1996,0,0,'exchanged');
INSERT INTO order_items VALUES(5280,2222,12,1892,0,1,'fulfilled');
INSERT INTO order_items VALUES(5282,2222,NULL,NULL,1,1,'workshop');
INSERT INTO workshop_tasks VALUES(2552,5282,2222,1,'active');
`)
const predicate=catalogReviewOrderScopePredicate('oi','o')
const relevantCount=()=>Number(db.prepare(`SELECT COUNT(*) n FROM order_items oi JOIN orders o ON o.id=oi.order_id
 WHERE oi.quantity>0 AND (oi.product_id IS NULL OR oi.variant_id IS NULL)
 AND (${predicate}) AND o.id=2222`).get().n)
assert.equal(relevantCount(),0,'Not-ready workshop replacement must not open Resolver')
const order={
 id:2222,external_id:'ORD-EXCHANGE-QA',created_at:'2026-11-18T08:29:28Z',
 shipping_status:'sent',order_status:'active',committed_exchange_count:1,
 items:[
  {id:5279,productName:'ЭТНО БОМБЕР',quantity:0,sourceType:'boutique',stockWriteoffStatus:'exchanged'},
  {id:5280,productName:'КЕРБЕЗ КӨЙЛЕК',quantity:1,sourceType:'boutique',stockWriteoffStatus:'fulfilled',shipmentSentQuantity:1},
  {id:5282,productName:'ЭТНО БОМБЕР',quantity:1,sourceType:'workshop',isWorkshop:true,stockWriteoffStatus:'workshop',workshopTaskStatus:'active',pendingExchangeWorkshopId:1},
 ]
}
const plan=buildOrderShipmentPlan(order,[])
assert.equal(plan.lines.length,2,'Replaced item must not be offered again')
assert.equal(plan.lines.find(x=>x.orderItemId===5282).readyQuantity,0)
assert.equal(plan.lines.find(x=>x.orderItemId===5282).reason,'Ещё не готов')
assert.equal(plan.lines.find(x=>x.orderItemId===5280).readyQuantity,0)
db.exec("UPDATE workshop_tasks SET status='ready' WHERE id=2552")
assert.equal(relevantCount(),1,'Once ready, still-unknown workshop identity may be reviewed')
const readyOrder={...order,items:order.items.map(i=>i.id===5282?{...i,workshopTaskStatus:'ready'}:i)}
assert.equal(buildOrderShipmentPlan(readyOrder,[]).lines.find(x=>x.orderItemId===5282).readyQuantity,1)
db.close()
console.log('RESOLVER_EXCHANGE_PENDING_WORKSHOP_GATE_PASS: ready-only review, no replaced line, accurate shipping readiness')
