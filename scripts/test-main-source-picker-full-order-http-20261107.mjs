// Actual Worker HTTP order-create acceptance on disposable in-memory SQLite.
// There are no Cloudflare network requests, production credentials or D1 writes.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {createHash} from 'node:crypto'
import worker from '../worker/index.ts'
import {planOrderManagerSchemaReconciliation} from './order-manager-schema-reconciliation-20261030.mjs'

const sql=new DatabaseSync(':memory:')
for(const name of fs.readdirSync('migrations').filter(x=>/^\d{4}.*\.sql$/.test(x)).sort())
 sql.exec(fs.readFileSync('migrations/'+name,'utf8'))
const auditExists=!!sql.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='order_manager_audit'").get()
const schema=planOrderManagerSchemaReconciliation({
 ordersColumns:sql.prepare('PRAGMA table_info(orders)').all(),
 auditTableExists:auditExists,
 auditColumns:auditExists?sql.prepare('PRAGMA table_info(order_manager_audit)').all():[]
})
for(const step of schema.steps)sql.exec(step.sql)
const stmt=(query,args=[])=>({
 bind(...values){return stmt(query,values)},
 async first(){return sql.prepare(query).get(...args)??null},
 async all(){return{results:sql.prepare(query).all(...args)}},
 async run(){
  const result=sql.prepare(query).run(...args)
  return{success:true,meta:{changes:Number(result.changes),last_row_id:Number(result.lastInsertRowid||0)}}
 }
})
const db={
 prepare:query=>stmt(query),
 async batch(statements){
  sql.exec('SAVEPOINT picker_http')
  try{
   const values=[]
   for(const statement of statements)values.push(await statement.run())
   sql.exec('RELEASE picker_http')
   return values
  }catch(e){
   sql.exec('ROLLBACK TO SAVEPOINT picker_http');sql.exec('RELEASE picker_http')
   throw e
  }
 }
}
const managerId=98501,productId=98502,token='picker-full-order-test-token'
const tokenHash=createHash('sha256').update(token).digest('base64url')
const seededAt='2026-11-07T00:00:00Z'
sql.prepare('INSERT INTO managers(id,name,is_active) VALUES(?,?,1)').run(managerId,'QA Picker Manager')
sql.prepare("INSERT INTO app_users(id,login,email,password_hash,role,manager_id,display_name,is_active,must_change_password) VALUES(98501,'picker-full','picker-test@invalid','unused-test-hash','admin',98501,'QA Picker Manager',1,0)").run()
sql.prepare("INSERT INTO app_sessions(user_id,token_hash,expires_at) VALUES(98501,?,'2099-01-01')").run(tokenHash)
sql.prepare("INSERT INTO catalog_products(id,name,category,is_active) VALUES(98502,'QA SIZE PONCHO','adult',1)").run()
sql.prepare("INSERT INTO catalog_stock_positions(product_id,category,gender_scope,material,length,is_default,is_active,sort_order,created_at,updated_at) VALUES(98502,'adult','unisex','КАШЕМИР','СТАНДАРТ',0,1,0,?,?)").run(seededAt,seededAt)
const executionId=sql.prepare("SELECT id FROM catalog_stock_positions WHERE product_id=98502 AND material='КАШЕМИР' AND length='СТАНДАРТ'").get()?.id
assert(executionId,'V3 execution required')
for(const [id,size,physical] of [[98511,'СТАНДАРТ',4],[98512,'0',2],[98513,'',3]]){
 sql.prepare("INSERT INTO catalog_variants(id,product_id,stock_position_id,gender,color,material,length,size_label,category,is_active) VALUES(?,98502,?,'ЖЕН','БЕЖЕВЫЙ','КАШЕМИР','СТАНДАРТ',?,'adult',1)").run(id,executionId,size)
 sql.prepare("INSERT INTO inventory_stock(inventory_source,product_id,variant_id,product_name_snapshot,gender_snapshot,color_snapshot,material_snapshot,length_snapshot,size_snapshot,quantity,reserved_quantity) VALUES('boutique',98502,?,'QA SIZE PONCHO','ЖЕН','БЕЖЕВЫЙ','КАШЕМИР','СТАНДАРТ',?,?,0)").run(id,size,physical)
}
sql.prepare("INSERT INTO inventory_model_meta(key,value,updated_at) VALUES('human_inventory_v2','active',?) ON CONFLICT(key) DO UPDATE SET value='active'").run(seededAt)
const post=async (payload)=>{
 const request=new Request('https://test-only.invalid/api/orders',{
  method:'POST',headers:{Cookie:'orders_session='+token,'Content-Type':'application/json','X-Idempotency-Key':payload.requestId},
  body:JSON.stringify(payload)
 })
 const response=await worker.fetch(request,{DB:db})
 let body
 try{body=await response.json()}catch{body={}}
 return{status:response.status,body}
}
const make=(variantId,size,requestId)=>({
 requestId,orderDate:'2026-11-07',
 managerId,managerName:'QA Picker Manager',customerName:'QA Customer',
 city:'Алматы',deliveryType:'Самовывоз',sourceType:'boutique',
 workshopStatus:'ready',orderStatus:'active',pricingMode:'itemized_v1',
 items:[{productName:'QA SIZE PONCHO',catalogVariantId:variantId,
  audienceType:'ВЗРОСЛЫЙ',gender:'ЖЕН',color:'БЕЖЕВЫЙ',
  material:'КАШЕМИР',length:'СТАНДАРТ',size,
  sourceType:'boutique',quantity:1,unitPrice:23000,
  catalogPriceSnapshot:null,shortageAcknowledged:true
 }],
 payments:[]
})
const itemCount=()=>Number(sql.prepare("SELECT COUNT(*) AS n FROM order_items WHERE product_name_snapshot='QA SIZE PONCHO'").get().n)
const reservations=()=>sql.prepare(
 "SELECT variant_id,inventory_source,quantity,status FROM inventory_reservations WHERE product_id=98502 AND status='active' ORDER BY variant_id"
).all()
const variants=[
 {id:98511,size:'СТАНДАРТ'},
 {id:98512,size:'0'},
 {id:98513,size:''}
]
try{
 for(const variant of variants){
  const requestId='qa-size-order-'+variant.id
  const payload=make(variant.id,variant.size,requestId)
  const response=await post(payload)
  assert([200,201].includes(response.status),'Creating '+variant.size+' HTTP order failed '+JSON.stringify(response.body))
  assert(response.body.orderId>0)
  const item=sql.prepare("SELECT variant_id,size_snapshot,source_type FROM order_items WHERE order_id=?").get(response.body.orderId)
  assert.equal(item?.variant_id,variant.id,'Saved order linked wrong SKU')
  assert.equal(item?.size_snapshot??'',variant.size,'Persisted human size not equal to actual SKU size')
  assert.equal(item?.source_type,'boutique')
  const reserve=sql.prepare("SELECT variant_id,inventory_source,quantity,status FROM inventory_reservations WHERE order_id=?").get(response.body.orderId)
  assert.equal(reserve?.variant_id,variant.id,'Reservation not linked to same exact SKU')
  assert.equal(reserve?.inventory_source,'boutique')
  assert.equal(reserve?.status,'active')
  const replay=await post(payload)
  assert([200,201].includes(replay.status),'Idempotent retry failed')
  assert.equal(replay.body.orderId,response.body.orderId,'Duplicate order from retry')
 }
 assert.equal(itemCount(),3)
 assert.deepEqual(reservations().map(r=>[r.variant_id,r.inventory_source,r.quantity]),
  [[98511,'boutique',1],[98512,'boutique',1],[98513,'boutique',1]])
 for(const [id,stock] of [[98511,4],[98512,2],[98513,3]]){
  const row=sql.prepare("SELECT quantity,reserved_quantity FROM inventory_stock WHERE variant_id=? AND inventory_source='boutique'").get(id)
  assert.equal(row.quantity,stock,'Order incorrectly decreased physical stock')
  assert.equal(row.reserved_quantity,1,'Reservation cache not updated correctly')
 }
 const before=itemCount()
 const wrong=await post(make(98511,'БЕЗ РАЗМЕРА','qa-size-wrong-standard'))
 assert.equal(wrong.status,400,'Mismatched pinned SKU must be a controlled client error '+JSON.stringify(wrong.body))
 assert.equal(itemCount(),before,'Wrong size must not create an order')
 assert.equal(reservations().length,3,'Wrong size must not create reservation')
 // Incomplete workshop descriptions are real tasks, never implicit STANDARD
 // material/length variants, and never stock reservations.
 const variantCount=Number(sql.prepare("SELECT COUNT(*) AS n FROM catalog_variants WHERE product_id=98502").get().n)
 const standardWorkshop=make(98511,'СТАНДАРТ','qa-workshop-omitted-material-length')
 standardWorkshop.items[0]={
  ...standardWorkshop.items[0],catalogVariantId:undefined,sourceType:'workshop',
  material:'',length:'',workshopComment:'Пошить по уточнению клиента',
  workshopUrgent:false
 }
 const taskReply=await post(standardWorkshop)
 assert([200,201].includes(taskReply.status),'Workshop order should save descriptive task '+JSON.stringify(taskReply.body))
 const task=sql.prepare("SELECT product_id,variant_id,material_snapshot,length_snapshot,size_snapshot FROM workshop_tasks WHERE order_id=?").get(taskReply.body.orderId)
 assert.equal(task?.product_id,98502,'Workshop known model should still link')
 assert.equal(task?.variant_id,null,'Omitted material/length must not auto-link STANDARD SKU')
 assert.equal(task?.material_snapshot,null,'Do not invent Workshop material')
 assert.equal(task?.length_snapshot,null,'Do not invent Workshop length')
 assert.equal(task?.size_snapshot,'СТАНДАРТ','Explicitly selected size must remain literal')
 assert.equal(Number(sql.prepare("SELECT COUNT(*) AS n FROM catalog_variants WHERE product_id=98502").get().n),variantCount,
  'Workshop task may not add catalog SKU')
 assert.equal(reservations().length,3,'Workshop task may not reserve physical stock')
 const taskItem=sql.prepare("SELECT variant_id,is_workshop FROM order_items WHERE order_id=?").get(taskReply.body.orderId)
 assert.equal(taskItem.variant_id,null)
 assert.equal(taskItem.is_workshop,1)
 // Manual source entry must reuse an existing active SKU from the FULL catalog,
 // even when that SKU has never existed in the requested source's inventory_stock.
 const countVariants=()=>Number(sql.prepare('SELECT COUNT(*) AS n FROM catalog_variants WHERE product_id=98502').get().n)
 const countProducts=()=>Number(sql.prepare("SELECT COUNT(*) AS n FROM catalog_products WHERE name='QA SIZE PONCHO'").get().n)
 const initialVariants=countVariants()
 const manual=(requestId,attrs={})=>{
  const payload=make(undefined,'СТАНДАРТ',requestId)
  payload.items[0]={...payload.items[0],catalogVariantId:undefined,
   manualCatalogEntry:true,sourceType:'warehouse',shortageAcknowledged:true,...attrs}
  return payload
 }
 const reused=await post(manual('qa-manual-existing-outside-source'))
 assert([200,201].includes(reused.status),'Manual exact outside-source SKU should be linked: '+JSON.stringify(reused.body))
 const reusedItem=sql.prepare('SELECT variant_id,source_type FROM order_items WHERE order_id=?').get(reused.body.orderId)
 assert.equal(reusedItem.variant_id,98511,'Manual source entry did not reuse active catalog variant outside source')
 assert.equal(reusedItem.source_type,'warehouse','Manual entry changed manager-selected source')
 const warehouseRow=sql.prepare("SELECT quantity FROM inventory_stock WHERE variant_id=98511 AND inventory_source='warehouse'").get()
 assert.equal(warehouseRow?.quantity,0,'Missing source inventory must never be fabricated with physical stock')
 const linkedReserve=sql.prepare('SELECT variant_id,inventory_source FROM inventory_reservations WHERE order_id=?').get(reused.body.orderId)
 assert.equal(linkedReserve?.variant_id,98511)
 assert.equal(linkedReserve?.inventory_source,'warehouse')
 assert.equal(countVariants(),initialVariants,'Existing SKU match must never duplicate catalog variant')
 const missing=await post(manual('qa-manual-unseen-combination',{size:'54'}))
 assert([200,201].includes(missing.status),'Unknown variant may be ordered for catalog clarification: '+JSON.stringify(missing.body))
 const missingItem=sql.prepare('SELECT product_id,variant_id,source_type FROM order_items WHERE order_id=?').get(missing.body.orderId)
 assert.equal(missingItem.product_id,98502,'Recognized model must remain linked')
 assert.equal(missingItem.variant_id,null,'Unknown manual characteristics must not spawn a SKU')
 assert.equal(missingItem.source_type,'warehouse')
 assert.equal(countVariants(),initialVariants,'Known-fact combination must not silently create a SKU')
 const pending=sql.prepare('SELECT status FROM inventory_reservations WHERE order_id=?').get(missing.body.orderId)
 assert.equal(pending?.status,'unresolved','New manual description must not silently reserve an invented SKU')
 const incomplete=await post(manual('qa-manual-incomplete',{material:''}))
 assert.equal(incomplete.status,400,'Direct HTTP cannot bypass required manual garment fields')
 assert.equal(countVariants(),initialVariants)
 const noColorSource=manual('qa-manual-no-color-not-guessed',{color:'БЕЗ ЦВЕТА',size:'БЕЗ РАЗМЕРА'})
 const noColorResult=await post(noColorSource)
 assert([200,201].includes(noColorResult.status),'Explicit no-color and no-size must be allowed')
 const noColorItem=sql.prepare('SELECT variant_id FROM order_items WHERE order_id=?').get(noColorResult.body.orderId)
 assert.equal(noColorItem.variant_id,null,'No-color must not select a beige SKU')
 assert.equal(countProducts(),1)
 assert.equal(countVariants(),initialVariants)
 console.log('MANUAL_ALL_SOURCE_HTTP_PASS: external-source SKU reused; new variation unresolved; no-color explicit; direct-HTTP required fields')
 console.log('EXACT_SIZE_HTTP_ORDER_PASS: persisted STANDARD, zero, no-size and safe incomplete Workshop tasks, no invented SKU or stock writes')
}finally{sql.close()}
