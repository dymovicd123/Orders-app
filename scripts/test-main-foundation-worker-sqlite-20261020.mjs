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

  console.log('MAIN_FOUNDATION_WORKER_SQLITE_PASSED: full '+migrations.length+' migrations, auth bootstrap, exact Catalog SKU, Arrival, itemized order+payment, active reservation, duplicate create, ship and duplicate ship. ZERO remote D1.')
} finally {
  sqlite.close()
}
