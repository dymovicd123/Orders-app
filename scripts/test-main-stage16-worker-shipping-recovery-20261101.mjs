// Real production Worker.fetch + exact Main SQL migrations, isolated SQLite only.
// Tests the server HTTP context and the actual client resolver decision together.
import assert from 'node:assert/strict'
import {readdirSync,readFileSync} from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import path from 'node:path'
import worker from '../worker/index.ts'

const sqlite=new DatabaseSync(':memory:')
sqlite.exec('PRAGMA foreign_keys=ON')
const migrations=readdirSync('migrations').filter(x=>/^\d+.*\.sql$/.test(x)).sort()
assert(migrations.length>=110)
for(const file of migrations)sqlite.exec(readFileSync(path.join('migrations',file),'utf8'))
// Existing known Main schema gap; test-only compatibility, never applied to Main D1.
if(!sqlite.prepare("SELECT 1 FROM pragma_table_info('orders') WHERE name='manager_snapshot_name'").get())
 sqlite.exec('ALTER TABLE orders ADD COLUMN manager_snapshot_name TEXT')
if(!sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='order_manager_audit'").get())
 sqlite.exec(`CREATE TABLE order_manager_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL, external_id TEXT,
  previous_manager_id INTEGER, previous_manager_name TEXT, new_manager_id INTEGER,
  new_manager_name TEXT, action TEXT, source TEXT, actor_role TEXT, actor_label TEXT,
  details TEXT, created_at TEXT
 )`) // #648 fresh-schema gap: TEST ONLY, never applied to active D1

let stolenLeaseBeforeOrderBatch = ''
let stolenLeaseBeforeItemBatch = ''
let failEditCompletionOnce = ''
let failEditActivityBatchOnce = ''
function prepared(sql,params=[]){
 const st=sqlite.prepare(sql)
 return {
  sqlText:sql,
  bind(...args){return prepared(sql,args)},
  async first(key){const row=st.get(...params)??null;return typeof key==='string'?row?.[key]??null:row},
  async all(){return {success:true,results:st.all(...params)}},
  async run(){
    if(failEditCompletionOnce && sql.includes("SET status = 'completed'") && params[3]===failEditCompletionOnce){
     failEditCompletionOnce=''
     throw new Error('injected lost-response before edit finalization')
    }
    const out=st.columns().length?{changes:0,lastInsertRowid:0}:st.run(...params);return{success:true,meta:{changes:out.changes||0,last_row_id:Number(out.lastInsertRowid||0)}}},
 }
}
const DB={
 prepare:sql=>prepared(sql),
 async batch(statements){
  // Inject a stolen lease immediately before the real order-header D1 batch.
  if(stolenLeaseBeforeOrderBatch && statements.some(stmt=>stmt.sqlText?.includes('INSERT INTO orders ('))
    && statements.some(stmt=>stmt.sqlText?.includes('UPDATE critical_operations'))){
   const requestId=stolenLeaseBeforeOrderBatch
   stolenLeaseBeforeOrderBatch=''
   const stolen=sqlite.prepare("UPDATE critical_operations SET lease_token=?, lease_until_ms=? WHERE request_id=? AND status='started' AND step='validated'")
     .run('another-request-owns-the-lease',Date.now()+90000,requestId)
   assert.equal(stolen.changes,1,'Fault injection must steal precisely the validated request lease')
  }
  if(stolenLeaseBeforeItemBatch && statements.some(stmt=>stmt.sqlText?.includes('INSERT INTO order_items ('))
    && statements.some(stmt=>stmt.sqlText?.includes('INSERT INTO critical_operation_entities'))){
   const requestId=stolenLeaseBeforeItemBatch
   stolenLeaseBeforeItemBatch=''
   const stolen=sqlite.prepare("UPDATE critical_operations SET lease_token=?, lease_until_ms=? WHERE request_id=? AND status='started' AND step='order_created'")
     .run('another-request-owns-item-lease',Date.now()+90000,requestId)
   assert.equal(stolen.changes,1,'Fault injection must steal the current item-stage lease')
  }
  if(failEditActivityBatchOnce && statements.some(stmt=>stmt.sqlText?.includes('INSERT INTO activity_log ('))){
   const requestId=failEditActivityBatchOnce
   failEditActivityBatchOnce=''
   const state=sqlite.prepare("SELECT step,status FROM critical_operations WHERE request_id=?").get(requestId)
   assert.equal(state?.step,'shipping_committed','Audit injection must run after business edit')
   assert.equal(state?.status,'started','Audit injection must run before completion')
   throw new Error('injected temporary failure between manager and activity evidence')
  }
  sqlite.exec('SAVEPOINT resolver_http')
  try {const r=[];for(const stmt of statements)r.push(await stmt.run());sqlite.exec('RELEASE resolver_http');return r}
  catch(e){sqlite.exec('ROLLBACK TO SAVEPOINT resolver_http');sqlite.exec('RELEASE resolver_http');throw e}
 },
 async exec(sql){sqlite.exec(sql);return{count:1,duration:0}},
}
const env={DB,ADMIN_MODE_LOGIN:'admin',ADMIN_MODE_PASSWORD:'synthetic-resolver-password-2026'}
let cookie=''
async function api(route,method='GET',body,expected=200){
 const res=await worker.fetch(new Request('https://local-only.invalid'+route,{
  method,headers:{...(cookie?{cookie}:{}),...(body?{'content-type':'application/json'}:{})},
  ...(body?{body:JSON.stringify(body)}:{})
 }),env)
 const data=await res.json()
 assert.equal(res.status,expected,method+' '+route+': '+JSON.stringify(data))
 return {res,data}
}
try{
 await api('/api/orders?limit=1','GET',undefined,401)
 const setup=await api('/api/auth/setup','POST',{
  login:'resolver-admin',password:'synthetic-actor-password-2026',
  bootstrapLogin:'admin',bootstrapPassword:env.ADMIN_MODE_PASSWORD,
  displayName:'Resolver test only'
 },201)
 cookie=(setup.res.headers.get('set-cookie')||'').split(';')[0]
 assert(cookie.startsWith('orders_session='))

 const name='STAGE1 MAIN RESERVATION HTTP'
 const product=await api('/api/catalog/products','POST',{name,category:'adult',genderScope:'female'},201)
 const productId=Number(product.data.id)
 const variant=await api('/api/catalog/variants','POST',{
  productId,category:'adult',gender:'ЖЕН',color:'ЧЕРНЫЙ',
  material:'СТАНДАРТ',length:'СТАНДАРТ',sizeLabel:'46'
 },201)
 const variantId=Number(variant.data.id)
 assert(variantId>0)
 const manager=sqlite.prepare('SELECT id FROM managers WHERE is_active=1 ORDER BY id LIMIT 1').get()
 assert(manager?.id>0)
 const payload=(suffix)=>({
  requestId:'main-atomic-recovery-'+suffix+'-20261031',
  orderDate:'2026-10-31',managerId:manager.id,
  customerPhone:'77019990000',city:'АЛМАТЫ',pricingMode:'itemized_v1',
  workshopStatus:'ready',orderStatus:'active',
  items:[{productName:name,audienceType:'ВЗРОСЛЫЙ',gender:'ЖЕН',
   color:'ЧЕРНЫЙ',material:'СТАНДАРТ',length:'СТАНДАРТ',size:'46',
   sourceType:'warehouse',quantity:1,unitPrice:10000,catalogPriceSnapshot:null}],
  payments:[],
 })
 const booking=(id)=>sqlite.prepare(
  'SELECT r.status,r.unresolved_reason,r.quantity,r.variant_id,r.inventory_source,oi.stock_writeoff_status FROM order_items oi JOIN inventory_reservations r ON r.order_item_id=oi.id WHERE oi.order_id=?'
 ).get(id)
 const stock=()=>sqlite.prepare(
  "SELECT quantity,reserved_quantity FROM inventory_stock WHERE inventory_source='warehouse' AND variant_id=?"
 ).get(variantId)
 const first=await api('/api/orders','POST',payload('one'),201)
 const firstId=Number(first.data.orderId)
 assert(firstId>0)
 assert.deepEqual([booking(firstId).status,booking(firstId).unresolved_reason,booking(firstId).stock_writeoff_status],
  ['unresolved','concurrent_shortage','pending_reservation'],'Out-of-stock order must persist without confirmation and without phantom active hold')
 assert.deepEqual({...stock()},{quantity:0,reserved_quantity:0})
 const pendingSend=await api('/api/orders/'+firstId+'/shipping','PATCH',{shippingStatus:'sent'},409)
 assert.equal(pendingSend.data.code,'inventory_reservation_pending')
 assert.deepEqual({...stock()},{quantity:0,reserved_quantity:0})
 assert.equal(booking(firstId).status,'unresolved')
 const firstReplay=await worker.fetch(new Request('https://local-only.invalid/api/orders',{
  method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify(payload('one'))
 }),env)
 assert([200,201].includes(firstReplay.status),'Retry must return existing order, not create another: '+firstReplay.status+' '+await firstReplay.text())
 assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM orders WHERE id=?').get(firstId).n,1)
 assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM inventory_reservations WHERE order_id=?').get(firstId).n,1)
 assert.deepEqual({...stock()},{quantity:0,reserved_quantity:0})
 // Initial synthetic fixture now has one real piece. Subsequent admissions
 // exercise the REAL HTTP create handler, not direct helper calls.
 sqlite.prepare("UPDATE inventory_stock SET quantity=1 WHERE inventory_source='warehouse' AND variant_id=?").run(variantId)
 const previousItem=sqlite.prepare('SELECT id FROM order_items WHERE order_id=?').get(firstId).id
 const previousReservation=sqlite.prepare('SELECT id FROM inventory_reservations WHERE order_id=?').get(firstId).id
 const fulfilled=await api('/api/orders/'+firstId+'/shipping','PATCH',{shippingStatus:'sent'},200)
 assert.equal(fulfilled.data.ok,true)
 assert.equal(booking(firstId).status,'fulfilled','Shipping should readmit pending then fulfil')
 assert.equal(sqlite.prepare('SELECT id FROM order_items WHERE order_id=?').get(firstId).id,previousItem)
 assert.equal(sqlite.prepare('SELECT id FROM inventory_reservations WHERE order_id=?').get(firstId).id,previousReservation)
 assert.equal(Number(stock().quantity),0)
 assert.equal(Number(stock().reserved_quantity),0)
 const shippingReplay=await api('/api/orders/'+firstId+'/shipping','PATCH',{shippingStatus:'sent'},200)
 assert.equal(shippingReplay.data.alreadySent,true,'replay cannot double fulfil')
 sqlite.prepare("UPDATE inventory_stock SET quantity=1 WHERE inventory_source='warehouse' AND variant_id=?").run(variantId)
 const second=await api('/api/orders','POST',payload('two'),201)
 const secondId=Number(second.data.orderId)
 assert.equal(booking(secondId).status,'active','First available last piece is reserved')
 const third=await api('/api/orders','POST',payload('three'),201)
 const thirdId=Number(third.data.orderId)
 assert.equal(booking(thirdId).status,'unresolved','Second customer is pending, never over-booked')
 assert.equal(booking(thirdId).stock_writeoff_status,'pending_reservation')
 assert.deepEqual({...stock()},{quantity:1,reserved_quantity:1})
 assert.equal(sqlite.prepare(
  "SELECT COUNT(*) AS n FROM inventory_reservations WHERE inventory_source='warehouse' AND variant_id=? AND status='active'"
 ).get(variantId).n,1)
 assert.equal(sqlite.prepare(
  "SELECT COUNT(*) AS n FROM inventory_reservations WHERE inventory_source='warehouse' AND variant_id=? AND status='unresolved'"
 ).get(variantId).n,1,'First pending was fulfilled; only the later shortage remains')
 // Exactly one physical shipment was made; order creation itself is not a movement.
 const beforeShipmentCount=sqlite.prepare('SELECT COUNT(*) AS n FROM inventory_movements').get().n
 const thirdItem=sqlite.prepare('SELECT id FROM order_items WHERE order_id=?').get(thirdId).id
 const thirdReserve=sqlite.prepare('SELECT id FROM inventory_reservations WHERE order_id=?').get(thirdId).id
 sqlite.prepare("UPDATE inventory_stock SET quantity=2 WHERE inventory_source='warehouse' AND variant_id=?").run(variantId)
 const thirdSent=await api('/api/orders/'+thirdId+'/shipping','PATCH',{shippingStatus:'sent'},200)
 assert.equal(thirdSent.data.ok,true)
 assert.equal(booking(thirdId).status,'fulfilled','Second pending order must recover on arrival')
 assert.equal(sqlite.prepare('SELECT id FROM order_items WHERE order_id=?').get(thirdId).id,thirdItem)
 assert.equal(sqlite.prepare('SELECT id FROM inventory_reservations WHERE order_id=?').get(thirdId).id,thirdReserve)
 assert.deepEqual({...stock()},{quantity:1,reserved_quantity:1},'other order hold must remain intact')
 assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM inventory_movements').get().n,beforeShipmentCount+1)
 const duplicateShip=await api('/api/orders/'+thirdId+'/shipping','PATCH',{shippingStatus:'sent'},200)
 assert.equal(duplicateShip.data.alreadySent,true)
 assert.deepEqual({...stock()},{quantity:1,reserved_quantity:1})

 // P0 #653: a request that loses its lease before header INSERT must never
 // create an unmapped order or a reservation, even when SQL batches commit.
 const stolenPayload=payload('stolen-lease-before-header')
 const beforeStaleOrders=sqlite.prepare('SELECT COUNT(*) AS n FROM orders').get().n
 const beforeStaleItems=sqlite.prepare('SELECT COUNT(*) AS n FROM order_items').get().n
 const beforeStaleReserves=sqlite.prepare('SELECT COUNT(*) AS n FROM inventory_reservations').get().n
 stolenLeaseBeforeOrderBatch=stolenPayload.requestId
 const blocked=await api('/api/orders','POST',stolenPayload,409)
 assert.equal(blocked.data.code,'critical_operation_busy')
 assert.equal(stolenLeaseBeforeOrderBatch,'','Order-header fault injection was not executed')
 assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM orders').get().n,beforeStaleOrders,'Stolen lease must not commit an orphan order header')
 assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM order_items').get().n,beforeStaleItems,'Stolen lease must not create order lines')
 assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM inventory_reservations').get().n,beforeStaleReserves,'Stolen lease must not claim stock')
 const stolenRecord=sqlite.prepare('SELECT target_id,step,lease_token FROM critical_operations WHERE request_id=?').get(stolenPayload.requestId)
 assert.equal(stolenRecord.target_id,null,'No target may be mapped to the stolen lease')
 assert.equal(stolenRecord.step,'validated','Stolen lease must not advance the operation')
 assert.equal(stolenRecord.lease_token,'another-request-owns-the-lease')

 // #653 follow-up: an order header may be validly committed when its
 // owner loses the lease during a later item insert. Never create an unmapped
 // order item or make a phantom physical/reserved movement.
 const itemPayload=payload('stolen-lease-before-item')
 const beforeItemRows=sqlite.prepare('SELECT COUNT(*) AS n FROM order_items').get().n
 const beforeItemReservations=sqlite.prepare('SELECT COUNT(*) AS n FROM inventory_reservations').get().n
 const beforeItemOrders=sqlite.prepare('SELECT COUNT(*) AS n FROM orders').get().n
 stolenLeaseBeforeItemBatch=itemPayload.requestId
 const blockedItem=await api('/api/orders','POST',itemPayload,409)
 assert.equal(blockedItem.data.code,'critical_operation_busy')
 assert.equal(stolenLeaseBeforeItemBatch,'','Order-item fault injection was not executed')
 const partial=sqlite.prepare('SELECT target_id,step,lease_token FROM critical_operations WHERE request_id=?').get(itemPayload.requestId)
 assert(partial?.target_id>0,'Prior header remains mapped to recoverable critical operation')
 assert.equal(partial.step,'order_created')
 assert.equal(partial.lease_token,'another-request-owns-item-lease')
 assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM orders').get().n,beforeItemOrders+1,'One safely mapped incomplete header is allowed')
 assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM order_items').get().n,beforeItemRows,'Stolen lease must not produce an unmapped order item')
 assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM inventory_reservations').get().n,beforeItemReservations,'Stolen lease cannot reserve inventory')
 assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM order_items WHERE order_id=?').get(partial.target_id).n,0)

 // #651: HTTP edit with lost completion response, after durable activity.
 const editBefore=(await api('/api/orders/'+secondId)).data.order
 const expectedMeta={
  orderDate:String(editBefore.order_date||''),customerPhone:String(editBefore.customer_phone||''),
  customerName:String(editBefore.customer_name||''),city:String(editBefore.city||''),
  deliveryType:String(editBefore.delivery_type||''),comment:String(editBefore.comment||''),
 }
 const editRequestId='qa-edit-activity-before-complete-20261109'
 const metadataPatch={requestId:editRequestId,metadataCorrection:{
  expected:expectedMeta,next:{...expectedMeta,comment:'EVIDENCE-REPLAY'},
  expectedState:{totalAmount:Number(editBefore.total_amount),receivedAmount:Number(editBefore.received_amount),
   debtAmount:Number(editBefore.debt_amount),returnAmount:Number(editBefore.return_amount||0),
   shippingStatus:String(editBefore.shipping_status),orderStatus:String(editBefore.order_status)},
 }}
 const activityCount=()=>sqlite.prepare("SELECT COUNT(*) AS n FROM activity_log WHERE event_type='order_updated' AND order_id=?").get(secondId).n
 const previousActivityCount=activityCount()
 const previousReserveId=sqlite.prepare('SELECT id FROM inventory_reservations WHERE order_id=?').get(secondId).id
 failEditCompletionOnce=editRequestId
 await api('/api/orders/'+secondId,'PATCH',metadataPatch,409)
 assert.equal(failEditCompletionOnce,'','Completion fault injection did not fire')
 assert.equal(sqlite.prepare('SELECT comment FROM orders WHERE id=?').get(secondId).comment,'EVIDENCE-REPLAY')
 assert.equal(activityCount(),previousActivityCount+1,'Activity must be durable before edit completion')
 const pendingEdit=sqlite.prepare('SELECT step,status FROM critical_operations WHERE request_id=?').get(editRequestId)
 assert.deepEqual({...pendingEdit},{step:'shipping_committed',status:'started'})
 assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM critical_operation_entities WHERE request_id=? AND entity_type='activity_log' AND entity_key='order_updated'").get(editRequestId).n,1)
 await api('/api/orders/'+secondId,'PATCH',metadataPatch,200)
 await api('/api/orders/'+secondId,'PATCH',metadataPatch,200)
 assert.equal(activityCount(),previousActivityCount+1,'Retry must not duplicate order activity')
 assert.equal(sqlite.prepare('SELECT id FROM inventory_reservations WHERE order_id=?').get(secondId).id,previousReserveId)
 assert.equal(sqlite.prepare('SELECT status FROM critical_operations WHERE request_id=?').get(editRequestId).status,'completed')

 // One manager-audit row commits, then activity temporarily fails.
 // Replaying the same requestId creates only the missing activity row.
 const anotherManager=sqlite.prepare('SELECT id,name FROM managers WHERE is_active=1 AND id<>? ORDER BY id LIMIT 1').get(manager.id)
 assert(anotherManager?.id>0,'Another seeded manager is required for reassignment')
 const managerEditId='qa-manager-changed-evidence-20261109'
 const managerChange={requestId:managerEditId,managerId:anotherManager.id,managerName:anotherManager.name}
 const managerAuditCount=()=>sqlite.prepare("SELECT COUNT(*) AS n FROM order_manager_audit WHERE order_id=? AND action='changed' AND source='admin_order_edit'").get(secondId).n
 const priorManagerAudit=managerAuditCount(),priorChangedActivity=activityCount()
 const preManagerStock={...stock()}
 const preManagerMovementCount=sqlite.prepare('SELECT COUNT(*) AS n FROM inventory_movements').get().n
 failEditActivityBatchOnce=managerEditId
 await api('/api/orders/'+secondId,'PATCH',managerChange,409)
 assert.equal(failEditActivityBatchOnce,'','Activity fault injection did not fire')
 assert.equal(sqlite.prepare('SELECT manager_id FROM orders WHERE id=?').get(secondId).manager_id,anotherManager.id)
 assert.equal(managerAuditCount(),priorManagerAudit+1,'Manager audit must persist before activity')
 assert.equal(activityCount(),priorChangedActivity,'Activity must not be claimed before it commits')
 await api('/api/orders/'+secondId,'PATCH',managerChange,200)
 await api('/api/orders/'+secondId,'PATCH',managerChange,200)
 assert.equal(managerAuditCount(),priorManagerAudit+1,'Manager reassignment audit must be once-only')
 assert.equal(activityCount(),priorChangedActivity+1,'Replay must restore activity once')
 assert.equal(sqlite.prepare('SELECT status FROM critical_operations WHERE request_id=?').get(managerEditId).status,'completed')
 assert.deepEqual({...stock()},preManagerStock,'Manager edit must not change stock')
 assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM inventory_movements').get().n,preManagerMovementCount)
 assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM critical_operation_entities WHERE request_id=? AND entity_type IN ('order_manager_audit','activity_log')").get(managerEditId).n,2)

 console.log('MAIN_STAGE16_PENDING_RECOVERY_REAL_WORKER_HTTP_PASS',JSON.stringify({
  firstPending:firstId,firstActive:secondId,secondPending:thirdId,
  variantId,physical:stock().quantity,activeReserved:stock().reserved_quantity
 }))
}finally{sqlite.close()}
