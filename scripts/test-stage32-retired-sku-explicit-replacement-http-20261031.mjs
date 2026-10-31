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
const initial=await http('POST','/api/orders',payload('stage32-retired-explicit-rewrite',[item('warehouse'),{...item('boutique'),productName:'P0 HTTP НОВЫЙ',color:'ЧЕРНЫЙ'}]))
assert.equal(initial.status,201,'Create two source-specific positions: '+JSON.stringify(initial))
const orderId=Number(initial.data.orderId)
const readRows=()=>sql.prepare('SELECT id,product_id,variant_id,source_type,quantity,unit_price,line_total,catalog_price_snapshot,inventory_obligation_key,inventory_obligation_origin_at FROM order_items WHERE order_id=? AND quantity>0 ORDER BY id ASC').all(orderId)
const reserve=id=>sql.prepare('SELECT id,order_item_id,product_id,variant_id,inventory_source,quantity,status FROM inventory_reservations WHERE order_item_id=? ORDER BY id DESC LIMIT 1').get(id)
const stock=id=>sql.prepare('SELECT quantity,reserved_quantity FROM inventory_stock WHERE id=?').get(id)
const rows=readRows()
assert.equal(rows.length,2)
const [old,untouched]=rows
assert.deepEqual([old.variant_id,old.source_type,untouched.variant_id,untouched.source_type],[9031,'warehouse',9032,'boutique'])
const hold=reserve(untouched.id)
const oldHold=reserve(old.id)
assert.equal(hold.status,'active')
assert.equal(oldHold.status,'active')
assert.equal(stock(9041).reserved_quantity,1)
assert.equal(stock(9042).reserved_quantity,0)
assert.equal(stock(9043).reserved_quantity,1)
const beforeStocks=[stock(9041),stock(9042),stock(9043)]
const beforeMove=Number(sql.prepare('SELECT COUNT(*) AS n FROM inventory_movements').get().n)
// Retire the original SKU after order creation; historical order identity remains valid.
sql.prepare('UPDATE catalog_variants SET is_active=0 WHERE id=9031').run()
const oldView=await http('GET','/api/orders/'+orderId)
assert.equal(oldView.status,200,'Read order: '+JSON.stringify(oldView))
const items=oldView.data.order.items
assert.equal(items.length,2)
const expectedItems=items.map(x=>({
 orderItemId:x.id,productName:x.productName,audienceType:x.audienceType,gender:x.gender||null,
 color:x.color||null,material:x.material||'СТАНДАРТ',length:x.length||'СТАНДАРТ',size:x.size||null,
 quantity:x.quantity,unitPrice:x.unitPrice,lineTotal:x.lineTotal,catalogPriceSnapshot:x.catalogPriceSnapshot??null,
 sourceType:x.sourceType,workshopComment:x.workshopComment||null,workshopUrgent:Boolean(x.workshopUrgent),
 workshopDueDate:x.workshopDueDate||null,workshopDueTime:x.workshopDueTime||null,
}))
const replacements=expectedItems.map(x=>({
 orderItemId:x.orderItemId,productName:x.productName,audienceType:x.audienceType,gender:x.gender,
 color:x.color,material:x.material,length:x.length,size:x.size,quantity:x.quantity,unitPrice:x.unitPrice,
 catalogPriceSnapshot:x.catalogPriceSnapshot,sourceType:x.sourceType,
 workshopComment:x.workshopComment,workshopUrgent:x.workshopUrgent,
 workshopDueDate:x.workshopDueDate||'',workshopDueTime:x.workshopDueTime||'',
}))
const first=replacements.find(x=>x.orderItemId===old.id)
assert(first)
first.productName='P0 HTTP НОВЫЙ'
first.color='ЧЕРНЫЙ'
first.sourceType='boutique'
const payloadEdit={requestId:'stage32-replace-one-sku',
 itemContentReplacement:{expectedItems,items:replacements}}
const patched=await http('PATCH','/api/orders/'+orderId,payloadEdit)
assert.equal(patched.status,200,'Partial itemized rewrite: '+JSON.stringify(patched))
assert.equal(patched.data.ok,true)
const after=readRows()
assert.equal(after.length,2,'One old position retired, one new inserted, one intact')
assert(after.some(x=>x.id===untouched.id),'Unchanged item keeps its exact original id')
assert.equal(sql.prepare('SELECT quantity FROM order_items WHERE id=?').get(old.id).quantity,0)
const preserved=after.find(x=>x.id===untouched.id)
const fresh=after.find(x=>x.id!==untouched.id)
assert.equal(fresh.variant_id,9032)
assert.equal(fresh.product_id,9022)
assert.equal(fresh.source_type,'boutique')
assert.deepEqual(reserve(untouched.id),hold,'Untouched item reserve remains IDENTICAL including row ID')
assert.equal(reserve(old.id).status,'released')
assert.equal(reserve(fresh.id).status,'active')
assert.equal(reserve(fresh.id).variant_id,9032)
assert.equal(reserve(fresh.id).inventory_source,'boutique')
assert.equal(preserved.inventory_obligation_key,untouched.inventory_obligation_key)
assert.equal(preserved.inventory_obligation_origin_at,untouched.inventory_obligation_origin_at)
assert.notEqual(fresh.inventory_obligation_key,old.inventory_obligation_key,'New SKU cannot inherit old lineage')
assert.equal(stock(9041).reserved_quantity,0)
assert.equal(stock(9042).reserved_quantity,0)
assert.equal(stock(9043).reserved_quantity,2)
assert.equal(sql.prepare('SELECT variant_id FROM order_items WHERE id=?').get(old.id).variant_id,9031,'Retired SKU preserved as historical order identity')
assert.equal(sql.prepare('SELECT is_active FROM catalog_variants WHERE id=9031').get().is_active,0)
assert.deepEqual([stock(9041).quantity,stock(9042).quantity,stock(9043).quantity],beforeStocks.map(x=>x.quantity),'Edit cannot move physical goods')
assert.equal(Number(sql.prepare('SELECT COUNT(*) AS n FROM inventory_movements').get().n),beforeMove,'No physical movements on edit')
const again=await http('PATCH','/api/orders/'+orderId,payloadEdit)
assert.equal(again.status,200)
assert.deepEqual(readRows(),after,'Exact retry cannot create another item')
assert.deepEqual(reserve(untouched.id),hold)
const stale=await http('PATCH','/api/orders/'+orderId,{...payloadEdit,requestId:'stage32-stale-editor'})
assert(stale.status>=400,'Stale item editor must be rejected: '+JSON.stringify(stale))
assert.deepEqual(readRows(),after,'Stale request must not alter order')
assert.deepEqual(reserve(untouched.id),hold,'Stale request must not change other row reserve')
console.log('STAGE32_RETIRED_SKU_EXPLICIT_REPLACEMENT_PASS: exact original id/reserve preserved, retired old, independent replacement SKU/source/lineage, no physical writes, retry and stale safe')
