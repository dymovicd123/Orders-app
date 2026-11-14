// Integration harness: run the actual versioned SQL migrations against a
// brand-new in-memory SQLite D1 shim. No Cloudflare network, no remote D1.
import assert from 'node:assert/strict'
import {readReturnV2ContractCapacity} from '../worker/domains/return-v2-contract-capacity.ts'
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



async function createSent(id){
 const response=await http('POST','/api/orders',{
  ...payload(id,[{...item('warehouse'),quantity:2,unitPrice:15000}]),
  payments:[{paymentDate:'2026-10-30',method:'KASPI',amount:30000,paymentKind:'primary'}],
 })
 assert.equal(response.status,201,'Create: '+JSON.stringify(response))
 const orderId=Number(response.data.orderId)
 const line=sql.prepare('SELECT id,quantity,unit_price,line_total FROM order_items WHERE order_id=?').get(orderId)
 assert.equal(line.quantity,2)
 const ship=await http('PATCH','/api/orders/'+orderId+'/shipping',{
   requestId:id+'-ship',shippingStatus:'sent',shippingDate:'2026-10-31'
 })
 assert.equal(ship.status,200,'Ship: '+JSON.stringify(ship))
 const retry=await http('PATCH','/api/orders/'+orderId+'/shipping',{
   requestId:id+'-ship',shippingStatus:'sent',shippingDate:'2026-10-31'
 })
 assert.equal(retry.status,200)
 return {orderId,lineId:Number(line.id)}
}
const one=await createSent('return-v2-capacity-legacy')
const getOne=()=>readReturnV2ContractCapacity(db,one.orderId,one.lineId)
let l=await getOne()
assert.equal(l.availableForNewReturn,2)
assert.equal(l.alreadyReturnedWithoutLineReduction,0)
assert.equal(l.alreadyReturnedWithLineReduction,0)
const legacy=await http('POST','/api/returns',{
 requestId:'legacy-row-0125',orderId:one.orderId,returnDate:'2026-11-14',amount:0,
 items:[{orderItemId:one.lineId,quantity:1,physicalState:'pending',restock:false}]
})
assert.equal(legacy.status,201,'Old Return must work unchanged: '+JSON.stringify(legacy))
const legacyId=Number(legacy.data.returnId)
assert.equal(sql.prepare('SELECT contract_quantity_applied c FROM return_items WHERE return_id=?').get(legacyId).c,0)
l=await getOne()
assert.deepEqual([l.currentOrderItemQuantity,l.alreadyReturnedWithoutLineReduction,
  l.alreadyReturnedWithLineReduction,l.availableForNewReturn],[2,1,0,1])
const legacySecond=await http('POST','/api/returns',{
 requestId:'legacy-second-0125',orderId:one.orderId,returnDate:'2026-11-14',amount:0,
 items:[{orderItemId:one.lineId,quantity:1,physicalState:'pending',restock:false}]
})
assert.equal(legacySecond.status,201)
l=await getOne()
assert.deepEqual([l.currentOrderItemQuantity,l.totalPhysicalReturnQuantity,l.availableForNewReturn],[2,2,0])
const tooMany=await http('POST','/api/returns',{
 requestId:'legacy-third-0125',orderId:one.orderId,returnDate:'2026-11-14',amount:0,
 items:[{orderItemId:one.lineId,quantity:1,physicalState:'pending',restock:false}]
})
assert(tooMany.status>=400,'Old Return must reject third unit')
assert.equal((await getOne()).availableForNewReturn,0)
const cancel=await http('PATCH','/api/returns/'+legacyId+'/cancel',{requestId:'legacy-cancel-0125'})
assert.equal(cancel.status,200,'Old Return cancel: '+JSON.stringify(cancel))
l=await getOne()
assert.deepEqual([l.alreadyReturnedWithoutLineReduction,l.availableForNewReturn],[1,1])
assert.equal(oldStock().quantity,0,'Pending Return and cancellation cannot change stock')

const two=await createSent('return-v2-capacity-simulated')
const getTwo=()=>readReturnV2ContractCapacity(db,two.orderId,two.lineId)
const initial=await getTwo()
assert.equal(initial.availableForNewReturn,2)
const initialQty=sql.prepare('SELECT quantity,line_total FROM order_items WHERE id=?').get(two.lineId)
assert.deepEqual(initialQty,{quantity:2,line_total:30000})
const stockBefore=oldStock()
const paymentBefore=sql.prepare('SELECT amount FROM payments WHERE order_id=?').get(two.orderId)
sql.exec('SAVEPOINT v2_contract_test_only')
const insertContracted=(qty,key)=>{
 const now='2026-11-14T12:00:00.000Z'
 const current=sql.prepare('SELECT quantity FROM order_items WHERE id=?').get(two.lineId).quantity
 assert(current>=qty)
 sql.prepare('UPDATE order_items SET quantity=?,line_total=? WHERE id=?').run(current-qty,(current-qty)*15000,two.lineId)
 sql.prepare("INSERT INTO returns (order_id,return_date,amount,status,created_at) VALUES (?,'2026-11-14',0,'completed',?)").run(two.orderId,now)
 const retId=Number(sql.prepare('SELECT last_insert_rowid() AS id').get().id)
 sql.prepare("INSERT INTO return_items(return_id,order_item_id,product_name_snapshot,quantity,amount,created_at,physical_tracking,physical_received_at,contract_quantity_applied) VALUES (?,?,'P0 HTTP ТОВАР',?,?,?,1,NULL,1)").run(retId,two.lineId,qty,qty*15000,now)
 return retId
}
const futureReturnId=insertContracted(1,'first')
let v=await getTwo()
assert.deepEqual([v.currentOrderItemQuantity,v.alreadyReturnedWithoutLineReduction,
  v.alreadyReturnedWithLineReduction,v.availableForNewReturn],[1,0,1,1])
const legacyCapacity=sql.prepare("SELECT oi.quantity - COALESCE((SELECT SUM(ri.quantity) FROM return_items ri JOIN returns r ON r.id=ri.return_id WHERE ri.order_item_id=oi.id AND r.status<>'cancelled'),0) AS remaining FROM order_items oi WHERE oi.id=?").get(two.lineId).remaining
assert.equal(legacyCapacity,0,'Demonstrate legacy double subtraction after a V2 quantity-reduced Return')
assert.equal(v.availableForNewReturn,1,'New marker must preserve remaining piece')
const plan=await http('GET','/api/orders/'+two.orderId+'/shipping/plan')
assert.equal(plan.status,200,'Shipping plan must still read existing dispatch evidence')
assert.equal(plan.data.selectedQuantity,0,'Already shipped residual piece must not be re-offered')
insertContracted(1,'second')
v=await getTwo()
assert.deepEqual([v.currentOrderItemQuantity,v.alreadyReturnedWithLineReduction,
 v.totalPhysicalReturnQuantity,v.availableForNewReturn],[0,2,2,0])
assert.equal(oldStock().quantity,stockBefore.quantity,'Contract accounting never mutates physical stock')
assert.deepEqual(sql.prepare('SELECT amount FROM payments WHERE order_id=?').get(two.orderId),paymentBefore,'No cash event')
sql.exec('ROLLBACK TO SAVEPOINT v2_contract_test_only')
sql.exec('RELEASE SAVEPOINT v2_contract_test_only')
v=await getTwo()
assert.deepEqual([v.currentOrderItemQuantity,v.alreadyReturnedWithLineReduction,v.availableForNewReturn],[2,0,2])
assert.deepEqual(sql.prepare('SELECT quantity,line_total FROM order_items WHERE id=?').get(two.lineId),initialQty)
assert.equal(sql.prepare('SELECT COUNT(*) n FROM returns WHERE id=?').get(futureReturnId).n,0,'Test-only simulated posting was rolled back')

const mixed=await createSent('return-v2-capacity-mixed')
const oldOne=await http('POST','/api/returns',{
 requestId:'mixed-legacy',orderId:mixed.orderId,returnDate:'2026-11-14',amount:0,
 items:[{orderItemId:mixed.lineId,quantity:1,physicalState:'pending',restock:false}]
})
assert.equal(oldOne.status,201)
sql.exec('SAVEPOINT v2_mixed_test_only')
sql.prepare('UPDATE order_items SET quantity=1,line_total=15000 WHERE id=?').run(mixed.lineId)
sql.prepare("INSERT INTO returns(order_id,return_date,amount,status,created_at) VALUES (?,'2026-11-14',0,'completed','2026-11-14T12:01:00.000Z')").run(mixed.orderId)
const mixedId=sql.prepare('SELECT last_insert_rowid() id').get().id
sql.prepare("INSERT INTO return_items(return_id,order_item_id,product_name_snapshot,quantity,amount,created_at,physical_tracking,contract_quantity_applied) VALUES (?,?,'P0 HTTP ТОВАР',1,15000,'2026-11-14T12:01:00.000Z',1,1)").run(mixedId,mixed.lineId)
const m=await readReturnV2ContractCapacity(db,mixed.orderId,mixed.lineId)
assert.deepEqual([m.currentOrderItemQuantity,m.alreadyReturnedWithoutLineReduction,
 m.alreadyReturnedWithLineReduction,m.availableForNewReturn],[1,1,1,0],
 'Existing legacy quantity remains a claim even after a future V2 quantity reduction')
sql.exec('ROLLBACK TO SAVEPOINT v2_mixed_test_only')
sql.exec('RELEASE SAVEPOINT v2_mixed_test_only')
assert.equal((await readReturnV2ContractCapacity(db,mixed.orderId,mixed.lineId)).availableForNewReturn,1)
sql.close()
console.log('RETURN_V2_CONTRACT_CAPACITY_SQLITE_PASS: old Return + cancel unchanged, marker defaults zero, simulated V2/mixed capacities avoid double subtraction, shipping still closed, no future posting code activated or stock write')
