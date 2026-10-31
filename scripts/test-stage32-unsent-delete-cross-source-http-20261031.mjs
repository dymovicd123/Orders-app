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

const rows=()=>sql.prepare("SELECT id,product_id,variant_id,source_type,quantity FROM order_items WHERE order_id=? ORDER BY id").all(orderId)
const reservation=id=>sql.prepare("SELECT id,order_id,order_item_id,variant_id,inventory_source,quantity,status FROM inventory_reservations WHERE order_item_id=? ORDER BY id DESC LIMIT 1").get(id)
const stock=id=>sql.prepare("SELECT quantity,reserved_quantity FROM inventory_stock WHERE id=?").get(id)
const created=await http('POST','/api/orders',payload('stage32-unsent-multi-source-delete',[item('warehouse'),item('boutique')]))
assert.equal(created.status,201,'Create cross-source two-SKU order: '+JSON.stringify(created))
const orderId=Number(created.data.orderId)
const original=rows()
assert.equal(original.length,2)
assert.deepEqual(original.map(x=>x.source_type),['warehouse','boutique'])
const initialReservations=original.map(x=>reservation(x.id))
assert.deepEqual(initialReservations.map(x=>x.status),['active','active'])
const physicalBefore=[stock(9041).quantity,stock(9042).quantity]
assert.deepEqual(physicalBefore,[2,2])
assert.deepEqual([stock(9041).reserved_quantity,stock(9042).reserved_quantity],[1,1])
const movementsBefore=Number(sql.prepare('SELECT COUNT(*) AS n FROM inventory_movements').get().n)
const managerDenied=await http('POST','/api/orders/'+orderId+'/delete',{
 requestId:'stage32-manager-delete-denied',expectedSnapshot:'a'.repeat(64)},'staff')
assert.equal(managerDenied.status,403,'Manager must not bypass admin-only deletion: '+JSON.stringify(managerDenied))
assert.deepEqual(original.map(x=>reservation(x.id)),initialReservations)
const preview=await http('GET','/api/orders/'+orderId+'/delete-preview')
assert.equal(preview.status,200,'Admin read-only preview: '+JSON.stringify(preview))
assert.equal(preview.data.preview.canAttemptDelete,true)
assert.equal(preview.data.preview.requiresPhysicalFact,false)
assert.deepEqual([stock(9041).reserved_quantity,stock(9042).reserved_quantity],[1,1])
const rejected=await http('POST','/api/orders/'+orderId+'/delete',{
 requestId:'stage32-invalid-delete-preview',expectedSnapshot:'f'.repeat(64)})
assert(rejected.status>=400,'Stale/deceptive delete snapshot rejected: '+JSON.stringify(rejected))
assert.deepEqual(original.map(x=>reservation(x.id)),initialReservations)
const deletion=await http('POST','/api/orders/'+orderId+'/delete',{
 requestId:'stage32-valid-delete',expectedSnapshot:preview.data.preview.chainPlan.snapshotFingerprint,
 comment:'QA test: delete unsent multi-source order without stock side-effects'})
assert.equal(deletion.status,200,'Delete after preview: '+JSON.stringify(deletion))
assert.equal(deletion.data.ok,true)
assert.equal(sql.prepare('SELECT order_status FROM orders WHERE id=?').get(orderId).order_status,'deleted')
for(const x of original){
 const r=reservation(x.id)
 assert.equal(r.id,initialReservations.find(x=>x.order_item_id===r.order_item_id).id,'Original reserve row preserved as audit')
 assert.equal(r.status,'released','Exactly selected active reserve released')
}
assert.deepEqual([stock(9041).reserved_quantity,stock(9042).reserved_quantity],[0,0])
assert.deepEqual([stock(9041).quantity,stock(9042).quantity],physicalBefore,'No phantom physical stock return')
assert.equal(Number(sql.prepare('SELECT COUNT(*) AS n FROM inventory_movements').get().n),movementsBefore,'No physical movement from unshipped deletion')
const again=await http('POST','/api/orders/'+orderId+'/delete',{
 requestId:'stage32-valid-delete',expectedSnapshot:preview.data.preview.chainPlan.snapshotFingerprint})
assert.equal(again.status,200)
assert.deepEqual([stock(9041).reserved_quantity,stock(9042).reserved_quantity],[0,0])
assert.deepEqual([stock(9041).quantity,stock(9042).quantity],physicalBefore)
console.log('STAGE32_UNSENT_DELETE_CROSS_SOURCE_HTTP_PASS: two active source reservations released individually, zero physical deltas, admin only, stale preview denied, replay safe')
