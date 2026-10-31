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

const reserve=id=>sql.prepare("SELECT id,quantity,status,variant_id,inventory_source FROM inventory_reservations WHERE order_item_id=? ORDER BY id ASC LIMIT 1").get(id)
const oldStock=()=>sql.prepare("SELECT quantity,reserved_quantity FROM inventory_stock WHERE id=9041").get()
const newStock=()=>sql.prepare("SELECT quantity,reserved_quantity FROM inventory_stock WHERE id=9042").get()
const oldQuantity=id=>Number(sql.prepare("SELECT quantity FROM order_items WHERE id=?").get(id)?.quantity)
const legacy={
  ...payload('stage3-legacy-old',[{...item('warehouse'),quantity:2}]),
  pricingMode:'legacy_manual_total',orderTotal:2000,payments:[],
}
const created=await http('POST','/api/orders',legacy)
assert.equal(created.status,201,'Legacy unsent 2-unit order must be created: '+JSON.stringify(created))
const orderId=Number(created.data.orderId)
const oldItemId=Number(sql.prepare("SELECT id FROM order_items WHERE order_id=? AND quantity=2 ORDER BY id LIMIT 1").get(orderId)?.id)
assert(oldItemId>0)
assert.equal(reserve(oldItemId)?.status,'active')
assert.equal(Number(reserve(oldItemId)?.quantity),2)
const startOld=oldStock(),startNew=newStock()
assert.equal(startOld.reserved_quantity,2)
const exchangeInput=requestId=>({
  requestId,orderId,exchangeDate:'2026-10-31',
  oldItemId,oldQuantity:1,oldPhysicalState:'not_issued',oldReturnSource:'none',
  newItem:{...item('boutique'),quantity:1,unitPrice:0,shipmentState:'sent',issuePossessionConfirmed:true},
  newSourceWasManuallyChanged:true,
  financialAction:'none',financialAmount:0,paymentMethod:'',
})
const makeSwap=async requestId=>{
  const r=await http('POST','/api/exchanges',exchangeInput(requestId))
  assert.equal(r.status,201,'Real HTTP partial exchange failed: '+JSON.stringify(r))
  const id=Number(r.data.exchangeId)
  assert(id>0,'Must persist exact exchange id')
  return id
}
const cancelSwap=async (id,requestId)=>{
  const r=await http('PATCH',`/api/exchanges/${id}/cancel`,{requestId})
  assert.equal(r.status,200,'Real HTTP exchange cancellation failed: '+JSON.stringify(r))
}
const first=await makeSwap('stage3-legacy-partial-one')
assert.equal(oldQuantity(oldItemId),1,'One old unit remains')
assert.equal(reserve(oldItemId).status,'active','Remaining old unit MUST keep active reserve')
assert.equal(Number(reserve(oldItemId).quantity),1)
assert.equal(oldStock().reserved_quantity,startOld.reserved_quantity-1,'One not two reserved units are freed')
assert.equal(oldStock().quantity,startOld.quantity,'Unissued old unit never changes physical')
assert.equal(newStock().quantity,startNew.quantity-1,'Sent replacement physical decreases once')
assert.equal(Number(sql.prepare('SELECT COUNT(*) AS n FROM exchanges WHERE id=?').get(first).n),1)
const retry=await makeSwap('stage3-legacy-partial-one')
assert.equal(retry,first,'Same HTTP request id must not create another exchange')
assert.equal(oldStock().reserved_quantity,startOld.reserved_quantity-1,'Replay cannot free another unit')
assert.equal(newStock().quantity,startNew.quantity-1,'Replay cannot ship replacement twice')
await cancelSwap(first,'stage3-legacy-partial-undo-one')
assert.equal(oldQuantity(oldItemId),2)
assert.equal(reserve(oldItemId).status,'active')
assert.equal(Number(reserve(oldItemId).quantity),2)
assert.equal(oldStock().reserved_quantity,startOld.reserved_quantity)
assert.equal(oldStock().quantity,startOld.quantity)
assert.equal(newStock().quantity,startNew.quantity)
await cancelSwap(first,'stage3-legacy-partial-undo-one')
assert.equal(oldStock().reserved_quantity,startOld.reserved_quantity,'Cancel replay cannot inflate reserve')
const seq1=await makeSwap('stage3-legacy-seq-one')
const seq2=await makeSwap('stage3-legacy-seq-two')
assert(seq1!==seq2)
assert.equal(oldQuantity(oldItemId),0)
assert.equal(reserve(oldItemId).status,'released')
assert.equal(oldStock().reserved_quantity,startOld.reserved_quantity-2)
assert.equal(oldStock().quantity,startOld.quantity)
await cancelSwap(seq2,'stage3-legacy-seq-undo-two')
assert.equal(reserve(oldItemId).status,'active')
assert.equal(Number(reserve(oldItemId).quantity),1)
assert.equal(oldStock().reserved_quantity,startOld.reserved_quantity-1)
await cancelSwap(seq1,'stage3-legacy-seq-undo-one')
assert.equal(oldQuantity(oldItemId),2)
assert.equal(reserve(oldItemId).status,'active')
assert.equal(Number(reserve(oldItemId).quantity),2)
assert.equal(oldStock().reserved_quantity,startOld.reserved_quantity)
assert.equal(oldStock().quantity,startOld.quantity)
assert.equal(newStock().quantity,startNew.quantity)
console.log('STAGE3_LEGACY_PARTIAL_EXCHANGE_HTTP_PASS: unsent 2->1->0, precise active reserve, physical invariants, two cancels and idempotent replay')
