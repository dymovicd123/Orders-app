// Integration harness: run the actual versioned SQL migrations against a
// brand-new in-memory SQLite D1 shim. No Cloudflare network, no remote D1.
import assert from 'node:assert/strict'
import { prepareReturnV2 } from '../worker/domains/return-v2-preparation.ts'
import { postPreparedReturnV2Prototype } from '../worker/domains/return-v2-posting-prototype.ts'
import { cancelPostedReturnV2Prototype } from '../worker/domains/return-v2-cancellation-prototype.ts'
import { readVersionedReturnMoney } from '../worker/domains/return-v2-financial-projection.ts'
import { readReturnV2ContractCapacity } from '../worker/domains/return-v2-contract-capacity.ts'
import { readOrderFinancialLedger } from '../worker/domains/money.ts'
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



async function make(id,payment=30000){
 // Reset only the isolated local fixture to give independent orders full stock.
 sql.prepare('UPDATE inventory_stock SET quantity=2,reserved_quantity=0 WHERE id=9041').run()
 const created=await http('POST','/api/orders',{
   ...payload(id,[{...item('warehouse'),quantity:2,unitPrice:15000}]),
   payments:payment?[{paymentDate:'2026-10-30',method:'KASPI',amount:payment,paymentKind:'primary'}]:[]
 })
 assert.equal(created.status,201,'New order '+JSON.stringify(created))
 const orderId=Number(created.data.orderId)
 const itemId=sql.prepare('SELECT id FROM order_items WHERE order_id=?').get(orderId).id
 const ship=await http('PATCH','/api/orders/'+orderId+'/shipping',{
   requestId:id+'-ship',shippingStatus:'sent',shippingDate:'2026-10-31'
 })
 assert.equal(ship.status,200,'Old shipment behavior '+JSON.stringify(ship))
 assert.equal(oldStock().quantity,0,'Shipping consumes exact physical stock')
 assert.equal(reserve(itemId).status,'fulfilled')
 return {orderId,itemId}
}
function orderRead(orderId,itemId){
 return {
  header:sql.prepare('SELECT total_amount,received_amount,return_amount,debt_amount,shipping_status FROM orders WHERE id=?').get(orderId),
  item:sql.prepare('SELECT quantity,line_total,unit_price FROM order_items WHERE id=?').get(itemId),
  stock:oldStock(),
  reservation:reserve(itemId),
  returns:count('returns','order_id=?',[orderId]),
  returnItems:count('return_items','order_item_id=?',[itemId]),
  events:count('financial_events','order_id=?',[orderId]),
 }
}
async function plan(orderId,itemId,requestId,refundAmount){
 return prepareReturnV2(db,{requestId,orderId,expectedTotalAmount:30000,
  items:[{orderItemId:itemId,quantity:1}],refundAmount,
  refundMethod:refundAmount?'KASPI':''})
}


const state=(orderId,itemId)=>({
  main:orderRead(orderId,itemId),
  v2post:sql.prepare('SELECT * FROM return_v2_postings WHERE order_id=?').all(orderId).length,
  cancel:sql.prepare('SELECT * FROM return_v2_cancellations WHERE order_id=?').all(orderId).length,
  returnRow:sql.prepare('SELECT id,status,amount,payment_method,cancelled_at FROM returns WHERE order_id=?').all(orderId).map(x=>({...x})),
  receipts:sql.prepare('SELECT id,quantity,physical_received_at,contract_quantity_applied,restocked FROM return_items WHERE return_id IN(SELECT id FROM returns WHERE order_id=?)').all(orderId).map(x=>({...x})),
})
async function posted(id,paid=30000,refund=20000){
 const sample=await make(id,paid)
 const prepared=await plan(sample.orderId,sample.itemId,id+'-prepared',refund)
 const posted=await postPreparedReturnV2Prototype(db,prepared.preparationId)
 assert.equal(posted.posted,true)
 assert.equal(posted.replayed,false)
 return {...sample,preparationId:prepared.preparationId,returnId:posted.returnId,refund}
}
const cancelArgs=(x,key=x.preparationId+'-cancellation')=>({
 preparationId:x.preparationId,requestId:key,reason:'Клиент оставил покупку',
 goodsWithCustomerConfirmed:true,refundRecoveredConfirmed:x.refund>0,
 recoveryMethod:x.refund>0?'CASH':''
})
const x=await posted('v2cancel-standard')
const before=state(x.orderId,x.itemId)
assert.equal(before.main.header.total_amount,15000)
assert.equal(before.main.header.debt_amount,5000)
assert.equal(before.main.stock.quantity,0)
assert.equal(before.main.reservation.status,'fulfilled')
await assert.rejects(cancelPostedReturnV2Prototype(db,{
 ...cancelArgs(x),goodsWithCustomerConfirmed:false
}),/подтвердите/)
await assert.rejects(cancelPostedReturnV2Prototype(db,{
 ...cancelArgs(x),refundRecoveredConfirmed:false
}),/получения денег/)
await assert.rejects(cancelPostedReturnV2Prototype(db,{
 ...cancelArgs(x),recoveryMethod:''
}),/получения денег/)
assert.deepEqual(state(x.orderId,x.itemId),before,'Denied cancellation must not alter money/order/stock')
const done=await cancelPostedReturnV2Prototype(db,cancelArgs(x))
assert.equal(done.ok,true)
assert.equal(done.cancelled,true)
assert.equal(done.replayed,false)
assert.equal(done.cashRecovered,20000)
assert.equal(done.contractRestored,true)
const after=state(x.orderId,x.itemId)
assert.equal(after.main.header.total_amount,30000)
assert.equal(after.main.header.return_amount,0)
assert.equal(after.main.header.debt_amount,0)
assert.equal(after.main.header.received_amount,30000)
assert.equal(after.main.item.quantity,2)
assert.equal(after.main.item.line_total,30000)
assert.equal(after.main.stock.quantity,before.main.stock.quantity,'Cancellation must not add physical stock')
assert.equal(after.main.stock.reserved_quantity,before.main.stock.reserved_quantity)
assert.deepEqual({...after.main.reservation},{...before.main.reservation})
assert.equal(after.returnRow[0].status,'cancelled')
assert(after.returnRow[0].cancelled_at)
assert.equal(after.receipts[0].contract_quantity_applied,1)
assert.equal(after.receipts[0].physical_received_at,null)
assert.equal(after.cancel,1)
const pair=sql.prepare('SELECT event_type,amount_delta,payment_method,source_id FROM financial_events WHERE order_id=? AND event_type IN (?,?) ORDER BY id').all(x.orderId,'order_refund','refund_reversal').map(r=>({...r}))
assert.deepEqual(pair,[
 {event_type:'order_refund',amount_delta:-20000,payment_method:'KASPI',source_id:x.returnId},
 {event_type:'refund_reversal',amount_delta:20000,payment_method:'CASH',source_id:x.returnId},
])
const projection=await readVersionedReturnMoney(db,x.orderId)
assert.equal(projection.kind,'return_v2')
assert.equal(projection.currentSale,30000)
assert.equal(projection.netHeld,30000)
assert.equal(projection.customerDebt,0)
assert.equal(projection.customerOverpay,0)
const capacity=await readReturnV2ContractCapacity(db,x.orderId,x.itemId)
assert.equal(capacity.availableForNewReturn,2)
assert.equal(capacity.totalPhysicalReturnQuantity,0,'Cancelled physical claim does not count as returned')
const ship=await http('GET','/api/orders/'+x.orderId+'/shipping/plan')
assert.equal(ship.status,200)
assert.equal(ship.data.selectedQuantity,0,'Previously shipped goods cannot reappear in send selector')
const replay=await cancelPostedReturnV2Prototype(db,cancelArgs(x))
assert.equal(replay.replayed,true)
assert.deepEqual(state(x.orderId,x.itemId),after,'Same cancellation key cannot apply twice')
await assert.rejects(cancelPostedReturnV2Prototype(db,cancelArgs(x,'other-key')),/другим запросом/)
assert.deepEqual(state(x.orderId,x.itemId),after)
assert.equal(sql.prepare('SELECT COUNT(*) n FROM financial_events WHERE event_key=?').get('return-v2:cancelled:'+x.preparationId).n,1)

const zero=await posted('v2cancel-no-cash',10000,0)
const beforeZero=state(zero.orderId,zero.itemId)
assert.equal(beforeZero.main.header.debt_amount,5000)
const zeroUndo=await cancelPostedReturnV2Prototype(db,cancelArgs(zero))
assert.equal(zeroUndo.cashRecovered,0)
const zeroState=state(zero.orderId,zero.itemId)
assert.equal(zeroState.main.header.total_amount,30000)
assert.equal(zeroState.main.header.debt_amount,20000)
assert.equal(zeroState.main.header.return_amount,0)
assert.equal(zeroState.main.stock.quantity,beforeZero.main.stock.quantity)
assert.equal(sql.prepare('SELECT COUNT(*) n FROM financial_events WHERE event_key=?').get('return-v2:cancelled:'+zero.preparationId).n,0,'Zero refund cancellation cannot create money movement')
assert.equal((await readVersionedReturnMoney(db,zero.orderId)).customerDebt,20000)

const received=await posted('v2cancel-received')
sql.prepare("UPDATE return_items SET physical_received_at='2026-11-14T20:50:00.000Z',inventory_source='warehouse' WHERE return_id=?").run(received.returnId)
const receivedBefore=state(received.orderId,received.itemId)
await assert.rejects(cancelPostedReturnV2Prototype(db,cancelArgs(received)),/поступила|менялась|Нельзя/)
assert.deepEqual(state(received.orderId,received.itemId),receivedBefore)
assert.equal(sql.prepare('SELECT COUNT(*) n FROM return_v2_cancellations WHERE order_id=?').get(received.orderId).n,0)

const laterPayment=await posted('v2cancel-later-payment')
sql.prepare("INSERT INTO payments(order_id,payment_date,method,amount,payment_kind,created_at) VALUES (?,'2026-11-14','KASPI',5000,'debt_close','2099-01-01T00:00:00.000Z')").run(laterPayment.orderId)
const laterBefore=state(laterPayment.orderId,laterPayment.itemId)
await assert.rejects(cancelPostedReturnV2Prototype(db,cancelArgs(laterPayment)),/изменились|запрещена/)
assert.deepEqual(state(laterPayment.orderId,laterPayment.itemId),laterBefore)

const laterExchange=await posted('v2cancel-later-exchange')
sql.prepare("INSERT INTO exchanges(order_id,exchange_date,old_order_item_id,old_quantity,new_source_type,status,created_at) VALUES (?,'2026-11-14',?,1,'warehouse','completed','2026-11-14T21:00:00.000Z')").run(laterExchange.orderId,laterExchange.itemId)
const exchangeBefore=state(laterExchange.orderId,laterExchange.itemId)
await assert.rejects(cancelPostedReturnV2Prototype(db,cancelArgs(laterExchange)),/изменились|запрещена/)
assert.deepEqual(state(laterExchange.orderId,laterExchange.itemId),exchangeBefore)

const laterEdit=await posted('v2cancel-later-edit')
sql.prepare("UPDATE orders SET updated_at='2099-01-01T00:00:00.000Z' WHERE id=?").run(laterEdit.orderId)
const editBefore=state(laterEdit.orderId,laterEdit.itemId)
await assert.rejects(cancelPostedReturnV2Prototype(db,cancelArgs(laterEdit)),/изменились|запрещена/)
assert.deepEqual(state(laterEdit.orderId,laterEdit.itemId),editBefore)

const damaged=await posted('v2cancel-damaged-event')
sql.prepare("UPDATE financial_events SET amount_delta=-19000 WHERE event_key=?").run('return-v2:posted:'+damaged.preparationId)
const damagedBefore=state(damaged.orderId,damaged.itemId)
await assert.rejects(cancelPostedReturnV2Prototype(db,cancelArgs(damaged)),/повреждено|отсутствует/)
assert.deepEqual(state(damaged.orderId,damaged.itemId),damagedBefore)

const injected=await posted('v2cancel-batch-fault')
const injectedBefore=state(injected.orderId,injected.itemId)
const baselineBatch=db.batch.bind(db)
let failedOnce=false
db.batch=async statements=>{
 if(!failedOnce&&statements.some(st=>st.sql?.includes('INSERT INTO return_v2_cancellations'))){
  failedOnce=true
  return baselineBatch(statements.map((st,i)=>i===2
    ? {...st,run:async()=>{throw Error('INJECTED_CANCELLATION_FAIL_AFTER_RETURN_STATUS')}}
    :st))
 }
 return baselineBatch(statements)
}
await assert.rejects(cancelPostedReturnV2Prototype(db,cancelArgs(injected)),/INJECTED_CANCELLATION_FAIL_AFTER_RETURN_STATUS/)
db.batch=baselineBatch
assert.equal(failedOnce,true)
assert.deepEqual(state(injected.orderId,injected.itemId),injectedBefore,'Incomplete cancellation must fully rollback')
const recovered=await cancelPostedReturnV2Prototype(db,cancelArgs(injected))
assert.equal(recovered.cancelled,true)
assert.equal(recovered.replayed,false)
assert.equal(sql.prepare('SELECT COUNT(*) n FROM financial_events WHERE event_key=?').get('return-v2:cancelled:'+injected.preparationId).n,1)

const race=await posted('v2cancel-concurrent-change')
const raceBefore=state(race.orderId,race.itemId)
let changedRace=false
db.batch=async statements=>{
 if(!changedRace&&statements.some(st=>st.sql?.includes('INSERT INTO return_v2_cancellations'))){
  changedRace=true
  sql.prepare('UPDATE orders SET total_amount=14999 WHERE id=?').run(race.orderId)
 }
 return baselineBatch(statements)
}
await assert.rejects(cancelPostedReturnV2Prototype(db,cancelArgs(race)),/изменились|отклонена/)
db.batch=baselineBatch
assert.equal(changedRace,true)
assert.equal(sql.prepare('SELECT COUNT(*) n FROM return_v2_cancellations WHERE order_id=?').get(race.orderId).n,0)
assert.equal(sql.prepare('SELECT status FROM returns WHERE id=?').get(race.returnId).status,'completed')
assert.equal(sql.prepare('SELECT quantity FROM order_items WHERE id=?').get(race.itemId).quantity,raceBefore.main.item.quantity)
assert.equal(sql.prepare('SELECT COUNT(*) n FROM financial_events WHERE event_key=?').get('return-v2:cancelled:'+race.preparationId).n,0)
sql.close()
console.log('RETURN_V2_CANCEL_ATOMIC_SQLITE_PASS: contract restoration, actual cash recovery proof, legacy shipping immutable, all 72 business gates, idempotency, zero refund, received goods and later payments/exchanges blocked, rollback on batch failure and CAS race, ledger recognizes verified cancel')
