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

function prepared(sql,params=[]){
 const st=sqlite.prepare(sql)
 return {
  bind(...args){return prepared(sql,args)},
  async first(key){const row=st.get(...params)??null;return typeof key==='string'?row?.[key]??null:row},
  async all(){return {success:true,results:st.all(...params)}},
  async run(){const out=st.columns().length?{changes:0,lastInsertRowid:0}:st.run(...params);return{success:true,meta:{changes:out.changes||0,last_row_id:Number(out.lastInsertRowid||0)}}},
 }
}
const DB={
 prepare:sql=>prepared(sql),
 async batch(statements){
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

 console.log('MAIN_STAGE16_PENDING_RECOVERY_REAL_WORKER_HTTP_PASS',JSON.stringify({
  firstPending:firstId,firstActive:secondId,secondPending:thirdId,
  variantId,physical:stock().quantity,activeReserved:stock().reserved_quantity
 }))
}finally{sqlite.close()}
