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
// Existing colorless/size-less SKU; it is active in the catalog but not listed
// in either physical source, so manual entry must recognize it without inventing one.
sql.prepare("INSERT INTO catalog_variants(id,product_id,stock_position_id,gender,color,material,length,size_label,category,is_active) VALUES(98514,98502,?,'ЖЕН','','КАШЕМИР','СТАНДАРТ','','adult',1)").run(executionId)
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
 assert.equal(noColorItem.variant_id,98514,
  'Explicit Без цвета + Без размера must identify existing global SKU even if absent from the selected source')
 const noColorStock=sql.prepare("SELECT quantity FROM inventory_stock WHERE inventory_source='warehouse' AND variant_id=98514").get()
 assert.equal(noColorStock?.quantity,0,'Matched source-absent no-color SKU must keep physical stock zero')
 assert.equal(countProducts(),1)
 assert.equal(countVariants(),initialVariants)
 // Full Workshop manual creation also uses read-only matching, but never reserves stock.
 const knownWorkshop=make(undefined,'СТАНДАРТ','qa-workshop-manual-complete')
 knownWorkshop.items[0]={...knownWorkshop.items[0],catalogVariantId:undefined,manualCatalogEntry:true,
  sourceType:'workshop',workshopComment:'Изготовить по образцу',shortageAcknowledged:false}
 const fullTask=await post(knownWorkshop)
 assert([200,201].includes(fullTask.status),'Complete Workshop task rejected '+JSON.stringify(fullTask.body))
 const workshopSku=sql.prepare("SELECT variant_id FROM workshop_tasks WHERE order_id=?").get(fullTask.body.orderId)
 assert.equal(workshopSku?.variant_id,98511,'Workshop task did not link exact existing SKU')
 const workshopReserves=sql.prepare('SELECT COUNT(*) AS n FROM inventory_reservations WHERE order_id=?').get(fullTask.body.orderId)
 assert.equal(Number(workshopReserves?.n),0,'Workshop exact SKU linkage may not reserve physical stock')
 const incompleteWorkshop=make(undefined,'СТАНДАРТ','qa-workshop-required-fields')
 incompleteWorkshop.items[0]={...incompleteWorkshop.items[0],catalogVariantId:undefined,
  manualCatalogEntry:true,sourceType:'workshop',material:'',shortageAcknowledged:false}
 const rejected=await post(incompleteWorkshop)
 assert.equal(rejected.status,400,'HTTP Workshop manual form must reject omitted material '+JSON.stringify(rejected.body))
 assert.equal(countVariants(),initialVariants)
 console.log('WORKSHOP_STRICT_HTTP_PASS: exact SKU linked without stock reservation; incomplete custom payload rejected')
 // Standard order creation without a pinned SKU must NOT silently mint a new
 // known-fact combination. Only explicit catalog/stocktake creation may do so.
 const normalUnseen=make(undefined,'54','qa-ordinary-unseen-no-auto-sku')
 normalUnseen.items[0]={...normalUnseen.items[0],catalogVariantId:undefined,manualCatalogEntry:false}
 const normalResult=await post(normalUnseen)
 assert([200,201].includes(normalResult.status),'Unknown normal order should stay an order, not fail on catalog mismatch '+JSON.stringify(normalResult.body))
 const unresolvedNormal=sql.prepare('SELECT product_id,variant_id,source_type FROM order_items WHERE order_id=?').get(normalResult.body.orderId)
 assert.equal(unresolvedNormal.product_id,98502)
 assert.equal(unresolvedNormal.variant_id,null,'Normal order created SKU instead of leaving unknown combo unresolved')
 assert.equal(countVariants(),initialVariants,'Normal known facts must not create new catalog variant')
 const noAutoReserve=sql.prepare('SELECT status FROM inventory_reservations WHERE order_id=?').get(normalResult.body.orderId)
 assert.equal(noAutoReserve?.status,'unresolved','Normal unknown combo may not get an invented-SKU stock reservation')

 // HTTP regression from Work final acceptance: mixed change of an existing
 // execution's size, a separate quantity/sale-price edit, and an added source
 // variant in one atomic update. Uses only disposable in-memory SQLite.
 for(const [id,size] of [[98521,'44'],[98522,'46'],[98523,'48'],[98524,'50'],[98525,'52'],[98526,'54'],[98527,'56']]){
  sql.prepare("INSERT INTO catalog_variants(id,product_id,stock_position_id,gender,color,material,length,size_label,category,is_active) VALUES(?,98502,?,'ЖЕН','БЕЖЕВЫЙ','КАШЕМИР','СТАНДАРТ',?,'adult',1)").run(id,executionId,size)
  sql.prepare("INSERT INTO inventory_stock(inventory_source,product_id,variant_id,product_name_snapshot,gender_snapshot,color_snapshot,material_snapshot,length_snapshot,size_snapshot,quantity,reserved_quantity) VALUES('boutique',98502,?,'QA SIZE PONCHO','ЖЕН','БЕЖЕВЫЙ','КАШЕМИР','СТАНДАРТ',?,20,0)").run(id,size)
 }
 const seed=make(98521,'44','qa-atomic-mixed-order-create')
 const prices=[22500,27500,25000,20000,25000,25000]
 const snapshots=[22500,27000,25000,20000,25000,25000]
 seed.items=[98521,98522,98523,98524,98525,98526].map((variantId,index)=>({
  ...seed.items[0],catalogVariantId:variantId,size:String(44+index*2),
  quantity:1,unitPrice:prices[index],catalogPriceSnapshot:snapshots[index]
 }))
 seed.payments=[{paymentDate:'2026-11-07',method:'НАЛИЧКА',amount:8000,paymentKind:'primary'}]
 const created=await post(seed)
 assert([200,201].includes(created.status),'Mixed edit base order creation rejected: '+JSON.stringify(created.body))
 const editOrderId=created.body.orderId
 assert(editOrderId>0)
 const detailRequest=new Request('https://test-only.invalid/api/orders/'+editOrderId,{
  method:'GET',headers:{Cookie:'orders_session='+token}
 })
 const detailResponse=await worker.fetch(detailRequest,{DB:db})
 assert.equal(detailResponse.status,200,'Expected full order detail to be readable before rewrite')
 const detail=(await detailResponse.json()).order
 assert.equal(detail.items.length,6)
 assert.equal(detail.total_amount,145000)
 assert.equal(detail.received_amount,8000)
 const expected=detail.items.map(row=>({
  orderItemId:Number(row.id),productName:row.productName,audienceType:row.audienceType,
  gender:row.gender,color:row.color,material:row.material||'СТАНДАРТ',
  length:row.length||'СТАНДАРТ',size:row.size,
  quantity:Number(row.quantity),unitPrice:Number(row.unitPrice),lineTotal:Number(row.lineTotal),
  catalogPriceSnapshot:row.catalogPriceSnapshot??null,
  sourceType:row.isWorkshop?'workshop':row.sourceType,
  workshopComment:row.workshopComment||null,workshopUrgent:Boolean(row.workshopUrgent),
  workshopDueDate:row.workshopDueDate||null,workshopDueTime:row.workshopDueTime||null
 }))
 const editItems=expected.map(row=>({
  ...row,unitPrice:row.unitPrice,
 }))
 editItems[0].quantity=2
 editItems[0].unitPrice=22600
 editItems[1].size='56'
 // The new SKU may suggest 29000, but the unchanged execution retains its
 // historical 27000 snapshot; the server deliberately rejects 29000.
 const unguarded=editItems.map(x=>({...x}))
 unguarded[1].catalogPriceSnapshot=29000
 const added={
  ...editItems[1],orderItemId:undefined,sourceType:'warehouse',size:'44',
  quantity:1,unitPrice:27500,catalogPriceSnapshot:27000,
  shortageAcknowledged:true
 }
 const patch=async(requestId,items)=>{
  const request=new Request('https://test-only.invalid/api/orders/'+editOrderId,{
   method:'PATCH',headers:{Cookie:'orders_session='+token,'Content-Type':'application/json','X-Idempotency-Key':requestId},
   body:JSON.stringify({
    requestId,orderDate:'2026-11-07',managerId,managerName:'QA Picker Manager',
    customerName:'QA Customer',city:'Алматы',deliveryType:'Самовывоз',
    paymentCorrections:[],
    itemContentReplacement:{expectedItems:expected,items},
   })
  })
  const response=await worker.fetch(request,{DB:db})
  return{status:response.status,body:await response.json()}
 }
 const rejectedSnapshot=await patch('qa-mixed-reject-snapshot', [...unguarded,added])
 assert.equal(rejectedSnapshot.status,409,'Server must reject overwritten historical execution snapshot '+JSON.stringify(rejectedSnapshot.body))
 assert.equal(Number(sql.prepare('SELECT COUNT(*) AS n FROM order_items WHERE order_id=?').get(editOrderId).n),6)
 assert.equal(Number(sql.prepare('SELECT total_amount FROM orders WHERE id=?').get(editOrderId).total_amount),145000)
 const corrected=await patch('qa-mixed-correct-historical-snapshot', [...editItems,added])
 assert([200,201].includes(corrected.status),'Mixed 6 -> 7 PATCH failed: '+JSON.stringify(corrected.body))
 const resultOrder=sql.prepare('SELECT total_amount,received_amount,debt_amount FROM orders WHERE id=?').get(editOrderId)
 assert.equal(resultOrder.total_amount,195200)
 assert.equal(resultOrder.received_amount,8000)
 assert.equal(resultOrder.debt_amount,187200)
 const saved=sql.prepare('SELECT size_snapshot,source_type,quantity,unit_price,catalog_price_snapshot,variant_id FROM order_items WHERE order_id=? ORDER BY id').all(editOrderId)
 assert.equal(saved.length,7,'One of the unchanged items was silently lost')
 assert(saved.some(row=>row.size_snapshot==='56'&&row.catalog_price_snapshot===27000&&row.unit_price===27500),'Replaced size lost historic execution snapshot')
 assert(saved.some(row=>row.size_snapshot==='44'&&row.quantity===2&&row.unit_price===22600),'Quantity/price correction lost')
 assert(saved.some(row=>row.size_snapshot==='44'&&row.source_type==='warehouse'&&row.catalog_price_snapshot===27000),'Added warehouse line lost')
 const editPaymentCount=Number(sql.prepare('SELECT COUNT(*) AS n FROM payments WHERE order_id=?').get(editOrderId).n)
 assert.equal(editPaymentCount,1,'Existing posted payment changed during mixed item edit')
 console.log('MIXED_ITEMIZED_HTTP_PATCH_PASS: rejected invalid snapshot atomically; accepted 6 to 7, total 195200, retained 8000 payment, correct source and historical snapshot')

 console.log('NORMAL_ORDER_READ_ONLY_CATALOG_PASS: exact already-known SKU or unresolved; never implicit catalog variant')
 console.log('MANUAL_ALL_SOURCE_HTTP_PASS: external-source SKU reused; new variation unresolved; no-color explicit; direct-HTTP required fields')
 console.log('EXACT_SIZE_HTTP_ORDER_PASS: persisted STANDARD, zero, no-size and safe incomplete Workshop tasks, no invented SKU or stock writes')
}finally{sql.close()}
