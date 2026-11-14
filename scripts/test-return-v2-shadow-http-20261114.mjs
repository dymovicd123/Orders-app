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

const count=(table,where,params=[])=>Number(sql.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get(...params)?.n)
const oldStock=()=>sql.prepare('SELECT quantity,reserved_quantity FROM inventory_stock WHERE id=9041').get()
const otherStock=()=>sql.prepare('SELECT quantity,reserved_quantity FROM inventory_stock WHERE id=9042').get()
const reserve=id=>sql.prepare('SELECT id,quantity,status,variant_id,inventory_source FROM inventory_reservations WHERE order_item_id=? ORDER BY id DESC LIMIT 1').get(id)

const created=await http('POST','/api/orders',{
 ...payload('v2-shadow-order',[{...item('warehouse'),quantity:2,unitPrice:30000}]),
 payments:[{paymentDate:'2026-10-30',method:'KASPI',amount:60000,paymentKind:'primary'}],
})
assert.equal(created.status,201,'Create priced order: '+JSON.stringify(created))
const orderId=Number(created.data.orderId)
const line=sql.prepare('SELECT id,quantity,unit_price,line_total FROM order_items WHERE order_id=?').get(orderId)
assert.deepEqual({qty:line.quantity,price:line.unit_price,total:line.line_total},{qty:2,price:30000,total:60000})
assert.equal(reserve(line.id).status,'active')
const core=()=>({
 order:sql.prepare('SELECT total_amount,received_amount,return_amount,debt_amount,shipping_status FROM orders WHERE id=?').get(orderId),
 item:sql.prepare('SELECT quantity,line_total,stock_writeoff_status FROM order_items WHERE id=?').get(line.id),
 stock:oldStock(),reserve:reserve(line.id),
 returns:count('returns','order_id=?',[orderId]),
 returnItems:count('return_items','order_item_id=?',[line.id]),
 exchanges:count('exchanges','order_id=?',[orderId]),
 moneyEvents:count('financial_events','order_id=?',[orderId]),
})
const before=core()
const input={orderId,expectedTotalAmount:60000,items:[{orderItemId:line.id,quantity:1}]}
const preview=await http('POST','/api/returns/preview-v2',input)
assert.equal(preview.status,200,'Read-only preview: '+JSON.stringify(preview))
assert.equal(preview.data.mode,'return_v2_shadow_preview')
assert.equal(preview.data.readOnly,true)
assert.equal(preview.data.commitAllowed,false)
assert.equal(preview.data.suggestedRefundAmount,30000)
assert.equal(preview.data.requestedRefundAmount,30000)
assert.deepEqual(preview.data.projected,{currentSale:30000,netHeld:30000,signedBalance:0,customerDebt:0,customerOverpay:0})
assert.deepEqual(core(),before,'Preview must not change prices, money, Return, reserve or physical stock')
const again=await http('POST','/api/returns/preview-v2',input)
assert.equal(again.status,200)
assert.deepEqual(core(),before)
const custom=await http('POST','/api/returns/preview-v2',{...input,refundAmount:20000})
assert.equal(custom.status,200)
assert.equal(custom.data.projected.customerOverpay,10000)
assert.deepEqual(core(),before)
const all=await http('POST','/api/returns/preview-v2',{...input,items:[{orderItemId:line.id,quantity:2}]})
assert.equal(all.status,200)
assert.equal(all.data.projected.currentSale,0)
assert.equal(all.data.suggestedRefundAmount,60000)
const noCash=await http('POST','/api/returns/preview-v2',{...input,refundAmount:0})
assert.equal(noCash.status,200)
assert.equal(noCash.data.projected.customerOverpay,30000)
const insufficient=await http('POST','/api/returns/preview-v2',{...input,refundAmount:60001})
assert.equal(insufficient.status,200)
assert.equal(insufficient.data.cashCovered,false)
assert.equal(insufficient.data.commitAllowed,false)
assert.deepEqual(core(),before)
const bads=[
 {...input,expectedTotalAmount:50000},
 {...input,items:[{orderItemId:line.id,quantity:3}]},
 {...input,items:[{orderItemId:line.id,quantity:1},{orderItemId:line.id,quantity:1}]},
 {...input,items:[]},
 {...input,refundAmount:-1},
 {...input,items:[{orderItemId:999999,quantity:1}]},
]
for(const bad of bads){
 const rejected=await http('POST','/api/returns/preview-v2',bad)
 assert(rejected.status>=400&&rejected.status<500,JSON.stringify({bad,rejected}))
 assert.deepEqual(core(),before,'Rejected preview changed real data')
}
const manager=await http('POST','/api/returns/preview-v2',input,'staff')
assert.equal(manager.status,403,'Shadow preview must be admin-only')
assert.deepEqual(core(),before)
const shipped=await http('PATCH','/api/orders/'+orderId+'/shipping',{
 requestId:'v2-shadow-ship',shippingStatus:'sent',shippingDate:'2026-10-31'
})
assert.equal(shipped.status,200,'Original shipment failed: '+JSON.stringify(shipped))
assert.equal(oldStock().quantity,0)
assert.equal(reserve(line.id).status,'fulfilled')
const shippedAgain=await http('PATCH','/api/orders/'+orderId+'/shipping',{
 requestId:'v2-shadow-ship',shippingStatus:'sent',shippingDate:'2026-10-31'
})
assert.equal(shippedAgain.status,200)
assert.equal(oldStock().quantity,0,'Replay must not write off stock twice')
const afterShip=core()
const sentPreview=await http('POST','/api/returns/preview-v2',input)
assert.equal(sentPreview.status,200)
assert.deepEqual(core(),afterShip)
const createdReturn=await http('POST','/api/returns',{
 requestId:'existing-return-after-shadow',orderId,returnDate:'2026-10-31',amount:0,
 items:[{orderItemId:line.id,quantity:1,physicalState:'pending',restock:false}]
})
assert.equal(createdReturn.status,201,'Existing Return handler broken: '+JSON.stringify(createdReturn))
assert.equal(oldStock().quantity,0,'Pending Return cannot add stock')
const afterReturn=core()
const conflict=await http('POST','/api/returns/preview-v2',input)
assert.equal(conflict.status,409,'Prior Return must block shadow repricing')
assert.equal(conflict.data.code,'return_v2_prior_operation')
assert.deepEqual(core(),afterReturn)
sql.prepare("UPDATE orders SET pricing_mode='legacy_manual_total' WHERE id=?").run(orderId)
const legacy=await http('POST','/api/returns/preview-v2',input)
assert.equal(legacy.status,409)
assert.equal(legacy.data.code,'return_v2_legacy_price')
sql.close()
console.log('RETURN_V2_SHADOW_HTTP_PASS: Worker+SQLite admin-only preview, exact sold prices, no stock/payment writes, stale and legacy safeguards, historical shipment and Return remain working')
