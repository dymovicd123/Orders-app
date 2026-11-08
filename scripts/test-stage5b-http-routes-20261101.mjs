import assert from 'node:assert/strict'
import fs from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {createHash} from 'node:crypto'
import worker from '../worker/index.ts'

const sql=new DatabaseSync(':memory:')
for(const m of fs.readdirSync('migrations').filter(x=>/^\d{4}.*\.sql$/.test(x)).sort()){
  sql.exec(fs.readFileSync('migrations/'+m,'utf8'))
}
if(!sql.prepare("SELECT 1 FROM pragma_table_info('orders') WHERE name='manager_snapshot_name'").get())
  sql.exec('ALTER TABLE orders ADD COLUMN manager_snapshot_name TEXT')
const stmt=(q,a=[])=>({
  bind(...args){return stmt(q,args)},
  async first(){return sql.prepare(q).get(...a)??null},
  async all(){return{results:sql.prepare(q).all(...a)}},
  async run(){const r=sql.prepare(q).run(...a);return{meta:{changes:r.changes,last_row_id:Number(r.lastInsertRowid)}}},
})
const DB={
  prepare:q=>stmt(q),
  async batch(statements){
    sql.exec('SAVEPOINT stage5_http')
    try{const out=[];for(const s of statements)out.push(await s.run());sql.exec('RELEASE stage5_http');return out}
    catch(e){sql.exec('ROLLBACK TO SAVEPOINT stage5_http');sql.exec('RELEASE stage5_http');throw e}
  },
}
const token='stage5-http-session',tokenHash=createHash('sha256').update(token).digest('base64url')
sql.prepare("INSERT OR IGNORE INTO managers(id,name,is_active) VALUES(9501,'Test manager',1)").run()
sql.prepare("INSERT INTO app_users(id,login,email,password_hash,role,manager_id,display_name,is_active,must_change_password) VALUES(9501,'stage5person','test-stage5@invalid','not-used','manager',9501,'Test manager',1,0)").run()
sql.prepare("INSERT INTO app_sessions(user_id,token_hash,expires_at) VALUES(9501,?,'2099-01-01')").run(tokenHash)
sql.prepare("INSERT INTO catalog_products(id,name,category,is_active) VALUES(9521,'STAGE 5 TEST WAREHOUSE','adult',1)").run()
sql.prepare("INSERT INTO catalog_variants(id,product_id,gender,color,material,length,size_label,category,is_active) VALUES(9531,9521,'МУЖ','ЧЕРНЫЙ','СТАНДАРТ','СТАНДАРТ','46','adult',1)").run()
sql.prepare("INSERT INTO inventory_stock(id,inventory_source,product_id,variant_id,product_name_snapshot,gender_snapshot,color_snapshot,material_snapshot,length_snapshot,size_snapshot,quantity,reserved_quantity) VALUES(9541,'warehouse',9521,9531,'STAGE 5 TEST WAREHOUSE','МУЖ','ЧЕРНЫЙ','СТАНДАРТ','СТАНДАРТ','46',5,3)").run()
sql.prepare("INSERT INTO orders(id,external_id,order_date,manager_id,order_status,source_type,workshop_status,shipping_status,created_at,updated_at) VALUES(9551,'ORD-TEST-STAGE5-HTTP','2026-11-01',9501,'active','warehouse','ready','not_sent','2026-11-01T00:00:00Z','2026-11-01T00:00:00Z')").run()
sql.prepare("INSERT INTO order_items(id,order_id,product_id,variant_id,product_name_snapshot,gender_snapshot,color_snapshot,material_snapshot,length_snapshot,size_snapshot,quantity,unit_price,line_total,is_workshop,source_type,stock_writeoff_status,created_at,inventory_obligation_key,inventory_obligation_origin_at) VALUES(9561,9551,9521,9531,'STAGE 5 TEST WAREHOUSE','МУЖ','ЧЕРНЫЙ','СТАНДАРТ','СТАНДАРТ','46',3,2000,6000,0,'warehouse','reserved','2026-11-01T00:00:00Z','stage5-http-original','2026-11-01T00:00:00Z')").run()
sql.prepare("INSERT INTO inventory_reservations(order_id,order_item_id,inventory_source,product_id,variant_id,quantity,status,created_at,updated_at) VALUES(9551,9561,'warehouse',9521,9531,3,'active','2026-11-01T00:00:00Z','2026-11-01T00:00:00Z')").run()
sql.prepare("INSERT INTO inventory_model_meta(key,value,updated_at) VALUES('human_inventory_v2','active','2026-11-01T00:00:00Z') ON CONFLICT(key) DO UPDATE SET value='active'").run()
async function api(method,path,body,expected=200,authenticated=true){
 const headers={...(authenticated?{Cookie:'orders_session='+token}:{}),...(body?{'Content-Type':'application/json'}:{})}
 const response=await worker.fetch(new Request('https://test-only.invalid'+path,{method,headers,...(body?{body:JSON.stringify(body)}:{})}),{DB})
 const data=await response.json()
 assert.equal(response.status,expected,method+' '+path+' '+JSON.stringify(data))
 return data
}
const prefix='/api/orders/9551/shipping'
const snapshot=()=>sql.prepare('SELECT quantity,reserved_quantity FROM inventory_stock WHERE id=9541').get()
const movementCount=()=>Number(sql.prepare("SELECT COUNT(*) AS n FROM inventory_movements WHERE movement_type='sale'").get().n)
try{
 await api('GET',prefix+'/plan',undefined,401,false)
 const before=await api('GET',prefix+'/plan')
 assert.equal(before.draftOnly,true)
 assert.equal(before.selectedQuantity,3)
 assert.equal(before.lines.length,1)
 assert.equal(before.lines[0].orderItemId,9561)
 const none=await api('GET',prefix+'/dispatches')
 assert.deepEqual(none.dispatches,[])
 const payload={requestId:'stage5-http-selected-01',items:[{orderItemId:9561,quantity:1}]}
 // Simulate a browser losing the RESPONSE after the Worker committed the POST.
 // Do not parse or deliver this reply to the client. The retry must use the
 // SAME requestId/payload and return an idempotent readback, not ship twice.
 const lostResponse=await worker.fetch(new Request('https://test-only.invalid'+prefix+'/dispatches',{
   method:'POST',headers:{Cookie:'orders_session='+token,'Content-Type':'application/json'},
   body:JSON.stringify(payload),
 }),{DB})
 assert.equal(lostResponse.status,200)
 assert.deepEqual({...snapshot()},{quantity:4,reserved_quantity:2})
 assert.equal(movementCount(),1)
 const sent=await api('POST',prefix+'/dispatches',payload)
 assert.equal(sent.alreadyCommitted,true,'Retry must acknowledge the committed first POST')
 assert(sent.dispatchId>0)
 assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM order_dispatches WHERE request_id=?").get(payload.requestId).n,1)
 assert.deepEqual({...snapshot()},{quantity:4,reserved_quantity:2})
 assert.equal(movementCount(),1,'Lost response + same-id retry must not write stock again')
 const replay=await api('POST',prefix+'/dispatches',payload)
 assert.equal(replay.alreadyCommitted,true)
 assert.equal(replay.dispatchId,sent.dispatchId)
 assert.equal(movementCount(),1)
 console.log('STAGE5_POSTCOMMIT_LOST_RESPONSE_REPLAY_HTTP_PASS')
 await api('POST',prefix+'/dispatches',{requestId:'stage5-http-selected-01',items:[{orderItemId:9561,quantity:2}]},409)
 await api('PATCH',prefix,{shippingStatus:'sent',shippingDate:'2026-11-01'},409)
 await api('POST',prefix+'/correct',{physicalOutcome:'not_issued'},409)
 const after=await api('GET',prefix+'/plan')
 assert.equal(after.selectedQuantity,2)
 const remaining=after.lines.find(x=>x.selectable)
 assert(remaining)
 assert.notEqual(remaining.orderItemId,9561)
 assert.equal(remaining.readyQuantity,2)
 const history=await api('GET',prefix+'/dispatches')
 assert.equal(history.dispatches.length,1)
 assert.equal(history.dispatches[0].orderItemId,9561)
 const canceled=await api('POST',prefix+'/dispatch-items/'+history.dispatches[0].dispatchItemId+'/correct',{
   requestId:'stage5-http-correct-01',reason:'Test actual non-shipment'})
 assert.equal(canceled.cancelledQuantity,1)
 assert.equal(canceled.physicalRestoredQuantity,1)
 assert.deepEqual({...snapshot()},{quantity:5,reserved_quantity:3})
 const repeatUndo=await api('POST',prefix+'/dispatch-items/'+history.dispatches[0].dispatchItemId+'/correct',{
   requestId:'stage5-http-correct-01',reason:'Retry'})
 assert.equal(repeatUndo.alreadyCorrected,true)
 assert.equal(movementCount(),1)
 assert.equal(sql.prepare("SELECT SUM(quantity) AS q FROM order_items WHERE order_id=9551").get().q,3)
 assert.equal(sql.prepare("SELECT SUM(line_total) AS total FROM order_items WHERE order_id=9551").get().total,6000)
 // A Return of ONE shipped line must not prevent shipping the still-reserved
 // remainder of the same original purchase; legacy one-line reservation rules
 // can now operate on the two accurate, physically distinct order item IDs.
 const sentAgain=await api('POST',prefix+'/dispatches',{
   requestId:'stage5-http-resend-after-undo',items:[{orderItemId:9561,quantity:1}]})
 assert.equal(sentAgain.shippedQuantity,1)
 const physicalReturn=await api('POST','/api/returns',{
   requestId:'stage5-http-return-one-unit',orderId:9551,returnDate:'2026-11-01',amount:0,
   items:[{orderItemId:9561,quantity:1,physicalState:'pending',restock:true}],
 },201)
 assert(physicalReturn.returnId>0,'Physical Return must record shipped item')
 const remainingAfterReturn=await api('GET',prefix+'/plan')
 assert.equal(remainingAfterReturn.selectedQuantity,2,'Return of dispatched row cannot lock sibling reserve')
 const outstanding=remainingAfterReturn.lines.find(x=>x.selectable)
 assert(outstanding)
 const shipSibling=await api('POST',prefix+'/dispatches',{
   requestId:'stage5-http-send-after-other-return',items:[{orderItemId:outstanding.orderItemId,quantity:1}]})
 assert.equal(shipSibling.shippedQuantity,1)
 assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM return_items WHERE order_item_id=9561').get().n,1)
 assert.equal(sql.prepare('SELECT SUM(line_total) AS total FROM order_items WHERE order_id=9551').get().total,6000)
 // Workshop part of a mixed order was sent, but warehouse sibling is still
 // reserved: Return must follow the WORKSHOP shipment item, not parent sent flag.
 sql.prepare("INSERT INTO orders(id,external_id,order_date,manager_id,order_status,source_type,workshop_status,shipping_status,created_at,updated_at) VALUES(9552,'ORD-TEST-MIXED-WORKSHOP-HTTP','2026-11-01',9501,'active','warehouse','ready','not_sent','2026-11-01T00:00:00Z','2026-11-01T00:00:00Z')").run()
 sql.prepare("INSERT INTO order_items(id,order_id,product_id,variant_id,product_name_snapshot,quantity,unit_price,line_total,is_workshop,source_type,stock_writeoff_status,created_at,inventory_obligation_key,inventory_obligation_origin_at) VALUES(9565,9552,9521,9531,'STAGE 5 TEST WORKSHOP',1,2500,2500,1,'warehouse','workshop','2026-11-01T00:00:00Z','stage5-http-workshop','2026-11-01T00:00:00Z')").run()
 sql.prepare("INSERT INTO order_items(id,order_id,product_id,variant_id,product_name_snapshot,quantity,unit_price,line_total,is_workshop,source_type,stock_writeoff_status,created_at,inventory_obligation_key,inventory_obligation_origin_at) VALUES(9566,9552,9521,9531,'STAGE 5 TEST WAREHOUSE',1,1000,1000,0,'warehouse','reserved','2026-11-01T00:00:00Z','stage5-http-stock-sibling','2026-11-01T00:00:00Z')").run()
 sql.prepare("INSERT INTO inventory_reservations(order_id,order_item_id,inventory_source,product_id,variant_id,quantity,status,created_at,updated_at) VALUES(9552,9566,'warehouse',9521,9531,1,'active','2026-11-01T00:00:00Z','2026-11-01T00:00:00Z')").run()
 sql.prepare('UPDATE inventory_stock SET reserved_quantity=reserved_quantity+1 WHERE id=9541').run()
 sql.prepare("INSERT INTO workshop_tasks(order_id,external_order_id,order_item_id,product_name_snapshot,quantity,status,created_at,updated_at) VALUES(9552,'ORD-TEST-MIXED-WORKSHOP-HTTP',9565,'STAGE 5 TEST WORKSHOP',1,'done','2026-11-01T00:00:00Z','2026-11-01T00:00:00Z')").run()
 const mixedPlan=await api('GET','/api/orders/9552/shipping/plan')
 assert.equal(mixedPlan.selectedQuantity,2)
 assert.equal(mixedPlan.lines.find(x=>x.orderItemId===9565)?.readyQuantity,1)
 const workshopSent=await api('POST','/api/orders/9552/shipping/dispatches',{
   requestId:'stage5-http-mixed-workshop-shipped',items:[{orderItemId:9565,quantity:1}]})
 assert.equal(workshopSent.shippedQuantity,1)
 assert.equal(sql.prepare('SELECT shipping_status FROM orders WHERE id=9552').get().shipping_status,'not_sent')
 const workshopReturn=await api('POST','/api/returns',{
   requestId:'stage5-http-workshop-partial-return',orderId:9552,returnDate:'2026-11-01',amount:0,
   items:[{orderItemId:9565,quantity:1,physicalState:'pending',restock:true}],
 },201)
 assert(workshopReturn.returnId>0,'Partially shipped Workshop item must remain returnable')
 const afterWorkshopReturn=await api('GET','/api/orders/9552/shipping/plan')
 assert.equal(afterWorkshopReturn.selectedQuantity,1,'Workshop Return cannot block independent Warehouse stock')
 console.log('STAGE5_HTTP_PARTIALLY_SHIPPED_WORKSHOP_RETURN_PASS')

 // Historical partial handover: explicit record of early physical issue is not
 // equivalent to customer shipping. Confirming shipment changes ONLY order
 // status, never stock, another buyer's reserve or the movement ledger.
 function seedPrior(orderId, itemStates, withEvidence=true, createdAt='2026-10-20T00:00:00Z') {
   sql.prepare("INSERT INTO orders(id,external_id,order_date,manager_id,order_status,source_type,workshop_status,shipping_status,created_at,updated_at) VALUES(?,?,'2026-10-20',9501,'active','warehouse','ready','not_sent',?,?)")
     .run(orderId,'PRIOR-ISSUED-'+orderId,createdAt,createdAt)
   return itemStates.map((state,i)=>{
     const itemId=orderId*10+i
     sql.prepare("INSERT INTO order_items(id,order_id,product_id,variant_id,product_name_snapshot,quantity,unit_price,line_total,is_workshop,source_type,stock_writeoff_status,created_at) VALUES(?,?,9521,9531,'STAGE 5 TEST WAREHOUSE',1,1000,1000,0,'warehouse',?,?)")
       .run(itemId,orderId,state,createdAt)
     sql.prepare("INSERT INTO inventory_reservations(order_id,order_item_id,inventory_source,product_id,variant_id,quantity,status,created_at,updated_at) VALUES(?,?, 'warehouse',9521,9531,1,?,?,?)")
       .run(orderId,itemId,state==='fulfilled'?'fulfilled':'active',createdAt,createdAt)
     if (withEvidence && state==='fulfilled') {
       sql.prepare("INSERT INTO activity_log(event_type,entity_type,entity_id,order_id,title,created_at) VALUES('order_stock_issued_before_full_shipping','order_item',?,?,'Early verified stock issue',?)")
         .run(itemId,orderId,'2026-10-21T00:00:00Z')
     }
     return itemId
   })
 }
 const historicalOrderId=9651
 const earlyItems=seedPrior(historicalOrderId,['fulfilled','fulfilled'])
 const priorPath='/api/orders/'+historicalOrderId+'/shipping'
 const oldStock=({...snapshot()})
 const movementsAtStart=sql.prepare('SELECT COUNT(*) AS c FROM inventory_movements').get().c
 const proofPlan=await api('GET',priorPath+'/plan')
 assert.equal(proofPlan.canConfirmIssuedOnly,true,'All issued lines have exact handover proof')
 assert.equal(proofPlan.selectedQuantity,0,'No second physical stock dispatch may be selected')
 assert.equal(proofPlan.lines.length,2)
 const failedAudit='CREATE TRIGGER reject_prior_shipping_audit BEFORE INSERT ON activity_log WHEN NEW.event_type=\'order_prior_issued_shipping_confirmed\' BEGIN SELECT RAISE(ABORT,\'audit unavailable\'); END'
 sql.exec(failedAudit)
 const noAudit=await api('PATCH',priorPath,{shippingStatus:'sent',confirmAlreadyIssued:true},500)
 assert.equal(noAudit.ok,false)
 assert.equal(sql.prepare('SELECT shipping_status FROM orders WHERE id=?').get(historicalOrderId).shipping_status,'not_sent',
   'Atomic status update must roll back when audit insertion fails')
 sql.exec('DROP TRIGGER reject_prior_shipping_audit')
 const checked=await api('PATCH',priorPath,{shippingStatus:'sent',shippingDate:'2026-11-08',confirmAlreadyIssued:true})
 assert.equal(checked.statusOnly,true)
 assert.equal(checked.stockDeducted,0)
 assert.equal(sql.prepare('SELECT shipping_status FROM orders WHERE id=?').get(historicalOrderId).shipping_status,'sent')
 const retry=await api('PATCH',priorPath,{shippingStatus:'sent',shippingDate:'2026-11-08',confirmAlreadyIssued:true})
 assert.equal(retry.alreadySent,true)
 assert.equal(sql.prepare("SELECT COUNT(*) AS c FROM activity_log WHERE order_id=? AND event_type='order_prior_issued_shipping_confirmed'").get(historicalOrderId).c,1)
 await api('POST',priorPath+'/correct',{physicalOutcome:'issued'},409)
 const statusUndo=await api('POST',priorPath+'/correct',{physicalOutcome:'not_issued'})
 assert.equal(statusUndo.statusOnly,true)
 assert.equal(statusUndo.restoredPhysicalQuantity,0)
 assert.equal(statusUndo.reactivatedReservations,0)
 assert.equal(sql.prepare('SELECT shipping_status FROM orders WHERE id=?').get(historicalOrderId).shipping_status,'not_sent')
 await api('POST',priorPath+'/correct',{physicalOutcome:'not_issued'},409)
 assert.deepEqual({...snapshot()},oldStock,'Prior-issue status confirmation and undo may never move warehouse stock')
 assert.equal(sql.prepare('SELECT COUNT(*) AS c FROM inventory_movements').get().c,movementsAtStart)
 assert.deepEqual(sql.prepare("SELECT status FROM inventory_reservations WHERE order_id=? ORDER BY order_item_id").all(historicalOrderId).map(r=>r.status),
   ['fulfilled','fulfilled'],'Prior issue physical reservations must stay already fulfilled')
 assert.deepEqual(earlyItems.map(id=>sql.prepare('SELECT stock_writeoff_status FROM order_items WHERE id=?').get(id).stock_writeoff_status),
   ['fulfilled','fulfilled'])

 // These fail closed even when the manager supplies confirmAlreadyIssued=true.
 // Never let the client override server-validated per-item evidence.
 const unknownId=9652
 seedPrior(unknownId,['fulfilled'],false)
 assert.equal((await api('GET','/api/orders/'+unknownId+'/shipping/plan')).canConfirmIssuedOnly,false)
 await api('PATCH','/api/orders/'+unknownId+'/shipping',{shippingStatus:'sent',confirmAlreadyIssued:true},409)
 const mixedId=9653
 seedPrior(mixedId,['fulfilled','reserved'])
 assert.equal((await api('GET','/api/orders/'+mixedId+'/shipping/plan')).canConfirmIssuedOnly,false)
 await api('PATCH','/api/orders/'+mixedId+'/shipping',{shippingStatus:'sent',confirmAlreadyIssued:true},409)
 const newerId=9654
 seedPrior(newerId,['fulfilled'],true,'2026-11-04T00:00:00Z')
 assert.equal((await api('GET','/api/orders/'+newerId+'/shipping/plan')).canConfirmIssuedOnly,false)
 await api('PATCH','/api/orders/'+newerId+'/shipping',{shippingStatus:'sent',confirmAlreadyIssued:true},409)
 const returnedId=9655
 const returnedItem=seedPrior(returnedId,['fulfilled'])[0]
 sql.prepare("INSERT INTO returns(id,order_id,manager_id,return_date,amount,comment,created_at) VALUES(9655,9655,9501,'2026-10-22',0,'Physical return','2026-10-22T00:00:00Z')").run()
 sql.prepare("INSERT INTO return_items(return_id,order_item_id,product_name_snapshot,quantity,amount,created_at) VALUES(9655,?,'STAGE 5 TEST WAREHOUSE',1,0,'2026-10-22T00:00:00Z')").run(returnedItem)
 assert.equal((await api('GET','/api/orders/'+returnedId+'/shipping/plan')).canConfirmIssuedOnly,false)
 await api('PATCH','/api/orders/'+returnedId+'/shipping',{shippingStatus:'sent',confirmAlreadyIssued:true},409)
 const exchangedId=9656
 const exchangedItem=seedPrior(exchangedId,['fulfilled'])[0]
 sql.prepare("INSERT INTO exchanges(id,order_id,manager_id,exchange_date,old_order_item_id,status,created_at) VALUES(9656,9656,9501,'2026-10-22',?,'completed','2026-10-22T00:00:00Z')").run(exchangedItem)
 assert.equal((await api('GET','/api/orders/'+exchangedId+'/shipping/plan')).canConfirmIssuedOnly,false)
 await api('PATCH','/api/orders/'+exchangedId+'/shipping',{shippingStatus:'sent',confirmAlreadyIssued:true},409)
 assert.deepEqual({...snapshot()},oldStock,'Invalid status-only attempts may not change any physical stock')
 assert.equal(sql.prepare('SELECT COUNT(*) AS c FROM inventory_movements').get().c,movementsAtStart)
 console.log('BRANCH2_PRIOR_ISSUED_REAL_HTTP_PASS: evidence, atomic audit rollback, zero stock writes, correction, retry, mixed/unknown/returned/exchanged/newer guards')
 console.log('STAGE5_REAL_WORKER_HTTP_SELECTED_1_OF_3_UNDO_REPLAY_LEGACY_GUARD_AND_RETURN_PASS')
}finally{sql.close()}
