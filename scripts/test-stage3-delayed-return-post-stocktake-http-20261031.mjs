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

const stock=()=>sql.prepare('SELECT quantity,reserved_quantity FROM inventory_stock WHERE id=9041').get()
const movements=()=>Number(sql.prepare("SELECT COUNT(*) AS n FROM inventory_movements WHERE reference_type='return'").get().n)
const createAndShip=async key=>{
 const c=await http('POST','/api/orders',payload(key,[item('warehouse')]))
 assert.equal(c.status,201,'Order creation: '+JSON.stringify(c))
 const orderId=Number(c.data.orderId)
 const line=sql.prepare('SELECT id,variant_id FROM order_items WHERE order_id=? AND quantity=1').get(orderId)
 assert.equal(line.variant_id,9031)
 const s=await http('PATCH','/api/orders/'+orderId+'/shipping',{requestId:key+'-ship',shippingStatus:'sent',shippingDate:'2026-10-31'})
 assert.equal(s.status,200,'Shipment: '+JSON.stringify(s))
 return {orderId,itemId:line.id}
}
const makePending=async (orderId,itemId,key)=>{
 const r=await http('POST','/api/returns',{requestId:key,orderId,returnDate:'2026-10-31',amount:0,
   items:[{orderItemId:itemId,quantity:1,physicalState:'pending',restock:true}]})
 assert.equal(r.status,201,'Pending Return: '+JSON.stringify(r))
 const returnId=Number(r.data.returnId)
 const ri=sql.prepare('SELECT id,physical_tracking,physical_received_at,inventory_source,created_at FROM return_items WHERE return_id=?').get(returnId)
 assert(ri?.id)
 assert.equal(ri.physical_tracking,1)
 assert.equal(ri.physical_received_at,null)
 assert.equal(ri.inventory_source,null)
 // Synthetic delayed receipt: registration preceded the count, but the present
 // Worker request happens after it. Do not sleep or mutate a remote database.
 sql.prepare('UPDATE return_items SET created_at=? WHERE id=?').run(new Date(Date.now()-60000).toISOString(),ri.id)
 return {returnId,returnItemId:ri.id}
}
const receive=async (id,itemId,requestId,decision)=>
 http('POST','/api/returned-items/receive',{requestId,operationType:'return',operationId:id,
  operationItemId:itemId,destination:'warehouse',...(decision?{freshnessDecision:decision}:{})})
const first=await createAndShip('stage3-postcheck-counted')
assert.equal(stock().quantity,1)
const a=await makePending(first.orderId,first.itemId,'stage3-pending-counted')
assert.equal(stock().quantity,1,'Registering pending return must not add physical')
const beforePhysicalEvents=movements()
const checkAt=new Date().toISOString()
sql.prepare("INSERT INTO inventory_stock_checks (check_key,inventory_source,variant_id,checked_at,check_type,reference_type,reference_id,expected_quantity,counted_quantity,difference_quantity,created_at) VALUES ('stage3-check-a','warehouse',9031,?,'selective_stocktake','stocktake','STAGE3-CHECK-A',1,2,1,?)").run(checkAt,checkAt)
sql.prepare('UPDATE inventory_stock SET quantity=2 WHERE id=9041').run()
const ambiguous=await receive(a.returnId,a.returnItemId,'stage3-counted-without-choice')
assert.equal(ambiguous.status,200,'Preflight must prompt, not fail silently: '+JSON.stringify(ambiguous))
assert.equal(ambiguous.data.ok,false)
assert.equal(ambiguous.data.code,'intake_freshness_confirmation_required')
assert.equal(stock().quantity,2)
assert.equal(movements(),beforePhysicalEvents)
assert.equal(sql.prepare('SELECT physical_received_at FROM return_items WHERE id=?').get(a.returnItemId).physical_received_at,null)
const counted=await receive(a.returnId,a.returnItemId,'stage3-counted-confirm','already_counted')
assert.equal(counted.status,200,'Already counted intake: '+JSON.stringify(counted))
assert.equal(counted.data.ok,true)
assert.equal(counted.data.freshnessProtected,true)
assert.equal(counted.data.stockApplied,false)
assert.equal(stock().quantity,2,'Stocktake already counted the return, no +1 allowed')
assert.equal(movements(),beforePhysicalEvents,'No phantom return movement')
const countedEvent=sql.prepare("SELECT status,variant_id,inventory_source FROM inventory_lifecycle_events WHERE operation_type='return' AND operation_id=?").get(a.returnId)
assert.equal(countedEvent.status,'cancelled','Already counted receipt protects against later automatic stock +1')
assert.equal(countedEvent.variant_id,9031)
assert.equal(countedEvent.inventory_source,'warehouse')
const repeated=await receive(a.returnId,a.returnItemId,'stage3-counted-confirm','already_counted')
assert.equal(repeated.status,200)
assert.equal(stock().quantity,2,'Repeat cannot credit counted item')
const cancelled=await http('PATCH','/api/returns/'+a.returnId+'/cancel',{requestId:'stage3-cancel-counted'})
assert.equal(cancelled.status,200,'Cancel already-counted Return: '+JSON.stringify(cancelled))
assert.equal(stock().quantity,2,'Cancellation must not subtract item already included in prior stocktake')
// Independent synthetic case: remove prior checkpoint to avoid invoking unrelated order-shipping review.
sql.exec('DELETE FROM inventory_stock_checks')
const second=await createAndShip('stage3-postcheck-arrived')
assert.equal(stock().quantity,1)
const b=await makePending(second.orderId,second.itemId,'stage3-pending-arrived')
assert.equal(stock().quantity,1)
const checkAtB=new Date().toISOString()
sql.prepare("INSERT INTO inventory_stock_checks (check_key,inventory_source,variant_id,checked_at,check_type,reference_type,reference_id,expected_quantity,counted_quantity,difference_quantity,created_at) VALUES ('stage3-check-b','warehouse',9031,?,'selective_stocktake','stocktake','STAGE3-CHECK-B',1,1,0,?)").run(checkAtB,checkAtB)
const arrived=await receive(b.returnId,b.returnItemId,'stage3-arrived-confirm','arrived_after_check')
assert.equal(arrived.status,200,'Arrived-after-check intake: '+JSON.stringify(arrived))
assert.equal(arrived.data.stockApplied,true)
assert.equal(stock().quantity,2,'Physically arrived after check increases stock once')
const arrivedAgain=await receive(b.returnId,b.returnItemId,'stage3-arrived-confirm','arrived_after_check')
assert.equal(arrivedAgain.status,200)
assert.equal(stock().quantity,2)
const cancelledB=await http('PATCH','/api/returns/'+b.returnId+'/cancel',{requestId:'stage3-cancel-arrived'})
assert.equal(cancelledB.status,200)
assert.equal(stock().quantity,1,'Cancellation reverses only actual new intake event')
// Independent negative case starts without an unrelated older checkpoint.
sql.exec('DELETE FROM inventory_stock_checks')
const noCheck=await createAndShip('stage3-postcheck-no-check')
const c=await makePending(noCheck.orderId,noCheck.itemId,'stage3-pending-no-check')
sql.exec('DELETE FROM inventory_stock_checks')
const stale=await receive(c.returnId,c.returnItemId,'stage3-stale-decision','already_counted')
assert.equal(stale.status,409,'Cannot claim counted without a newer check: '+JSON.stringify(stale))
assert.equal(sql.prepare('SELECT physical_received_at FROM return_items WHERE id=?').get(c.returnItemId).physical_received_at,null)
console.log('STAGE3_DELAYED_RETURN_POST_STOCKTAKE_HTTP_PASS: read-only required prompt, counted no duplicate +1, arrived after count +1, cancellation exact, stale choice 409')
