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
    // Fresh-install-only rewrite of historical manager rebuild. The original
    // ALTER managers -> managers_step126_old causes SQLite/D1 to retarget ALL
    // other tables' FKs to the temporary name, then DROP leaves dangling FKs.
    // Instead create the replacement under a new name, COPY, DROP old manager
    // table, and RENAME replacement to the canonical name. Every referencing
    // table keeps its original REFERENCES managers FK throughout.
    // Never apply this override to an existing user database or historical data.
    let migrated=flat
    if(file==='0035_v72_team_identity_colors.sql') {
      const before=await db.prepare("SELECT COUNT(*) AS n FROM orders").first()
      assert.equal(Number(before?.n),0,'Manager fresh-install strategy is NOT safe on databases holding real orders')
      assert(migrated.includes('ALTER TABLE managers RENAME TO managers_step126_old;'))
      assert(migrated.includes('CREATE TABLE managers ('))
      assert(migrated.includes('FROM managers_step126_old old;'))
      assert(migrated.includes('DROP TABLE managers_step126_old;'))
      migrated=migrated
        .replace('ALTER TABLE managers RENAME TO managers_step126_old;', '')
        .replace('CREATE TABLE managers (','CREATE TABLE managers_step126_new (')
        .replace('INSERT INTO managers (','INSERT INTO managers_step126_new (')
        .replace('FROM managers_step126_old old;','FROM managers old;')
        .replace('DROP TABLE managers_step126_old;',
          'DROP TABLE managers; ALTER TABLE managers_step126_new RENAME TO managers;')
      console.warn('LOCAL_WORKERD_D1_FRESH_MANAGER_REBUILD: preserving canonical manager FK target; NOT a migration replacement/deployment')
    }
    // Historical migrations contain explicit transaction control from ordinary
    // SQLite. D1 explicitly forbids BEGIN/COMMIT through its Worker API. Seed
    // the disposable fixture without these wrappers ONLY, and flag this
    // migration-parity gap; never rewrite the checked-in SQL migrations.
    const withoutTransactions=migrated.replace(/\bBEGIN\s+TRANSACTION\s*;/gi,'').replace(/\bCOMMIT\s*;/gi,'')
    if(withoutTransactions!==flat) console.warn('LOCAL_WORKERD_D1_TRANSACTION_GAP: '+file+' needs D1-aware transaction migration review')
    // Cloudflare D1 Worker API disallows SQLite TEMP-schema creation. Historical
    // migration scratch tables are dropped before their migration completes;
    // using ordinary disposable scratch tables only in this fresh test DB
    // preserves their SQL effects without touching checked-in migrations.
    const adapted=withoutTransactions.replace(/\bCREATE\s+TEMP(?:ORARY)?\s+TABLE\b/gi,'CREATE TABLE')
    if(adapted!==withoutTransactions) console.warn('LOCAL_WORKERD_D1_TEMP_SCHEMA_GAP: '+file+' historical CREATE TEMP TABLE not supported by D1 Worker API')
    try { await db.exec(adapted) }
    catch(error) {throw new Error('Local workerd D1 failed migration '+file+': '+String(error),{cause:error})}
  }
  const orphanReferences=(await db.prepare(
    "SELECT type,name,substr(sql,1,650) AS sql FROM sqlite_master WHERE sql LIKE '%managers_step126_old%' ORDER BY type,name"
  ).all()).results||[]
  if(orphanReferences.length){
    console.error('LOCAL_WORKERD_D1_STALE_MANAGER_REFERENCES: '+JSON.stringify(orphanReferences))
    throw new Error('Fresh D1 migrations retain references to dropped managers_step126_old; stop before business mutations')
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
  },201)
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

  // Assert all references resolve BEFORE inserting operational rows.
  const fkRows=(await db.prepare('PRAGMA foreign_key_check').all()).results||[]
  assert.equal(fkRows.length,0,'Fresh local D1 has invalid foreign-key links: '+JSON.stringify(fkRows.slice(0,6)))

  // Return a physically issued item, then cancel the Return. Real D1 must
  // reverse one physical unit and one refund, without double writes.
  const firstLine=await sql('SELECT id FROM order_items WHERE order_id=?',orderId)
  const returnData={
    orderId,returnDate:'2026-10-20',amount:1000,paymentMethod:'НАЛИЧКА',
    items:[{orderItemId:firstLine.id,quantity:1,restock:true,physicalState:'warehouse'}],
  }
  const ret=(await call('/api/returns','POST',returnData,201,'workerd-return-once')).data
  const retId=Number(ret.returnId)
  assert(retId>0)
  assert.equal(Number((await stock()).quantity),2)
  await call('/api/returns','POST',returnData,201,'workerd-return-once')
  assert.equal(Number((await stock()).quantity),2)
  await call('/api/returns/'+retId+'/cancel','PATCH',{},200,'workerd-return-cancel')
  assert.equal(Number((await stock()).quantity),1)
  await call('/api/returns/'+retId+'/cancel','PATCH',{},200,'workerd-return-cancel')
  assert.equal(Number((await stock()).quantity),1)
  assert.equal(Number((await sql('SELECT return_amount FROM orders WHERE id=?',orderId)).return_amount),0)

  // Delayed physical intake: a Return was registered while correctly
  // fulfilled, but its reservation becomes wrongly active before later
  // warehouse receipt. Guard must re-evaluate at RECEIVE, not only CREATE.
  const deferred=(await call('/api/returns','POST',{
    orderId,returnDate:'2026-10-20',amount:0,
    items:[{orderItemId:firstLine.id,quantity:1,physicalState:'pending',restock:false}],
  },201,'workerd-late-return-register')).data
  const deferredId=Number(deferred.returnId)
  assert(deferredId>0)
  const deferredLine=await sql('SELECT id,physical_received_at FROM return_items WHERE return_id=?',deferredId)
  assert(deferredLine.id && !deferredLine.physical_received_at)
  const originalReservation=await sql('SELECT id,status FROM inventory_reservations WHERE order_item_id=?',firstLine.id)
  assert.equal(originalReservation.status,'fulfilled')
  await db.prepare("UPDATE inventory_reservations SET status='active',fulfilled_at=NULL WHERE id=?").bind(originalReservation.id).run()
  await db.prepare("UPDATE inventory_stock SET reserved_quantity=reserved_quantity+1 WHERE inventory_source='warehouse' AND variant_id=?").bind(variantId).run()
  const physicalBeforeDelayed=Number((await stock()).quantity)
  const reservedBeforeDelayed=Number((await stock()).reserved_quantity)
  await call('/api/returned-items/receive','POST',{
    operationType:'return',operationId:deferredId,operationItemId:deferredLine.id,
    destination:'warehouse',requestId:'workerd-late-return-receive',
  },409)
  assert.equal(Number((await stock()).quantity),physicalBeforeDelayed,'Late inconsistent intake cannot credit Physical')
  assert.equal(Number((await stock()).reserved_quantity),reservedBeforeDelayed)
  assert.equal((await sql('SELECT physical_received_at FROM return_items WHERE id=?',deferredLine.id)).physical_received_at,null)
  // Restore only this artificial test fixture before unrelated follow-up tests.
  await db.prepare("UPDATE inventory_reservations SET status='fulfilled',fulfilled_at='2026-10-20T00:00:00.000Z' WHERE id=?").bind(originalReservation.id).run()
  await db.prepare("UPDATE inventory_stock SET reserved_quantity=reserved_quantity-1 WHERE inventory_source='warehouse' AND variant_id=?").bind(variantId).run()
  assert.equal(Number((await stock()).reserved_quantity),0)
  console.log('MAIN_LOCAL_WORKERD_D1_LATE_RECEIPT_GUARDED: pre-existing pending physical Return refused if a live reservation later reappears')

  // Partial legacy unissued swap on actual D1: 2->1 active reserve, cancel
  // restores 2. A second exact SKU must depart and return only once.
  const colorNew='БЕЛЫЙ'
  const secondVariant=(await call('/api/catalog/variants','POST',{
    productId,category:'adult',gender:'ЖЕН',color:colorNew,
    material:'СТАНДАРТ',length:'СТАНДАРТ',sizeLabel:size,
  },201)).data
  const newVariantId=Number(secondVariant.id)
  assert(newVariantId>0 && newVariantId!==variantId)
  await call('/api/inventory/movements','POST',{
    requestId:'workerd-legacy-old-arrival',inventorySource:'warehouse',movementType:'arrival',
    items:[{productId,variantId,productName:name,gender:'ЖЕН',color,
      material:'СТАНДАРТ',length:'СТАНДАРТ',size,quantity:3}],
  },201)
  await call('/api/inventory/movements','POST',{
    requestId:'workerd-legacy-new-arrival',inventorySource:'warehouse',movementType:'arrival',
    items:[{productId,variantId:newVariantId,productName:name,gender:'ЖЕН',color:colorNew,
      material:'СТАНДАРТ',length:'СТАНДАРТ',size,quantity:2}],
  },201)
  const originalStock=Number((await stock()).quantity)
  const newStock=async()=>await sql(
    "SELECT quantity,reserved_quantity FROM inventory_stock WHERE inventory_source='warehouse' AND variant_id=?",newVariantId
  )
  const oldOrder={
    requestId:'workerd-legacy-order',orderDate:'2026-10-20',managerId,
    customerPhone:'77010000888',pricingMode:'legacy_manual_total',orderTotal:20000,
    workshopStatus:'ready',orderStatus:'active',
    items:[{...orderPayload.items[0],quantity:2,unitPrice:undefined}],
    payments:[],
  }
  const legacy=(await call('/api/orders','POST',oldOrder,201,'workerd-legacy-order')).data
  const legacyId=Number(legacy.orderId)
  const oldLine=await sql('SELECT id FROM order_items WHERE order_id=?',legacyId)
  assert.equal(Number((await sql('SELECT quantity FROM inventory_reservations WHERE order_item_id=?',oldLine.id)).quantity),2)
  const swapPayload={
    orderId:legacyId,exchangeDate:'2026-10-20',oldItemId:oldLine.id,oldQuantity:1,
    oldPhysicalState:'not_issued',oldReturnSource:'none',
    newItem:{...oldOrder.items[0],color:colorNew,quantity:1},
    financialAction:'none',financialAmount:0,paymentMethod:'',
  }
  const swap=(await call('/api/exchanges','POST',swapPayload,201,'workerd-partial-exchange')).data
  const exchId=Number(swap.exchangeId)
  assert(exchId>0)
  const afterReserve=await sql('SELECT status,quantity FROM inventory_reservations WHERE order_item_id=?',oldLine.id)
  assert.equal(afterReserve.status,'active')
  assert.equal(Number(afterReserve.quantity),1)
  assert.equal(Number((await stock()).quantity),originalStock,'Unissued old physical cannot move')
  assert.equal(Number((await newStock()).quantity),1)
  await call('/api/exchanges','POST',swapPayload,201,'workerd-partial-exchange')
  assert.equal(Number((await stock()).reserved_quantity),1)
  await call('/api/exchanges/'+exchId+'/cancel','PATCH',{},200,'workerd-partial-exchange-cancel')
  const restoredReserve=await sql('SELECT status,quantity FROM inventory_reservations WHERE order_item_id=?',oldLine.id)
  assert.equal(restoredReserve.status,'active')
  assert.equal(Number(restoredReserve.quantity),2)
  assert.equal(Number((await stock()).reserved_quantity),2)
  assert.equal(Number((await newStock()).quantity),2)
  await call('/api/exchanges/'+exchId+'/cancel','PATCH',{},200,'workerd-partial-exchange-cancel')
  assert.equal(Number((await stock()).reserved_quantity),2)

  // Contradictory legacy history: marked physically issued despite LIVE
  // reservation. Physical return must fail before any Return/stock/refund write.
  const contradictory={
    ...oldOrder,requestId:'workerd-contradiction',customerPhone:'77010000777',
    items:[{...oldOrder.items[0],quantity:1}],
  }
  const conflicted=(await call('/api/orders','POST',contradictory,201,'workerd-contradiction')).data
  const badId=Number(conflicted.orderId)
  const badLine=await sql('SELECT id FROM order_items WHERE order_id=?',badId)
  await db.prepare("UPDATE order_items SET stock_writeoff_status='written_off' WHERE id=?").bind(badLine.id).run()
  const stableOld=Number((await stock()).quantity)
  const stableReserve=Number((await stock()).reserved_quantity)
  await call('/api/returns','POST',{
    orderId:badId,returnDate:'2026-10-20',amount:0,
    items:[{orderItemId:badLine.id,quantity:1,restock:true,physicalState:'warehouse'}],
  },409,'workerd-conflict-physical-return')
  assert.equal(Number((await stock()).quantity),stableOld)
  assert.equal(Number((await stock()).reserved_quantity),stableReserve)
  assert.equal(Number((await sql('SELECT COUNT(*) AS n FROM returns WHERE order_id=?',badId)).n),0)
  console.log('MAIN_LOCAL_WORKERD_D1_RETURN_EXCHANGE_PASSED: idempotent physical Return/cancel, legacy 2->1->2 reserve with cancellation, conflicting physical Return rejected')
  console.log('MAIN_LOCAL_WORKERD_D1_ACCEPTANCE_PASSED: '+migrations.length+' source-derived migrations with explicit local D1 adaptations, real local D1 storage, Cyrillic auth, Catalog SKU, arrival, itemized order/payment/reserve, idempotent shipping; no production identifiers')
} finally {
  if(proxy)await proxy.dispose()
  rmSync(sandbox,{recursive:true,force:true})
}
