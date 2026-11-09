// Real Worker HTTP + transactional SQLite acceptance. No remote D1 or Cloudflare calls.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {createHash} from 'node:crypto'
import worker from '../worker/index.ts'
import {planOrderManagerSchemaReconciliation} from './order-manager-schema-reconciliation-20261030.mjs'

const sql=new DatabaseSync(':memory:')
for(const filename of fs.readdirSync('migrations').filter(x=>/^\d{4}.*\.sql$/.test(x)).sort()){
 sql.exec(fs.readFileSync('migrations/'+filename,'utf8'))
}
const audits=!!sql.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='order_manager_audit'").get()
const plan=planOrderManagerSchemaReconciliation({
 ordersColumns:sql.prepare('PRAGMA table_info(orders)').all(),
 auditTableExists:audits,
 auditColumns:audits?sql.prepare('PRAGMA table_info(order_manager_audit)').all():[],
})
for(const step of plan.steps)sql.exec(step.sql)
const stmt=(query,params=[])=>({
 bind(...args){return stmt(query,args)},
 async first(){return sql.prepare(query).get(...params)??null},
 async all(){return{results:sql.prepare(query).all(...params)}},
 async run(){const r=sql.prepare(query).run(...params);return{success:true,meta:{changes:Number(r.changes),last_row_id:Number(r.lastInsertRowid||0)}}}
})
const DB={
 prepare(query){return stmt(query)},
 async batch(statements){
  sql.exec('SAVEPOINT dispatch_qa')
  try{
   const result=[]
   for(const stmt of statements)result.push(await stmt.run())
   sql.exec('RELEASE dispatch_qa')
   return result
  }catch(e){
   sql.exec('ROLLBACK TO SAVEPOINT dispatch_qa')
   sql.exec('RELEASE dispatch_qa')
   throw e
  }
 }
}
const token='shipping-shortage-test-token'
const tokenHash=createHash('sha256').update(token).digest('base64url')
const actor=98981,product=98982
sql.prepare('INSERT INTO managers(id,name,is_active) VALUES(?,?,1)').run(actor,'QA Dispatch Manager')
sql.prepare("INSERT INTO app_users(id,login,email,password_hash,role,manager_id,display_name,is_active,must_change_password) VALUES(98981,'qa-dispatch','qa-dispatch@invalid','unused-hash','admin',98981,'QA Dispatch Manager',1,0)").run()
sql.prepare("INSERT INTO app_sessions(user_id,token_hash,expires_at) VALUES(98981,?,'2099-01-01')").run(tokenHash)
sql.prepare("INSERT INTO catalog_products(id,name,category,is_active) VALUES(98982,'QA DISPATCH SHAPAN','adult',1)").run()
const stamp='2026-11-08T00:00:00Z'
sql.prepare("INSERT INTO catalog_stock_positions(product_id,category,gender_scope,material,length,is_default,is_active,sort_order,created_at,updated_at) VALUES(98982,'adult','unisex','КАШЕМИР','СТАНДАРТ',0,1,0,?,?)").run(stamp,stamp)
const execution=Number(sql.prepare("SELECT id FROM catalog_stock_positions WHERE product_id=98982").get()?.id)
assert(execution>0)
for(const [id,size,physical] of [[98983,'44',1],[98984,'46',1],[98985,'48',1],[98986,'50',1]]){
 sql.prepare("INSERT INTO catalog_variants(id,product_id,stock_position_id,gender,color,material,length,size_label,category,is_active) VALUES(?,98982,?,'ЖЕН','БЕЖЕВЫЙ','КАШЕМИР','СТАНДАРТ',?,'adult',1)").run(id,execution,size)
 sql.prepare("INSERT INTO inventory_stock(inventory_source,product_id,variant_id,product_name_snapshot,gender_snapshot,color_snapshot,material_snapshot,length_snapshot,size_snapshot,quantity,reserved_quantity) VALUES('warehouse',98982,?,'QA DISPATCH SHAPAN','ЖЕН','БЕЖЕВЫЙ','КАШЕМИР','СТАНДАРТ',?,?,0)").run(id,size,physical)
}
sql.prepare("INSERT INTO inventory_model_meta(key,value,updated_at) VALUES('human_inventory_v2','active',?) ON CONFLICT(key) DO UPDATE SET value='active'").run(stamp)

async function call(url,method='GET',body=null){
 const request=new Request('https://test-only.invalid'+url,{
  method,headers:{Cookie:'orders_session='+token,...(body?{'Content-Type':'application/json'}:{})},
  ...(body?{body:JSON.stringify(body)}:{})
 })
 const response=await worker.fetch(request,{DB})
 let value={}
 try{value=await response.json()}catch{}
 return {status:response.status,body:value}
}
function payload(variant,size,id,quantity=1){
 return{requestId:id,orderDate:'2026-11-08',managerId:actor,managerName:'QA Dispatch Manager',
  customerName:'QA Customer',city:'Алматы',deliveryType:'Самовывоз',sourceType:'warehouse',
  workshopStatus:'ready',orderStatus:'active',pricingMode:'itemized_v1',
  items:[{productName:'QA DISPATCH SHAPAN',catalogVariantId:variant,audienceType:'ВЗРОСЛЫЙ',
   gender:'ЖЕН',color:'БЕЖЕВЫЙ',material:'КАШЕМИР',length:'СТАНДАРТ',
   size,sourceType:'warehouse',quantity,unitPrice:18000,
   catalogPriceSnapshot:null,shortageAcknowledged:true}],payments:[]}
}
const create=async (variant,size,key,quantity=1)=>{
 const response=await call('/api/orders','POST',payload(variant,size,key,quantity))
 assert([200,201].includes(response.status),'Create failed: '+JSON.stringify(response))
 assert(response.body.orderId>0)
 const id=response.body.orderId
 const row=sql.prepare('SELECT id,stock_writeoff_status,variant_id FROM order_items WHERE order_id=?').get(id)
 const reservation=sql.prepare('SELECT id,status,quantity,inventory_source FROM inventory_reservations WHERE order_item_id=?').get(row.id)
 return{id,itemId:row.id,row,reservation}
}
const getPlan=async order=>{
 const r=await call('/api/orders/'+order.id+'/shipping/plan')
 assert.equal(r.status,200,JSON.stringify(r.body))
 return r.body
}
const dispatch=async(order,requestId,items,stockConfirmations)=>
 await call('/api/orders/'+order.id+'/shipping/dispatches','POST',{requestId,items,stockConfirmations})

// Free stock=0 because this order has already reserved its own piece: MUST send.
const reserved=create&&await create(98983,'44','qa-dispatch-own-reserve-0001')
assert.equal(reserved.reservation.status,'active')
const rStock=sql.prepare('SELECT quantity,reserved_quantity FROM inventory_stock WHERE variant_id=98983').get()
assert.deepEqual([rStock.quantity,rStock.reserved_quantity],[1,1])
const readyPlan=await getPlan(reserved)
assert.equal(readyPlan.lines[0].selectable,true)
const r0=await dispatch(reserved,'qa-dispatch-zero-free-0001',[{orderItemId:reserved.itemId,quantity:1}])
assert.equal(r0.status,200,'Free 0 incorrectly blocked: '+JSON.stringify(r0))
assert.equal(sql.prepare('SELECT quantity FROM inventory_stock WHERE variant_id=98983').get().quantity,0)

// Recorded physical changed to zero AFTER a valid reservation. Manager confirms
// possession of exact piece; do not make stock negative, fabricate stock or duplicate issue.
const short=await create(98984,'46','qa-dispatch-shortage-create-0001')
assert.equal(short.reservation.status,'active')
sql.prepare("UPDATE inventory_stock SET quantity=0 WHERE variant_id=98984 AND inventory_source='warehouse'").run()
const shortPlan=await getPlan(short)
assert.equal(shortPlan.lines[0].selectable,true)
const selected=[{orderItemId:short.itemId,quantity:1}]
const requestId='qa-dispatch-shortage-submit-0001'
const preflight=await dispatch(short,requestId,selected)
assert.equal(preflight.status,409,'Shortage must offer confirmation, not permanently block: '+JSON.stringify(preflight))
assert.equal(preflight.body.code,'dispatch_stock_confirmation_required')
assert.equal(preflight.body.items[0].trackedPhysicalQuantity,0)
assert.equal(sql.prepare('SELECT status FROM inventory_reservations WHERE id=?').get(short.reservation.id).status,'active')
const correct=await dispatch(short,requestId,selected,[{
 source:'warehouse',variantId:98984,expectedQuantity:0,operationQuantity:1
}])
assert.equal(correct.status,200,'Confirming actual possession must allow dispatch: '+JSON.stringify(correct))
assert.equal(sql.prepare("SELECT status FROM inventory_reservations WHERE id=?").get(short.reservation.id).status,'fulfilled')
assert.deepEqual([
 ...Object.values(sql.prepare('SELECT quantity,reserved_quantity FROM inventory_stock WHERE variant_id=98984').get())
],[0,0])
const movement=sql.prepare("SELECT id,quantity_delta,quantity_after FROM inventory_movements WHERE variant_id=98984 AND reference_type='order_dispatch'").get()
assert.equal(movement.quantity_delta,0,'The system may not invent a -1 tracked movement when tracked stock is already zero')
assert.equal(movement.quantity_after,0)
const evidence=sql.prepare("SELECT confirmed_operation_quantity,explained_quantity,unexplained_quantity FROM inventory_operation_evidence WHERE variant_id=98984 AND operation_type='shipping'").get()
assert(evidence,'Physical discrepancy evidence must be recorded')
assert.deepEqual([evidence.confirmed_operation_quantity,evidence.explained_quantity,evidence.unexplained_quantity],[1,0,1])
const replay=await dispatch(short,requestId,selected)
assert.equal(replay.status,200,'Retry of exactly same dispatch should be idempotent')
assert.equal(replay.body.alreadyCommitted,true)
const duplicate=await dispatch(short,'qa-dispatch-duplicate-rejected-0001',selected)
assert.equal(duplicate.status,409,'No second shipment of the same line')
const dispatchItem=sql.prepare('SELECT id FROM order_dispatch_items WHERE order_item_id=?').get(short.itemId)
const correction=await call('/api/orders/'+short.id+'/shipping/dispatch-items/'+dispatchItem.id+'/correct','POST',{
 requestId:'qa-dispatch-correct-shortage-0001',reason:'Тестовый откат ошибочной отправки'
})
assert.equal(correction.status,200,'Correction failed: '+JSON.stringify(correction))
assert.equal(sql.prepare('SELECT quantity FROM inventory_stock WHERE variant_id=98984').get().quantity,0,
 'Correcting an unaccounted dispatch cannot fabricate physical stock')
assert.equal(sql.prepare('SELECT status FROM inventory_reservations WHERE id=?').get(short.reservation.id).status,'unresolved')

// A second unresolved reservation with a known SKU must not be blocked even
// when the first buyer already reserves all physical stock. Do not steal that reserve.
const first=await create(98985,'48','qa-dispatch-first-buyer-0001')
assert.equal(first.reservation.status,'active')
const second=await create(98985,'48','qa-dispatch-second-buyer-0001')
assert.equal(second.reservation.status,'unresolved','This buyer should have a known SKU in shortage state')
assert.equal(second.row.stock_writeoff_status,'pending_reservation')
const pendingPlan=await getPlan(second)
assert.equal(pendingPlan.lines[0].selectable,true,'Known pending-reservation item must remain shippable')
const pendingItems=[{orderItemId:second.itemId,quantity:1}]
const pendingRequest='qa-dispatch-unresolved-confirmed-0001'
const unresolvedPreflight=await dispatch(second,pendingRequest,pendingItems)
assert.equal(unresolvedPreflight.body.code,'dispatch_stock_confirmation_required')
const unresolvedConfirm=await dispatch(second,pendingRequest,pendingItems,[{
 source:'warehouse',variantId:98985,expectedQuantity:1,operationQuantity:1
}])
assert.equal(unresolvedConfirm.status,200,'Unresolved known SKU should send after possession confirmation: '+JSON.stringify(unresolvedConfirm))
const otherReserve=sql.prepare('SELECT status FROM inventory_reservations WHERE id=?').get(first.reservation.id)
assert.equal(otherReserve.status,'active','Another buyer reservation may not be removed')
const otherStock=sql.prepare('SELECT quantity,reserved_quantity FROM inventory_stock WHERE variant_id=98985').get()
assert.deepEqual([otherStock.quantity,otherStock.reserved_quantity],[0,1],
 'Physical stock can now be lower than held commitments, but outstanding reservations must remain intact')

 // Partial delivery of a known SKU whose reservation could not be admitted.
 // A different buyer still owns the only active reservation.
const owner=await create(98986,'50','qa-partial-owner-0001')
assert.equal(owner.reservation.status,'active')
const bulk=await create(98986,'50','qa-partial-shortage-0001',3)
assert.equal(bulk.reservation.status,'unresolved')
const planBefore=await getPlan(bulk)
assert.equal(planBefore.lines[0].selectedQuantity,3,'All pending goods are selected by default')
assert.equal(planBefore.lines[0].selectable,true)
const subset=[{orderItemId:bulk.itemId,quantity:1}]
const partialKey='qa-partial-shortage-dispatch-0001'
const needConfirm=await dispatch(bulk,partialKey,subset)
assert.equal(needConfirm.status,409)
assert.equal(needConfirm.body.code,'dispatch_stock_confirmation_required')
assert.equal(needConfirm.body.items[0].operationQuantity,1,
  'Confirm only the one piece actually being dispatched')
const sentOne=await dispatch(bulk,partialKey,subset,[{
 source:'warehouse',variantId:98986,expectedQuantity:1,operationQuantity:1
}])
assert.equal(sentOne.status,200,'Partial unresolved dispatch must commit: '+JSON.stringify(sentOne))
const remaining=sql.prepare(`SELECT id,quantity,line_total,stock_writeoff_status
 FROM order_items WHERE order_id=? AND id<>?`).get(bulk.id,bulk.itemId)
assert(remaining?.id>0)
assert.equal(remaining.quantity,2)
assert.equal(remaining.stock_writeoff_status,'pending_reservation')
const pendingReserve=sql.prepare('SELECT quantity,status,unresolved_reason FROM inventory_reservations WHERE order_item_id=?').get(remaining.id)
assert.deepEqual([pendingReserve.quantity,pendingReserve.status,pendingReserve.unresolved_reason],
 [2,'unresolved','concurrent_shortage'])
assert.equal(sql.prepare('SELECT quantity FROM order_items WHERE id=?').get(bulk.itemId).quantity,1)
assert.equal(sql.prepare('SELECT status FROM inventory_reservations WHERE order_item_id=?').get(bulk.itemId).status,'fulfilled')
assert.equal(sql.prepare('SELECT SUM(line_total) AS total FROM order_items WHERE order_id=?').get(bulk.id).total,54000,
  'Splitting must preserve the order total')
assert.equal(sql.prepare('SELECT shipping_status FROM orders WHERE id=?').get(bulk.id).shipping_status,'not_sent')
assert.deepEqual([
 ...Object.values(sql.prepare('SELECT quantity,reserved_quantity FROM inventory_stock WHERE variant_id=98986').get())
],[0,1],'Never steal a different buyer\'s reservation or run physical negative')
const sameRetry=await dispatch(bulk,partialKey,subset)
assert.equal(sameRetry.status,200)
assert.equal(sameRetry.body.alreadyCommitted,true)
assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM order_items WHERE order_id=?').get(bulk.id).n,2,
 'Idempotent retry may not duplicate the remaining item')
const secondPlan=await getPlan(bulk)
const remPlan=secondPlan.lines.find(x=>x.orderItemId===remaining.id)
assert.equal(remPlan.readyQuantity,2)
assert.equal(remPlan.selectedQuantity,2)
const nextPart=await dispatch(bulk,'qa-partial-shortage-dispatch-0002',
 [{orderItemId:remaining.id,quantity:1}])
assert.equal(nextPart.status,409)
assert.equal(nextPart.body.items[0].operationQuantity,1)
const secondPart=await dispatch(bulk,'qa-partial-shortage-dispatch-0002',
 [{orderItemId:remaining.id,quantity:1}],
 [{source:'warehouse',variantId:98986,expectedQuantity:0,operationQuantity:1}])
assert.equal(secondPart.status,200)
assert.deepEqual(Object.values(sql.prepare('SELECT quantity,stock_writeoff_status FROM order_items WHERE id=?').get(remaining.id)),
 [1,'fulfilled'])
assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM order_items WHERE order_id=?').get(bulk.id).n,3)
const dispatchItem1=sql.prepare('SELECT id FROM order_dispatch_items WHERE order_item_id=?').get(bulk.itemId)
const undo=await call('/api/orders/'+bulk.id+'/shipping/dispatch-items/'+dispatchItem1.id+'/correct','POST',{
 requestId:'qa-partial-shortage-undo-0001',reason:'QA cancel only one shipped unit'
})
assert.equal(undo.status,200,'Cancel one dispatched piece: '+JSON.stringify(undo))
assert.equal(sql.prepare('SELECT status FROM inventory_reservations WHERE order_item_id=?').get(bulk.itemId).status,
 'unresolved','A cancelled shortage must not create an active reservation ahead of another buyer')
assert.deepEqual([
 ...Object.values(sql.prepare('SELECT quantity,reserved_quantity FROM inventory_stock WHERE variant_id=98986').get())
],[1,1],'Undo restores only previously deducted stock, never another buyer\'s reserved balance')
assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM inventory_reservations WHERE order_id=? AND status=\'unresolved\'').get(bulk.id).n,2)

console.log('SELECTIVE_SHIPPING_HTTP_SHORTAGE_PASS: zero free, bounded zero stock with confirmation, idempotency, undo without phantom stock, unresolved known SKU and another order reserve preserved')
