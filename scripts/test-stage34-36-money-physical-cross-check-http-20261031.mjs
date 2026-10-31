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



// Batched acceptance: all financial and physical consequences of actual
// authenticated Worker HTTP, against a disposable migrated SQLite database.
const totals=id=>({...sql.prepare('SELECT total_amount,received_amount,return_amount,debt_amount FROM orders WHERE id=?').get(id)})
const physical=id=>Number(sql.prepare('SELECT quantity FROM inventory_stock WHERE id=?').get(id).quantity)
const pay=async(orderId,key,amount)=>{
 const r=await http('POST','/api/payments',{requestId:key,orderId,paymentDate:'2026-10-31',method:'НАЛИЧНЫЕ',amount,paymentKind:'payment'})
 assert.equal(r.status,201,'Payment: '+JSON.stringify(r))
 return r
}
const ship=async(orderId)=>{
 const r=await http('PATCH','/api/orders/'+orderId+'/shipping',{shippingStatus:'sent',shippingDate:'2026-10-31'})
 assert.equal(r.status,200,'Ship order: '+JSON.stringify(r))
}
const create=async (key,source)=>{
 const r=await http('POST','/api/orders',payload(key,[item(source)]))
 assert.equal(r.status,201,'Create order: '+JSON.stringify(r))
 const orderId=Number(r.data.orderId)
 const row=sql.prepare('SELECT id,variant_id,source_type,quantity,unit_price,line_total FROM order_items WHERE order_id=? AND quantity>0').get(orderId)
 assert.equal(row.variant_id,9031)
 return {orderId,original:row}
}
const replacement=(unitPrice,shipmentState)=>({...item('boutique'),productName:'P0 HTTP НОВЫЙ',color:'ЧЕРНЫЙ',
  quantity:1,unitPrice,catalogPriceSnapshot:null,sourceType:'boutique',shipmentState,
  ...(shipmentState==='sent'?{issuePossessionConfirmed:true}:{})})
const exchangeInput=(orderId,old,unitPrice,shipmentState,key,paymentAmount=0,refundMethod='')=>({
 requestId:key,orderId,exchangeDate:'2026-10-31',expectedOrderTotal:1000,
 oldItems:[{orderItemId:old.id,quantity:1,physicalState:'warehouse',
  expectedActiveQuantity:1,expectedUnitPrice:1000,expectedLineTotal:1000,expectedCatalogPriceSnapshot:null}],
 newItems:[replacement(unitPrice,shipmentState)],paymentAmount,paymentMethod:paymentAmount?'НАЛИЧНЫЕ':'',
 refundMethod
})
// Exchange A: customer paid old 1000, replacement costs 1300, pays 300 now,
// delayed shipment must not decrement stock; cancellation reverses EXACT
// payment only and returns original price/reservations/physical counts.
const plus=await create('stage34-36-plus-order','warehouse')
await pay(plus.orderId,'stage34-36-plus-original-pay',1000)
await ship(plus.orderId)
const prePlus={old:physical(9041),new:physical(9043)}
const plusBody=exchangeInput(plus.orderId,plus.original,1300,'pending','stage34-36-plus-exchange',300)
const plusResult=await http('POST','/api/exchanges/set',plusBody)
assert.equal(plusResult.status,201,'Extra-payment exchange: '+JSON.stringify(plusResult))
const plusId=Number(plusResult.data.exchangeId)
assert(plusId>0)
assert.deepEqual(totals(plus.orderId),{total_amount:1300,received_amount:1300,return_amount:0,debt_amount:0})
assert.equal(physical(9041),prePlus.old+1)
assert.equal(physical(9043),prePlus.new)
assert.equal(sql.prepare("SELECT count(*) n FROM payments WHERE order_id=?").get(plus.orderId).n,2)
const plusAgain=await http('POST','/api/exchanges/set',plusBody)
assert.equal(plusAgain.status,201)
assert.equal(Number(plusAgain.data.exchangeId),plusId)
assert.equal(sql.prepare("SELECT count(*) n FROM payments WHERE order_id=?").get(plus.orderId).n,2)
assert.deepEqual(totals(plus.orderId),{total_amount:1300,received_amount:1300,return_amount:0,debt_amount:0})
const plusCancel=await http('PATCH','/api/exchanges/'+plusId+'/cancel',{requestId:'stage34-36-plus-cancel'})
assert.equal(plusCancel.status,200,'Cancel extra-payment exchange: '+JSON.stringify(plusCancel))
assert.deepEqual(totals(plus.orderId),{total_amount:1000,received_amount:1000,return_amount:0,debt_amount:0})
assert.equal(physical(9041),prePlus.old)
assert.equal(physical(9043),prePlus.new)
assert.equal(sql.prepare('SELECT unit_price FROM order_items WHERE id=?').get(plus.original.id).unit_price,1000)
const plusCancelAgain=await http('PATCH','/api/exchanges/'+plusId+'/cancel',{requestId:'stage34-36-plus-cancel'})
assert.equal(plusCancelAgain.status,200)
assert.equal(sql.prepare("SELECT count(*) n FROM payments WHERE order_id=?").get(plus.orderId).n,1)
console.log('STAGE36_EXCHANGE_EXTRA_PAYMENT_CHAIN_PASS: price up, exact 300 payment, delayed replacement, repeat/cancel no phantom funds or stock')
// Exchange B: replacing a paid 1000 item with a cheaper 700 one must refund
// precisely 300 and stay balanced even after exchange cancellation.
const minus=await create('stage34-36-minus-order','warehouse')
await pay(minus.orderId,'stage34-36-minus-original-pay',1000)
await ship(minus.orderId)
const preMinus={old:physical(9041),new:physical(9043)}
const minusBody=exchangeInput(minus.orderId,minus.original,700,'sent','stage34-36-minus-exchange',0,'НАЛИЧНЫЕ')
const minusResult=await http('POST','/api/exchanges/set',minusBody)
assert.equal(minusResult.status,201,'Refund exchange: '+JSON.stringify(minusResult))
const minusId=Number(minusResult.data.exchangeId)
assert(minusId>0)
assert.deepEqual(totals(minus.orderId),{total_amount:700,received_amount:1000,return_amount:300,debt_amount:0})
assert.equal(physical(9041),preMinus.old+1)
assert.equal(physical(9043),preMinus.new-1)
const minusAgain=await http('POST','/api/exchanges/set',minusBody)
assert.equal(minusAgain.status,201)
assert.equal(Number(minusAgain.data.exchangeId),minusId)
assert.equal(sql.prepare("SELECT count(*) n FROM returns WHERE order_id=? AND amount=300 AND status!='cancelled'").get(minus.orderId).n,1)
assert.equal(physical(9043),preMinus.new-1)
const minusCancel=await http('PATCH','/api/exchanges/'+minusId+'/cancel',{requestId:'stage34-36-minus-cancel'})
assert.equal(minusCancel.status,200,'Cancel refund exchange: '+JSON.stringify(minusCancel))
assert.deepEqual(totals(minus.orderId),{total_amount:1000,received_amount:1000,return_amount:0,debt_amount:0})
assert.equal(physical(9041),preMinus.old)
assert.equal(physical(9043),preMinus.new)
const minusCancelAgain=await http('PATCH','/api/exchanges/'+minusId+'/cancel',{requestId:'stage34-36-minus-cancel'})
assert.equal(minusCancelAgain.status,200)
assert.equal(totals(minus.orderId).return_amount,0)
console.log('STAGE36_EXCHANGE_REFUND_CHAIN_PASS: price down, exact 300 refund, independent new physical SKU, repeat/cancel restores original financial ledger')
// Mixed Return: money and a physically received good in one real Return, a
// newer physical selective stock count, then cancellation should remove the
// monetary refund without fabricating a stock decrement already absorbed by
// the later physical count.
const mixed=await create('stage34-36-mixed-order','boutique')
await pay(mixed.orderId,'stage34-36-mixed-paid',1000)
await ship(mixed.orderId)
const mixedBefore=physical(9042)
const mixedBody={requestId:'stage34-36-mixed-refund',orderId:mixed.orderId,returnDate:'2026-10-31',
 amount:300,paymentMethod:'НАЛИЧНЫЕ',
 items:[{orderItemId:mixed.original.id,quantity:1,physicalState:'boutique',restock:true}]}
const mixedReturn=await http('POST','/api/returns',mixedBody)
assert.equal(mixedReturn.status,201,'Mixed money+goods Return: '+JSON.stringify(mixedReturn))
const mixedReturnId=Number(mixedReturn.data.returnId)
assert(mixedReturnId>0)
assert.equal(physical(9042),mixedBefore+1)
assert.deepEqual(totals(mixed.orderId),{total_amount:1000,received_amount:1000,return_amount:300,debt_amount:0})
const mixedAgain=await http('POST','/api/returns',mixedBody)
assert.equal(mixedAgain.status,201)
assert.equal(Number(mixedAgain.data.returnId),mixedReturnId)
assert.equal(physical(9042),mixedBefore+1)
assert.equal(totals(mixed.orderId).return_amount,300)
const event=sql.prepare("SELECT id,applied_at,variant_id,inventory_source FROM inventory_lifecycle_events WHERE operation_type='return' AND operation_id=? AND status='applied'").get(mixedReturnId)
assert.equal(event.variant_id,9031)
assert.equal(event.inventory_source,'boutique')
const laterAt=new Date(Date.now()+4000).toISOString()
const counted=physical(9042)
sql.prepare("INSERT INTO inventory_stock_checks (check_key,inventory_source,product_id,variant_id,expected_quantity,counted_quantity,difference_quantity,reserved_quantity,check_type,reference_type,reference_id,checked_at,created_at) VALUES ('stage34-mixed-check','boutique',9021,9031,?,?,0,0,'selective_stocktake','stocktake','STAGE34-MIXED',?,?)").run(counted,counted,laterAt,laterAt)
const mixedCancel=await http('PATCH','/api/returns/'+mixedReturnId+'/cancel',{requestId:'stage34-36-mixed-cancel'})
assert.equal(mixedCancel.status,200,'Cancel mixed after later selective check: '+JSON.stringify(mixedCancel))
assert.equal(physical(9042),counted,'New physical check supersedes Return and its cancellation; no automatic -1')
assert.equal(totals(mixed.orderId).return_amount,0,'Money refund reversed even though physical counted remains unchanged')
const cancelledEvent=sql.prepare('SELECT status,reversal_movement_id FROM inventory_lifecycle_events WHERE id=?').get(event.id)
assert.equal(cancelledEvent.status,'cancelled')
assert.equal(cancelledEvent.reversal_movement_id,null)
const mixedCancelAgain=await http('PATCH','/api/returns/'+mixedReturnId+'/cancel',{requestId:'stage34-36-mixed-cancel'})
assert.equal(mixedCancelAgain.status,200)
assert.equal(physical(9042),counted)
assert.equal(totals(mixed.orderId).return_amount,0)
console.log('STAGE34_MIXED_REFUND_POST_STOCKTAKE_PASS: cash+goods Return, later physical checkpoint, cancelled refund without phantom negative physical delta')
