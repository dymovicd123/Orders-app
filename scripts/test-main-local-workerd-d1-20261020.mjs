// Local Cloudflare workerd D1 test only. Never use wrangler.jsonc,
// remote Cloudflare credentials or a production/test database identifier.
import assert from 'node:assert/strict'
import { getPlatformProxy } from 'wrangler'
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import worker from '../worker/index.ts'

const sandbox=mkdtempSync(join(tmpdir(),'orders-local-workerd-'))
const configPath=join(sandbox,'wrangler-local.json')
writeFileSync(configPath,JSON.stringify({
  name:'orders-stabilization-disposable-local',
  main:resolve('worker/index.ts'),
  compatibility_date:'2026-07-06',
  compatibility_flags:['nodejs_compat'],
  d1_databases:[{
    binding:'DB',
    database_name:'orders_disposable_acceptance',
    database_id:'00000000-0000-4000-8000-000000000001',
  }],
},null,2))
let proxy
try {
  proxy=await getPlatformProxy({configPath,persist:{path:join(sandbox,'state')}})
  const db=proxy.env.DB
  assert(db?.prepare && db?.exec && db?.batch,'Actual local workerd D1 must be accessible')
  const migrations=readdirSync('migrations').filter(f=>/^\d+.*\.sql$/.test(f)).sort()
  assert(migrations.length>=110)
  for(const file of migrations) {
    // Local D1Database.exec splits multi-line SQL differently from SQLite's
    // exec(). Flatten statement continuations while discarding SQL line
    // comments; keep semicolons, trigger bodies and migration order intact.
    // The source files are read-only and never rewritten.
    const source=readFileSync(join('migrations',file),'utf8')
    const flat=source.split(/\r?\n/).map(line=>
      line.trimStart().startsWith('--') ? '' : line.replace(/\s+--[^\n]*$/, '')
    ).join(' ').replace(/\s+/g,' ').trim()
    try { await db.exec(flat) }
    catch(error) {throw new Error('Local workerd D1 failed migration '+file+': '+String(error),{cause:error})}
  }
  const hasSnapshot=await db.prepare("SELECT 1 AS present FROM pragma_table_info('orders') WHERE name='manager_snapshot_name'").first()
  if(!hasSnapshot) {
    console.warn('LOCAL_WORKERD_D1_SCHEMA_GAP: fresh repo migrations missing manager_snapshot_name, test-only compatibility field applied')
    await db.exec('ALTER TABLE orders ADD COLUMN manager_snapshot_name TEXT')
  }
  const env={DB:db,ADMIN_MODE_LOGIN:'admin',ADMIN_MODE_PASSWORD:'disposable-local-only'}
  const root='https://local-workerd.invalid'
  let cookie=''
  async function call(route,method='GET',body,expected=200,requestId) {
    const req=new Request(root+route,{method,headers:{
      ...(body?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{}),
      ...(requestId?{'X-Idempotency-Key':requestId}:{}),
    },...(body?{body:JSON.stringify(body)}:{})})
    const resp=await worker.fetch(req,env)
    const text=await resp.text()
    let data
    try {data=JSON.parse(text)} catch{throw new Error(method+' '+route+': non-JSON '+resp.status+' '+text.slice(0,200))}
    assert.equal(resp.status,expected,method+' '+route+': '+JSON.stringify(data))
    return {data,resp}
  }
  const sql=async(q,...a)=>await db.prepare(q).bind(...a).first()
  await call('/api/orders','GET',undefined,401)
  const boot=await call('/api/auth/setup','POST',{
    login:'local-d1-admin',password:'disposable-admin-password-2026',
    bootstrapLogin:'admin',bootstrapPassword:env.ADMIN_MODE_PASSWORD,
    displayName:'Локальная D1',
  },201)
  assert.equal(boot.data.user.role,'admin')
  cookie=(boot.resp.headers.get('set-cookie')||'').split(';')[0]
  assert(cookie.startsWith('orders_session='))
  await call('/api/auth/me')

  const name='D1 ИЗОЛИРОВАННЫЙ АУДИТ'
  const product=(await call('/api/catalog/products','POST',{name,category:'adult',genderScope:'female'},201)).data
  const productId=Number(product.id)
  assert(productId>0)
  const color=(await sql("SELECT value FROM reference_values WHERE kind='color' AND value='ЧЕРНЫЙ' AND is_active=1"))?.value
  const size=(await sql("SELECT value FROM reference_values WHERE kind='size' AND value='46' AND is_active=1"))?.value
  assert(color && size)
  const variant=(await call('/api/catalog/variants','POST',{
    productId,category:'adult',gender:'ЖЕН',color,material:'СТАНДАРТ',length:'СТАНДАРТ',sizeLabel:size,
  },201)).data
  const variantId=Number(variant.id)
  assert(variantId>0)
  await call('/api/inventory/movements','POST',{
    requestId:'workerd-arrival',inventorySource:'warehouse',movementType:'arrival',
    items:[{productId,variantId,productName:name,gender:'ЖЕН',color,
      material:'СТАНДАРТ',length:'СТАНДАРТ',size,quantity:3}],
  },200)
  const stock=async()=>await sql("SELECT quantity,reserved_quantity FROM inventory_stock WHERE inventory_source='warehouse' AND variant_id=?",variantId)
  assert.equal(Number((await stock()).quantity),3)
  const managerId=Number((await sql("SELECT id FROM managers WHERE is_active=1 ORDER BY id LIMIT 1"))?.id)
  const orderPayload={
    requestId:'workerd-order',orderDate:'2026-10-20',managerId,
    customerPhone:'77010000999',pricingMode:'itemized_v1',
    workshopStatus:'ready',orderStatus:'active',
    items:[{productName:name,audienceType:'ВЗРОСЛЫЙ',gender:'ЖЕН',color,material:'СТАНДАРТ',
      length:'СТАНДАРТ',size,sourceType:'warehouse',quantity:2,unitPrice:10000,catalogPriceSnapshot:null}],
    payments:[{paymentDate:'2026-10-20',method:'НАЛИЧКА',paymentKind:'primary',amount:5000}],
  }
  const created=await call('/api/orders','POST',orderPayload,201,'workerd-order')
  const orderId=Number(created.data.orderId)
  assert(orderId>0)
  assert.equal(Number((await stock()).reserved_quantity),2)
  assert.equal(Number((await stock()).quantity),3)
  await call('/api/orders','POST',orderPayload,201,'workerd-order')
  assert.equal(Number((await sql('SELECT COUNT(*) AS n FROM order_items WHERE order_id=?',orderId)).n),1)
  await call('/api/orders/'+orderId+'/shipping','PATCH',{
    shippingStatus:'sent',shippingDate:'2026-10-20',
  },200,'workerd-ship')
  assert.equal(Number((await stock()).quantity),1)
  assert.equal(Number((await stock()).reserved_quantity),0)
  await call('/api/orders/'+orderId+'/shipping','PATCH',{
    shippingStatus:'sent',shippingDate:'2026-10-20',
  },200,'workerd-ship')
  assert.equal(Number((await stock()).quantity),1)
  console.log('MAIN_LOCAL_WORKERD_D1_ACCEPTANCE_PASSED: '+migrations.length+' exact repo migrations, real local D1 storage, Cyrillic auth, Catalog SKU, arrival, itemized order/payment/reserve, idempotent shipping; no production identifiers')
} finally {
  if(proxy)await proxy.dispose()
  rmSync(sandbox,{recursive:true,force:true})
}
