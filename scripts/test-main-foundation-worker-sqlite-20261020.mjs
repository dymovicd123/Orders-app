// Main customer ONLY. Runs actual production Worker.fetch with an ephemeral,
// entirely local SQLite/D1-compatible adapter and the exact main migrations.
// Never binds Cloudflare secrets, URLs, or a remote production/test D1.
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import worker from '../worker/index.ts'

const sqlite = new DatabaseSync(':memory:')
sqlite.exec('PRAGMA foreign_keys=ON')
const migrations = readdirSync('migrations').filter(f => /^\d+.*\.sql$/.test(f)).sort()
assert(migrations.length >= 110, 'Production migration set incomplete')
for (const migration of migrations) {
  try {
    sqlite.exec(readFileSync(path.join('migrations', migration), 'utf8'))
  } catch (error) {
    throw new Error('Exact migration failed on isolated SQLite: ' + migration + ': ' + String(error), { cause: error })
  }
}

// The historical production DB already carries certain columns not represented
// by the checked-in migration sequence. Do NOT silently call the fixture fully
// production-equivalent. Record this reproducibility gap and ONLY for this
// disposable test add the missing compatibility column so downstream API
// acceptance can independently continue. The production schema is untouched.
if (!sqlite.prepare("SELECT 1 AS present FROM pragma_table_info('orders') WHERE name='manager_snapshot_name'").get()) {
  console.warn('SCHEMA_GAP_REQUIRES_RECONCILIATION: all repo migrations lack orders.manager_snapshot_name, but current Worker writes it.')
  sqlite.exec('ALTER TABLE orders ADD COLUMN manager_snapshot_name TEXT')
}

// All SQL executes against the same ephemeral in-memory SQLite handle;
// batch is a real transactional savepoint, NOT a mocked successful write.
// An opt-in one-shot SQL failure lets us prove how committed intermediate
// stages recover without faking a successful business mutation.
let failNextSqlWriteContaining = null
function wrap(query, args = []) {
  const stmt = sqlite.prepare(query)
  return {
    bind(...values) { return wrap(query, values) },
    async all() { return { success: true, results: stmt.all(...args) } },
    async first(column) {
      const row = stmt.get(...args) ?? null
      return typeof column === 'string' ? row?.[column] ?? null : row
    },
    async run() {
      if (failNextSqlWriteContaining && query.includes(failNextSqlWriteContaining)) {
        failNextSqlWriteContaining = null
        throw new Error('INJECTED_NETWORK_OR_DB_FAILURE_BEFORE_WRITE')
      }
      const outcome = stmt.columns().length > 0 ? { rows: stmt.all(...args), changes: 0, lastInsertRowid: 0 } : stmt.run(...args)
      return { success: true, results: outcome.rows || [], meta: { changes: outcome.changes || 0, last_row_id: Number(outcome.lastInsertRowid || 0) } }
    },
  }
}
const db = {
  prepare(query) { return wrap(query) },
  async batch(statements) {
    sqlite.exec('SAVEPOINT isolated_d1_batch')
    try {
      const result = []
      for (const statement of statements) result.push(await statement.run())
      sqlite.exec('RELEASE SAVEPOINT isolated_d1_batch')
      return result
    } catch (error) {
      sqlite.exec('ROLLBACK TO SAVEPOINT isolated_d1_batch')
      sqlite.exec('RELEASE SAVEPOINT isolated_d1_batch')
      throw error
    }
  },
  async exec(query) { sqlite.exec(query); return { count: 1, duration: 0 } },
}
const env = { DB: db, ADMIN_MODE_LOGIN: 'admin', ADMIN_MODE_PASSWORD: 'local-synthetic-bootstrap-2026' }
const root = 'https://stabilization.invalid'
let cookie = ''
async function api(route, method = 'GET', body, options = {}) {
  const req = new Request(root + route, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...(options.requestId ? { 'X-Idempotency-Key': options.requestId } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const response = await worker.fetch(req, env)
  const raw = await response.text()
  let data
  try { data = JSON.parse(raw) } catch { throw new Error(method + ' ' + route + ': non-JSON HTTP ' + response.status + ': ' + raw.slice(0, 250)) }
  if (options.expectedStatus !== undefined) assert.equal(response.status, options.expectedStatus, method + ' ' + route + ': ' + JSON.stringify(data))
  else assert(response.ok, method + ' ' + route + ': HTTP ' + response.status + ': ' + JSON.stringify(data))
  return { status: response.status, data, response }
}
const sql = (query, ...params) => sqlite.prepare(query).get(...params)
const count = (table, where = '1=1') => sql('SELECT COUNT(*) AS n FROM ' + table + ' WHERE ' + where).n
try {
  // Auth is enforced before touching business paths.
  await api('/api/orders', 'GET', undefined, { expectedStatus: 401 })
  const setup = await api('/api/auth/setup', 'POST', {
    login: 'stability-admin', password: 'local-test-admin-password-2026',
    bootstrapLogin: 'admin', bootstrapPassword: env.ADMIN_MODE_PASSWORD,
    displayName: 'Локальный тест',
  }, { expectedStatus: 201 })
  assert.equal(setup.data.user.role, 'admin')
  cookie = (setup.response.headers.get('set-cookie') || '').split(';')[0]
  assert(cookie.startsWith('orders_session='), 'No first-admin session cookie')
  await api('/api/auth/me')
  await api('/api/auth/setup', 'POST', { login: 'second-admin' }, { expectedStatus: 409 })

  // Use legitimate API to materialize an exact product and SKU identity.
  const name = 'СТАБИЛИЗАЦИЯ ТЕСТ ИЗОЛИРОВАННАЯ'
  const product = await api('/api/catalog/products', 'POST', { name, category: 'adult', genderScope: 'female' }, { expectedStatus: 201 })
  const productId = Number(product.data.id)
  assert(productId > 0)
  const color = sql("SELECT value FROM reference_values WHERE kind='color' AND value='ЧЕРНЫЙ' AND is_active=1")?.value
  const size = sql("SELECT value FROM reference_values WHERE kind='size' AND value='46' AND is_active=1")?.value
  assert(color && size, 'Reference seed required by the current production catalog is missing')
  const variant = await api('/api/catalog/variants', 'POST', {
    productId, category: 'adult', gender: 'ЖЕН', color,
    material: 'СТАНДАРТ', length: 'СТАНДАРТ', sizeLabel: size,
  }, { expectedStatus: 201 })
  const variantId = Number(variant.data.id)
  assert(variantId > 0)
  assert.equal(sql('SELECT product_id FROM catalog_variants WHERE id=?',variantId).product_id, productId)

  // REAL inventory POST: movement and physical stock, no direct inventory-row seed.
  const arrival = {
    requestId: 'stability-arrival-one',
    inventorySource: 'warehouse', movementType: 'arrival',
    items: [{ productId, variantId, productName:name, gender:'ЖЕН', color, material:'СТАНДАРТ', length:'СТАНДАРТ', size, quantity:3 }],
  }
  await api('/api/inventory/movements', 'POST', arrival)
  const stock = () => sql("SELECT quantity,reserved_quantity FROM inventory_stock WHERE inventory_source='warehouse' AND variant_id=?",variantId)
  assert.equal(Number(stock()?.quantity), 3, 'Arrival should create 3 real physical units')

  // REAL order POST: one canonical line, partial payment, active reservation.
  const managerId = Number(sql("SELECT id FROM managers WHERE is_active=1 ORDER BY id LIMIT 1")?.id)
  assert(managerId > 0)
  const orderPayload = {
    requestId: 'stability-create-one', orderDate: '2026-10-20', managerId,
    customerPhone: '77010000001', city: 'АЛМАТЫ', pricingMode: 'itemized_v1',
    workshopStatus: 'ready', orderStatus: 'active',
    items: [{ productName:name, audienceType:'ВЗРОСЛЫЙ', gender:'ЖЕН',color,material:'СТАНДАРТ',length:'СТАНДАРТ',size,sourceType:'warehouse',quantity:2,unitPrice:10000,catalogPriceSnapshot:null }],
    payments:[{paymentDate:'2026-10-20',method:'НАЛИЧКА',paymentKind:'primary',amount:5000}],
  }
  const created = await api('/api/orders','POST',orderPayload,{expectedStatus:201,requestId:orderPayload.requestId})
  const orderId=Number(created.data.orderId)
  assert(orderId>0,'Created order must have canonical ID')
  const actualOrder = ()=>sql('SELECT total_amount,received_amount,debt_amount,shipping_status FROM orders WHERE id=?',orderId)
  assert.equal(actualOrder().total_amount,20000)
  assert.equal(actualOrder().received_amount,5000)
  assert.equal(actualOrder().debt_amount,15000)
  let item=sql('SELECT id,product_id,variant_id,quantity,stock_writeoff_status FROM order_items WHERE order_id=?',orderId)
  assert.equal(item.product_id,productId)
  assert.equal(item.variant_id,variantId)
  assert.equal(item.quantity,2)
  assert.equal(Number(stock().quantity),3,'Creating an order must not remove Physical')
  assert.equal(Number(stock().reserved_quantity),2,'Creating order must reserve exact 2 units')

  // Same requestId on retry cannot create a second order or charge again.
  await api('/api/orders','POST',orderPayload,{expectedStatus:201,requestId:orderPayload.requestId})
  assert.equal(count('orders','id='+orderId),1)
  assert.equal(count('order_items','order_id='+orderId),1)
  assert.equal(count('payments','order_id='+orderId),1)
  assert.equal(Number(stock().reserved_quantity),2)
  
  // REAL shipping PATCH uses the exact canonical reservation and decrements
  // Physical once. Historical payment/debt is unchanged.
  const ship={ shippingStatus:'sent', shippingDate:'2026-10-20' }
  await api('/api/orders/'+orderId+'/shipping','PATCH',ship,{requestId:'stability-ship-once'})
  assert.equal(actualOrder().shipping_status,'sent')
  assert.equal(Number(stock().quantity),1)
  assert.equal(Number(stock().reserved_quantity),0)
  assert.equal(sql('SELECT status FROM inventory_reservations WHERE order_item_id=? ORDER BY id DESC LIMIT 1',item.id).status,'fulfilled')
  await api('/api/orders/'+orderId+'/shipping','PATCH',ship,{requestId:'stability-ship-once'})
  assert.equal(Number(stock().quantity),1,'Repeated send must never decrement stock twice')
  assert.equal(actualOrder().received_amount,5000)
  assert.equal(actualOrder().debt_amount,15000)

  // A second real order remains reserved when an exact short stock-check is
  // completed AFTER its creation. The server MUST stop final shipment and ask
  // for the review rather than silently double-decrementing physical stock.
  const orderAfterCheck = {
    ...orderPayload, requestId:'stability-create-review-after-check', customerPhone:'77010000002',
    items:[{...orderPayload.items[0],quantity:1}],
    payments:[],
  }
  const second = await api('/api/orders','POST',orderAfterCheck,{expectedStatus:201,requestId:orderAfterCheck.requestId})
  const secondId = Number(second.data.orderId)
  assert(secondId>0 && secondId!==orderId)
  assert.equal(Number(stock().quantity),1)
  assert.equal(Number(stock().reserved_quantity),1)
  // Make this a deterministic historical-order fixture: a real order/reservation
  // created by the API, then aged in the isolated test DB before the later check.
  const oldOrigin='2026-10-19T09:00:00.000Z'
  sqlite.prepare("UPDATE orders SET created_at=?,order_date='2026-10-19' WHERE id=?").run(oldOrigin,secondId)
  sqlite.prepare("UPDATE order_items SET created_at=?,inventory_obligation_origin_at=? WHERE order_id=?").run(oldOrigin,oldOrigin,secondId)
  sqlite.prepare("UPDATE inventory_reservations SET created_at=? WHERE order_id=?").run(oldOrigin,secondId)
  const reviewCheck=await api('/api/inventory/stocktakes/quick','POST',{
    source:'warehouse',variantId,expectedQuantity:1,countedQuantity:1,
  })
  assert(reviewCheck.data.ok,'Exact physical check must commit')
  assert.equal(Number(stock().quantity),1,'Exact unchanged count must not change Physical')
  const blocked=await api('/api/orders/'+secondId+'/shipping','PATCH',ship,{expectedStatus:409})
  assert.equal(blocked.data.code,'stock_handover_review_required','Old-order/post-check handover prompt must occur before shipping')
  const state=(await api('/api/orders/'+secondId+'/stock-handover')).data
  const secondItem=state.items.find(v=>v.variantId===variantId)
  assert(secondItem?.reviewNeeded,'Actual latest post-order SKU check must appear as review-needed')
  const reviewed=await api('/api/orders/'+secondId+'/stock-handover','PATCH',{
    action:'still_here',orderItemId:secondItem.orderItemId,
    checkpointId:secondItem.checkpointId,checkpointAt:secondItem.checkpointAt,
  })
  assert(reviewed.data.ok,'Concrete checkpoint confirmation failed')
  assert.equal(Number(stock().quantity),1,'Still-here confirmation must not itself decrement Physical')
  await api('/api/orders/'+secondId+'/shipping','PATCH',ship)
  assert.equal(Number(stock().quantity),0,'Post-check shipping must decrement exactly once')
  assert.equal(Number(stock().reserved_quantity),0,'Post-check shipping must close exactly one active reservation')
  await api('/api/orders/'+secondId+'/shipping','PATCH',ship)
  assert.equal(Number(stock().quantity),0,'Post-check shipment replay must be idempotent')
  // REAL standalone return: already-shipped SKU, exact received-back stock,
  // money refund and full cancellation. Replays must never duplicate +1 or -1.
  const returnPayload = {
    orderId, returnDate:'2026-10-20', amount:1000,
    paymentMethod:'НАЛИЧКА', comment:'Изолированный возврат, проверка отмены',
    items:[{orderItemId:item.id,quantity:1,restock:true,physicalState:'warehouse'}],
  }
  const returned = await api('/api/returns','POST',returnPayload,{expectedStatus:201,requestId:'stability-return-one'})
  const returnId=Number(returned.data.returnId)
  assert(returnId>0,'Return ID required')
  assert.equal(Number(stock().quantity),1,'Returning one physically received SKU adds exactly one')
  assert.equal(sql('SELECT status FROM returns WHERE id=?',returnId).status,'completed')
  assert.equal(Number(sql('SELECT return_amount FROM orders WHERE id=?',orderId).return_amount),1000)
  await api('/api/returns','POST',returnPayload,{expectedStatus:201,requestId:'stability-return-one'})
  assert.equal(Number(stock().quantity),1,'Return replay may not duplicate arrival')
  assert.equal(count('returns','order_id='+orderId+' AND status=\'completed\''),1)
  const cancellation=await api('/api/returns/'+returnId+'/cancel','PATCH',{
    comment:'Проверка отката на синтетическом товаре',
  },{requestId:'stability-return-cancel'})
  assert(cancellation.data.ok,'Return cancellation failed')
  assert.equal(Number(stock().quantity),0,'Cancelled physical Return must reverse stock exactly once')
  assert.equal(Number(sql('SELECT return_amount FROM orders WHERE id=?',orderId).return_amount),0,'Return cancellation must restore refunded amount')
  await api('/api/returns/'+returnId+'/cancel','PATCH',{
    comment:'Проверка отката на синтетическом товаре',
  },{requestId:'stability-return-cancel'})
  assert.equal(Number(stock().quantity),0,'Return cancellation replay may not decrement again')
  assert.equal(sql('SELECT status FROM returns WHERE id=?',returnId).status,'cancelled')
  assert.equal(actualOrder().total_amount,20000)
  assert.equal(actualOrder().received_amount,5000)
  assert.equal(actualOrder().debt_amount,15000)
  console.log('MAIN_RETURN_CANCEL_WORKER_SQLITE_PASSED: physical +1 then -1, cash refund/reversal, duplicate create/cancel, original total/payment/debt preserved')
  // NEW itemized Exchange Set V2: 1 issued old SKU is physically accepted
  // back, and 1 new SKU leaves. Money is unchanged for equal-priced swap.
  const newColor='БЕЛЫЙ'
  const replacement=(await api('/api/catalog/variants','POST',{
    productId,category:'adult',gender:'ЖЕН',color:newColor,
    material:'СТАНДАРТ',length:'СТАНДАРТ',sizeLabel:size,
  },{expectedStatus:201})).data
  const newVariantId=Number(replacement.id)
  assert(newVariantId>0 && newVariantId!==variantId)
  await api('/api/inventory/movements','POST',{
    requestId:'stability-replacement-arrival', inventorySource:'warehouse',movementType:'arrival',
    items:[{productId,variantId:newVariantId,productName:name,gender:'ЖЕН',color:newColor,material:'СТАНДАРТ',length:'СТАНДАРТ',size,quantity:2}],
  })
  const newStock=()=>sql("SELECT quantity,reserved_quantity FROM inventory_stock WHERE inventory_source='warehouse' AND variant_id=?",newVariantId)
  assert.equal(Number(newStock().quantity),2)
  const exchangeSetPayload={
    orderId,exchangeDate:'2026-10-20',expectedOrderTotal:20000,
    oldItems:[{orderItemId:item.id,quantity:1,physicalState:'warehouse',
      expectedActiveQuantity:2,expectedUnitPrice:10000,expectedLineTotal:20000,expectedCatalogPriceSnapshot:null}],
    newItems:[{productName:name,audienceType:'ВЗРОСЛЫЙ',gender:'ЖЕН',color:newColor,material:'СТАНДАРТ',
      length:'СТАНДАРТ',size,sourceType:'warehouse',quantity:1,unitPrice:10000,catalogPriceSnapshot:null}],
    paymentAmount:0,paymentMethod:'',refundMethod:'',comment:'Тест равного обмена',
  }
  const switched=await api('/api/exchanges/set','POST',exchangeSetPayload,{expectedStatus:201,requestId:'stability-set-swap-once'})
  const exchangeId=Number(switched.data.exchangeId)
  assert(exchangeId>0,'Exchange Set must have ID')
  assert.equal(Number(stock().quantity),1,'One physically returned old SKU must increase stock by one')
  assert.equal(Number(newStock().quantity),1,'One new SKU must leave Physical exactly once')
  assert.equal(actualOrder().total_amount,20000,'Equal-priced Set exchange must preserve total')
  assert.equal(actualOrder().received_amount,5000,'Set exchange must preserve paid amount')
  assert.equal(actualOrder().debt_amount,15000,'Set exchange must preserve existing debt')
  assert.equal(Number(sql('SELECT quantity FROM order_items WHERE id=?',item.id).quantity),1,'Old order line must shrink')
  const newLine=sql('SELECT id,variant_id,quantity FROM order_items WHERE order_id=? AND variant_id=?',orderId,newVariantId)
  assert(newLine?.id && Number(newLine.quantity)===1,'New order line must have the exact white canonical SKU')
  await api('/api/exchanges/set','POST',exchangeSetPayload,{expectedStatus:201,requestId:'stability-set-swap-once'})
  assert.equal(Number(stock().quantity),1,'Exchange replay must not re-add old stock')
  assert.equal(Number(newStock().quantity),1,'Exchange replay must not re-issue new stock')
  assert.equal(count('exchanges','order_id='+orderId+' AND status=\'completed\''),1)
  const undone=await api('/api/exchanges/'+exchangeId+'/cancel','PATCH',{
    comment:'Тест полной отмены обмена',
  },{requestId:'stability-set-cancel-once'})
  assert(undone.data.ok,'Set exchange cancellation failed')
  assert.equal(Number(stock().quantity),0,'Cancelled Set must undo returned stock')
  assert.equal(Number(newStock().quantity),2,'Cancelled Set must restore the issued new SKU')
  assert.equal(actualOrder().total_amount,20000)
  assert.equal(actualOrder().received_amount,5000)
  assert.equal(actualOrder().debt_amount,15000)
  await api('/api/exchanges/'+exchangeId+'/cancel','PATCH',{
    comment:'Тест полной отмены обмена',
  },{requestId:'stability-set-cancel-once'})
  assert.equal(Number(stock().quantity),0,'Set cancellation replay must not touch old SKU again')
  assert.equal(Number(newStock().quantity),2,'Set cancellation replay must not touch new SKU again')
  assert.equal(sql('SELECT status FROM exchanges WHERE id=?',exchangeId).status,'cancelled')
  console.log('MAIN_EXCHANGE_SET_WORKER_SQLITE_PASSED: 1-for-1 canonical variant swap, exact Physical, preserved money, create replay, cancellation and replay')
  // LEGACY HISTORICAL ORDER: intentionally has ONLY an order-level total.
  // We must not invent a unit price while exchanging or undoing it.
  await api('/api/inventory/movements','POST',{
    requestId:'stability-legacy-arrival',inventorySource:'warehouse',movementType:'arrival',
    items:[{productId,variantId,productName:name,gender:'ЖЕН',color,
      material:'СТАНДАРТ',length:'СТАНДАРТ',size,quantity:2}],
  })
  const legacyCreatePayload={
    requestId:'stability-legacy-order',orderDate:'2026-10-20',managerId,
    customerPhone:'77010000003',city:'АЛМАТЫ',
    pricingMode:'legacy_manual_total',orderTotal:12000,
    workshopStatus:'ready',orderStatus:'active',
    items:[{productName:name,audienceType:'ВЗРОСЛЫЙ',gender:'ЖЕН',color,
      material:'СТАНДАРТ',length:'СТАНДАРТ',size,sourceType:'warehouse',quantity:1}],
    payments:[{paymentDate:'2026-10-20',method:'НАЛИЧКА',paymentKind:'primary',amount:5000}],
  }
  const legacyCreated=await api('/api/orders','POST',legacyCreatePayload,{expectedStatus:201,requestId:legacyCreatePayload.requestId})
  const legacyId=Number(legacyCreated.data.orderId)
  assert(legacyId>0)
  const legacyInitial=sql('SELECT pricing_mode,total_amount,received_amount,debt_amount FROM orders WHERE id=?',legacyId)
  assert.equal(legacyInitial.pricing_mode,'legacy_manual_total')
  assert.equal(Number(legacyInitial.total_amount),12000)
  assert.equal(Number(legacyInitial.debt_amount),7000)
  const legacyOld=sql('SELECT id,variant_id FROM order_items WHERE order_id=?',legacyId)
  assert.equal(Number(legacyOld.variant_id),variantId)
  await api('/api/orders/'+legacyId+'/shipping','PATCH',ship)
  const legacyPhysicalBefore=Number(stock().quantity)
  const legacyReplacementBefore=Number(newStock().quantity)
  const legacyExchangePayload={
    orderId:legacyId,exchangeDate:'2026-10-20',oldItemId:legacyOld.id,oldQuantity:1,
    oldPhysicalState:'warehouse',oldReturnSource:'warehouse',
    newItem:{productName:name,audienceType:'ВЗРОСЛЫЙ',gender:'ЖЕН',color:newColor,
      material:'СТАНДАРТ',length:'СТАНДАРТ',size,sourceType:'warehouse',quantity:1},
    financialAction:'none',financialAmount:0,paymentMethod:'',comment:'Тест совместимого обмена',
  }
  const legacySwap=await api('/api/exchanges','POST',legacyExchangePayload,{
    expectedStatus:201,requestId:'stability-legacy-swap-once',
  })
  const legacyExchangeId=Number(legacySwap.data.exchangeId)
  assert(legacyExchangeId>0)
  assert.equal(Number(stock().quantity),legacyPhysicalBefore+1,'Legacy old received SKU must add one')
  assert.equal(Number(newStock().quantity),legacyReplacementBefore-1,'Legacy replacement must issue exactly one')
  assert.equal(sql('SELECT total_amount FROM orders WHERE id=?',legacyId).total_amount,12000)
  await api('/api/exchanges','POST',legacyExchangePayload,{
    expectedStatus:201,requestId:'stability-legacy-swap-once',
  })
  assert.equal(Number(stock().quantity),legacyPhysicalBefore+1,'Legacy exchange retry cannot double count old SKU')
  assert.equal(Number(newStock().quantity),legacyReplacementBefore-1,'Legacy exchange retry cannot double issue new SKU')
  await api('/api/exchanges/'+legacyExchangeId+'/cancel','PATCH',{
    comment:'Синтетическая отмена старого обмена',
  },{requestId:'stability-legacy-cancel'})
  assert.equal(Number(stock().quantity),legacyPhysicalBefore,'Legacy cancellation returns old physical to initial value')
  assert.equal(Number(newStock().quantity),legacyReplacementBefore,'Legacy cancellation restores replaced physical')
  await api('/api/exchanges/'+legacyExchangeId+'/cancel','PATCH',{
    comment:'Синтетическая отмена старого обмена',
  },{requestId:'stability-legacy-cancel'})
  assert.equal(Number(stock().quantity),legacyPhysicalBefore,'Legacy cancellation replay cannot change physical')
  assert.equal(Number(newStock().quantity),legacyReplacementBefore,'Legacy cancellation replay cannot change new SKU')
  const legacyFinal=sql('SELECT total_amount,received_amount,debt_amount FROM orders WHERE id=?',legacyId)
  assert.equal(Number(legacyFinal.total_amount),12000,'Legacy order total must remain immutable')
  assert.equal(Number(legacyFinal.received_amount),5000)
  assert.equal(Number(legacyFinal.debt_amount),7000)
  assert.equal(sql('SELECT status FROM exchanges WHERE id=?',legacyExchangeId).status,'cancelled')
  console.log('MAIN_LEGACY_EXCHANGE_WORKER_SQLITE_PASSED: old manual total, concrete SKU exchange, no invented unit price, retries and cancellation reconcile')
  // LEGACY MULTI-PAIR visit: the existing UI does sequential critical
  // operations, not one transaction. Simulate a network cut AFTER pair 1,
  // replay that request, then finish pair 2 with the ONLY extra payment.
  const twoLinePayload={
    ...legacyCreatePayload,requestId:'stability-legacy-two-line',customerPhone:'77010000004',
    orderTotal:30000,
    items:[
      {...legacyCreatePayload.items[0]},
      {...legacyCreatePayload.items[0],color:newColor},
    ],
    payments:[{paymentDate:'2026-10-20',method:'НАЛИЧКА',paymentKind:'primary',amount:20000}],
  }
  const mult=await api('/api/orders','POST',twoLinePayload,{expectedStatus:201,requestId:twoLinePayload.requestId})
  const multiId=Number(mult.data.orderId)
  const multiOld=sqlite.prepare('SELECT id,variant_id,quantity FROM order_items WHERE order_id=? ORDER BY id').all(multiId)
  assert.equal(multiOld.length,2)
  assert.deepEqual(multiOld.map(x=>Number(x.variant_id)),[variantId,newVariantId])
  await api('/api/orders/'+multiId+'/shipping','PATCH',ship)
  const beforeMultiOld=Number(stock().quantity)
  const beforeMultiNew=Number(newStock().quantity)
  const pair1={
    orderId:multiId,exchangeDate:'2026-10-20',
    oldItemId:multiOld[0].id,oldQuantity:1,oldPhysicalState:'warehouse',oldReturnSource:'warehouse',
    newItem:{...legacyCreatePayload.items[0],color:newColor},
    financialAction:'none',financialAmount:0,paymentMethod:'',comment:'Первый из двух обменов',
  }
  const first=await api('/api/exchanges','POST',pair1,{
    expectedStatus:201,requestId:'stability-legacy-multi-first',
  })
  assert(Number(first.data.exchangeId)>0)
  assert.equal(Number(stock().quantity),beforeMultiOld+1)
  assert.equal(Number(newStock().quantity),beforeMultiNew-1)
  assert.equal(sql('SELECT total_amount FROM orders WHERE id=?',multiId).total_amount,30000)
  assert.equal(sql('SELECT received_amount FROM orders WHERE id=?',multiId).received_amount,20000)
  // Cut transport, lose client response, repeat the exact first payload and ID.
  await api('/api/exchanges','POST',pair1,{
    expectedStatus:201,requestId:'stability-legacy-multi-first',
  })
  assert.equal(count('exchanges','order_id='+multiId+' AND status=\'completed\''),1)
  assert.equal(Number(stock().quantity),beforeMultiOld+1)
  assert.equal(Number(newStock().quantity),beforeMultiNew-1)
  const pair2={
    ...pair1,oldItemId:multiOld[1].id,newItem:{...legacyCreatePayload.items[0]},
    financialAction:'extra_payment',financialAmount:1000,paymentMethod:'НАЛИЧКА',
    comment:'Второй обмен — единственная доплата',
  }
  const secondSwap=await api('/api/exchanges','POST',pair2,{
    expectedStatus:201,requestId:'stability-legacy-multi-second',
  })
  assert(Number(secondSwap.data.exchangeId)>0)
  assert.equal(count('exchanges','order_id='+multiId+' AND status=\'completed\''),2)
  assert.equal(Number(stock().quantity),beforeMultiOld)
  assert.equal(Number(newStock().quantity),beforeMultiNew)
  const afterMulti=sql('SELECT total_amount,received_amount,debt_amount FROM orders WHERE id=?',multiId)
  assert.equal(Number(afterMulti.total_amount),31000)
  assert.equal(Number(afterMulti.received_amount),21000)
  assert.equal(Number(afterMulti.debt_amount),10000)
  await api('/api/exchanges','POST',pair2,{
    expectedStatus:201,requestId:'stability-legacy-multi-second',
  })
  assert.equal(count('payments','order_id='+multiId),2,'Extra payment must not be duplicated by retry')
  assert.equal(Number(sql('SELECT received_amount FROM orders WHERE id=?',multiId).received_amount),21000)
  assert.equal(Number(stock().quantity),beforeMultiOld)
  assert.equal(Number(newStock().quantity),beforeMultiNew)
  // Undo in reverse chronological order; original historical total and
  // both exact SKU physical counts must be restored without guesswork.
  for(const [id,key] of [
    [Number(secondSwap.data.exchangeId),'stability-legacy-multi-cancel2'],
    [Number(first.data.exchangeId),'stability-legacy-multi-cancel1'],
  ]) await api('/api/exchanges/'+id+'/cancel','PATCH',{
    comment:'Отмена двухпарного теста',
  },{requestId:key})
  assert.equal(Number(stock().quantity),beforeMultiOld)
  assert.equal(Number(newStock().quantity),beforeMultiNew)
  const finalMulti=sql('SELECT total_amount,received_amount,debt_amount FROM orders WHERE id=?',multiId)
  assert.equal(Number(finalMulti.total_amount),30000)
  assert.equal(Number(finalMulti.received_amount),20000)
  assert.equal(Number(finalMulti.debt_amount),10000)
  console.log('MAIN_LEGACY_MULTI_PAIR_WORKER_SQLITE_PASSED: failed transport/retry between pairs, final-only cash, two reverse cancellations, exact SKU & money restored')
  // Fail AFTER the Return header and refund money event were committed,
  // BEFORE its first return_item. Retry the exact operation ID must recover
  // and avoid double-refund / double-restocking.
  await api('/api/inventory/movements','POST',{
    requestId:'stability-failpoint-arrival',inventorySource:'warehouse',movementType:'arrival',
    items:[{productId,variantId,productName:name,gender:'ЖЕН',color,material:'СТАНДАРТ',length:'СТАНДАРТ',size,quantity:1}],
  })
  const failedReturnOrderPayload={
    ...orderPayload,requestId:'stability-failpoint-create',customerPhone:'77010000005',
    items:[{...orderPayload.items[0],quantity:1}],
    payments:[{paymentDate:'2026-10-20',method:'НАЛИЧКА',paymentKind:'primary',amount:7000}],
  }
  const failedOrder=await api('/api/orders','POST',failedReturnOrderPayload,{
    expectedStatus:201,requestId:failedReturnOrderPayload.requestId,
  })
  const failedId=Number(failedOrder.data.orderId)
  assert(failedId>0)
  const failedItemId=Number(sql('SELECT id FROM order_items WHERE order_id=?',failedId).id)
  await api('/api/orders/'+failedId+'/shipping','PATCH',ship)
  const failedReturnPayload={
    orderId:failedId,returnDate:'2026-10-20',amount:1000,paymentMethod:'НАЛИЧКА',
    items:[{orderItemId:failedItemId,quantity:1,restock:true,physicalState:'warehouse'}],
  }
  failNextSqlWriteContaining='INSERT INTO return_items'
  const injected=await api('/api/returns','POST',failedReturnPayload,{
    expectedStatus:500,requestId:'stability-recover-mid-return',
  })
  assert.equal(injected.data.ok,false)
  assert.equal(count('returns','order_id='+failedId),1,'Return header committed before injected failure')
  assert.equal(Number(stock().quantity),0,'Uncompleted Return must not restock physical')
  const recovered=await api('/api/returns','POST',failedReturnPayload,{
    expectedStatus:201,requestId:'stability-recover-mid-return',
  })
  const recoveredReturnId=Number(recovered.data.returnId)
  assert(recoveredReturnId>0,'Partial Return must recover under original requestId')
  assert.equal(count('returns','order_id='+failedId),1,'Retry cannot create duplicate refund header')
  assert.equal(count('return_items','return_id='+recoveredReturnId),1,'Retry must create exactly one return item')
  assert.equal(Number(stock().quantity),1,'Recovered Return must restock exactly one')
  assert.equal(Number(sql('SELECT return_amount FROM orders WHERE id=?',failedId).return_amount),1000)
  await api('/api/returns','POST',failedReturnPayload,{
    expectedStatus:201,requestId:'stability-recover-mid-return',
  })
  assert.equal(Number(stock().quantity),1,'Completed Return replay must be idempotent')
  await api('/api/returns/'+recoveredReturnId+'/cancel','PATCH',{},{
    requestId:'stability-recover-mid-return-cancel',
  })
  assert.equal(Number(stock().quantity),0,'Recovered-and-cancelled Return must restore physical')
  assert.equal(Number(sql('SELECT return_amount FROM orders WHERE id=?',failedId).return_amount),0)
  console.log('MAIN_RETURN_INJECTED_FAILURE_RECOVERY_PASSED: committed header/refund before failed item, request replay preserves exactly one money/stock event and cancels safely')
  // REGRESSION: partial LEGACY exchange of an UNISSUED old line (quantity 2).
  // It must free ONE unit of that line's reserve, never the other unissued unit.
  await api('/api/inventory/movements','POST',{
    requestId:'stability-legacy-unissued-stock',inventorySource:'warehouse',movementType:'arrival',
    items:[{productId,variantId,productName:name,gender:'ЖЕН',color,material:'СТАНДАРТ',
      length:'СТАНДАРТ',size,quantity:4}],
  })
  await api('/api/inventory/movements','POST',{
    requestId:'stability-legacy-unissued-replacement',inventorySource:'warehouse',movementType:'arrival',
    items:[{productId,variantId:newVariantId,productName:name,gender:'ЖЕН',color:newColor,
      material:'СТАНДАРТ',length:'СТАНДАРТ',size,quantity:2}],
  })
  const unissuedPayload={
    ...legacyCreatePayload,requestId:'stability-unissued-two-old',customerPhone:'77010000006',
    orderTotal:20000,
    items:[{...legacyCreatePayload.items[0],quantity:2}],payments:[],
  }
  const unissuedOrder=await api('/api/orders','POST',unissuedPayload,{
    expectedStatus:201,requestId:unissuedPayload.requestId,
  })
  const unissuedId=Number(unissuedOrder.data.orderId)
  const unissuedItem=sql('SELECT id,quantity FROM order_items WHERE order_id=?',unissuedId)
  const oldReservation=()=>sql('SELECT id,quantity,status FROM inventory_reservations WHERE order_item_id=?',unissuedItem.id)
  const beforeOldPhysical=Number(stock().quantity)
  const beforeReplacementPhysical=Number(newStock().quantity)
  const beforeOldReserved=Number(stock().reserved_quantity)
  assert.equal(oldReservation().status,'active')
  assert.equal(Number(oldReservation().quantity),2)
  assert(beforeOldReserved>=2)
  const partialLegacyInput={
    orderId:unissuedId,exchangeDate:'2026-10-20',
    oldItemId:unissuedItem.id,oldQuantity:1,
    oldPhysicalState:'not_issued',oldReturnSource:'none',
    newItem:{...legacyCreatePayload.items[0],color:newColor,quantity:1},
    financialAction:'none',financialAmount:0,paymentMethod:'',
    comment:'Частичный обмен невыданной вещи: 2 старые, одна заменяется',
  }
  const partial=await api('/api/exchanges','POST',partialLegacyInput,{
    expectedStatus:201,requestId:'stability-unissued-partial-one',
  })
  const partialExchangeId=Number(partial.data.exchangeId)
  assert(partialExchangeId>0)
  assert.equal(Number(sql('SELECT quantity FROM order_items WHERE id=?',unissuedItem.id).quantity),1)
  assert.equal(Number(stock().quantity),beforeOldPhysical,'Unissued old item must not alter Physical')
  assert.equal(Number(newStock().quantity),beforeReplacementPhysical-1,'New item consumes one exact SKU')
  assert.equal(oldReservation().status,'active','Remaining old unit MUST retain active reservation')
  assert.equal(Number(oldReservation().quantity),1,'Remaining old unit MUST retain exact quantity 1')
  assert.equal(Number(stock().reserved_quantity),beforeOldReserved-1,'Only one reserved old unit must be freed')
  await api('/api/exchanges','POST',partialLegacyInput,{
    expectedStatus:201,requestId:'stability-unissued-partial-one',
  })
  assert.equal(Number(stock().reserved_quantity),beforeOldReserved-1,'Retry must not release twice')
  assert.equal(Number(oldReservation().quantity),1)
  const undonePartial=await api('/api/exchanges/'+partialExchangeId+'/cancel','PATCH',{},{
    requestId:'stability-unissued-partial-undo',
  })
  assert(undonePartial.data.ok)
  assert.equal(Number(sql('SELECT quantity FROM order_items WHERE id=?',unissuedItem.id).quantity),2)
  assert.equal(oldReservation().status,'active')
  assert.equal(Number(oldReservation().quantity),2)
  assert.equal(Number(stock().reserved_quantity),beforeOldReserved)
  assert.equal(Number(stock().quantity),beforeOldPhysical)
  assert.equal(Number(newStock().quantity),beforeReplacementPhysical)
  await api('/api/exchanges/'+partialExchangeId+'/cancel','PATCH',{},{
    requestId:'stability-unissued-partial-undo',
  })
  assert.equal(Number(stock().reserved_quantity),beforeOldReserved)
  // Two independent partial exchanges of one never-issued 2-unit line:
  // 2->1 active, 1->0 released, cancel last 0->1, cancel first 1->2.
  const seq1=await api('/api/exchanges','POST',partialLegacyInput,{
    expectedStatus:201,requestId:'stability-unissued-sequential-first',
  })
  assert.equal(oldReservation().status,'active')
  assert.equal(Number(oldReservation().quantity),1)
  const seq2=await api('/api/exchanges','POST',partialLegacyInput,{
    expectedStatus:201,requestId:'stability-unissued-sequential-second',
  })
  assert(Number(seq1.data.exchangeId)>0 && Number(seq2.data.exchangeId)>0)
  assert.equal(Number(sql('SELECT quantity FROM order_items WHERE id=?',unissuedItem.id).quantity),0)
  assert.equal(oldReservation().status,'released')
  assert.equal(Number(stock().reserved_quantity),beforeOldReserved-2)
  assert.equal(Number(stock().quantity),beforeOldPhysical,'Two unissued swaps never remove old physical')
  assert.equal(Number(newStock().quantity),beforeReplacementPhysical-2,'Two replacement units leave physical')
  await api('/api/exchanges/'+Number(seq2.data.exchangeId)+'/cancel','PATCH',{},{
    requestId:'stability-unissued-sequential-undo-last',
  })
  assert.equal(oldReservation().status,'active')
  assert.equal(Number(oldReservation().quantity),1)
  assert.equal(Number(stock().reserved_quantity),beforeOldReserved-1)
  await api('/api/exchanges/'+Number(seq1.data.exchangeId)+'/cancel','PATCH',{},{
    requestId:'stability-unissued-sequential-undo-first',
  })
  assert.equal(oldReservation().status,'active')
  assert.equal(Number(oldReservation().quantity),2)
  assert.equal(Number(stock().reserved_quantity),beforeOldReserved)
  assert.equal(Number(newStock().quantity),beforeReplacementPhysical)

  // Interrupt cancellation AFTER restoring order item/new stock but BEFORE
  // restoring the partial old reservation: same requestId must complete once.
  const failCancelSwap=await api('/api/exchanges','POST',partialLegacyInput,{
    expectedStatus:201,requestId:'stability-unissued-failcancel-create',
  })
  const failCancelId=Number(failCancelSwap.data.exchangeId)
  assert.equal(Number(oldReservation().quantity),1)
  failNextSqlWriteContaining='SET quantity = ?, status = ?, released_at = NULL, updated_at = ?'
  const cancelledHalf=await api('/api/exchanges/'+failCancelId+'/cancel','PATCH',{},{
    expectedStatus:500,requestId:'stability-unissued-failcancel-undo',
  })
  assert.equal(cancelledHalf.data.ok,false,'Injected cancellation must actually fail')
  assert.equal(Number(oldReservation().quantity),1,'Before retry reserve must not have changed')
  const recoveredCancel=await api('/api/exchanges/'+failCancelId+'/cancel','PATCH',{},{
    requestId:'stability-unissued-failcancel-undo',
  })
  assert(recoveredCancel.data.ok)
  assert.equal(oldReservation().status,'active')
  assert.equal(Number(oldReservation().quantity),2)
  assert.equal(Number(stock().reserved_quantity),beforeOldReserved)
  assert.equal(Number(stock().quantity),beforeOldPhysical)
  assert.equal(Number(newStock().quantity),beforeReplacementPhysical)
  await api('/api/exchanges/'+failCancelId+'/cancel','PATCH',{},{
    requestId:'stability-unissued-failcancel-undo',
  })
  assert.equal(Number(oldReservation().quantity),2,'Recovered cancellation replay cannot inflate reserve')
  console.log('MAIN_LEGACY_UNISSUED_SEQUENTIAL_AND_FAILCANCEL_PASSED: 2->1->0, undo 0->1->2, injected partial cancellation recovered')
  console.log('MAIN_LEGACY_PARTIAL_UNISSUED_RESERVE_PASSED: 2->1 active reserve, no old physical writeoff, full cancel 1->2, retries harmless')
  // Partial never-issued legacy exchange must NOT strand the remaining unit.
  // After the 2->1 reserve split, shipping the still-active old line must consume
  // exactly one Physical; the already-exchanged new item must not be sent twice.
  await api('/api/inventory/movements','POST',{
    requestId:'stability-unissued-then-ship-old',inventorySource:'warehouse',movementType:'arrival',
    items:[{productId,variantId,productName:name,gender:'ЖЕН',color,
      material:'СТАНДАРТ',length:'СТАНДАРТ',size,quantity:3}],
  })
  await api('/api/inventory/movements','POST',{
    requestId:'stability-unissued-then-ship-new',inventorySource:'warehouse',movementType:'arrival',
    items:[{productId,variantId:newVariantId,productName:name,gender:'ЖЕН',color:newColor,
      material:'СТАНДАРТ',length:'СТАНДАРТ',size,quantity:2}],
  })
  const shipAfterSwapPayload={
    ...unissuedPayload,requestId:'stability-unissued-then-ship',customerPhone:'77010000007',
  }
  const shipAfterSwap=await api('/api/orders','POST',shipAfterSwapPayload,{
    expectedStatus:201,requestId:shipAfterSwapPayload.requestId,
  })
  const remainingOrderId=Number(shipAfterSwap.data.orderId)
  const remainingOldItem=sql('SELECT id FROM order_items WHERE order_id=?',remainingOrderId)
  const afterSwapPayload={
    ...partialLegacyInput,orderId:remainingOrderId,oldItemId:remainingOldItem.id,
  }
  const swapOnce=await api('/api/exchanges','POST',afterSwapPayload,{
    expectedStatus:201,requestId:'stability-unissued-then-ship-swap',
  })
  assert(swapOnce.data.ok)
  const activeBeforeShip=sql('SELECT status,quantity FROM inventory_reservations WHERE order_item_id=?',remainingOldItem.id)
  assert.equal(activeBeforeShip.status,'active')
  assert.equal(Number(activeBeforeShip.quantity),1)
  const physicalOldBeforeShip=Number(stock().quantity)
  const physicalNewBeforeShip=Number(newStock().quantity)
  await api('/api/orders/'+remainingOrderId+'/shipping','PATCH',ship)
  const fulfilledAfterShip=sql('SELECT status,quantity FROM inventory_reservations WHERE order_item_id=?',remainingOldItem.id)
  assert.equal(fulfilledAfterShip.status,'fulfilled','Remaining old item must be physically issued exactly once')
  assert.equal(Number(fulfilledAfterShip.quantity),1)
  assert.equal(Number(stock().quantity),physicalOldBeforeShip-1)
  assert.equal(Number(newStock().quantity),physicalNewBeforeShip,'Already-issued exchanged new SKU cannot be sent twice')
  await api('/api/orders/'+remainingOrderId+'/shipping','PATCH',ship)
  assert.equal(Number(stock().quantity),physicalOldBeforeShip-1)
  assert.equal(Number(newStock().quantity),physicalNewBeforeShip)
  console.log('MAIN_LEGACY_UNISSUED_PARTIAL_THEN_SHIP_PASSED: residual active 1 -> fulfilled 1, original Physical -1, exchanged SKU not double issued')
  // Legacy historical inconsistency: the row says physically issued, but
  // its exact SKU reservation is STILL ACTIVE (production forensic #510 showed
  // such a completed-return-vs-live-reservation class of conflict).
  // A new physical intake must fail closed instead of silently adding Physical
  // while leaving an active reservation that later shipping might consume.
  await api('/api/inventory/movements','POST',{
    requestId:'stability-inconsistent-return-arrival',inventorySource:'warehouse',
    movementType:'arrival',
    items:[{productId,variantId,productName:name,gender:'ЖЕН',color,
      material:'СТАНДАРТ',length:'СТАНДАРТ',size,quantity:1}],
  })
  const inconsistentPayload={
    ...orderPayload,requestId:'stability-inconsistent-return-order',
    customerPhone:'77010000008',items:[{...orderPayload.items[0],quantity:1}],
    payments:[{paymentDate:'2026-10-20',method:'НАЛИЧКА',paymentKind:'primary',amount:2000}],
  }
  const inconsistentCreated=await api('/api/orders','POST',inconsistentPayload,{
    expectedStatus:201,requestId:inconsistentPayload.requestId,
  })
  const inconsistentOrderId=Number(inconsistentCreated.data.orderId)
  const inconsistentLineId=Number(sql('SELECT id FROM order_items WHERE order_id=?',inconsistentOrderId).id)
  assert.equal(sql('SELECT status FROM inventory_reservations WHERE order_item_id=?',inconsistentLineId).status,'active')
  const inconsistentPhysical=Number(stock().quantity)
  const inconsistentReserved=Number(stock().reserved_quantity)
  // Simulate an already-broken historical row; this is TEST-ONLY data and
  // is not produced by or run against live order data.
  sqlite.prepare("UPDATE order_items SET stock_writeoff_status='written_off' WHERE id=?").run(inconsistentLineId)
  const refused=await api('/api/returns','POST',{
    orderId:inconsistentOrderId,returnDate:'2026-10-20',amount:0,
    items:[{orderItemId:inconsistentLineId,quantity:1,physicalState:'warehouse',restock:true}],
  },{expectedStatus:409,requestId:'stability-contradictory-issued-reserve-return'})
  assert.equal(refused.data.ok,false)
  assert.match(String(refused.data.message||''),/резерв|выдач/i)
  assert.equal(count('returns','order_id='+inconsistentOrderId),0,'Conflicting return must not create a return')
  assert.equal(Number(stock().quantity),inconsistentPhysical,'Conflicting return must not add physical')
  assert.equal(Number(stock().reserved_quantity),inconsistentReserved)
  // Money-only refund stays intentionally available even if physical evidence
  // is contradictory. It cannot touch stock or reservations.
  const moneyOnly=await api('/api/returns','POST',{
    orderId:inconsistentOrderId,returnDate:'2026-10-20',amount:1000,paymentMethod:'НАЛИЧКА',items:[],
  },{expectedStatus:201,requestId:'stability-contradictory-money-only'})
  assert(Number(moneyOnly.data.returnId)>0)
  assert.equal(Number(stock().quantity),inconsistentPhysical)
  assert.equal(Number(stock().reserved_quantity),inconsistentReserved)
  console.log('MAIN_RETURN_ACTIVE_RESERVATION_CONFLICT_PASSED: unissued active reserve cannot be physically returned twice, money-only refund remains possible')

  // Delayed physical return intake can occur days AFTER the Return was
  // registered. A newly active reserve must be checked again on actual intake
  // (reproduction of order 1563 / return 43 category, no live writes).
  const pendingReturn=(await api('/api/returns','POST',{
    orderId,returnDate:'2026-10-20',amount:0,
    items:[{orderItemId:item.id,quantity:1,physicalState:'pending',restock:false}],
  },{expectedStatus:201,requestId:'stability-late-intake-create'})).data
  const pendingReturnId=Number(pendingReturn.returnId)
  assert(pendingReturnId>0)
  const pendingReturnItem=sql('SELECT id,physical_received_at FROM return_items WHERE return_id=?',pendingReturnId)
  assert(pendingReturnItem?.id && !pendingReturnItem.physical_received_at)
  const oldReservationRow=sql('SELECT id,status,quantity FROM inventory_reservations WHERE order_item_id=?',item.id)
  assert.equal(oldReservationRow.status,'fulfilled')
  // This injects a historical inconsistency ONLY in the disposable test DB:
  // reservation has been improperly reopened between Return and intake.
  sqlite.prepare("UPDATE inventory_reservations SET status='active',fulfilled_at=NULL,released_at=NULL WHERE id=?").run(oldReservationRow.id)
  sqlite.prepare("UPDATE inventory_stock SET reserved_quantity=reserved_quantity+1 WHERE inventory_source='warehouse' AND variant_id=?").run(variantId)
  const beforeLateIntake=Number(stock().quantity)
  const beforeLateReserved=Number(stock().reserved_quantity)
  // Earlier scenario performed a quick stock-check; at one-second SQLite
  // datetime precision it can fall inside the receipt freshness window.
  // Reproduce the explicit user freshness choice iff the check actually exists,
  // so the independent active-reservation guard is tested deterministically.
  const receiptRegisteredAt=sql('SELECT created_at FROM return_items WHERE id=?',pendingReturnItem.id).created_at
  const newerCheck=sql("SELECT id FROM inventory_stock_checks WHERE inventory_source='warehouse' AND variant_id=? AND datetime(checked_at)>=datetime(?) LIMIT 1",variantId,receiptRegisteredAt)
  const delayedAttempt=await api('/api/returned-items/receive','POST',{
    operationType:'return',operationId:pendingReturnId,operationItemId:pendingReturnItem.id,
    destination:'warehouse',requestId:'stability-late-intake-conflict',
    ...(newerCheck?{freshnessDecision:'arrived_after_check'}:{}),
  },{expectedStatus:409})
  assert.equal(delayedAttempt.data.ok,false)
  assert.match(String(delayedAttempt.data.message||''),/резерв|выдач/i)
  assert.equal(Number(stock().quantity),beforeLateIntake,'Conflicting late intake cannot credit physical')
  assert.equal(Number(stock().reserved_quantity),beforeLateReserved,'Intake cannot drop unrelated active reserve')
  assert.equal(sql('SELECT physical_received_at FROM return_items WHERE id=?',pendingReturnItem.id).physical_received_at,null)
  assert.equal(sql('SELECT COUNT(*) AS n FROM inventory_lifecycle_events WHERE operation_type=\'return\' AND operation_id=?',pendingReturnId).n,0)
  console.log('MAIN_LATE_RETURN_RECEIPT_ACTIVE_RESERVE_BLOCKED: historical pending Return cannot receive physical item while original SKU reservation is active')

  // Production #1563 class: order still UNSENT, active reservation still holds,
  // yet a standalone completed Return has already named the same order_item.
  // Historical import had mixed actual physical intake, so shipment cannot
  // silently deduct that item again just because Physical is >0.
  await api('/api/inventory/movements','POST',{
    requestId:'stability-legacy-return-shipping-arrival',inventorySource:'warehouse',
    movementType:'arrival',
    items:[{productId,variantId,productName:name,gender:'ЖЕН',color,
      material:'СТАНДАРТ',length:'СТАНДАРТ',size,quantity:2}],
  })
  const historicConflictPayload={
    ...orderPayload,requestId:'stability-historic-return-ship-order',
    customerPhone:'77010000009',items:[{...orderPayload.items[0],quantity:1}],
    payments:[],
  }
  const histOrder=(await api('/api/orders','POST',historicConflictPayload,{
    expectedStatus:201,requestId:historicConflictPayload.requestId,
  })).data
  const historicOrderId=Number(histOrder.orderId)
  const historicItemId=Number(sql('SELECT id FROM order_items WHERE order_id=?',historicOrderId).id)
  assert.equal(sql('SELECT status FROM inventory_reservations WHERE order_item_id=?',historicItemId).status,'active')
  const insertReturn=sqlite.prepare(
    "INSERT INTO returns (order_id,manager_id,return_date,amount,comment,status,created_at) VALUES (?,?,?,?,?,'completed',?)"
  ).run(historicOrderId,managerId,'2026-10-20',0,'Synthetic historical orphaned Return','2026-10-20T00:00:00Z')
  const historicalReturnId=Number(insertReturn.lastInsertRowid)
  sqlite.prepare(
    'INSERT INTO return_items (return_id,order_item_id,product_name_snapshot,quantity,amount,inventory_source,restocked,physical_tracking,physical_received_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)'
  ).run(historicalReturnId,historicItemId,name,1,0,'warehouse',1,1,'2026-10-20T00:00:00Z','2026-10-20T00:00:00Z')
  const physicalBeforeContradictoryShip=Number(stock().quantity)
  const reserveBeforeContradictoryShip=Number(stock().reserved_quantity)
  const stopped=await api('/api/orders/'+historicOrderId+'/shipping','PATCH',ship,{
    expectedStatus:409,requestId:'stability-historic-return-shipping-block',
  })
  assert.equal(stopped.data.code,'return_reservation_conflict')
  // The same safeguard MUST cover the "Выдать готовые товары" / issue_now
  // endpoint, not only full-order shipment.
  const perItemBlocked=await api('/api/orders/'+historicOrderId+'/stock-handover','PATCH',{
    action:'issue_now',orderItemId:historicItemId,
  },{expectedStatus:409,requestId:'stability-historic-return-early-issue-block'})
  assert.equal(perItemBlocked.data.code,'return_reservation_conflict')
  assert.equal(Number(stock().quantity),physicalBeforeContradictoryShip)
  assert.equal(Number(stock().reserved_quantity),reserveBeforeContradictoryShip)
  assert.equal(sql('SELECT shipping_status FROM orders WHERE id=?',historicOrderId).shipping_status,'not_sent')
  assert.equal(sql('SELECT status FROM inventory_reservations WHERE order_item_id=?',historicItemId).status,'active')
  console.log('MAIN_RETURN_RESERVATION_SHIPMENT_CONFLICT_BLOCKED: completed Return with active line reserve cannot issue same item a second time')

  // Administrator/manager editor contract: isolate safe metadata and price
  // corrections; stale snapshots must refuse without touching money or stock.
  // Every order below is a synthetic API-created record in the disposable DB.
  await api('/api/inventory/movements','POST',{
    requestId:'stability-editor-stock',inventorySource:'warehouse',movementType:'arrival',
    items:[{productId,variantId,productName:name,gender:'ЖЕН',color,
      material:'СТАНДАРТ',length:'СТАНДАРТ',size,quantity:4}],
  })
  const editorPayload={
    ...orderPayload,requestId:'stability-editor-create',customerPhone:'77010000901',
    items:[{...orderPayload.items[0],quantity:1}],
    payments:[{paymentDate:'2026-10-20',method:'НАЛИЧКА',paymentKind:'primary',amount:2000}],
  }
  const editorCreated=(await api('/api/orders','POST',editorPayload,{
    expectedStatus:201,requestId:editorPayload.requestId,
  })).data
  const editorId=Number(editorCreated.orderId)
  const editorRecord=()=>sql('SELECT order_date,customer_phone,customer_name,city,delivery_type,comment,total_amount,received_amount,debt_amount,return_amount,shipping_status,order_status FROM orders WHERE id=?',editorId)
  const snapshot=editorRecord()
  const originalReserved=Number(stock().reserved_quantity)
  const originalPhysical=Number(stock().quantity)
  const expectedMetadata={
    orderDate:String(snapshot.order_date||''),customerPhone:String(snapshot.customer_phone||''),
    customerName:String(snapshot.customer_name||''),city:String(snapshot.city||''),
    deliveryType:String(snapshot.delivery_type||''),comment:String(snapshot.comment||''),
  }
  const metadataPatch={metadataCorrection:{
    expected:expectedMetadata,
    next:{...expectedMetadata,city:'АСТАНА',comment:'Изолированный тест изменения реквизитов'},
    expectedState:{
      totalAmount:Number(snapshot.total_amount),receivedAmount:Number(snapshot.received_amount),
      debtAmount:Number(snapshot.debt_amount),returnAmount:Number(snapshot.return_amount),
      shippingStatus:String(snapshot.shipping_status),orderStatus:String(snapshot.order_status),
    },
  }}
  const metadataUpdated=await api('/api/orders/'+editorId,'PATCH',metadataPatch,{
    expectedStatus:200,requestId:'stability-metadata-update',
  })
  assert(metadataUpdated.data.ok)
  assert.equal(editorRecord().city,'АСТАНА')
  assert.equal(editorRecord().comment,'Изолированный тест изменения реквизитов')
  assert.equal(Number(stock().quantity),originalPhysical)
  assert.equal(Number(stock().reserved_quantity),originalReserved)
  assert.equal(editorRecord().received_amount,2000)
  await api('/api/orders/'+editorId,'PATCH',metadataPatch,{
    expectedStatus:200,requestId:'stability-metadata-update',
  })
  const staleMetadata=await api('/api/orders/'+editorId,'PATCH',metadataPatch,{
    expectedStatus:409,requestId:'stability-metadata-stale-other-employee',
  })
  assert.equal(staleMetadata.data.ok,false)
  assert.equal(editorRecord().city,'АСТАНА')
  assert.equal(count('payments','order_id='+editorId),1)
  console.log('MAIN_EDITOR_METADATA_CAS_PASSED: admin safe details edit, retry, stale cross-staff guard and zero inventory/payment drift')

  // Price correction has its own original-value CAS and updates booked total,
  // not historical cash, exact SKU, order quantity or warehouse Physical.
  const editorItem=sql('SELECT id,unit_price,line_total,catalog_price_snapshot,quantity FROM order_items WHERE order_id=?',editorId)
  assert.equal(Number(editorItem.unit_price),10000)
  const pricePatch={itemPriceCorrections:[{
    orderItemId:editorItem.id,unitPrice:11000,
    expectedUnitPrice:Number(editorItem.unit_price),
    expectedLineTotal:Number(editorItem.line_total),
    expectedQuantity:Number(editorItem.quantity),
    expectedCatalogPriceSnapshot:editorItem.catalog_price_snapshot,
  }]}
  const changedPrice=await api('/api/orders/'+editorId,'PATCH',pricePatch,{
    expectedStatus:200,requestId:'stability-price-fix',
  })
  assert(changedPrice.data.ok)
  assert.equal(Number(sql('SELECT unit_price FROM order_items WHERE id=?',editorItem.id).unit_price),11000)
  assert.equal(Number(editorRecord().total_amount),11000)
  assert.equal(Number(editorRecord().received_amount),2000)
  assert.equal(Number(editorRecord().debt_amount),9000)
  assert.equal(Number(stock().quantity),originalPhysical)
  assert.equal(Number(stock().reserved_quantity),originalReserved)
  await api('/api/orders/'+editorId,'PATCH',pricePatch,{expectedStatus:200,requestId:'stability-price-fix'})
  const stalePrice=await api('/api/orders/'+editorId,'PATCH',pricePatch,{
    expectedStatus:409,requestId:'stability-price-stale',
  })
  assert.equal(stalePrice.data.ok,false)
  assert.equal(Number(editorRecord().total_amount),11000)
  assert.equal(count('payments','order_id='+editorId),1)
  console.log('MAIN_EDITOR_PRICE_CAS_PASSED: recorded item price update, repeat idempotent, stale price rejected and exact inventory/cash preserved')

  // No user, not even admin, may bypass impact preview by PATCHing a deleted
  // status in the full editor; DELETE requires the current fingerprint.
  await api('/api/orders/'+editorId,'PATCH',{orderStatus:'deleted'},{
    expectedStatus:409,requestId:'stability-editor-illegal-delete',
  })
  const beforeDelete=await api('/api/orders/'+editorId+'/delete-preview')
  assert(beforeDelete.data.ok)
  assert.equal(beforeDelete.data.preview.canAttemptDelete,true)
  const deleteFingerprint=beforeDelete.data.preview.chainPlan.snapshotFingerprint
  assert.match(deleteFingerprint,/^[0-9a-f]{64}$/)
  await api('/api/orders/'+editorId+'/delete','POST',{
    requestId:'stability-delete-no-snapshot',
  },{expectedStatus:409,requestId:'stability-delete-no-snapshot'})
  assert.equal(editorRecord().order_status,'active')
  assert.equal(Number(stock().reserved_quantity),originalReserved)
  const deleted=await api('/api/orders/'+editorId+'/delete','POST',{
    requestId:'stability-delete-with-preview',
    expectedSnapshot:deleteFingerprint,
    comment:'Тест безопасного удаления невыданного заказа',
  },{expectedStatus:200,requestId:'stability-delete-with-preview'})
  assert(deleted.data.ok)
  assert.equal(editorRecord().order_status,'deleted')
  assert.equal(Number(stock().quantity),originalPhysical,'Deleting unissued order must preserve physical')
  assert.equal(Number(stock().reserved_quantity),originalReserved-1,'Unissued order reserve must be released once')
  await api('/api/orders/'+editorId+'/delete','POST',{
    requestId:'stability-delete-with-preview',
    expectedSnapshot:deleteFingerprint,
  },{expectedStatus:200,requestId:'stability-delete-with-preview'})
  assert.equal(Number(stock().reserved_quantity),originalReserved-1)
  assert.equal(Number(stock().quantity),originalPhysical)
  console.log('MAIN_DELETE_UNISSUED_PREVIEW_PASSED: no delete without current snapshot, paid order deleted, exact reserve freed once, Physical untouched')

  // A money-only Return is a separate completed linked operation. Direct
  // Delete may never silently erase this Return and its refund: admin must
  // use the previewed chain workflow and account for each cancellation.
  const linkedPayload={
    ...editorPayload,requestId:'stability-linked-return-create',customerPhone:'77010000902',
  }
  const linked=(await api('/api/orders','POST',linkedPayload,{
    expectedStatus:201,requestId:linkedPayload.requestId,
  })).data
  const linkedId=Number(linked.orderId)
  const linkedRefund=(await api('/api/returns','POST',{
    orderId:linkedId,returnDate:'2026-10-20',amount:1000,
    paymentMethod:'НАЛИЧКА',items:[],
  },{expectedStatus:201,requestId:'stability-linked-return-refund'})).data
  assert(Number(linkedRefund.returnId)>0)
  const activeLinked=await api('/api/orders/'+linkedId+'/delete-preview')
  assert(activeLinked.data.preview.activeReturns.includes(Number(linkedRefund.returnId)))
  assert.equal(activeLinked.data.preview.canAttemptDelete,false)
  const linkedBefore=sql('SELECT received_amount,return_amount,order_status FROM orders WHERE id=?',linkedId)
  await api('/api/orders/'+linkedId+'/delete','POST',{
    expectedSnapshot:activeLinked.data.preview.chainPlan.snapshotFingerprint,
    requestId:'stability-delete-linked-return-unsafe',
  },{expectedStatus:409,requestId:'stability-delete-linked-return-unsafe'})
  const linkedAfter=sql('SELECT received_amount,return_amount,order_status FROM orders WHERE id=?',linkedId)
  assert.deepEqual(linkedAfter,linkedBefore)
  assert.equal(sql('SELECT status FROM returns WHERE id=?',Number(linkedRefund.returnId)).status,'completed')
  console.log('MAIN_DELETE_LINKED_RETURN_GUARD_PASSED: active Return/refund forces previewed chain, direct deletion cannot silently erase money')
  console.log('MAIN_FOUNDATION_WORKER_SQLITE_PASSED: '+migrations.length+' migrations, auth, Catalog SKU, Arrival, itemized order/payment, reserve/replay, shipping/replay, exact stock check, checkpoint review, still-here decision, no double physical outbound; ZERO remote D1.')

} finally {
  sqlite.close()
}
