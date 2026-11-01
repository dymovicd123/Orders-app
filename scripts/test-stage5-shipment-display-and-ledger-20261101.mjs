import assert from 'node:assert/strict'
import fs from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { projectOrderShipmentDisplay } from '../src/app/orderShipmentProjection.ts'

const item=(id,more={})=>({id,productName:'TEST',sourceType:'warehouse',quantity:1,stockWriteoffStatus:'reserved',...more})
const projection=(items,shipping_status='not_sent')=>projectOrderShipmentDisplay({items,shipping_status})

let p=projection([item(1),item(2)])
assert.equal(p.label,'Не отправлен')
assert.deepEqual(p.lines.map(x=>x.label),['Не отправлен','Не отправлен'])
p=projection([item(1,{stockWriteoffStatus:'fulfilled'}),item(2)])
assert.equal(p.label,'Частично отправлено')
assert.deepEqual(p.lines.map(x=>x.label),['Отправлен','Не отправлен'])
p=projection([item(1,{stockWriteoffStatus:'fulfilled'}),item(2,{stockWriteoffStatus:'fulfilled'})])
assert.equal(p.label,'Отправлен')
p=projection([item(1,{sourceType:'workshop',isWorkshop:true,workshopTaskStatus:'done'}),item(2)])
assert.equal(p.lines[0].label,'Не отправлен','Workshop ready is not shipped')
p=projection([item(1,{stockWriteoffStatus:'fulfilled'}),item(2,{sourceType:'workshop',isWorkshop:true,workshopTaskStatus:'active'})])
assert.equal(p.label,'Частично отправлено','Earlier warehouse handover is not reset by workshop readiness')
p=projection([item(1,{quantity:3,shipmentSentQuantity:1}),item(2)])
assert.equal(p.lines[0].label,'Отправлено 1 из 3')
assert.equal(p.label,'Частично отправлено')
p=projection([item(1,{quantity:3,shipmentSentQuantity:3}),item(2,{quantity:1,shipmentSentQuantity:1})])
assert.equal(p.label,'Отправлен')
p=projection([item(1,{stockWriteoffStatus:'reservation_released'})])
assert.equal(p.lines[0].state,'unknown','Returned historic item cannot be labeled never sent')
p=projection([item(1,{stockWriteoffStatus:'reservation_released'})],'sent')
assert.equal(p.lines[0].state,'sent','A legacy whole-order sent fact must not disappear')
p=projection([item(1,{pendingExchangeDispatchId:22})],'sent')
assert.equal(p.lines[0].state,'not_sent','New exchange replacement still awaiting dispatch')
p=projection([item(1,{stockWriteoffStatus:'fulfilled'}),item(2,{pendingExchangeDispatchId:22})],'sent')
assert.equal(p.label,'Частично отправлено','Old sent order with unshipped replacement is partial')
assert.notEqual(p.lines[1].label,'Отправлен')

// Standalone migration check: future select/undo must be uniquely identified and
// must not rewrite a historical shipment without an independent correction.
const db=new DatabaseSync(':memory:')
db.exec(`CREATE TABLE orders(id INTEGER PRIMARY KEY);
CREATE TABLE order_items(id INTEGER PRIMARY KEY);
CREATE TABLE catalog_variants(id INTEGER PRIMARY KEY);
CREATE TABLE inventory_reservations(id INTEGER PRIMARY KEY);
CREATE TABLE inventory_movements(id INTEGER PRIMARY KEY);
INSERT INTO orders VALUES(1);INSERT INTO order_items VALUES(10);`)
db.exec(fs.readFileSync('migrations/0119_v72_order_dispatch_lineage.sql','utf8'))
db.exec(`INSERT INTO order_dispatches(order_id,request_id,dispatch_date,created_at,status)
VALUES(1,'dispatch-1','2026-11-01','2026-11-01T12:00:00Z','sent')`)
assert.throws(()=>db.exec(`INSERT INTO order_dispatches(order_id,request_id,dispatch_date,created_at)
VALUES(1,'dispatch-1','2026-11-01','2026-11-01T12:00:00Z')`),/UNIQUE/, 'Retry cannot create a second batch')
db.exec(`INSERT INTO order_dispatch_items(dispatch_id,order_item_id,source_type,quantity,created_at)
VALUES(1,10,'warehouse',3,'2026-11-01T12:00:00Z')`)
assert.throws(()=>db.exec(`INSERT INTO order_dispatch_items(dispatch_id,order_item_id,source_type,quantity,created_at)
VALUES(1,10,'warehouse',1,'2026-11-01T12:00:00Z')`),/UNIQUE/,'Duplicate item in same shipment forbidden')
assert.throws(()=>db.exec(`UPDATE order_dispatch_items SET cancelled_quantity=4 WHERE id=1`),/CHECK/,'Cannot cancel more units than issued')
db.exec(`INSERT INTO order_dispatch_corrections(dispatch_item_id,request_id,quantity,stock_restored,reason,created_at)
VALUES(1,'undo-1',1,0,'Marked shipped by mistake','2026-11-01T12:01:00Z')`)
assert.throws(()=>db.exec(`INSERT INTO order_dispatch_corrections(dispatch_item_id,request_id,quantity,stock_restored,reason,created_at)
VALUES(1,'undo-1',1,0,'retry','2026-11-01T12:02:00Z')`),/UNIQUE/,'Repeated undo request must not duplicate')
assert.equal(db.prepare('SELECT quantity FROM order_dispatch_items WHERE id=1').get().quantity,3,'Original shipment immutable in correction log')
db.close()
const table=fs.readFileSync('src/features/sections/OrdersTableSection.tsx','utf8')
assert.match(table,/projectOrderShipmentDisplay\(order\)/)
assert.match(table,/order-item-shipment-status/)
assert.match(table,/shipmentDisplay\.label/)
console.log('STAGE5_LINE_SHIPMENT_LABELS_AND_LEDGER_FOUNDATION_PASS')
