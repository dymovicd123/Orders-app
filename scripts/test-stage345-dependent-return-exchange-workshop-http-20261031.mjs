// Integration harness: run the actual versioned SQL migrations against a
// brand-new in-memory SQLite D1 shim. No Cloudflare network, no remote D1.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {createHash} from 'node:crypto'
import worker from '../worker/index.ts'
import { planOrderManagerSchemaReconciliation } from './order-manager-schema-reconciliation-20261030.mjs'

const sql=new DatabaseSync(':memory:')
const migrations=fs.readdirSync('migrations').filter(name=>/^\d{4}.*\.sql$/.test(name)).sort()
assert(migrations.length>=110,'Expected complete schema migration chain')
let last=''
for(const name of migrations){
 try {sql.exec(fs.readFileSync('migrations/'+name,'utf8'));last=name}
 catch(error){throw new Error('Fresh SQLite migration '+name+' failed after '+last+': '+(error?.message||error))}
}
// The migration gap #648 is handled by the pure, fail-closed planner. This
// test explicitly applies the result to DISPOSABLE LOCAL SQLite only.
// No remote DB, network, or migration executor is available in this script.
const auditTableExists = Boolean(sql.prepare(
  "SELECT name FROM sqlite_schema WHERE type='table' AND name='order_manager_audit'"
).get())
const localObservation = {
  ordersColumns:sql.prepare('PRAGMA table_info(orders)').all(),
  auditTableExists,
  auditColumns:auditTableExists ? sql.prepare('PRAGMA table_info(order_manager_audit)').all() : [],
}
const schemaPlan=planOrderManagerSchemaReconciliation(localObservation)
const localSchemaGaps=schemaPlan.steps.map(step=>step.object)
assert.deepEqual(localSchemaGaps,['orders.manager_snapshot_name','order_manager_audit'])
for(const step of schemaPlan.steps)sql.exec(step.sql)
console.log('P0_HTTP_LOCAL_SCHEMA_GAPS: '+JSON.stringify(localSchemaGaps)+' (explicit test-only repair; #648)')
const tables=()=>new Set(sql.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(x=>x.name))
for(const n of ['app_users','app_sessions','inventory_stock','inventory_reservations','critical_operations','orders','order_items','catalog_products','catalog_variants']){
 assert(tables().has(n),'Fresh complete schema must have '+n)
}
function stmt(statement,params=[]){
 return {
  sql:statement,
  bind(...values){return stmt(statement,values)},
  async first(){return sql.prepare(statement).get(...params)??null},
  async all(){return {results:sql.prepare(statement).all(...params)}},
  async run(){
   const m=sql.prepare(statement).run(...params)
   // Simulate failure AFTER the completion UPDATE committed but BEFORE
   // the caller received its result. This is a real persisted critical op.
   if(loseCriticalCompleteResponseOnce
       && statement.includes('UPDATE critical_operations')
       && statement.includes("SET status = 'completed'")){
     loseCriticalCompleteResponseOnce=false
     throw new Error('INJECTED: lost response after critical-operation completion')
   }
   return {success:true,meta:{changes:Number(m.changes),last_row_id:Number(m.lastInsertRowid)}}
  },
 }
}
let loseReservationBatchResponseOnce=false
let loseCriticalCompleteResponseOnce=false
let stealCreateLeaseAtBatchOnce=false
const db={
 prepare:q=>stmt(q),
 async batch(stmts){
  // Simulate a concurrent retry stealing the lease immediately before the
  // atomic header INSERT+target UPDATE (not before request validation).
  if(stealCreateLeaseAtBatchOnce && stmts.some(st=>st.sql?.includes('INSERT INTO orders ('))){
   stealCreateLeaseAtBatchOnce=false
   const changed=sql.prepare("UPDATE critical_operations SET lease_token='other-owner', lease_until_ms=? WHERE request_id=? AND step='validated'").run(Date.now()+45000,'create-stolen-lease')
   assert.equal(Number(changed.changes),1,'Create lease fault must actually run')
  }
  sql.exec('BEGIN IMMEDIATE')
  let committed=false
  try{
   const out=[];for(const st of stmts)out.push(await st.run())
   sql.exec('COMMIT');committed=true
   if(loseReservationBatchResponseOnce && stmts.some(st=>st.sql?.includes('INSERT INTO inventory_reservations'))){
     loseReservationBatchResponseOnce=false
     throw new Error('INJECTED: committed reservation but client lost the response')
   }
   return out
  }catch(error){if(!committed)sql.exec('ROLLBACK');throw error}
 }
}
const token='test-local-http-create-token'
const tokenHash=createHash('sha256').update(token).digest('base64url')
const staffToken='test-local-http-staff-token'
const staffTokenHash=createHash('sha256').update(staffToken).digest('base64url')
sql.prepare("INSERT INTO managers (id,name,is_active) VALUES(9001,'HTTP Manager',1)").run()
sql.prepare("INSERT INTO app_users (id,login,email,password_hash,role,manager_id,display_name,is_active,must_change_password) VALUES(9001,'httpmanager','local@invalid','fixture-inert-hash','admin',9001,'HTTP Admin',1,0)").run()
sql.prepare("INSERT INTO app_users (id,login,email,password_hash,role,manager_id,display_name,is_active,must_change_password) VALUES(9002,'httpstaff','staff@invalid','fixture-inert-hash','manager',NULL,'HTTP Staff',1,0)").run()
sql.prepare("INSERT INTO app_sessions (user_id,token_hash,expires_at) VALUES(9001,?,'2099-01-01')").run(tokenHash)
sql.prepare("INSERT INTO app_sessions (user_id,token_hash,expires_at) VALUES(9002,?,'2099-01-01')").run(staffTokenHash)
sql.prepare("INSERT INTO catalog_products (id,name,category,is_active) VALUES(9021,'P0 HTTP ТОВАР','adult',1)").run()
sql.prepare("INSERT INTO catalog_variants (id,product_id,gender,color,material,length,size_label,category,is_active) VALUES(9031,9021,'МУЖ','БЕЖ','СТАНДАРТ','СТАНДАРТ','50','adult',1)").run()
sql.prepare("INSERT INTO catalog_stock_positions (product_id,category,gender_scope,material,length,is_default,is_active,sort_order,created_at,updated_at) VALUES(9021,'adult','unisex','СТАНДАРТ','СТАНДАРТ',0,1,0,'2026-10-30T00:00:00Z','2026-10-30T00:00:00Z')").run()
const executionId=sql.prepare("SELECT id FROM catalog_stock_positions WHERE product_id=9021 AND is_active=1 AND material='СТАНДАРТ' AND length='СТАНДАРТ'").get()?.id
assert(executionId,'The fixture SKU needs a V3 execution identity')
sql.prepare('UPDATE catalog_variants SET stock_position_id=? WHERE id=9031').run(executionId)
for(const [id,source] of [[9041,'warehouse'],[9042,'boutique']]){
 sql.prepare("INSERT INTO inventory_stock (id,inventory_source,product_id,variant_id,product_name_snapshot,gender_snapshot,color_snapshot,material_snapshot,length_snapshot,size_snapshot,quantity,reserved_quantity) VALUES(?,?,9021,9031,'P0 HTTP ТОВАР','МУЖ','БЕЖ','СТАНДАРТ','СТАНДАРТ','50',2,0)").run(id,source)
}
sql.prepare("INSERT INTO inventory_model_meta (key,value,updated_at) VALUES('human_inventory_v2','active','2026-10-30T00:00:00Z') ON CONFLICT(key) DO UPDATE SET value='active',updated_at=excluded.updated_at").run()
async function http(method,path,payload,identity='admin'){
 const headers={'Cookie':'orders_session='+(identity==='staff'?staffToken:token)}
 if(payload)headers['Content-Type']='application/json'
 const request=new Request('https://test.invalid'+path,{method,headers,...(payload?{body:JSON.stringify(payload)}:{})})
 const response=await worker.fetch(request,{DB:db})
 let data;try{data=await response.json()}catch{data={}}
 return {status:response.status,data}
}
const item=(source='warehouse')=>({
 productName:'P0 HTTP ТОВАР',audienceType:'ВЗРОСЛЫЙ',gender:'МУЖ',color:'БЕЖ',material:'СТАНДАРТ',length:'СТАНДАРТ',size:'50',
 quantity:1,unitPrice:1000,catalogPriceSnapshot:null,sourceType:source,
 shortageAcknowledged:false,shortageDecision:null,
})
const payload=(requestId,items=[item()])=>({
 requestId,externalId:'P0-'+requestId,orderDate:'2026-10-30',managerId:9001,
 managerName:'HTTP Manager',customerPhone:'',customerName:'HTTP Test',
 city:'',deliveryType:'',orderPaymentMethod:'',sourceType:'warehouse',
 workshopStatus:'in_workshop',orderStatus:'active',pricingMode:'itemized_v1',
 items,payments:[],
})

sql.prepare("INSERT INTO catalog_products (id,name,category,is_active) VALUES(9022,'P0 HTTP НОВЫЙ','adult',1)").run()
sql.prepare("INSERT INTO catalog_variants (id,product_id,gender,color,material,length,size_label,category,is_active) VALUES(9032,9022,'МУЖ','ЧЕРНЫЙ','СТАНДАРТ','СТАНДАРТ','50','adult',1)").run()
sql.prepare("INSERT INTO catalog_stock_positions (product_id,category,gender_scope,material,length,is_default,is_active,sort_order,created_at,updated_at) VALUES(9022,'adult','unisex','СТАНДАРТ','СТАНДАРТ',0,1,0,'2026-10-31T00:00:00Z','2026-10-31T00:00:00Z')").run()
const replacementExecution=sql.prepare("SELECT id FROM catalog_stock_positions WHERE product_id=9022 AND is_active=1").get()?.id
assert(replacementExecution)
sql.prepare("UPDATE catalog_variants SET stock_position_id=? WHERE id=9032").run(replacementExecution)
sql.prepare("INSERT INTO inventory_stock (id,inventory_source,product_id,variant_id,product_name_snapshot,gender_snapshot,color_snapshot,material_snapshot,length_snapshot,size_snapshot,quantity,reserved_quantity) VALUES(9043,'boutique',9022,9032,'P0 HTTP НОВЫЙ','МУЖ','ЧЕРНЫЙ','СТАНДАРТ','СТАНДАРТ','50',2,0)").run()
const oldStock=()=>sql.prepare("SELECT quantity,reserved_quantity FROM inventory_stock WHERE id=9041").get()
const newStock=()=>sql.prepare("SELECT quantity,reserved_quantity FROM inventory_stock WHERE id=9043").get()
const getReserve=id=>sql.prepare("SELECT id,status,quantity,variant_id,inventory_source FROM inventory_reservations WHERE order_item_id=? ORDER BY id DESC LIMIT 1").get(id)
const qty=id=>Number(sql.prepare("SELECT quantity FROM order_items WHERE id=?").get(id)?.quantity)
const count=(table,where,params=[])=>Number(sql.prepare('SELECT COUNT(*) AS n FROM '+table+' WHERE '+where).get(...params)?.n)




const stock=id=>({...sql.prepare('SELECT quantity,reserved_quantity FROM inventory_stock WHERE id=?').get(id)})
const reserve=id=>sql.prepare("SELECT status,quantity,variant_id,inventory_source FROM inventory_reservations WHERE order_item_id=? ORDER BY id DESC LIMIT 1").get(id)
const create=async(key,items)=>{
 const r=await http('POST','/api/orders',payload(key,items))
 assert.equal(r.status,201,'Create: '+JSON.stringify(r))
 return Number(r.data.orderId)
}
const send=async id=>{
 const r=await http('PATCH','/api/orders/'+id+'/shipping',{shippingStatus:'sent',shippingDate:'2026-10-31'})
 assert.equal(r.status,200,'Send: '+JSON.stringify(r))
}
const originalOrderId=await create('stage345-linked-base',[item('warehouse')])
const old=sql.prepare("SELECT id,product_id,variant_id,source_type,quantity,unit_price,line_total,stock_writeoff_status FROM order_items WHERE order_id=? AND quantity>0").get(originalOrderId)
assert.equal(old.variant_id,9031)
await send(originalOrderId)
assert.equal(reserve(old.id).status,'fulfilled')
const oldPhysical=stock(9041).quantity, replacementPhysical=stock(9043).quantity
const pendingBody={requestId:'stage345-pending-original-return',orderId:originalOrderId,returnDate:'2026-10-31',amount:0,
 items:[{orderItemId:old.id,quantity:1,physicalState:'pending',restock:true}]}
const registered=await http('POST','/api/returns',pendingBody)
assert.equal(registered.status,201,'Pending Return: '+JSON.stringify(registered))
const returnId=Number(registered.data.returnId)
assert(returnId)
assert.equal(stock(9041).quantity,oldPhysical)
const setInput={requestId:'stage345-blocked-exchange',orderId:originalOrderId,exchangeDate:'2026-10-31',expectedOrderTotal:1000,
 oldItems:[{orderItemId:old.id,quantity:1,physicalState:'warehouse',
 expectedActiveQuantity:1,expectedUnitPrice:1000,expectedLineTotal:1000,expectedCatalogPriceSnapshot:null}],
 newItems:[{...item('boutique'),productName:'P0 HTTP НОВЫЙ',color:'ЧЕРНЫЙ',unitPrice:1000,
 catalogPriceSnapshot:null,sourceType:'boutique',shipmentState:'pending'}],
 paymentAmount:0,paymentMethod:'',refundMethod:''}
const conflictingExchange=await http('POST','/api/exchanges/set',setInput)
assert(conflictingExchange.status>=400,'A pending standalone return already claimed entire original item: '+JSON.stringify(conflictingExchange))
assert.equal(count('exchanges','order_id=?',[originalOrderId]),0)
assert.equal(stock(9041).quantity,oldPhysical)
assert.equal(stock(9043).quantity,replacementPhysical)
const cancelledOriginalReturn=await http('PATCH','/api/returns/'+returnId+'/cancel',{requestId:'stage345-original-return-cancel'})
assert.equal(cancelledOriginalReturn.status,200,JSON.stringify(cancelledOriginalReturn))
assert.equal(stock(9041).quantity,oldPhysical)
const exchangeBody={...setInput,requestId:'stage345-now-allowed-exchange'}
const exchange=await http('POST','/api/exchanges/set',exchangeBody)
assert.equal(exchange.status,201,'Exchange after release of Return claim: '+JSON.stringify(exchange))
const exchangeId=Number(exchange.data.exchangeId)
assert(exchangeId)
const newLine=sql.prepare("SELECT id,product_id,variant_id,source_type,quantity FROM order_items WHERE order_id=? AND id<>? AND quantity>0").get(originalOrderId,old.id)
assert.deepEqual([newLine.product_id,newLine.variant_id,newLine.source_type],[9022,9032,'boutique'])
assert.equal(stock(9041).quantity,oldPhysical+1)
assert.equal(stock(9043).quantity,replacementPhysical)
const cannotReturnUndelivered=await http('POST','/api/returns',{requestId:'stage345-before-new-dispatch-return',orderId:originalOrderId,returnDate:'2026-10-31',amount:0,
 items:[{orderItemId:newLine.id,quantity:1,physicalState:'boutique',restock:true}]})
assert(cannotReturnUndelivered.status>=400,'Replacement not sent: no actual physical return allowed: '+JSON.stringify(cannotReturnUndelivered))
const outEvent=sql.prepare("SELECT id,status,pending_reason FROM inventory_lifecycle_events WHERE operation_type='exchange' AND operation_id=? AND event_type='exchange_new_out'").get(exchangeId)
assert.equal(outEvent.status,'pending')
assert.equal(outEvent.pending_reason,'awaiting_dispatch')
const dispatch=await http('POST','/api/exchanges/pending-dispatch/'+outEvent.id,{requestId:'stage345-new-dispatch'})
assert.equal(dispatch.status,200,'Dispatch replacement: '+JSON.stringify(dispatch))
assert.equal(stock(9043).quantity,replacementPhysical-1)
const physicalReturnBody={requestId:'stage345-new-replacement-return',orderId:originalOrderId,returnDate:'2026-10-31',amount:0,
 items:[{orderItemId:newLine.id,quantity:1,physicalState:'boutique',restock:true}]}
const newReturn=await http('POST','/api/returns',physicalReturnBody)
assert.equal(newReturn.status,201,'Return shipped replacement: '+JSON.stringify(newReturn))
const newReturnId=Number(newReturn.data.returnId)
assert(newReturnId)
assert.equal(stock(9043).quantity,replacementPhysical)
const mustCancelChildFirst=await http('PATCH','/api/exchanges/'+exchangeId+'/cancel',{requestId:'stage345-parent-cancel-before-child'})
assert(mustCancelChildFirst.status>=400,'Parent exchange cannot be cancelled while replacement Return remains active: '+JSON.stringify(mustCancelChildFirst))
assert.equal(stock(9041).quantity,oldPhysical+1)
assert.equal(stock(9043).quantity,replacementPhysical)
assert.equal(count('exchanges',"id=? AND status='cancelled'",[exchangeId]),0)
const undoChild=await http('PATCH','/api/returns/'+newReturnId+'/cancel',{requestId:'stage345-child-return-cancel'})
assert.equal(undoChild.status,200,'Cancel dependent Return: '+JSON.stringify(undoChild))
assert.equal(stock(9043).quantity,replacementPhysical-1)
const undoParent=await http('PATCH','/api/exchanges/'+exchangeId+'/cancel',{requestId:'stage345-parent-after-child'})
assert.equal(undoParent.status,200,'Cancel exchange once dependencies cleared: '+JSON.stringify(undoParent))
assert.equal(stock(9041).quantity,oldPhysical)
if(stock(9043).quantity!==replacementPhysical){
 console.error('STAGE5_CANCEL_SYNTHETIC_DIAG',JSON.stringify({
  checks:sql.prepare("SELECT id,check_type,checked_at FROM inventory_stock_checks WHERE variant_id=9032 ORDER BY id DESC LIMIT 8").all(),
  movements:sql.prepare("SELECT id,movement_type,quantity_delta,reference_type FROM inventory_movements WHERE variant_id=9032 ORDER BY id DESC LIMIT 12").all(),
  dispatch:sql.prepare("SELECT di.id,di.quantity,di.cancelled_quantity,di.movement_id FROM order_dispatch_items di JOIN order_items oi ON oi.id=di.order_item_id WHERE oi.order_id=?").all(originalOrderId),
  lifecycle:sql.prepare("SELECT id,status,pending_reason,movement_id FROM inventory_lifecycle_events WHERE operation_id=?").all(exchangeId),
  stock:stock(9043),
 }))
}
assert.equal(stock(9043).quantity,replacementPhysical)
assert.equal(sql.prepare('SELECT quantity FROM order_items WHERE id=?').get(old.id).quantity,1)
assert.equal(sql.prepare('SELECT quantity FROM order_items WHERE id=?').get(newLine.id).quantity,0)
assert.equal(reserve(old.id).status,'fulfilled')
const repeat=await http('PATCH','/api/exchanges/'+exchangeId+'/cancel',{requestId:'stage345-parent-after-child'})
assert.equal(repeat.status,200)
assert.equal(stock(9041).quantity,oldPhysical)
assert.equal(stock(9043).quantity,replacementPhysical)
console.log('STAGE345_RETURN_EXCHANGE_DEPENDENCY_HTTP_PASS: return claims protect exact original, dispatch prerequisite, dependent replacement Return blocks parent cancel, reverse order restores original stock')
// Workshop and Warehouse in the same order: Return must only reduce the
// precise active Workshop task, not alter warehouse source or another task.
const mixedOrderId=await create('stage345-workshop-mixed',[{...item('warehouse'),quantity:1},{...item('warehouse'),sourceType:'workshop',quantity:2}])
const mixedRows=sql.prepare('SELECT id,source_type,quantity,is_workshop,variant_id FROM order_items WHERE order_id=? ORDER BY id').all(mixedOrderId)
assert.equal(mixedRows.length,2)
// Database stores source_type='warehouse' for Workshop rows as a physical
// fallback; is_workshop is the authoritative discriminator.
const physicalLine=mixedRows.find(x=>x.is_workshop===0)
const workshopLine=mixedRows.find(x=>x.is_workshop===1)
assert(physicalLine&&workshopLine)
const originalTask=sql.prepare('SELECT id,quantity,status,order_item_id FROM workshop_tasks WHERE order_id=? AND order_item_id=?').get(mixedOrderId,workshopLine.id)
assert(originalTask?.id)
assert.equal(originalTask.quantity,2)
assert.equal(originalTask.status,'active')
const warehouseBefore=stock(9041)
// An active Workshop task must prevent full shipping, but cannot prevent
// a separate eligible Warehouse handover. Finalize Workshop through the
// actual public HTTP endpoint before shipping this mixed order.
const premature=await http('PATCH','/api/orders/'+mixedOrderId+'/shipping',{shippingStatus:'sent',shippingDate:'2026-10-31'})
assert.equal(premature.status,409,'Active Workshop work must block full shipment')
assert.equal(premature.data.code,'workshop_not_ready')
assert.deepEqual(stock(9041),warehouseBefore,'Failed mixed shipment leaves physical Warehouse unchanged')
const ready=await http('PATCH','/api/workshop/'+originalTask.id,{status:'done'})
assert.equal(ready.status,200,'Mark Workshop task complete through HTTP: '+JSON.stringify(ready))
assert.equal(sql.prepare('SELECT status FROM workshop_tasks WHERE id=?').get(originalTask.id).status,'done')
await send(mixedOrderId)
const warehouseAfter=stock(9041)
assert.equal(warehouseAfter.quantity,warehouseBefore.quantity-1)
const workshopReturn={requestId:'stage345-workshop-partial-return',orderId:mixedOrderId,returnDate:'2026-10-31',amount:0,
 items:[{orderItemId:workshopLine.id,quantity:1,physicalState:'pending',restock:false}]}
const workshopRegistered=await http('POST','/api/returns',workshopReturn)
assert.equal(workshopRegistered.status,201,'Workshop partial return: '+JSON.stringify(workshopRegistered))
const wrId=Number(workshopRegistered.data.returnId)
assert(wrId)
assert.equal(stock(9041).quantity,warehouseAfter.quantity,'Workshop Return must not credit or debit warehouse')
const completedTask=sql.prepare('SELECT quantity,status FROM workshop_tasks WHERE id=?').get(originalTask.id)
assert.deepEqual({...completedTask},{quantity:2,status:'done'},'Return must not rewrite historically completed Workshop work as active')
const wrAgain=await http('POST','/api/returns',workshopReturn)
assert.equal(wrAgain.status,201)
assert.equal(sql.prepare('SELECT quantity FROM workshop_tasks WHERE id=?').get(originalTask.id).quantity,2)
const wrCancel=await http('PATCH','/api/returns/'+wrId+'/cancel',{requestId:'stage345-workshop-return-cancel'})
assert.equal(wrCancel.status,200,'Restore workshop task: '+JSON.stringify(wrCancel))
assert.deepEqual({...sql.prepare('SELECT quantity,status FROM workshop_tasks WHERE id=?').get(originalTask.id)},{quantity:2,status:'done'},'Return cancellation must preserve completed Workshop task')
assert.equal(stock(9041).quantity,warehouseAfter.quantity)
const wrCancelReplay=await http('PATCH','/api/returns/'+wrId+'/cancel',{requestId:'stage345-workshop-return-cancel'})
assert.equal(wrCancelReplay.status,200)
assert.equal(sql.prepare('SELECT quantity FROM workshop_tasks WHERE id=?').get(originalTask.id).quantity,2)
assert.equal(stock(9041).quantity,warehouseAfter.quantity)
console.log('STAGE36_WORKSHOP_MIXED_ISSUE_RETURN_HTTP_PASS: active Workshop blocks full shipping; HTTP completion permits shipment; pending Return/cancel preserve completed task and exact Warehouse stock')
