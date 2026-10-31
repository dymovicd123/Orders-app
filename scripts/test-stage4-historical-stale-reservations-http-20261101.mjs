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





const nowOrder=await http('POST','/api/orders',payload('legacy-cleanup-current',[item()]))
assert.equal(nowOrder.status,201,'Create modern order '+JSON.stringify(nowOrder))
const currentId=Number(nowOrder.data.orderId)
const modernItem=sql.prepare('SELECT id FROM order_items WHERE order_id=? AND quantity>0').get(currentId).id
const oldOrder=await http('POST','/api/orders',payload('legacy-cleanup-august',[item()]))
assert.equal(oldOrder.status,201,'Create predecessor order '+JSON.stringify(oldOrder))
const legacyId=Number(oldOrder.data.orderId)
const oldItem=sql.prepare('SELECT id FROM order_items WHERE order_id=? AND quantity>0').get(legacyId).id
sql.prepare("UPDATE orders SET order_date='2026-08-08' WHERE id=?").run(legacyId)
sql.prepare("UPDATE inventory_stock SET quantity=0 WHERE id=9041").run() // simulated later physical stocktake, NOT performed by cleanup
const physBefore=sql.prepare('SELECT quantity,reserved_quantity FROM inventory_stock WHERE id=9041').get()
assert.deepEqual({...physBefore},{quantity:0,reserved_quantity:2})
const movesBefore=sql.prepare('SELECT count(*) n FROM inventory_movements').get().n
const oldReserve=sql.prepare('SELECT * FROM inventory_reservations WHERE order_item_id=?').get(oldItem)
const currentReserve=sql.prepare('SELECT * FROM inventory_reservations WHERE order_item_id=?').get(modernItem)
assert.equal(oldReserve.status,'active')
assert.equal(currentReserve.status,'active')
assert.equal(oldReserve.variant_id,9031)

const denied=await http('GET','/api/admin/historical-reservations',undefined,'staff')
assert.equal(denied.status,403,'Manager cannot view admin-only cleanup')
const deniedApply=await http('POST','/api/admin/historical-reservations/release',{reservationId:oldReserve.id},'staff')
assert.equal(deniedApply.status,403)
const preview=await http('GET','/api/admin/historical-reservations')
assert.equal(preview.status,200,JSON.stringify(preview))
const old=preview.data.items.find(x=>x.reservationId===oldReserve.id)
assert(old,'Original August 2026 active reservation must be in preview')
assert.equal(old.classification,'stale_legacy_reservation')
assert.equal(old.orderDate,'2026-08-08')
assert(!preview.data.items.some(x=>x.reservationId===currentReserve.id),
  'Modern orders must never appear as historical cleanup')
const body={reservationId:old.reservationId,orderId:old.orderId,orderItemId:old.orderItemId,
  source:old.source,variantId:old.variantId,quantity:old.quantity,
  confirm:'СНЯТЬ ИСТОРИЧЕСКИЙ РЕЗЕРВ'}
const noConfirm=await http('POST','/api/admin/historical-reservations/release',{...body,confirm:'yes'})
assert.equal(noConfirm.status,400)
const staleQty=await http('POST','/api/admin/historical-reservations/release',{...body,quantity:999})
assert.equal(staleQty.status,409)
const before=sql.prepare('SELECT quantity,reserved_quantity FROM inventory_stock WHERE id=9041').get()
assert.equal(before.reserved_quantity,2)
const released=await http('POST','/api/admin/historical-reservations/release',body)
assert.equal(released.status,200,'Release August order stale reserve: '+JSON.stringify(released))
assert.equal(released.data.quantityReleased,1)
assert.equal(released.data.physicalQuantityChanged,false)
assert.deepEqual({...sql.prepare('SELECT quantity,reserved_quantity FROM inventory_stock WHERE id=9041').get()},{quantity:0,reserved_quantity:1},
  'Only one stale reservation removed. Physical stock and live reserve intact')
assert.equal(sql.prepare('SELECT status FROM inventory_reservations WHERE id=?').get(oldReserve.id).status,'released')
assert.equal(sql.prepare('SELECT status FROM inventory_reservations WHERE id=?').get(currentReserve.id).status,'active')
assert.equal(sql.prepare('SELECT quantity FROM order_items WHERE id=?').get(oldItem).quantity,1,
  'Preserve original historical sale')
assert.equal(sql.prepare('SELECT count(*) n FROM inventory_movements').get().n,movesBefore,
  'No phantom physical movement')
const log=sql.prepare("SELECT title,details FROM activity_log WHERE event_type='historical_reservation_released' AND entity_id=?").all(oldReserve.id)
assert.equal(log.length,1,'Durable atomic audit entry for one release')
assert(log[0].details.includes('физическое количество и заказ НЕ изменялись'))
const replay=await http('POST','/api/admin/historical-reservations/release',body)
assert.equal(replay.status,200)
assert.equal(replay.data.alreadyReleased,true)
assert.equal(sql.prepare("SELECT count(*) n FROM activity_log WHERE event_type='historical_reservation_released' AND entity_id=?").get(oldReserve.id).n,1)
assert.equal(sql.prepare('SELECT reserved_quantity FROM inventory_stock WHERE id=9041').get().reserved_quantity,1)
const nowPreview=await http('GET','/api/admin/historical-reservations')
assert.equal(nowPreview.status,200)
assert.equal(nowPreview.data.items.filter(x=>x.reservationId===oldReserve.id).length,0)
assert.equal(sql.prepare('SELECT count(*) n FROM inventory_reservations WHERE status="active" AND inventory_source="warehouse" AND variant_id=9031').get().n,1)
console.log('STAGE4_LEGACY_RESERVE_CLEANUP_PASS: admin-only, August order migration stale claim, guarded explicit identity, no fake stock, current reserve preserved, durable audit, retry safe')
