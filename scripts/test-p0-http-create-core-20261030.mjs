// Integration harness: run the actual versioned SQL migrations against a
// brand-new in-memory SQLite D1 shim. No Cloudflare network, no remote D1.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {createHash} from 'node:crypto'
import worker from '../worker/index.ts'

const sql=new DatabaseSync(':memory:')
const migrations=fs.readdirSync('migrations').filter(name=>/^\d{4}.*\.sql$/.test(name)).sort()
assert(migrations.length>=110,'Expected complete schema migration chain')
let last=''
for(const name of migrations){
 try {sql.exec(fs.readFileSync('migrations/'+name,'utf8'));last=name}
 catch(error){throw new Error('Fresh SQLite migration '+name+' failed after '+last+': '+(error?.message||error))}
}
// Test-only compatibility shim for confirmed migration debt #648.
// Never execute this against production or a connected D1 binding.
const orderColumns=new Set(sql.prepare("PRAGMA table_info(orders)").all().map(x=>x.name))
const localSchemaGaps=[]
if(!orderColumns.has('manager_snapshot_name')){
  localSchemaGaps.push('orders.manager_snapshot_name')
  sql.exec('ALTER TABLE orders ADD COLUMN manager_snapshot_name TEXT')
}
const existingTables=new Set(sql.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(x=>x.name))
if(!existingTables.has('order_manager_audit')){
  localSchemaGaps.push('order_manager_audit')
  sql.exec(`CREATE TABLE order_manager_audit(
    id INTEGER PRIMARY KEY AUTOINCREMENT,order_id INTEGER,external_id TEXT,
    previous_manager_id INTEGER,previous_manager_name TEXT,new_manager_id INTEGER,new_manager_name TEXT,
    action TEXT,source TEXT,actor_role TEXT,actor_label TEXT,details TEXT,created_at TEXT)`)
}
console.log('P0_HTTP_LOCAL_SCHEMA_GAPS: '+JSON.stringify(localSchemaGaps)+' (tracked in #648)')
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
   return {success:true,meta:{changes:Number(m.changes),last_row_id:Number(m.lastInsertRowid)}}
  },
 }
}
let loseReservationBatchResponseOnce=false
const db={
 prepare:q=>stmt(q),
 async batch(stmts){
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
sql.prepare("INSERT INTO managers (id,name,is_active) VALUES(9001,'HTTP Manager',1)").run()
sql.prepare("INSERT INTO app_users (id,login,email,password_hash,role,manager_id,display_name,is_active,must_change_password) VALUES(9001,'httpmanager','local@invalid','fixture-inert-hash','admin',9001,'HTTP Admin',1,0)").run()
sql.prepare("INSERT INTO app_sessions (user_id,token_hash,expires_at) VALUES(9001,?,'2099-01-01')").run(tokenHash)
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
async function http(method,path,payload){
 const headers={'Cookie':'orders_session='+token}
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
const created=await http('POST','/api/orders',payload('create-one'))
assert.equal(created.status,201,'Actual POST /api/orders must succeed: '+JSON.stringify(created))
assert.equal(created.data.ok,true,JSON.stringify(created.data))
const same=await http('POST','/api/orders',payload('create-one'))
assert.equal(same.status,201,'HTTP idempotent retry: '+JSON.stringify(same))
assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM orders WHERE external_id='P0-create-one'").get().n,1)
const stock=sql.prepare("SELECT quantity,reserved_quantity FROM inventory_stock WHERE id=9041").get()
assert.equal(stock.quantity,2)
assert.equal(stock.reserved_quantity,1)
const createdId=Number(created.data.orderId)
assert(createdId>0)
const getOrderResponse=await http('GET','/api/orders/'+createdId)
assert.equal(getOrderResponse.status,200,'GET must read the newly created itemized order: '+JSON.stringify(getOrderResponse))
const current=getOrderResponse.data.order
assert(current?.items?.length===1,'Expected one persisted SKU in actual order readback')
const expectedFields={
 orderDate:String(current.order_date||''),customerPhone:String(current.customer_phone||''),
 customerName:String(current.customer_name||''),city:String(current.city||''),
 deliveryType:String(current.delivery_type||''),comment:String(current.comment||''),
}
const editPayload={
 requestId:'p0-meta-edit',
 metadataCorrection:{
  expected:expectedFields,
  next:{...expectedFields,city:'Алматы'},
  expectedState:{
   totalAmount:Number(current.total_amount||0),receivedAmount:Number(current.received_amount||0),
   debtAmount:Number(current.debt_amount||0),returnAmount:Number(current.return_amount||0),
   shippingStatus:String(current.shipping_status||''),orderStatus:String(current.order_status||''),
  },
 },
}
const updated=await http('PATCH','/api/orders/'+createdId,editPayload)
assert.equal(updated.status,200,'Actual PATCH metadata correction: '+JSON.stringify(updated))
const updatedRetry=await http('PATCH','/api/orders/'+createdId,editPayload)
assert.equal(updatedRetry.status,200,'Metadata edit idempotent retry: '+JSON.stringify(updatedRetry))
assert.equal(sql.prepare('SELECT city FROM orders WHERE id=?').get(createdId).city,'Алматы')
assert.equal(sql.prepare('SELECT reserved_quantity FROM inventory_stock WHERE id=9041').get().reserved_quantity,1,
 'Metadata edit must not rewrite stock or reserve')
const rawItem=current.items[0]
const originalItem={
 orderItemId:Number(rawItem.id),
 productName:String(rawItem.productName||'P0 HTTP ТОВАР'),
 audienceType:String(rawItem.audienceType||'ВЗРОСЛЫЙ'),
 gender:String(rawItem.gender||'МУЖ'),color:String(rawItem.color||'БЕЖ'),
 material:String(rawItem.material||'СТАНДАРТ'),length:String(rawItem.length||'СТАНДАРТ'),
 size:String(rawItem.size||'50'),
 quantity:Number(rawItem.quantity||1),unitPrice:Number(rawItem.unitPrice||1000),
 lineTotal:Number(rawItem.lineTotal||1000),
 catalogPriceSnapshot:rawItem.catalogPriceSnapshot??null,
 sourceType:String(rawItem.sourceType||'warehouse'),
 workshopComment:String(rawItem.workshopComment||''),
 workshopUrgent:Boolean(rawItem.workshopUrgent),
 workshopDueDate:String(rawItem.workshopDueDate||''),
 workshopDueTime:String(rawItem.workshopDueTime||''),
}
const replacementPayload={
 requestId:'p0-source-edit',
 itemContentReplacement:{
  expectedItems:[originalItem],
  items:[{...originalItem,sourceType:'boutique'}],
 },
}
const moved=await http('PATCH','/api/orders/'+createdId,replacementPayload)
assert.equal(moved.status,200,'Change one SKU warehouse to boutique through HTTP PATCH: '+JSON.stringify(moved))
const movedRetry=await http('PATCH','/api/orders/'+createdId,replacementPayload)
assert.equal(movedRetry.status,200,'Source-edit retry must be idempotent: '+JSON.stringify(movedRetry))
assert.equal(sql.prepare('SELECT quantity FROM inventory_stock WHERE id=9041').get().quantity,2)
assert.equal(sql.prepare('SELECT reserved_quantity FROM inventory_stock WHERE id=9041').get().reserved_quantity,0,
 'Changing source must release exactly the old warehouse reserve')
assert.equal(sql.prepare('SELECT quantity FROM inventory_stock WHERE id=9042').get().quantity,2)
assert.equal(sql.prepare('SELECT reserved_quantity FROM inventory_stock WHERE id=9042').get().reserved_quantity,1,
 'Changing source must reserve exactly one boutique SKU')
const shortage=await http('POST','/api/orders',payload('create-short',[item(),item(),item()]))
assert.equal(shortage.status,409,'Shortage response: '+JSON.stringify(shortage))
assert.equal(shortage.data.code,'order_stock_shortage')
assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM orders WHERE external_id='P0-create-short'").get().n,0)
// Remove one item from an itemized order: exactly its old active reserve
// disappears, without changing the other line or either physical stock.
const two=await http('POST','/api/orders',payload('create-two',[item('warehouse'),item('boutique')]))
assert.equal(two.status,201,'Two-source order create: '+JSON.stringify(two))
const twoId=Number(two.data.orderId)
const twoRead=await http('GET','/api/orders/'+twoId)
assert.equal(twoRead.status,200)
const snapshots=twoRead.data.order.items.map(row=>({
 ...originalItem,
 orderItemId:Number(row.id),
 sourceType:String(row.sourceType||'warehouse'),
 unitPrice:Number(row.unitPrice||1000),
 lineTotal:Number(row.lineTotal||1000),
 catalogPriceSnapshot:row.catalogPriceSnapshot??null,
}))
assert.equal(snapshots.length,2)
const keepBoutique=snapshots.find(row=>row.sourceType==='boutique')
assert(keepBoutique,'The survivor must be the boutique line')
const deletePayload={requestId:'p0-delete-one-line',itemContentReplacement:{
 expectedItems:snapshots,items:[keepBoutique],
}}
const deleteResult=await http('PATCH','/api/orders/'+twoId,deletePayload)
assert.equal(deleteResult.status,200,'Removing warehouse line through actual PATCH: '+JSON.stringify(deleteResult))
const deleteReplay=await http('PATCH','/api/orders/'+twoId,deletePayload)
assert.equal(deleteReplay.status,200)
assert.equal(sql.prepare('SELECT reserved_quantity FROM inventory_stock WHERE id=9041').get().reserved_quantity,0)
assert.equal(sql.prepare('SELECT reserved_quantity FROM inventory_stock WHERE id=9042').get().reserved_quantity,2)
assert.equal(sql.prepare('SELECT quantity FROM inventory_stock WHERE id=9041').get().quantity,2)
assert.equal(sql.prepare('SELECT quantity FROM inventory_stock WHERE id=9042').get().quantity,2)
// Drop the server's response just AFTER an atomic D1.batch commits the
// reservation. The same HTTP requestId must recover the existing order/item.
loseReservationBatchResponseOnce=true
const lost=await http('POST','/api/orders',payload('create-lost-response'))
assert.equal(lost.status,500,'Fault injection must drop response after DB COMMIT: '+JSON.stringify(lost))
assert.equal(loseReservationBatchResponseOnce,false,'The reservation COMMIT fault must actually fire')
const resumed=await http('POST','/api/orders',payload('create-lost-response'))
assert.equal(resumed.status,201,'Safe replay after committed-but-lost response: '+JSON.stringify(resumed))
const savedId=Number(resumed.data.orderId)
assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM orders WHERE external_id='P0-create-lost-response'").get().n,1)
assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM order_items WHERE order_id=?').get(savedId).n,1)
assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM inventory_reservations WHERE order_id=? AND status='active'").get(savedId).n,1)
assert.equal(sql.prepare('SELECT reserved_quantity FROM inventory_stock WHERE id=9041').get().reserved_quantity,1)
assert.equal(sql.prepare('SELECT quantity FROM inventory_stock WHERE id=9041').get().quantity,2)
console.log('P0_HTTP_CREATE_EDIT_PASSED: migrations '+migrations.length+', create, shortage, metadata, source transfer, item removal, idempotency and committed-but-lost HTTP response')
