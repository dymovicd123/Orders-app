// Integration harness: run the actual versioned SQL migrations against a
// brand-new in-memory SQLite D1 shim. No Cloudflare network, no remote D1.
import assert from 'node:assert/strict'
import { prepareReturnV2 } from '../worker/domains/return-v2-preparation.ts'
import { postPreparedReturnV2Prototype } from '../worker/domains/return-v2-posting-prototype.ts'
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

const first=await make('v2post-fully-paid',30000)
const pre=await plan(first.orderId,first.itemId,'v2post-prepare-first',20000)
assert.equal(pre.posted,false)
assert.equal(pre.replayed,false)
const before=orderRead(first.orderId,first.itemId)
const committed=await postPreparedReturnV2Prototype(db,pre.preparationId)
assert.equal(committed.ok,true)
assert.equal(committed.posted,true)
assert.equal(committed.replayed,false)
assert.equal(committed.currentSale,15000)
assert.equal(committed.netHeld,10000)
const postedRecord=sql.prepare('SELECT * FROM return_v2_postings WHERE preparation_id=?').get(pre.preparationId)
assert.equal(postedRecord.return_id,committed.returnId)
const postedReturn=sql.prepare('SELECT * FROM returns WHERE id=?').get(committed.returnId)
assert.equal(postedReturn.amount,20000)
assert.equal(postedReturn.status,'completed')
const returnedLine=sql.prepare('SELECT * FROM return_items WHERE return_id=?').get(committed.returnId)
assert.equal(returnedLine.contract_quantity_applied,1,'Only a quantity-adjusted V2 Return has marker=1')
assert.equal(returnedLine.amount,15000,'Actual sold-item price != cash refund is persisted')
assert.equal(returnedLine.quantity,1)
assert.equal(returnedLine.physical_tracking,1)
assert.equal(returnedLine.physical_received_at,null)
assert.equal(returnedLine.restocked,0)
const after=orderRead(first.orderId,first.itemId)
assert.equal(after.header.total_amount,15000)
assert.equal(after.header.received_amount,30000)
assert.equal(after.header.return_amount,20000)
assert.equal(after.header.debt_amount,5000,'New debt must use net cash retained')
assert.equal(after.item.quantity,1)
assert.equal(after.item.line_total,15000)
assert.equal(after.stock.quantity,before.stock.quantity,'Never auto +1 before physical receipt')
assert.equal(after.stock.reserved_quantity,0)
assert.deepEqual({...after.reservation},{...before.reservation})
assert.equal(after.returns,before.returns+1)
assert.equal(after.returnItems,before.returnItems+1)
assert.equal(after.events,before.events+1)
const cash=sql.prepare("SELECT amount_delta,payment_method,event_type,source_id FROM financial_events WHERE order_id=? AND event_type='order_refund'").get(first.orderId)
assert.deepEqual({...cash},{amount_delta:-20000,payment_method:'KASPI',event_type:'order_refund',source_id:committed.returnId})
const cap=await readReturnV2ContractCapacity(db,first.orderId,first.itemId)
assert.deepEqual([cap.availableForNewReturn,cap.alreadyReturnedWithLineReduction,cap.alreadyReturnedWithoutLineReduction],[1,1,0])
const shipment=await http('GET','/api/orders/'+first.orderId+'/shipping/plan')
assert.equal(shipment.status,200)
assert.equal(shipment.data.selectedQuantity,0,'Previously dispatched remainder must not be sent again')
const again=await postPreparedReturnV2Prototype(db,pre.preparationId)
assert.equal(again.replayed,true)
assert.equal(again.returnId,committed.returnId)
assert.deepEqual(orderRead(first.orderId,first.itemId),after,'Repeated posting must create no additional header/item/event/stock movement')
const oldFinance=await readOrderFinancialLedger(db,first.orderId)
assert.equal(oldFinance.debtAmount,0,'Old global ledger still ignores cash refund and MUST NOT be reused to sync V2')
assert.equal(after.header.debt_amount,5000,'V2 cache before old sync is correct')

const second=await make('v2post-goods-only-partial-paid',10000)
const goods=await plan(second.orderId,second.itemId,'v2post-goods-only',0)
const goodsPosted=await postPreparedReturnV2Prototype(db,goods.preparationId)
assert.equal(goodsPosted.posted,true)
const zero=orderRead(second.orderId,second.itemId)
assert.equal(zero.header.total_amount,15000)
assert.equal(zero.header.received_amount,10000)
assert.equal(zero.header.return_amount,0)
assert.equal(zero.header.debt_amount,5000)
assert.equal(zero.events,1,'Existing original payment only, no fake refund event')
assert.equal(zero.stock.quantity,0)
assert.equal(sql.prepare('SELECT physical_tracking FROM return_items WHERE return_id=?').get(goodsPosted.returnId).physical_tracking,1)

const stale=await make('v2post-stale-prepared',30000)
const preparedStale=await plan(stale.orderId,stale.itemId,'v2post-prep-stale',15000)
const staleBefore=orderRead(stale.orderId,stale.itemId)
sql.prepare('UPDATE orders SET updated_at=? WHERE id=?').run('2090-01-01T00:00:00Z',stale.orderId)
await assert.rejects(postPreparedReturnV2Prototype(db,preparedStale.preparationId),/изменился|после подготовки|Обновите/)
assert.equal(sql.prepare('SELECT COUNT(*) n FROM return_v2_postings WHERE preparation_id=?').get(preparedStale.preparationId).n,0)
assert.equal(sql.prepare('SELECT COUNT(*) n FROM returns WHERE order_id=?').get(stale.orderId).n,0)
sql.prepare('UPDATE orders SET updated_at=? WHERE id=?').run(
  sql.prepare('SELECT created_at FROM orders WHERE id=?').get(stale.orderId).created_at,
  stale.orderId)
const patched=orderRead(stale.orderId,stale.itemId)
assert.equal(patched.header.total_amount,staleBefore.header.total_amount)
assert.equal(patched.stock.quantity,staleBefore.stock.quantity)

const failed=await make('v2post-crash-after-header',30000)
const preparedFail=await plan(failed.orderId,failed.itemId,'v2post-prep-crash',15000)
const beforeFail=orderRead(failed.orderId,failed.itemId)
const originalBatch=db.batch.bind(db)
let injected=false
db.batch=async statements=>{
 if(!injected&&statements.some(st=>st.sql?.includes('INSERT INTO return_v2_postings'))){
  injected=true
  const broken=statements.map((st,index)=>index===2
    ? {...st,run:async()=>{throw Error('INJECTED_V2_POSTING_CRASH_AFTER_RETURN_HEADER')}}
    : st)
  return originalBatch(broken)
 }
 return originalBatch(statements)
}
await assert.rejects(postPreparedReturnV2Prototype(db,preparedFail.preparationId),/INJECTED_V2_POSTING_CRASH_AFTER_RETURN_HEADER/)
db.batch=originalBatch
assert.equal(injected,true)
assert.deepEqual(orderRead(failed.orderId,failed.itemId),beforeFail,'Crash before complete batch must roll back everything')
assert.equal(sql.prepare('SELECT COUNT(*) n FROM return_v2_postings WHERE preparation_id=?').get(preparedFail.preparationId).n,0)
assert.equal(sql.prepare('SELECT COUNT(*) n FROM returns WHERE order_id=?').get(failed.orderId).n,0)
const retried=await postPreparedReturnV2Prototype(db,preparedFail.preparationId)
assert.equal(retried.posted,true)
assert.equal(retried.replayed,false)
assert.equal(sql.prepare('SELECT COUNT(*) n FROM returns WHERE order_id=?').get(failed.orderId).n,1)

const conflict=await make('v2post-competing-preps',30000)
const one=await plan(conflict.orderId,conflict.itemId,'v2post-prep-competitive-one',15000)
const two=await plan(conflict.orderId,conflict.itemId,'v2post-prep-competitive-two',15000)
const winner=await postPreparedReturnV2Prototype(db,one.preparationId)
assert.equal(winner.posted,true)
await assert.rejects(postPreparedReturnV2Prototype(db,two.preparationId),/изменился|уже|Обновите|после подготовки/)
assert.equal(sql.prepare('SELECT COUNT(*) n FROM returns WHERE order_id=?').get(conflict.orderId).n,1)
assert.equal(sql.prepare('SELECT COUNT(*) n FROM return_v2_postings WHERE order_id=?').get(conflict.orderId).n,1)

sql.close()
console.log('RETURN_V2_ATOMIC_POSTING_PROTOTYPE_PASS: real Worker/SQLite 0126, item quantity+total+refund+event all atomic, pending physical no +1, debt net held, idempotent replay, full batch crash rollback, stale version/competing proposals fail, legacy sync divergence documented; NO HTTP route activated')
