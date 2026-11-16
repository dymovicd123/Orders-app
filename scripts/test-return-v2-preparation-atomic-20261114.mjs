// Integration harness: run the actual versioned SQL migrations against a
// brand-new in-memory SQLite D1 shim. No Cloudflare network, no remote D1.
import assert from 'node:assert/strict'
import { prepareReturnV2 } from '../worker/domains/return-v2-preparation.ts'
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

const count=(table,where,params=[])=>Number(sql.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get(...params)?.n)
const oldStock=()=>sql.prepare('SELECT quantity,reserved_quantity FROM inventory_stock WHERE id=9041').get()
const otherStock=()=>sql.prepare('SELECT quantity,reserved_quantity FROM inventory_stock WHERE id=9042').get()
const reserve=id=>sql.prepare('SELECT id,quantity,status,variant_id,inventory_source FROM inventory_reservations WHERE order_item_id=? ORDER BY id DESC LIMIT 1').get(id)


const created=await http('POST','/api/orders',{
 ...payload('v2-prepared-durable',[{...item('warehouse'),quantity:2,unitPrice:15000}]),
 payments:[{paymentDate:'2026-10-30',method:'KASPI',amount:30000,paymentKind:'primary'}],
})
assert.equal(created.status,201,'Create synthetic priced order '+JSON.stringify(created))
const orderId=Number(created.data.orderId)
const line=sql.prepare('SELECT id,quantity,unit_price,line_total FROM order_items WHERE order_id=?').get(orderId)
assert.deepEqual({qty:line.quantity,price:line.unit_price,total:line.line_total},{qty:2,price:15000,total:30000})
const lineId=Number(line.id)
const request={requestId:'prepared-v2-one',orderId,expectedTotalAmount:30000,
 items:[{orderItemId:lineId,quantity:1}],refundAmount:15000,refundMethod:'KASPI'}
const snapshot=()=>({
 order:sql.prepare('SELECT total_amount,received_amount,return_amount,debt_amount,shipping_status FROM orders WHERE id=?').get(orderId),
 line:sql.prepare('SELECT quantity,unit_price,line_total,stock_writeoff_status FROM order_items WHERE id=?').get(lineId),
 stock:oldStock(),res:reserve(lineId),
 returns:count('returns','order_id=?',[orderId]),
 returnItems:count('return_items','order_item_id=?',[lineId]),
 exchanges:count('exchanges','order_id=?',[orderId]),
 payments:count('payments','order_id=?',[orderId]),
 moneyEvents:count('financial_events','order_id=?',[orderId]),
})
const staged=()=>sql.prepare('SELECT * FROM return_v2_prepared_operations WHERE order_id=? ORDER BY id').all(orderId)
const stagedItems=()=>sql.prepare('SELECT * FROM return_v2_prepared_items WHERE operation_id IN (SELECT id FROM return_v2_prepared_operations WHERE order_id=?) ORDER BY id').all(orderId)
const initial=snapshot()
await assert.rejects(prepareReturnV2(db,request),/не был выдан|невыдан|не была выдана|Товар ещё/)
assert.deepEqual(snapshot(),initial)
assert.equal(staged().length,0)

const shipped=await http('PATCH','/api/orders/'+orderId+'/shipping',{
 requestId:'v2-prepared-ship',shippingStatus:'sent',shippingDate:'2026-10-31'})
assert.equal(shipped.status,200,'Existing shipping cannot fail: '+JSON.stringify(shipped))
assert.equal(oldStock().quantity,0)
assert.equal(reserve(lineId).status,'fulfilled')
const shippedAgain=await http('PATCH','/api/orders/'+orderId+'/shipping',{
 requestId:'v2-prepared-ship',shippingStatus:'sent',shippingDate:'2026-10-31'})
assert.equal(shippedAgain.status,200)
assert.equal(oldStock().quantity,0,'Historical shipping retry cannot deduct twice')
const before=snapshot()

await assert.rejects(prepareReturnV2(db,{...request,requestId:'no-payment-method',refundMethod:''}),/способ/)
assert.equal(staged().length,0)
const first=await prepareReturnV2(db,request)
assert.equal(first.ok,true)
assert.equal(first.prepared,true)
assert.equal(first.posted,false)
assert.equal(first.replayed,false)
assert.equal(first.plannedContractReduction,15000)
assert.equal(first.plannedCashRefund,15000)
assert.equal(staged().length,1)
assert.equal(stagedItems().length,1)
assert.equal(stagedItems()[0].sold_unit_price,15000)
assert.equal(stagedItems()[0].reduced_value,15000)
assert.equal(stagedItems()[0].physical_state,'unconfirmed')
assert.deepEqual(snapshot(),before,'Staged V2 proposal MUST NOT change current financial/physical workflow')
const repeat=await prepareReturnV2(db,request)
assert.equal(repeat.replayed,true)
assert.equal(repeat.preparationId,first.preparationId)
assert.equal(staged().length,1,'Same request must not create another staged proposal')
await assert.rejects(
  prepareReturnV2(db,{...request,refundAmount:14000}),/идентификатор уже использован|другого возврата/
)
assert.equal(staged().length,1)

const batch=db.batch.bind(db)
let inject='none'
db.batch=async(stmts)=>{
 if(inject==='fail_after_header'){
  inject='none'
  return batch(stmts.map((st,i)=>i===1?{...st,run:async()=>{throw Error('INJECTED_FAILURE_AFTER_PREPARED_HEADER')}}:st))
 }
 if(inject==='price_race'){
  inject='none'
  sql.prepare('UPDATE order_items SET unit_price=18000 WHERE id=?').run(lineId)
 }
 if(inject==='total_race'){
  inject='none'
  sql.prepare('UPDATE orders SET total_amount=28000 WHERE id=?').run(orderId)
 }
 if(inject==='money_race'){
  inject='none'
  sql.prepare('UPDATE payments SET amount=29000 WHERE order_id=?').run(orderId)
 }
 if(inject==='reservation_race'){
  inject='none'
  sql.prepare("UPDATE inventory_reservations SET status='active' WHERE order_item_id=?").run(lineId)
 }
 return batch(stmts)
}
inject='fail_after_header'
await assert.rejects(prepareReturnV2(db,{...request,requestId:'injected-fault'}),/INJECTED_FAILURE_AFTER_PREPARED_HEADER/)
assert.equal(staged().length,1,'Batch failure must roll back its header')
assert.equal(stagedItems().length,1,'Batch failure must roll back its item')
assert.deepEqual(snapshot(),before)
inject='price_race'
await assert.rejects(prepareReturnV2(db,{...request,requestId:'changed-price'}),/изменились|обновите расчёт/)
assert.equal(staged().length,1)
sql.prepare('UPDATE order_items SET unit_price=15000 WHERE id=?').run(lineId)
inject='total_race'
await assert.rejects(prepareReturnV2(db,{...request,requestId:'changed-total'}),/изменились|обновите расчёт/)
assert.equal(staged().length,1)
sql.prepare('UPDATE orders SET total_amount=30000 WHERE id=?').run(orderId)
inject='money_race'
await assert.rejects(prepareReturnV2(db,{...request,requestId:'changed-payment'}),/изменились|обновите расчёт/)
assert.equal(staged().length,1)
sql.prepare('UPDATE payments SET amount=30000 WHERE order_id=?').run(orderId)
inject='reservation_race'
await assert.rejects(prepareReturnV2(db,{...request,requestId:'changed-reservation'}),/изменились|обновите расчёт/)
assert.equal(staged().length,1)
sql.prepare("UPDATE inventory_reservations SET status='fulfilled' WHERE order_item_id=?").run(lineId)
assert.deepEqual(snapshot(),before,'Injected race must not change live order once synthetic racing row restored')
db.batch=batch

const zero=await prepareReturnV2(db,{...request,requestId:'zero-refund',refundAmount:0,refundMethod:''})
assert.equal(zero.plannedCashRefund,0)
assert.equal(zero.posted,false)
const two=await prepareReturnV2(db,{...request,requestId:'two-units',items:[{orderItemId:lineId,quantity:2}],refundAmount:30000})
assert.equal(two.plannedContractReduction,30000)
assert.equal(staged().length,3,'Several previews are harmless; no goods have actually been returned')
assert.deepEqual(snapshot(),before,'Drafts must not change order/cash/reservations or stock')
const oldReturn=await http('POST','/api/returns',{
 requestId:'legacy-existing-return-after-v2-preparation',orderId,returnDate:'2026-10-31',amount:0,
 items:[{orderItemId:lineId,quantity:1,physicalState:'pending',restock:false}]
})
assert.equal(oldReturn.status,201,'Existing Return still works, prepared proposals are inert: '+JSON.stringify(oldReturn))
assert.equal(oldStock().quantity,0,'No auto restock')
await assert.rejects(prepareReturnV2(db,{...request,requestId:'after-old-return'}),/уже содержит возврат|действующую логику/)
assert.equal(staged().length,3)
sql.close()
console.log('RETURN_V2_PREPARE_ATOMIC_SQLITE_PASS: real migrated schema, old shipment/replay, staged proposal only, idempotency, rollback after header, price/total/payment/reservation races, old Returns still operational')
