// Real production Worker.fetch + exact Main SQL migrations, isolated SQLite only.
// Tests the server HTTP context and the actual client resolver decision together.
import assert from 'node:assert/strict'
import {readdirSync,readFileSync} from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import path from 'node:path'
import worker from '../worker/index.ts'
import {initialDraft,nextQuestion} from '../src/features/orders/catalogResolutionFlow.ts'

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
 const name='RESOLVER EXISTING SKU HTTP'
 const product=await api('/api/catalog/products','POST',{name,category:'adult',genderScope:'female'},201)
 const productId=Number(product.data.id)
 const variant=await api('/api/catalog/variants','POST',{
  productId,category:'adult',gender:'ЖЕН',color:'ЧЕРНЫЙ',
  material:'СТАНДАРТ',length:'СТАНДАРТ',sizeLabel:'46'
 },201)
 const variantId=Number(variant.data.id)
 assert(variantId>0)
 const manager=sqlite.prepare('SELECT id FROM managers WHERE is_active=1 ORDER BY id LIMIT 1').get()
 assert(manager?.id>0,'Main test fixture requires an active seeded manager')
 const payload={
  requestId:'resolver-http-order-20261031',orderDate:'2026-10-31',managerId:manager.id,
  customerPhone:'77019990000',city:'АЛМАТЫ',pricingMode:'itemized_v1',
  workshopStatus:'ready',orderStatus:'active',
  items:[{productName:name,audienceType:'ВЗРОСЛЫЙ',gender:'ЖЕН',
   color:'ЧЕРНЫЙ',material:'СТАНДАРТ',length:'СТАНДАРТ',size:'46',
   sourceType:'warehouse',quantity:1,unitPrice:10000,catalogPriceSnapshot:null}],
  payments:[],
 }
 const order=await api('/api/orders','POST',payload,201)
 const orderId=Number(order.data.orderId)
 const line=sqlite.prepare('SELECT id,variant_id,product_id FROM order_items WHERE order_id=?').get(orderId)
 assert.equal(Number(line.variant_id),variantId,'Worker must retain canonical linked SKU in new order')
 assert.equal(Number(line.product_id),productId)
 // Legacy order snapshot has incomplete facts even though canonical SKU is proven.
 sqlite.prepare("UPDATE order_items SET color_snapshot='',size_snapshot='' WHERE id=?").run(line.id)
 const {data:ctx}=await api('/api/orders/'+orderId+'/catalog-review/'+line.id+'/context')
 assert.equal(Number(ctx.exactVariant?.id),variantId,'HTTP context must return exact active linked variant')
 assert.equal(ctx.facts.color,'ЧЕРНЫЙ','HTTP context must recover catalog color')
 assert.equal(ctx.facts.size,'46','HTTP context must recover catalog size')
 const d=initialDraft({productName:name,variantId,color:'',size:''},ctx)
 assert.equal(d.color,'ЧЕРНЫЙ')
 assert.equal(d.size,'46')
 const answer=nextQuestion(ctx,d,{remainder:'',classified:false,confirmed:{},legacy:false,editing:null})
 assert.equal(answer.kind,'ready','Known reference/variant ID must not ask for duplicate fields')
 assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM catalog_variants WHERE product_id=?').get(productId).n,1)
 assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM inventory_movements').get().n,0,'Resolver context must not mutate physical stock')
 // Task 1.5: reproduce interrupted old order reservation, then exercise the
 // REAL shipping API recovery and persisted SQLite records. No fake physical receipt.
 const starting=sqlite.prepare('SELECT id,status,variant_id,quantity FROM inventory_reservations WHERE order_item_id=?').all(line.id)
 assert.equal(starting.length,1)
 assert.equal(starting[0].status,'active')
 assert.equal(Number(starting[0].variant_id),variantId)
 const physicalBefore=sqlite.prepare("SELECT quantity FROM inventory_stock WHERE inventory_source='warehouse' AND variant_id=?").get(variantId)?.quantity
 assert.equal(physicalBefore,0,'Synthetic test starts with no physical stock')
 sqlite.prepare('DELETE FROM inventory_reservations WHERE order_item_id=?').run(line.id)
 sqlite.prepare("UPDATE inventory_stock SET reserved_quantity=0 WHERE inventory_source='warehouse' AND variant_id=?").run(variantId)
 sqlite.prepare("UPDATE order_items SET stock_writeoff_status='pending_reservation' WHERE id=?").run(line.id)
 const firstShipping=await api('/api/orders/'+orderId+'/shipping','PATCH',{shippingStatus:'sent'},409)
 assert.notEqual(firstShipping.data.code,'catalog_review_required','A known SKU must not be sent to a redundant resolver')
 assert.notEqual(firstShipping.data.code,'inventory_reservation_inconsistent','Known pending SKU should be recovered')
 const recovered=sqlite.prepare('SELECT status,quantity,variant_id,inventory_source FROM inventory_reservations WHERE order_item_id=?').all(line.id)
 assert.equal(recovered.length,1,'Exactly one repaired reservation is persisted')
 assert.deepEqual([recovered[0].status,recovered[0].quantity,recovered[0].variant_id,recovered[0].inventory_source],
  ['active',1,variantId,'warehouse'])
 const stockAfter=sqlite.prepare("SELECT quantity,reserved_quantity FROM inventory_stock WHERE inventory_source='warehouse' AND variant_id=?").get(variantId)
 assert.equal(stockAfter.quantity,0,'Reservation recovery must not invent an arrival')
 assert.equal(stockAfter.reserved_quantity,1)
 assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM inventory_movements').get().n,0)
 const retry=await api('/api/orders/'+orderId+'/shipping','PATCH',{shippingStatus:'sent'},409)
 assert.notEqual(retry.data.code,'catalog_review_required')
 assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM inventory_reservations WHERE order_item_id=?').get(line.id).n,1)
 assert.equal(sqlite.prepare("SELECT reserved_quantity FROM inventory_stock WHERE inventory_source='warehouse' AND variant_id=?").get(variantId).reserved_quantity,1,'Retried shipping must not double-reserve')
 assert.equal(sqlite.prepare('SELECT shipping_status FROM orders WHERE id=?').get(orderId).shipping_status,'not_sent')
 // A historical closed row is NOT the missing-reservation scenario. Fail safely,
 // keep the old record immutable, and never turn it active to make shipping pass.
 for(const historicalStatus of ['released','fulfilled']){
  sqlite.prepare('UPDATE inventory_reservations SET status=? WHERE order_item_id=?').run(historicalStatus,line.id)
  sqlite.prepare("UPDATE inventory_stock SET reserved_quantity=0 WHERE inventory_source='warehouse' AND variant_id=?").run(variantId)
  sqlite.prepare("UPDATE order_items SET stock_writeoff_status='pending_reservation' WHERE id=?").run(line.id)
  const historical=await api('/api/orders/'+orderId+'/shipping','PATCH',{shippingStatus:'sent'},409)
  assert.equal(historical.data.code,'inventory_reservation_inconsistent','Historical '+historicalStatus+' is not an active reservation')
  assert.equal(sqlite.prepare('SELECT status FROM inventory_reservations WHERE order_item_id=?').get(line.id).status,historicalStatus)
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM inventory_reservations WHERE order_item_id=?').get(line.id).n,1)
  assert.equal(sqlite.prepare("SELECT quantity FROM inventory_stock WHERE inventory_source='warehouse' AND variant_id=?").get(variantId).quantity,0)
 }
 console.log('MAIN_RESOLVER_PENDING_KNOWN_SHIPPING_HTTP_PASS: repaired pending exact SKU, replay dedupe, immutable released/fulfilled, physical zero')
 console.log('MAIN_RESOLVER_REAL_WORKER_HTTP_EXISTING_SKU_PASS',JSON.stringify({orderId,itemId:line.id,variantId,color:d.color,size:d.size,nextQuestion:answer.kind,physicalMovements:0}))
} finally {sqlite.close()}
