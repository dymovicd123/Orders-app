import assert from 'node:assert/strict'
import fs from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {dispatchSelectedCompleteOrderLines} from '../worker/domains/order-dispatch.ts'
import {cancelExactOrderDispatchItem} from '../worker/domains/order-dispatch-cancel.ts'

const sql=new DatabaseSync(':memory:')
const migrations=fs.readdirSync('migrations').filter(s=>/^\d+.*\.sql$/.test(s)).sort()
for(const m of migrations) sql.exec(fs.readFileSync('migrations/'+m,'utf8'))
// Historical seed gap is repaired in DISPOSABLE test DB only.
if(!sql.prepare("SELECT 1 FROM pragma_table_info('orders') WHERE name='manager_snapshot_name'").get()){
 sql.exec('ALTER TABLE orders ADD COLUMN manager_snapshot_name TEXT')
}
const stmt=(query,bindings=[])=>({
 bind(...v){return stmt(query,v)},
 async first(){return sql.prepare(query).get(...bindings)||null},
 async all(){return {results:sql.prepare(query).all(...bindings)}},
 async run(){const d=sql.prepare(query).run(...bindings);return{meta:{changes:Number(d.changes),last_row_id:Number(d.lastInsertRowid)}}},
})
const db={
 prepare:q=>stmt(q),
 async batch(statements){
  sql.exec('SAVEPOINT dispatch_atomic')
  try {const out=[];for(const s of statements)out.push(await s.run());sql.exec('RELEASE dispatch_atomic');return out}
  catch(e){sql.exec('ROLLBACK TO SAVEPOINT dispatch_atomic');sql.exec('RELEASE dispatch_atomic');throw e}
 },
}
sql.prepare("INSERT OR IGNORE INTO managers(id,name) VALUES(1,'Stage5 tester')").run()
sql.prepare("INSERT INTO catalog_products(id,name,category,is_active) VALUES(9021,'DISPATCH EXACT SKU','adult',1)").run()
sql.prepare("INSERT INTO catalog_variants(id,product_id,gender,color,material,length,size_label,is_active) VALUES(9031,9021,'МУЖ','БЕЖ','СТАНДАРТ','СТАНДАРТ','50',1)").run()
sql.prepare("INSERT INTO inventory_stock(id,inventory_source,product_id,variant_id,product_name_snapshot,gender_snapshot,color_snapshot,material_snapshot,length_snapshot,size_snapshot,quantity,reserved_quantity) VALUES(9041,'warehouse',9021,9031,'DISPATCH EXACT SKU','МУЖ','БЕЖ','СТАНДАРТ','СТАНДАРТ','50',10,2)").run()
sql.prepare("INSERT INTO orders(id,external_id,order_date,manager_id,order_status,source_type,workshop_status,shipping_status,created_at,updated_at) VALUES(9051,'ORD-TEST-STAGE5B','2026-11-01',1,'active','warehouse','ready','not_sent','2026-11-01T00:00:00Z','2026-11-01T00:00:00Z')").run()
for(const id of [9061,9062]) {
 sql.prepare("INSERT INTO order_items(id,order_id,product_id,variant_id,product_name_snapshot,gender_snapshot,color_snapshot,material_snapshot,length_snapshot,size_snapshot,quantity,unit_price,line_total,is_workshop,source_type,stock_writeoff_status,created_at) VALUES(?,9051,9021,9031,'DISPATCH EXACT SKU','МУЖ','БЕЖ','СТАНДАРТ','СТАНДАРТ','50',1,1000,1000,0,'warehouse','reserved','2026-11-01T00:00:00Z')").run(id)
 sql.prepare("INSERT INTO inventory_reservations(order_id,order_item_id,inventory_source,product_id,variant_id,quantity,status,created_at,updated_at) VALUES(9051,?,'warehouse',9021,9031,1,'active','2026-11-01T00:00:00Z','2026-11-01T00:00:00Z')").run(id)
}
sql.prepare("INSERT INTO inventory_model_meta(key,value,updated_at) VALUES('human_inventory_v2','active','2026-11-01T00:00:00Z') ON CONFLICT(key) DO UPDATE SET value='active'").run()

const stock=()=>sql.prepare("SELECT quantity,reserved_quantity FROM inventory_stock WHERE id=9041").get()
const refs=()=>sql.prepare("SELECT reference_id,quantity_delta FROM inventory_movements WHERE reference_type='order_dispatch' ORDER BY id").all()
const state=()=>sql.prepare("SELECT shipping_status FROM orders WHERE id=9051").get().shipping_status
const dispatch=(key,items)=>dispatchSelectedCompleteOrderLines(db,9051,{requestId:key,items,actor:'QA manager',dispatchDate:'2026-11-01'})
const before=stock()
assert.deepEqual({ ...before },{quantity:10,reserved_quantity:2})
const first=await dispatch('stage5b-test-dispatch-0001',[{orderItemId:9061,quantity:1}])
assert.equal(first.ok,true)
assert.equal(first.shippedLines,1)
assert.deepEqual({...stock()},{quantity:9,reserved_quantity:1})
assert.equal(state(),'not_sent')
assert.equal(sql.prepare("SELECT status FROM inventory_reservations WHERE order_item_id=9061").get().status,'fulfilled')
assert.equal(sql.prepare("SELECT status FROM inventory_reservations WHERE order_item_id=9062").get().status,'active')
assert.equal(refs().length,1)
const replay=await dispatch('stage5b-test-dispatch-0001',[{orderItemId:9061,quantity:1}])
assert.equal(replay.alreadyCommitted,true)
assert.equal(refs().length,1)
await assert.rejects(dispatch('stage5b-test-dispatch-0001',[{orderItemId:9062,quantity:1}]),/другим набором/)
await assert.rejects(dispatch('stage5b-test-dispatch-0002',[{orderItemId:9061,quantity:1}]),/ещё не готов|Товар изменился|выдан/)
assert.equal(refs().length,1)
const second=await dispatch('stage5b-test-dispatch-0003',[{orderItemId:9062,quantity:1}])
assert.equal(second.ok,true)
assert.deepEqual({...stock()},{quantity:8,reserved_quantity:0})
assert.equal(state(),'sent')
assert.equal(refs().length,2)
const cancelItem=sql.prepare("SELECT id FROM order_dispatch_items WHERE order_item_id=9061").get().id
const canceled=await cancelExactOrderDispatchItem(db,9051,{dispatchItemId:cancelItem,requestId:'stage5b-test-undo-0001',actor:'QA manager',reason:'Marked shipped in error'})
assert.equal(canceled.ok,true)
assert.equal(canceled.cancelledQuantity,1)
assert.equal(canceled.physicalRestoredQuantity,1)
assert.equal(state(),'not_sent')
assert.deepEqual({...stock()},{quantity:9,reserved_quantity:1})
assert.equal(sql.prepare("SELECT status FROM inventory_reservations WHERE order_item_id=9061").get().status,'active')
assert.equal(sql.prepare("SELECT status FROM inventory_reservations WHERE order_item_id=9062").get().status,'fulfilled')
assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM order_dispatch_corrections").get().n,1)
const cancelReplay=await cancelExactOrderDispatchItem(db,9051,{dispatchItemId:cancelItem,requestId:'stage5b-test-undo-0001',actor:'QA manager',reason:'retry'})
assert.equal(cancelReplay.alreadyCorrected,true)
assert.deepEqual({...stock()},{quantity:9,reserved_quantity:1})
await assert.rejects(cancelExactOrderDispatchItem(db,9051,{dispatchItemId:cancelItem,requestId:'stage5b-test-undo-0002',actor:'QA manager',reason:'new key'}),/уже исправили/)
assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM inventory_movements WHERE reference_type='order_dispatch_correction'").get().n,1)
// A completed Return on a THIRD line is not a reason to block normal
// dispatch or cancellation of unrelated lines in the same order.
sql.prepare("INSERT INTO order_items(id,order_id,product_id,variant_id,product_name_snapshot,quantity,unit_price,line_total,is_workshop,source_type,stock_writeoff_status,created_at) VALUES(9063,9051,9021,9031,'DISPATCH EXACT SKU',1,1000,1000,0,'warehouse','fulfilled','2026-11-01T00:00:00Z')").run()
sql.prepare("INSERT INTO returns(id,order_id,manager_id,return_date,amount,comment,created_at) VALUES(9071,9051,1,'2026-11-01',0,'Fixture unrelated Return','2026-11-01T00:00:00Z')").run()
sql.prepare("INSERT INTO return_items(return_id,order_item_id,product_name_snapshot,quantity,amount,created_at) VALUES(9071,9063,'DISPATCH EXACT SKU',1,0,'2026-11-01T00:00:00Z')").run()

// Bring the remaining shipped line back to active, then atomically dispatch
// two separate order lines for the SAME physical SKU in one request.
const oldSecondItem=sql.prepare("SELECT id FROM order_dispatch_items WHERE order_item_id=9062").get().id
const correctedOther=await cancelExactOrderDispatchItem(db,9051,{
 dispatchItemId:oldSecondItem,requestId:'stage5b-test-undo-0003',actor:'QA manager',reason:'Wrong last shipment',
})
assert.equal(correctedOther.ok,true)
assert.deepEqual({...stock()},{quantity:10,reserved_quantity:2})
const group=await dispatch('stage5b-test-dispatch-group-01',[
 {orderItemId:9061,quantity:1},{orderItemId:9062,quantity:1},
])
assert.equal(group.shippedLines,2)
assert.deepEqual({...stock()},{quantity:8,reserved_quantity:0})
assert.equal(state(),'sent')
const groupId=group.dispatchId
const groupItems=sql.prepare("SELECT id,order_item_id,movement_id FROM order_dispatch_items WHERE dispatch_id=? ORDER BY order_item_id").all(groupId)
assert.equal(groupItems.length,2)
assert(groupItems.every(x=>x.movement_id>0),'Every exact outgoing line has a movement ID')
assert.notEqual(groupItems[0].movement_id,groupItems[1].movement_id)
assert.equal(sql.prepare("SELECT status FROM inventory_reservations WHERE order_item_id=9061").get().status,'fulfilled')

// A later physical revision overwrote the stock baseline. Correcting the
// earlier dispatch must NEVER manufacture a +1 on the counted physical stock.
sql.prepare("INSERT INTO inventory_movements(inventory_source,movement_type,product_id,variant_id,product_name_snapshot,quantity_delta,quantity_after,reference_type,reference_id,created_at) VALUES('warehouse','revision',9021,9031,'DISPATCH EXACT SKU',0,8,'test','after-dispatch','2099-01-01T00:00:00Z')").run()
const countedUndo=await cancelExactOrderDispatchItem(db,9051,{
 dispatchItemId:groupItems[0].id,requestId:'stage5b-test-undo-after-count-01',
 actor:'QA manager',reason:'Shipment marked too early',
})
assert.equal(countedUndo.ok,true)
assert.equal(countedUndo.physicalRestoredQuantity,0)
assert.equal(countedUndo.needsStockCheck,true)
assert.deepEqual({...stock()},{quantity:8,reserved_quantity:0},
 'Revision after dispatch forbids both phantom physical restore and phantom hold')
assert.equal(sql.prepare("SELECT status FROM inventory_reservations WHERE order_item_id=9061").get().status,'unresolved')
assert.equal(sql.prepare("SELECT stock_writeoff_status FROM order_items WHERE id=9061").get().stock_writeoff_status,'pending_reservation')
assert.equal(sql.prepare("SELECT status FROM inventory_reservations WHERE order_item_id=9062").get().status,'fulfilled')
assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM return_items WHERE return_id=9071").get().n,1,
  'Unrelated completed Return is retained unchanged')

// Send ONE of three identical physical units on a single original order line.
// The issued line keeps its stable ID; a second, active row owns the remaining
// two units. This preserves the established one-reservation-per-order-item rule.
sql.prepare("INSERT INTO orders(id,external_id,order_date,manager_id,order_status,source_type,workshop_status,shipping_status,created_at,updated_at) VALUES(9052,'ORD-TEST-THREE-UNITS','2026-11-01',1,'active','warehouse','ready','not_sent','2026-11-01T00:00:00Z','2026-11-01T00:00:00Z')").run()
sql.prepare("INSERT INTO order_items(id,order_id,product_id,variant_id,product_name_snapshot,gender_snapshot,color_snapshot,material_snapshot,length_snapshot,size_snapshot,quantity,unit_price,line_total,is_workshop,source_type,stock_writeoff_status,created_at,inventory_obligation_key,inventory_obligation_origin_at) VALUES(9064,9052,9021,9031,'DISPATCH EXACT SKU','МУЖ','БЕЖ','СТАНДАРТ','СТАНДАРТ','50',3,1000,3000,0,'warehouse','reserved','2026-11-01T00:00:00Z','stage5b-3-of-same','2026-11-01T00:00:00Z')").run()
sql.prepare("INSERT INTO inventory_reservations(order_id,order_item_id,inventory_source,product_id,variant_id,quantity,status,created_at,updated_at) VALUES(9052,9064,'warehouse',9021,9031,3,'active','2026-11-01T00:00:00Z','2026-11-01T00:00:00Z')").run()
sql.prepare('UPDATE inventory_stock SET reserved_quantity=reserved_quantity+3 WHERE id=9041').run()
const stockBeforeSplit={...stock()}
const firstPart=await dispatchSelectedCompleteOrderLines(db,9052,{requestId:'stage5b-test-one-of-three-001',actor:'QA manager',dispatchDate:'2026-11-01',items:[{orderItemId:9064,quantity:1}]})
assert.equal(firstPart.ok,true)
assert.equal(firstPart.shippedQuantity,1)
assert.deepEqual({...stock()},{quantity:stockBeforeSplit.quantity-1,reserved_quantity:stockBeforeSplit.reserved_quantity-1})
const splitRows=sql.prepare("SELECT id,quantity,unit_price,line_total,stock_writeoff_status,variant_id,source_type FROM order_items WHERE order_id=9052 ORDER BY id").all()
assert.equal(splitRows.length,2,'One selected original plus one new outstanding row')
assert.equal(splitRows[0].id,9064)
assert.equal(splitRows[0].quantity,1)
assert.equal(splitRows[0].stock_writeoff_status,'fulfilled')
assert.equal(splitRows[1].quantity,2)
assert.equal(splitRows[1].stock_writeoff_status,'reserved')
assert.equal(splitRows[1].variant_id,9031,'Canonical SKU must not change on split')
assert.equal(splitRows[1].source_type,'warehouse')
assert.equal(splitRows.reduce((n,x)=>n+x.line_total,0),3000,'Split cannot change booked money')
const splitRes=sql.prepare("SELECT order_item_id,status,quantity FROM inventory_reservations WHERE order_id=9052 ORDER BY order_item_id").all()
assert.deepEqual(splitRes.map(x=>({status:x.status,quantity:x.quantity})),[
 {status:'fulfilled',quantity:1},{status:'active',quantity:2},
])
assert.equal(sql.prepare('SELECT shipping_status FROM orders WHERE id=9052').get().shipping_status,'not_sent')
const repeatPart=await dispatchSelectedCompleteOrderLines(db,9052,{requestId:'stage5b-test-one-of-three-001',actor:'QA manager',dispatchDate:'2026-11-01',items:[{orderItemId:9064,quantity:1}]})
assert.equal(repeatPart.alreadyCommitted,true)
assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM order_items WHERE order_id=9052').get().n,2,'Replay must not split again')
const part2=await dispatchSelectedCompleteOrderLines(db,9052,{requestId:'stage5b-test-second-of-three',actor:'QA manager',dispatchDate:'2026-11-01',items:[{orderItemId:splitRows[1].id,quantity:1}]})
assert.equal(part2.ok,true)
assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM order_items WHERE order_id=9052').get().n,3)
const last=sql.prepare("SELECT id FROM order_items WHERE order_id=9052 AND stock_writeoff_status='reserved'").get()
assert(last?.id)
const lastPart=await dispatchSelectedCompleteOrderLines(db,9052,{requestId:'stage5b-test-third-of-three',actor:'QA manager',dispatchDate:'2026-11-01',items:[{orderItemId:last.id,quantity:1}]})
assert.equal(lastPart.ok,true)
assert.equal(sql.prepare('SELECT shipping_status FROM orders WHERE id=9052').get().shipping_status,'sent')
assert.equal(sql.prepare('SELECT SUM(quantity) AS q FROM order_items WHERE order_id=9052').get().q,3)
assert.equal(sql.prepare("SELECT SUM(quantity) AS q FROM inventory_reservations WHERE order_id=9052 AND status='fulfilled'").get().q,3)


// A historically sent order can gain TWO new replacement lines. Both must be
// selected/committed through the SAME dispatch/ledger, never N exchange actions.
sql.prepare("INSERT INTO catalog_variants(id,product_id,gender,color,material,length,size_label,is_active) VALUES(9032,9021,'МУЖ','ЧЕРНЫЙ','СТАНДАРТ','СТАНДАРТ','50',1)").run()
sql.prepare("INSERT INTO inventory_stock(id,inventory_source,product_id,variant_id,product_name_snapshot,gender_snapshot,color_snapshot,material_snapshot,length_snapshot,size_snapshot,quantity,reserved_quantity) VALUES(9042,'warehouse',9021,9032,'DISPATCH REPLACEMENT','МУЖ','ЧЕРНЫЙ','СТАНДАРТ','СТАНДАРТ','50',5,2)").run()
sql.prepare("INSERT INTO orders(id,external_id,order_date,manager_id,order_status,source_type,workshop_status,shipping_status,created_at,updated_at) VALUES(9053,'ORD-TEST-TWO-REPLACEMENTS','2026-11-01',1,'active','warehouse','ready','sent','2026-11-01T00:00:00Z','2026-11-01T00:00:00Z')").run()
sql.prepare("INSERT INTO order_items(id,order_id,product_id,variant_id,product_name_snapshot,quantity,unit_price,line_total,is_workshop,source_type,stock_writeoff_status,created_at) VALUES(9967,9053,9021,9032,'OLD EXCHANGED',0,1000,0,0,'warehouse','exchanged','2026-11-01T00:00:00Z')").run()
for(const [index,itemId] of [9965,9966].entries()){
 const exchangeId=9081+index,eventId=9083+index
 sql.prepare("INSERT INTO order_items(id,order_id,product_id,variant_id,product_name_snapshot,gender_snapshot,color_snapshot,material_snapshot,length_snapshot,size_snapshot,quantity,unit_price,line_total,is_workshop,source_type,stock_writeoff_status,created_at) VALUES(?,9053,9021,9032,'DISPATCH REPLACEMENT','МУЖ','ЧЕРНЫЙ','СТАНДАРТ','СТАНДАРТ','50',1,1000,1000,0,'warehouse','reserved','2026-11-01T00:00:00Z')").run(itemId)
 sql.prepare("INSERT INTO inventory_reservations(order_id,order_item_id,inventory_source,product_id,variant_id,quantity,status,created_at,updated_at) VALUES(9053,?,'warehouse',9021,9032,1,'active','2026-11-01T00:00:00Z','2026-11-01T00:00:00Z')").run(itemId)
 sql.prepare("INSERT INTO exchanges(id,order_id,exchange_date,old_order_item_id,old_quantity,new_order_item_id,new_source_type,financial_action,financial_amount,status,created_at) VALUES(?,9053,'2026-11-01',9967,1,?,'warehouse','none',0,'completed','2026-11-01T00:00:00Z')").run(exchangeId,itemId)
 sql.prepare("INSERT INTO inventory_lifecycle_events(id,event_key,operation_type,operation_id,order_id,order_item_id,event_type,direction,inventory_source,quantity,product_id,variant_id,status,pending_reason,created_at,updated_at) VALUES(? ,?,'exchange',?,9053,?,'exchange_new_out','out','warehouse',1,9021,9032,'pending','awaiting_dispatch','2026-11-01T00:00:00Z','2026-11-01T00:00:00Z')").run(eventId,'test-exchange-'+exchangeId,exchangeId,itemId)
}
const previewSent=await import('../worker/domains/orders-write.ts').then(m=>m.getOrder(db,9053))
assert.equal(previewSent.shipping_status,'sent')
assert.equal(previewSent.items.filter(i=>Number(i.pendingExchangeDispatchId)>0).length,2)
const exchangeBatch=await dispatchSelectedCompleteOrderLines(db,9053,{
 requestId:'stage5b-two-replacements-one-batch-0001',
 items:[{orderItemId:9965,quantity:1},{orderItemId:9966,quantity:1}],
 actor:'QA manager',dispatchDate:'2026-11-01',
})
assert.equal(exchangeBatch.ok,true)
assert.equal(exchangeBatch.shippedLines,2)
assert.deepEqual({...sql.prepare("SELECT quantity,reserved_quantity FROM inventory_stock WHERE id=9042").get()}, {quantity:3,reserved_quantity:0})
const events=()=>sql.prepare("SELECT id,status,pending_reason,movement_id FROM inventory_lifecycle_events WHERE operation_id IN(9081,9082) ORDER BY id").all()
assert(events().every(x=>x.status==='applied'&&x.movement_id>0))
assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM order_dispatch_items WHERE dispatch_id=?").get(exchangeBatch.dispatchId).n,2)
assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM inventory_movements WHERE reference_type='order_dispatch' AND variant_id=9032").get().n,2)
const exchangeReplay=await dispatchSelectedCompleteOrderLines(db,9053,{requestId:'stage5b-two-replacements-one-batch-0001',items:[{orderItemId:9965,quantity:1},{orderItemId:9966,quantity:1}],actor:'QA manager',dispatchDate:'2026-11-01'})
assert.equal(exchangeReplay.alreadyCommitted,true)
assert.deepEqual({...sql.prepare("SELECT quantity,reserved_quantity FROM inventory_stock WHERE id=9042").get()}, {quantity:3,reserved_quantity:0})
const dispatchedA=sql.prepare('SELECT id FROM order_dispatch_items WHERE dispatch_id=? AND order_item_id=9965').get(exchangeBatch.dispatchId).id
const undoneExchange=await cancelExactOrderDispatchItem(db,9053,{dispatchItemId:dispatchedA,requestId:'stage5b-undo-replacement-A-0001',actor:'QA manager',reason:'Error in shipment'})
assert.equal(undoneExchange.ok,true)
assert.equal(undoneExchange.physicalRestoredQuantity,1)
assert.deepEqual({...sql.prepare("SELECT quantity,reserved_quantity FROM inventory_stock WHERE id=9042").get()}, {quantity:4,reserved_quantity:1})
assert.equal(events()[0].status,'pending')
assert.equal(events()[0].pending_reason,'awaiting_dispatch')
assert.equal(events()[1].status,'applied')
assert.equal(sql.prepare("SELECT quantity FROM order_items WHERE id=9967").get().quantity,0,'Original exchanged line must stay immutable')
const lastOne=await dispatchSelectedCompleteOrderLines(db,9053,{requestId:'stage5b-replacement-A-again-0002',items:[{orderItemId:9965,quantity:1}],actor:'QA manager',dispatchDate:'2026-11-01'})
assert.equal(lastOne.ok,true)
assert.equal(events()[0].status,'applied')
assert.deepEqual({...sql.prepare("SELECT quantity,reserved_quantity FROM inventory_stock WHERE id=9042").get()}, {quantity:3,reserved_quantity:0})
assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM order_dispatch_corrections WHERE dispatch_item_id=?').get(dispatchedA).n,1,'Exchange correction must be item-exact')

// A workshop replacement created AFTER an already-sent order must use the
// same dispatch plan and ledger, but must never alter physical stock.
sql.prepare("INSERT INTO orders(id,external_id,order_date,manager_id,order_status,source_type,workshop_status,shipping_status,created_at,updated_at) VALUES(9054,'ORD-TEST-READY-WORKSHOP-EXCHANGE','2026-11-01',1,'active','warehouse','ready','sent','2026-11-01T00:00:00Z','2026-11-01T00:00:00Z')").run()
sql.prepare("INSERT INTO order_items(id,order_id,product_name_snapshot,quantity,unit_price,line_total,is_workshop,source_type,stock_writeoff_status,created_at) VALUES(9969,9054,'ORIGINAL EXCHANGED',0,1000,0,0,'warehouse','exchanged','2026-11-01T00:00:00Z')").run()
sql.prepare("INSERT INTO order_items(id,order_id,product_name_snapshot,quantity,unit_price,line_total,is_workshop,source_type,created_at) VALUES(9970,9054,'READY WORKSHOP REPLACEMENT',1,1000,1000,1,'workshop','2026-11-01T00:00:00Z')").run()
sql.prepare("INSERT INTO exchanges(id,order_id,exchange_date,old_order_item_id,old_quantity,new_order_item_id,new_source_type,financial_action,financial_amount,status,created_at) VALUES(9086,9054,'2026-11-01',9969,1,9970,'workshop','none',0,'completed','2026-11-01T00:00:00Z')").run()
sql.prepare("INSERT INTO workshop_tasks(order_id,external_order_id,order_item_id,product_name_snapshot,quantity,status,created_at,updated_at) VALUES(9054,'ORD-TEST-READY-WORKSHOP-EXCHANGE',9970,'READY WORKSHOP REPLACEMENT',1,'done','2026-11-01T00:00:00Z','2026-11-01T00:00:00Z')").run()
const workshopOrder=await import('../worker/domains/orders-write.ts').then(m=>m.getOrder(db,9054))
assert.equal(workshopOrder.shipping_status,'sent')
const readyWorkshop=workshopOrder.items.find(x=>x.id===9970)
assert.equal(readyWorkshop.pendingExchangeWorkshopId,9086)
assert.equal(readyWorkshop.workshopTaskStatus,'done')
const {buildOrderShipmentPlan}=await import('../worker/domains/order-shipment-plan.ts')
const workshopPlan=buildOrderShipmentPlan(workshopOrder,[])
assert.equal(workshopPlan.selectedQuantity,1)
assert.equal(workshopPlan.lines.find(x=>x.orderItemId===9970).exchangeWorkshopId,9086)
const snapshotBeforeWorkshop={...stock()}
const workshopResult=await dispatchSelectedCompleteOrderLines(db,9054,{
 requestId:'stage5b-historical-sent-workshop-exchange-01',items:[{orderItemId:9970,quantity:1}],
 actor:'QA manager',dispatchDate:'2026-11-01',
})
assert.equal(workshopResult.shippedQuantity,1)
assert.deepEqual({...stock()},snapshotBeforeWorkshop,'Workshop shipment must not consume physical stock')
assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM order_dispatch_items WHERE order_item_id=9970 AND cancelled_quantity=0").get().n,1)
const workshopRepeat=await dispatchSelectedCompleteOrderLines(db,9054,{
 requestId:'stage5b-historical-sent-workshop-exchange-01',items:[{orderItemId:9970,quantity:1}],
 actor:'QA manager',dispatchDate:'2026-11-01',
})
assert.equal(workshopRepeat.alreadyCommitted,true)
const workshopDispatchId=sql.prepare("SELECT id FROM order_dispatch_items WHERE order_item_id=9970").get().id
const workshopUndo=await cancelExactOrderDispatchItem(db,9054,{
 dispatchItemId:workshopDispatchId,requestId:'stage5b-workshop-exchange-undo-01',
 actor:'QA manager',reason:'Mistaken workshop shipment',
})
assert.equal(workshopUndo.ok,true)
assert.equal(workshopUndo.physicalRestoredQuantity,0)
assert.deepEqual({...stock()},snapshotBeforeWorkshop,'Undo workshop dispatch is never stock movement')
const again=await import('../worker/domains/orders-write.ts').then(m=>m.getOrder(db,9054))
assert.equal(again.items.find(x=>x.id===9970).pendingExchangeWorkshopId,9086)
const workshopAgain=await dispatchSelectedCompleteOrderLines(db,9054,{
 requestId:'stage5b-workshop-exchange-redispatch-01',items:[{orderItemId:9970,quantity:1}],
 actor:'QA manager',dispatchDate:'2026-11-01',
})
assert.equal(workshopAgain.ok,true)
assert.deepEqual({...stock()},snapshotBeforeWorkshop)

sql.close()
console.log('STAGE5B_ATOMIC_FULL_LINE_DISPATCH_AND_EXACT_ITEM_UNDO_PASS')
console.log('STAGE5B_TWO_EXCHANGE_REPLACEMENTS_ONE_BATCH_PASS')
console.log('STAGE5B_WORKSHOP_REPLACEMENT_AFTER_SENT_AND_EXACT_CANCEL_PASS')

