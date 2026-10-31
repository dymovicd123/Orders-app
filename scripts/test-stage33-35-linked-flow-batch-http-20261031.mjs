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


const original=await http('POST','/api/orders',payload('stage3-batch-original',[{...item('warehouse'),quantity:2}]))
assert.equal(original.status,201,'Original order must be created: '+JSON.stringify(original))
const orderId=Number(original.data.orderId)
const old=sql.prepare('SELECT id,product_id,variant_id,quantity,unit_price,line_total,source_type FROM order_items WHERE order_id=? AND quantity>0').get(orderId)
assert.deepEqual([old.product_id,old.variant_id,old.quantity,old.unit_price,old.line_total,old.source_type],[9021,9031,2,1000,2000,'warehouse'])
const shipped=await http('PATCH','/api/orders/'+orderId+'/shipping',{shippingStatus:'sent',shippingDate:'2026-10-31'})
assert.equal(shipped.status,200,JSON.stringify(shipped))
assert.equal(oldStock().quantity,0)
const baselineNew=newStock().quantity
const oldReserve=getReserve(old.id)
assert.equal(oldReserve.status,'fulfilled')
const before=sql.prepare('SELECT total_amount,received_amount,return_amount,debt_amount,shipping_status,shipping_date FROM orders WHERE id=?').get(orderId)
assert.equal(before.total_amount,2000)
assert.equal(before.shipping_status,'sent')
const oldRow={orderItemId:old.id,quantity:1,physicalState:'warehouse',expectedActiveQuantity:2,
 expectedUnitPrice:1000,expectedLineTotal:2000,expectedCatalogPriceSnapshot:null}
const replacement={...item('boutique'),productName:'P0 HTTP НОВЫЙ',color:'ЧЕРНЫЙ',
 quantity:1,unitPrice:1000,catalogPriceSnapshot:null,sourceType:'boutique'}
const exchangeBase={orderId,exchangeDate:'2026-10-31',expectedOrderTotal:2000,
 oldItems:[oldRow],newItems:[replacement],paymentAmount:0,paymentMethod:'',refundMethod:''}
const invalid=await http('POST','/api/exchanges/set',{...exchangeBase,requestId:'stage3-batch-missing-choice'})
assert(invalid.status>=400,'Shipment choice must be required: '+JSON.stringify(invalid))
assert.equal(oldStock().quantity,0)
assert.equal(newStock().quantity,baselineNew)
assert.equal(count('exchanges','order_id=?',[orderId]),0)
const exchangeBody={...exchangeBase,requestId:'stage3-batch-pending-exchange',
 newItems:[{...replacement,shipmentState:'pending'}]}
const created=await http('POST','/api/exchanges/set',exchangeBody)
assert.equal(created.status,201,'Deferred replacement exchange: '+JSON.stringify(created))
const exchangeId=Number(created.data.exchangeId)
assert(exchangeId>0)
const replacementRow=sql.prepare('SELECT id,product_id,variant_id,source_type,quantity,unit_price,line_total FROM order_items WHERE order_id=? AND id<>? AND quantity>0').get(orderId,old.id)
assert.deepEqual([replacementRow.product_id,replacementRow.variant_id,replacementRow.source_type,replacementRow.quantity],[9022,9032,'boutique',1])
assert.equal(oldStock().quantity,1,'The old physical item returned exactly once')
assert.equal(newStock().quantity,baselineNew,'Unsent replacement MUST NOT physically leave Boutique')
assert.equal(qty(old.id),1)
const events=sql.prepare("SELECT id,event_type,order_item_id,product_id,variant_id,inventory_source,status,pending_reason,quantity FROM inventory_lifecycle_events WHERE operation_type='exchange' AND operation_id=? ORDER BY id").all(exchangeId)
assert.equal(events.length,2)
const inbound=events.find(x=>x.event_type==='exchange_old_in')
const outbound=events.find(x=>x.event_type==='exchange_new_out')
assert(inbound&&outbound)
assert.deepEqual([inbound.order_item_id,inbound.product_id,inbound.variant_id,inbound.inventory_source,inbound.status],[old.id,9021,9031,'warehouse','applied'])
assert.deepEqual([outbound.order_item_id,outbound.product_id,outbound.variant_id,outbound.inventory_source,outbound.status,outbound.pending_reason],[replacementRow.id,9022,9032,'boutique','pending','awaiting_dispatch'])
const postExchange=sql.prepare('SELECT total_amount,received_amount,return_amount,debt_amount,shipping_status,shipping_date FROM orders WHERE id=?').get(orderId)
assert.deepEqual([postExchange.total_amount,postExchange.received_amount,postExchange.return_amount,postExchange.debt_amount,postExchange.shipping_status,postExchange.shipping_date],
 [before.total_amount,before.received_amount,before.return_amount,before.debt_amount,before.shipping_status,before.shipping_date],
 'Equal-price delayed exchange must not modify order financial totals or original shipping state')
const duplicateExchange=await http('POST','/api/exchanges/set',exchangeBody)
assert.equal(duplicateExchange.status,201)
assert.equal(Number(duplicateExchange.data.exchangeId),exchangeId)
assert.equal(newStock().quantity,baselineNew)
const oldShippingRetry=await http('PATCH','/api/orders/'+orderId+'/shipping',{shippingStatus:'sent',shippingDate:'2026-10-31'})
assert.equal(oldShippingRetry.status,200)
assert.equal(newStock().quantity,baselineNew,'Original shipping endpoint must not dispatch pending replacement')
const sent=await http('POST','/api/exchanges/pending-dispatch/'+outbound.id,{requestId:'stage3-batch-send-replacement'})
assert.equal(sent.status,200,'Deferred dispatch: '+JSON.stringify(sent))
assert.equal(sent.data.ok,true)
assert.equal(sent.data.alreadySent,false)
assert.equal(newStock().quantity,baselineNew-1)
assert.equal(sql.prepare('SELECT status FROM inventory_lifecycle_events WHERE id=?').get(outbound.id).status,'applied')
const repeatDispatch=await http('POST','/api/exchanges/pending-dispatch/'+outbound.id,{requestId:'stage3-batch-send-replacement'})
assert.equal(repeatDispatch.status,200)
assert.equal(newStock().quantity,baselineNew-1)
const independentRepeat=await http('POST','/api/exchanges/pending-dispatch/'+outbound.id,{requestId:'stage3-batch-send-replacement-again'})
assert.equal(independentRepeat.status,200)
assert.equal(independentRepeat.data.alreadySent,true)
assert.equal(newStock().quantity,baselineNew-1)
const cancel=await http('PATCH','/api/exchanges/'+exchangeId+'/cancel',{requestId:'stage3-batch-cancel-after-send'})
assert.equal(cancel.status,200,'Cancel a dispatched exchange: '+JSON.stringify(cancel))
assert.equal(qty(old.id),2)
assert.equal(qty(replacementRow.id),0)
assert.equal(oldStock().quantity,0)
assert.equal(newStock().quantity,baselineNew)
assert.equal(getReserve(old.id).status,'fulfilled')
assert.equal(count('exchanges',"id=? AND status='cancelled'",[exchangeId]),1)
const cancelAgain=await http('PATCH','/api/exchanges/'+exchangeId+'/cancel',{requestId:'stage3-batch-cancel-after-send'})
assert.equal(cancelAgain.status,200)
assert.equal(oldStock().quantity,0)
assert.equal(newStock().quantity,baselineNew)
const financialAfter=sql.prepare('SELECT total_amount,received_amount,return_amount,debt_amount FROM orders WHERE id=?').get(orderId)
assert.deepEqual([financialAfter.total_amount,financialAfter.received_amount,financialAfter.return_amount,financialAfter.debt_amount],
 [before.total_amount,before.received_amount,before.return_amount,before.debt_amount],'Cancellation must not fabricate money movements')
assert.equal(sql.prepare('SELECT unit_price FROM order_items WHERE id=?').get(old.id).unit_price,1000,'Historical original recorded sale price unchanged')
console.log('STAGE33_35_BATCH_DEFERRED_DISPATCH_PASS: required choice, exact original/replacement SKU, deferred physical, idempotent dispatch and reverse cancellation, no money changes')
// Use an independent stocked Boutique source for the second scenario; the first
// order legitimately consumed all Warehouse physical stock.
const lateStock=()=>Number(sql.prepare('SELECT quantity FROM inventory_stock WHERE id=9042').get().quantity)
const lateOrder=await http('POST','/api/orders',payload('stage3-batch-pending-return',[item('boutique')]))
assert.equal(lateOrder.status,201)
const lateId=Number(lateOrder.data.orderId)
const lateItem=Number(sql.prepare('SELECT id FROM order_items WHERE order_id=? AND quantity>0').get(lateId).id)
const lateShip=await http('PATCH','/api/orders/'+lateId+'/shipping',{shippingStatus:'sent',shippingDate:'2026-10-31'})
assert.equal(lateShip.status,200,'Late order shipping: '+JSON.stringify(lateShip))
const beforePendingPhysical=lateStock()
const returnBody={requestId:'stage3-batch-pending-return',orderId:lateId,returnDate:'2026-10-31',amount:0,
 items:[{orderItemId:lateItem,quantity:1,restock:true,physicalState:'pending'}]}
const pending=await http('POST','/api/returns',returnBody)
assert.equal(pending.status,201,JSON.stringify(pending))
const returnId=Number(pending.data.returnId)
assert(returnId>0)
assert.equal(lateStock(),beforePendingPhysical,'Pending physical receipt must not increase stock')
const pendingItem=sql.prepare('SELECT physical_tracking,physical_received_at,inventory_source FROM return_items WHERE return_id=?').get(returnId)
assert.equal(pendingItem.physical_tracking,1)
assert.equal(pendingItem.physical_received_at,null)
assert.equal(pendingItem.inventory_source,null)
const pendingRetry=await http('POST','/api/returns',returnBody)
assert.equal(pendingRetry.status,201)
assert.equal(lateStock(),beforePendingPhysical)
const cancelPending=await http('PATCH','/api/returns/'+returnId+'/cancel',{requestId:'stage3-batch-cancel-pending-return'})
assert.equal(cancelPending.status,200,JSON.stringify(cancelPending))
assert.equal(lateStock(),beforePendingPhysical,'Cancellation of unreceived physical item must not subtract stock')
const repeatPendingCancel=await http('PATCH','/api/returns/'+returnId+'/cancel',{requestId:'stage3-batch-cancel-pending-return'})
assert.equal(repeatPendingCancel.status,200)
assert.equal(lateStock(),beforePendingPhysical)
console.log('STAGE34_PENDING_RETURN_BATCH_PASS: pending physical return, replay and cancel create zero stock movements')

// 3.6 in the SAME linked batch: refund money without any physical goods.
const payment=await http('POST','/api/payments',{
 requestId:'stage3-batch-pay-late',orderId:lateId,paymentDate:'2026-10-31',method:'НАЛИЧНЫЕ',amount:500,paymentKind:'payment'})
assert.equal(payment.status,201,'Recorded payment before money-only Return: '+JSON.stringify(payment))
assert.equal(payment.data.ok,true)
const paidBefore=sql.prepare('SELECT total_amount,received_amount,return_amount,debt_amount FROM orders WHERE id=?').get(lateId)
assert.equal(paidBefore.total_amount,1000)
assert.equal(paidBefore.received_amount,500)
assert.equal(paidBefore.return_amount,0)
const stockBeforeMoney=lateStock()
const moneyOnly={requestId:'stage3-batch-money-only',orderId:lateId,returnDate:'2026-10-31',
 amount:200,paymentMethod:'НАЛИЧНЫЕ',items:[]}
const refunded=await http('POST','/api/returns',moneyOnly)
assert.equal(refunded.status,201,'Pure money-only return: '+JSON.stringify(refunded))
const moneyReturnId=Number(refunded.data.returnId)
assert(moneyReturnId>0)
assert.equal(sql.prepare('SELECT amount FROM returns WHERE id=?').get(moneyReturnId).amount,200)
assert.equal(count('return_items','return_id=?',[moneyReturnId]),0,'No artificial goods Return rows')
assert.equal(lateStock(),stockBeforeMoney,'Money-only Return must not mutate physical stock')
const moneyAfter=sql.prepare('SELECT received_amount,return_amount FROM orders WHERE id=?').get(lateId)
assert.deepEqual([moneyAfter.received_amount,moneyAfter.return_amount],[500,200])
const moneyAgain=await http('POST','/api/returns',moneyOnly)
assert.equal(moneyAgain.status,201)
assert.equal(Number(moneyAgain.data.returnId),moneyReturnId)
assert.equal(sql.prepare('SELECT return_amount FROM orders WHERE id=?').get(lateId).return_amount,200,'Refund replay cannot double credit')
assert.equal(lateStock(),stockBeforeMoney)
const wrongOverpayment=await http('POST','/api/returns',{...moneyOnly,requestId:'stage3-batch-over-refund',amount:600})
assert(wrongOverpayment.status>=400,'Cannot return more than outstanding received funds: '+JSON.stringify(wrongOverpayment))
assert.equal(lateStock(),stockBeforeMoney)
assert.equal(sql.prepare('SELECT return_amount FROM orders WHERE id=?').get(lateId).return_amount,200)
const cancelMoney=await http('PATCH','/api/returns/'+moneyReturnId+'/cancel',{requestId:'stage3-batch-money-cancel'})
assert.equal(cancelMoney.status,200,'Money-only refund cancellation: '+JSON.stringify(cancelMoney))
assert.equal(lateStock(),stockBeforeMoney)
assert.equal(sql.prepare('SELECT return_amount FROM orders WHERE id=?').get(lateId).return_amount,0,'Cancel money-only refund restores net paid exactly once')
const cancelMoneyAgain=await http('PATCH','/api/returns/'+moneyReturnId+'/cancel',{requestId:'stage3-batch-money-cancel'})
assert.equal(cancelMoneyAgain.status,200)
assert.equal(lateStock(),stockBeforeMoney)
assert.equal(sql.prepare('SELECT return_amount FROM orders WHERE id=?').get(lateId).return_amount,0)
assert.equal(count('payments','order_id=?',[lateId]),1,'No extra money payment created')
console.log('STAGE36_MONEY_ONLY_RETURN_BATCH_PASS: recorded pay, pure cash refund, no physical goods, idempotent replay, over-refund fail closed and cancellation')
