import assert from 'node:assert/strict'
import fs from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { build } from 'esbuild'
import { createEmptyOrderDraft, createEmptyEditorPayment } from '../src/app/utils.ts'
import { admitOrderReservationAtomically, recoverPendingOrderReservationsBeforeShipping } from '../worker/domains/reservation-admission.ts'

// In-memory SQLite, not remote D1. Exercise the exact candidate SQL and triggers.
const sql=new DatabaseSync(':memory:')
sql.exec([
'CREATE TABLE inventory_stock(id INTEGER PRIMARY KEY, inventory_source TEXT, variant_id INTEGER, quantity INTEGER, reserved_quantity INTEGER, product_id INTEGER, product_name_snapshot TEXT, gender_snapshot TEXT, color_snapshot TEXT, material_snapshot TEXT, length_snapshot TEXT, size_snapshot TEXT, last_action TEXT, last_source_ref TEXT, updated_at TEXT);',
'CREATE TABLE inventory_reservations(id INTEGER PRIMARY KEY, order_id INTEGER, order_item_id INTEGER UNIQUE, inventory_source TEXT, product_id INTEGER, variant_id INTEGER, quantity INTEGER, status TEXT, reference_type TEXT, reference_id TEXT, unresolved_reason TEXT, created_at TEXT, updated_at TEXT);',
'CREATE TABLE order_items(id INTEGER PRIMARY KEY,order_id INTEGER,stock_writeoff_status TEXT,stock_quantity_before INTEGER,stock_quantity_after INTEGER,is_workshop INTEGER DEFAULT 0,quantity INTEGER,product_id INTEGER,variant_id INTEGER);',
'CREATE TABLE orders(id INTEGER PRIMARY KEY,shipping_status TEXT DEFAULT "not_sent",order_status TEXT DEFAULT "active",archived_at TEXT);',
'CREATE TABLE catalog_products(id INTEGER PRIMARY KEY,is_active INTEGER);',
'CREATE TABLE catalog_variants(id INTEGER PRIMARY KEY,product_id INTEGER,is_active INTEGER);',
'CREATE TABLE returns(id INTEGER PRIMARY KEY,status TEXT);',
'CREATE TABLE return_items(id INTEGER PRIMARY KEY,return_id INTEGER,order_item_id INTEGER);',
'INSERT INTO catalog_products VALUES(12,1);',
'INSERT INTO catalog_variants VALUES(7,12,1),(8,12,1);',
'CREATE TABLE inventory_stock_audit(stock_id INTEGER, old_reserved INTEGER, new_reserved INTEGER);',
'CREATE TRIGGER inventory_stock_after_reserve AFTER UPDATE OF reserved_quantity ON inventory_stock BEGIN INSERT INTO inventory_stock_audit VALUES(new.id,old.reserved_quantity,new.reserved_quantity); END;',
"INSERT INTO inventory_stock(id,inventory_source,variant_id,quantity,reserved_quantity) VALUES (1,'warehouse',7,1,0),(2,'boutique',7,3,0),(3,'warehouse',8,0,0);",
].join('\n'))
let batchTail=Promise.resolve()
const db={
 prepare(query){let args=[];return {
  bind(...values){args=values;return this},
  async first(){return sql.prepare(query).get(...args)??null},
  async all(){return {results:sql.prepare(query).all(...args)}},
  async run(){const m=sql.prepare(query).run(...args);return {meta:{changes:m.changes,last_row_id:m.lastInsertRowid}}}
 }},
 async batch(statements){
  // D1 serializes SQLite atomic batches; this adapter queues concurrent callers
  // on one in-memory connection so Promise.all tests contention, not nested BEGIN.
  const prior=batchTail
  let release
  batchTail=new Promise(resolve=>{release=resolve})
  await prior
  try{
    sql.exec('BEGIN IMMEDIATE')
    try{const values=[];for(const stmt of statements)values.push(await stmt.run());sql.exec('COMMIT');return values}
    catch(e){sql.exec('ROLLBACK');throw e}
  }finally{release()}
 }
}
let seq=10
function request(orderId,source='warehouse',variantId=7,quantity=1,options={}){
 const orderItemId=++seq
 sql.prepare('INSERT INTO orders(id) VALUES (?)').run(orderId)
 sql.prepare('INSERT INTO order_items(id,order_id,is_workshop,quantity,product_id,variant_id) VALUES (?,?,?,?,?,?)').run(orderItemId,orderId,0,quantity,12,variantId)
 return {orderId,orderItemId,source,stockId:source==='boutique'?2:variantId===8?3:1,
 productId:12,variantId,quantity,productName:'ПАЛЬТО',gender:'ЖЕН',color:'ЧЕРНЫЙ',
 material:'ДРАП',length:'СТАНДАРТ',size:'46',referenceType:'order',
 referenceId:'TEST-'+orderId,timestamp:'2026-11-01T20:00:00Z',
 shortageAcknowledged:false,shortageDecision:null,...options}
}
const get=(q,...a)=>sql.prepare(q).get(...a)
const first=request(1), second=request(2)
const out=await Promise.all([admitOrderReservationAtomically(db,first),admitOrderReservationAtomically(db,second)])
assert.deepEqual(out.map(x=>x.status),['active','unresolved'])
assert.equal(out[1].reason,'concurrent_shortage')
assert.equal(get('SELECT quantity FROM inventory_stock WHERE id=1').quantity,1)
assert.equal(get('SELECT reserved_quantity AS r FROM inventory_stock WHERE id=1').r,1)
assert.equal(get('SELECT stock_writeoff_status AS s FROM order_items WHERE id=?',second.orderItemId).s,'pending_reservation')
assert.equal(get('SELECT count(*) AS n FROM inventory_stock_audit').n,1)
assert.equal((await admitOrderReservationAtomically(db,request(3,'boutique',7,2))).status,'active')
assert.equal(get('SELECT reserved_quantity AS r FROM inventory_stock WHERE id=2').r,2)
const stale=request(4,'warehouse',7,1,{shortageAcknowledged:true,shortageDecision:{
 inventorySource:'warehouse',variantId:7,physicalQuantity:1,reservedQuantity:0,requestedQuantity:1
}})
assert.equal((await admitOrderReservationAtomically(db,stale)).status,'unresolved')
assert.equal(get('SELECT reserved_quantity AS r FROM inventory_stock WHERE id=1').r,1)
assert.equal((await admitOrderReservationAtomically(db,request(5,'warehouse',8,1))).status,'unresolved')
assert.equal(get('SELECT reserved_quantity AS r FROM inventory_stock WHERE id=3').r,0)
assert.equal((await admitOrderReservationAtomically(db,request(6,'warehouse',8,1,{stockId:1}))).status,'unresolved')
assert.equal(get('SELECT reserved_quantity AS r FROM inventory_stock WHERE id=1').r,1)
const acknowledged=request(7,'warehouse',7,1,{shortageAcknowledged:true,shortageDecision:{
 inventorySource:'warehouse',variantId:7,physicalQuantity:1,reservedQuantity:1,requestedQuantity:1
}})
assert.equal((await admitOrderReservationAtomically(db,acknowledged)).status,'active')
assert.equal(get('SELECT reserved_quantity AS r FROM inventory_stock WHERE id=1').r,2)
assert.equal(get('SELECT quantity AS q FROM inventory_stock WHERE id=1').q,1)
assert.equal(get("SELECT count(*) AS n FROM inventory_reservations WHERE status='unresolved' AND unresolved_reason='concurrent_shortage'").n,4)
assert.equal(get("SELECT count(*) AS n FROM inventory_reservations WHERE status='active'").n,3)
assert.equal(get('SELECT count(*) AS n FROM inventory_stock_audit').n,3)
const module=fs.readFileSync('worker/domains/order-reservations.ts','utf8')
const worker=fs.readFileSync('worker/index.ts','utf8')
assert(module.includes('admitOrderReservationAtomically(db, {'))
assert(module.includes('shortageDecision: null'),'Main has no audited explicit shortage snapshot yet')
assert(module.includes('known_pending_reservation'))
assert(worker.includes("code: 'inventory_reservation_pending'"))

// Recovery is a separate call on an explicit shipping retry, not a catalog resolver.
// It never changes physical quantity, invents reservations or replaces the order item.
const priorSecond=get('SELECT id,order_item_id,status FROM inventory_reservations WHERE order_id=2')
assert.equal(priorSecond.status,'unresolved')
assert.deepEqual(await recoverPendingOrderReservationsBeforeShipping(db,2,'2026-11-01T20:01:00Z'),{attempted:1,activated:0})
assert.equal(get('SELECT reserved_quantity AS r FROM inventory_stock WHERE id=1').r,2)
sql.prepare('UPDATE inventory_stock SET quantity=3 WHERE id=1').run()
const twoAttempts=await Promise.all([
 recoverPendingOrderReservationsBeforeShipping(db,2,'2026-11-01T20:02:00Z'),
 recoverPendingOrderReservationsBeforeShipping(db,2,'2026-11-01T20:02:00Z'),
])
assert.equal(get('SELECT reserved_quantity AS r FROM inventory_stock WHERE id=1').r,3,'race must claim only one free unit')
assert.equal(get('SELECT quantity AS q FROM inventory_stock WHERE id=1').q,3,'recovery must not adjust physical truth')
assert.equal(get('SELECT status AS s FROM inventory_reservations WHERE id=?',priorSecond.id).s,'active')
assert.equal(get('SELECT stock_writeoff_status AS s FROM order_items WHERE id=?',second.orderItemId).s,'reserved')
assert.equal(get('SELECT order_item_id AS id FROM inventory_reservations WHERE id=?',priorSecond.id).id,second.orderItemId)
assert.equal(get('SELECT count(*) AS n FROM inventory_reservations').n,7,'no extra reservation record')
assert.equal((await recoverPendingOrderReservationsBeforeShipping(db,2,'2026-11-01T20:03:00Z')).attempted,0)
assert.equal(get('SELECT reserved_quantity AS r FROM inventory_stock WHERE id=1').r,3)

// Returned items, archived/sent orders, wrong identity, retired SKU are fail-closed.
const returned=request(8,'warehouse',8,1)
assert.equal((await admitOrderReservationAtomically(db,returned)).status,'unresolved')
sql.prepare("INSERT INTO returns(id,status) VALUES (1,'completed')").run()
sql.prepare('INSERT INTO return_items(id,return_id,order_item_id) VALUES (1,1,?)').run(returned.orderItemId)
sql.prepare('UPDATE inventory_stock SET quantity=8 WHERE id=3').run()
assert.equal((await recoverPendingOrderReservationsBeforeShipping(db,8,'2026-11-01T20:04:00Z')).attempted,0)
const sent=request(9,'warehouse',8,1)
assert.equal((await admitOrderReservationAtomically(db,sent)).status,'active')
const archived=request(10,'warehouse',8,1)
assert.equal((await admitOrderReservationAtomically(db,archived)).status,'active')
const future=request(11,'warehouse',8,1)
assert.equal((await admitOrderReservationAtomically(db,future)).status,'active')
// Reproduce pending for each negative case while keeping its original row and ID.
for(const row of [sent,archived,future]){
 sql.prepare("UPDATE inventory_reservations SET status='unresolved',unresolved_reason='concurrent_shortage' WHERE order_item_id=?").run(row.orderItemId)
 sql.prepare("UPDATE order_items SET stock_writeoff_status='pending_reservation' WHERE id=?").run(row.orderItemId)
}
sql.prepare("UPDATE orders SET shipping_status='sent' WHERE id=9").run()
sql.prepare("UPDATE orders SET order_status='archived' WHERE id=10").run()
sql.prepare('UPDATE order_items SET variant_id=7 WHERE id=?').run(future.orderItemId)
const beforeBlocked=get('SELECT reserved_quantity AS r FROM inventory_stock WHERE id=3').r
for(const id of [8,9,10,11])
 assert.equal((await recoverPendingOrderReservationsBeforeShipping(db,id,'2026-11-01T20:05:00Z')).attempted,0)
assert.equal(get('SELECT reserved_quantity AS r FROM inventory_stock WHERE id=3').r,beforeBlocked)
assert.equal(get('SELECT status AS s FROM inventory_reservations WHERE order_item_id=?',future.orderItemId).s,'unresolved')
const available=request(12,'warehouse',8,1)
assert.equal((await admitOrderReservationAtomically(db,available)).status,'active')
sql.prepare("UPDATE inventory_reservations SET status='unresolved',unresolved_reason='concurrent_shortage' WHERE order_item_id=?").run(available.orderItemId)
sql.prepare("UPDATE order_items SET stock_writeoff_status='pending_reservation' WHERE id=?").run(available.orderItemId)
const originalReservation=get('SELECT id FROM inventory_reservations WHERE order_item_id=?',available.orderItemId).id
const pre=get('SELECT reserved_quantity AS r FROM inventory_stock WHERE id=3').r
const healed=await recoverPendingOrderReservationsBeforeShipping(db,12,'2026-11-01T20:06:00Z')
assert.deepEqual(healed,{attempted:1,activated:1})
assert.equal(get('SELECT reserved_quantity AS r FROM inventory_stock WHERE id=3').r,pre+1)
assert.equal(get('SELECT id FROM inventory_reservations WHERE order_item_id=?',available.orderItemId).id,originalReservation)
assert.equal(get('SELECT stock_writeoff_status AS s FROM order_items WHERE id=?',available.orderItemId).s,'reserved')
assert.equal(get('SELECT quantity AS q FROM inventory_stock WHERE id=3').q,8)
assert.equal((await recoverPendingOrderReservationsBeforeShipping(db,12,'2026-11-01T20:07:00Z')).attempted,0)

// Check the actual bundled browser create-order boundary as well as Worker/SQLite.
// The payload and request ID must match the physical/reservation-safe server API.
const bundled = await build({
  entryPoints: ['src/features/orders/orderCreationActions.ts'],
  bundle: true, platform: 'node', format: 'esm', write: false, target: 'es2022', logLevel: 'silent',
})
const { createOrderCreationActions } = await import(
  'data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64')
)
const initialDraft = createEmptyOrderDraft()
let createDraft = {
  ...initialDraft,
  managerId: 7,
  managerName: 'QA MANAGER',
  orderDate: '2026-11-08',
  items: [{
    ...initialDraft.items[0],
    productName: 'QA ШАПАН',
    audienceType: 'ВЗРОСЛЫЙ', gender: 'ЖЕН',
    color: 'БЕЛЫЙ', material: 'СТАНДАРТ', length: 'СТАНДАРТ', size: '46',
    sourceType: 'warehouse', quantity: 1, unitPrice: 10000,
    catalogPriceSnapshot: null, priceOrigin: 'manual',
  }],
  payments: [{ ...createEmptyEditorPayment('2026-11-08'), method: 'КАРТА', amount: 3000, paymentKind: 'primary' }],
}
let capturedRequests = []
let completedCritical = []
let invalidated = []
let addedOrder = null
let lastMessage = ''
let lastError = ''
let orderBusy = false
const baseArgs = {
  catalogData: null, orderPanel: 'create', authUser: null,
  references: null, activeSector: 'orders',
  getSizeOptions: () => ['44', '46'],
  setOrderBusy: value => { orderBusy = value },
  setError: value => { lastError = value },
  setMessage: value => { lastMessage = value },
  setOrderPanel: () => {}, setSelectedOrderId: () => {},
  setEditorDraft: () => {}, setEditorOpen: () => {},
  prepareCriticalRequest: (key, payload) => ({ requestId: 'qa-safe-create-1', payload: { ...payload, requestId: 'qa-safe-create-1' } }),
  completeCriticalRequest: (key, id) => { completedCritical.push({ key, id }) },
  apiFetch: async (url, options = {}) => {
    capturedRequests.push({ url: String(url), options })
    return new Response(JSON.stringify({
      ok: true, orderId: 902, externalId: 'QA-902',
      totalAmount: 10000, receivedAmount: 3000, debtAmount: 7000, stockWriteOff: [],
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  },
  invalidateFinanceReadCaches: () => invalidated.push('finance'),
  invalidateInventoryStockCaches: include => invalidated.push(include ? 'stock-catalog' : 'stock'),
  upsertOrderInState: order => { addedOrder = order },
  refreshOrderList: () => {}, refreshWorkshop: () => {}, refreshOrderFinance: () => {},
  setCreateDraft: updater => { createDraft = typeof updater === 'function' ? updater(createDraft) : updater },
}
let creator = createOrderCreationActions({ ...baseArgs, createDraft })
creator.updateCreateDraft('orderDate', '2026-11-05')
assert.equal(createDraft.payments[0].paymentDate, '2026-11-05',
  'Changing the order date must also synchronize primary payment date')
assert.equal(createDraft.orderDate, '2026-11-05')
const readyDraft = structuredClone(createDraft)
creator = createOrderCreationActions({ ...baseArgs, createDraft })
await creator.createOrderFromDraft()
assert.equal(capturedRequests.length, 1, 'One order save must send exactly one critical POST')
assert.equal(capturedRequests[0].url, '/api/orders')
assert.equal(capturedRequests[0].options.method, 'POST')
assert.equal(capturedRequests[0].options.headers['X-Idempotency-Key'], 'qa-safe-create-1')
const payload = JSON.parse(capturedRequests[0].options.body)
assert.equal(payload.requestId, 'qa-safe-create-1')
assert.equal(payload.orderDate, '2026-11-05')
assert.equal(payload.pricingMode, 'itemized_v1')
assert.equal(payload.items[0].unitPrice, 10000)
assert.equal(payload.items[0].catalogPriceSnapshot, null)
assert.equal(payload.items[0].sourceType, 'warehouse')
assert.equal(payload.payments[0].amount, 3000)
assert.equal(payload.payments[0].paymentDate, '2026-11-05')
assert.equal(payload.items[0].observedPhysicalQuantity, undefined,
  'Creating an order must not invent physical counts')
assert.deepEqual(completedCritical, [{ key: 'order-create', id: 'qa-safe-create-1' }])
assert.deepEqual(invalidated, ['finance', 'stock-catalog'],
  'Confirmed order creation must invalidate stock reservations and finance caches once')
assert.equal(addedOrder?.id, 902)
assert.equal(addedOrder?.debt_amount, 7000)
assert.equal(orderBusy, false)
assert.match(lastMessage, /QA-902/)

capturedRequests = []
completedCritical = []
invalidated = []
addedOrder = null
lastError = ''
const failureDraft = { ...readyDraft, managerId: 7 }
const failing = createOrderCreationActions({
  ...baseArgs,
  createDraft: failureDraft,
  apiFetch: async (url, options = {}) => {
    capturedRequests.push({ url: String(url), options })
    throw new Error('uncertain network result')
  },
  setCreateDraft: () => { throw new Error('Draft must survive an unknown write outcome') },
})
await failing.createOrderFromDraft()
assert.equal(capturedRequests.length, 1)
assert.equal(JSON.parse(capturedRequests[0].options.body).requestId, 'qa-safe-create-1')
assert.equal(completedCritical.length, 0, 'Unknown network outcome cannot retire the idempotency token')
assert.equal(addedOrder, null, 'Unknown network outcome cannot fabricate a new order')
assert.match(lastError, /uncertain network result/)
assert.equal(orderBusy, false, 'Busy state must clear even after an indeterminate response')

// Test the actual bundled admin edit boundary without any Production data writes.
// Existing SQLite tests above verify reservation CAS; these requests must preserve its
// exact historical item/pricing/payment facts without manufacturing stock.
const editBundle = await build({
  entryPoints: ['src/features/orders/orderEditPersistenceActions.ts'],
  bundle: true, platform: 'node', format: 'esm', write: false, target: 'es2022', logLevel: 'silent',
})
const { createOrderEditPersistenceActions } = await import(
  'data:text/javascript;base64,' + Buffer.from(editBundle.outputFiles[0].text).toString('base64')
)
const existingOrder = {
  id: 991, external_id: 'QA-991', pricing_mode: 'itemized_v1',
  order_date: '2026-11-03', manager_id: 7, manager_name: 'MANAGER',
  order_status: 'active', workshop_status: 'ready',
  shipping_status: 'not_sent', source_type: 'warehouse',
  total_amount: 10000, received_amount: 3000, debt_amount: 7000, return_amount: 0,
  items: [{
    id: 301, productName: 'QA ШАПАН', audienceType: 'ВЗРОСЛЫЙ', gender: 'ЖЕН',
    color: 'БЕЛЫЙ', material: 'СТАНДАРТ', length: 'СТАНДАРТ', size: '46',
    quantity: 1, unitPrice: 10000, lineTotal: 10000,
    catalogPriceSnapshot: 8500, sourceType: 'warehouse', isWorkshop: false,
  }],
  payments: [{
    id: 401, paymentDate: '2026-11-03', method: 'КАРТА', amount: 3000,
    paymentKind: 'primary', comment: '',
  }],
  returns: [],
}
const { createEditorDraft } = await import('../src/app/utils.ts')
let editingDraft = createEditorDraft(existingOrder)
editingDraft.payments[0].method = 'ТЕРМИНАЛ'
editingDraft.payments.push({
  ...createEmptyEditorPayment(editingDraft.orderDate),
  method: 'НАЛИЧНЫЕ', amount: 1000, paymentKind: 'primary',
})
let editWrites = []
let editCompleted = []
let editInvalidated = []
let editorClosed = 0
let lastEditorDraft = null
let editError = null
const editArgs = {
  isAdmin: true, selectedOrder: existingOrder, activeSector: 'orders', orderPanel: 'edit',
  setSavingOrder: () => {}, setError: next => { editError = next }, setMessage: () => {},
  getOrderOperationalProjection: async () => ({ canEdit: true, hasCommittedDownstreamOperation: false }),
  prepareCriticalRequest: (key, payload) => ({
    requestId: 'qa-idempotent-edit-991', payload: { ...payload, requestId: 'qa-idempotent-edit-991' },
  }),
  completeCriticalRequest: (key, requestId) => { editCompleted.push({ key, requestId }) },
  apiFetch: async (url, init = {}) => {
    editWrites.push({ url: String(url), init })
    return new Response(JSON.stringify({ ok: true, order: existingOrder }), {
      status: 200, headers: { 'content-type': 'application/json' },
    })
  },
  setEditorDraft: updater => { lastEditorDraft = typeof updater === 'function' ? updater(lastEditorDraft) : updater },
  setEditorOrderOverride: () => {}, setSelectedOrderId: () => {},
  setEditorOpen: () => {}, invalidateFinanceReadCaches: () => editInvalidated.push('finance'),
  invalidateInventoryStockCaches: () => editInvalidated.push('stock'),
  upsertOrderInState: () => {}, closeOrderEditor: () => { editorClosed++ },
  refreshDashboard: () => {}, refreshWorkshop: () => {}, refreshOrderFinance: () => {},
}
await createOrderEditPersistenceActions({ ...editArgs, isAdmin: false }).persistOrder(editingDraft)
assert.equal(editWrites.length, 0, 'Only the administrator can rewrite order records')
await createOrderEditPersistenceActions({
  ...editArgs,
  getOrderOperationalProjection: async () => ({ canEdit: false, hasCommittedDownstreamOperation: true }),
}).persistOrder(editingDraft)
assert.equal(editWrites.length, 0, 'Committed Return/Exchange must block subsequent full order rewrites')
await createOrderEditPersistenceActions(editArgs).persistOrder(editingDraft)
assert.equal(editWrites.length, 1, 'One editor save must send one PATCH, not post appended payments')
assert.equal(editWrites[0].url, '/api/orders/991')
assert.equal(editWrites[0].init.method, 'PATCH')
assert.equal(editWrites[0].init.headers['X-Idempotency-Key'], 'qa-idempotent-edit-991')
const editPayload = JSON.parse(editWrites[0].init.body)
assert.equal(editPayload.requestId, 'qa-idempotent-edit-991')
assert.equal(editPayload.itemContentReplacement, undefined, 'A payment-only correction must never rewrite item or physical inventory')
assert.deepEqual(editPayload.itemPriceCorrections, [])
assert.equal(editPayload.paymentCorrections.length, 1)
assert.deepEqual(editPayload.paymentCorrections[0], {
  paymentId: 401, paymentDate: '2026-11-03', method: 'ТЕРМИНАЛ',
  amount: 3000, paymentKind: 'primary', comment: '',
  expectedPaymentDate: '2026-11-03', expectedMethod: 'КАРТА',
  expectedAmount: 3000, expectedPaymentKind: 'primary', expectedComment: '',
}, 'Existing payments must retain all original CAS facts during a method correction')
assert.deepEqual(editCompleted, [{ key: 'order-edit:991', requestId: 'qa-idempotent-edit-991' }])
assert.deepEqual(editInvalidated, ['finance'], 'Payment-only editing must not invalidate or mutate physical stock')
assert.equal(editorClosed, 0, 'Unsaved new payment stays visible and must not be silently recorded')
assert.equal(lastEditorDraft.payments.some(payment => !payment.id && payment.amount === 1000), true,
  'An appended payment must stay pending until its own independent money operation')

editWrites = []
editCompleted = []
editInvalidated = []
editorClosed = 0
const changedQuantityDraft = createEditorDraft(existingOrder)
changedQuantityDraft.items[0].quantity = 2
await createOrderEditPersistenceActions({
  ...editArgs,
  apiFetch: async (url, init = {}) => {
    editWrites.push({ url: String(url), init })
    return new Response(JSON.stringify({ ok: true, order: existingOrder }), {
      status: 200, headers: { 'content-type': 'application/json' },
    })
  },
}).persistOrder(changedQuantityDraft)
const quantityPayload = JSON.parse(editWrites[0].init.body)
assert.equal(quantityPayload.itemContentReplacement.expectedItems[0].quantity, 1)
assert.equal(quantityPayload.itemContentReplacement.items[0].quantity, 2)
assert.equal(quantityPayload.itemContentReplacement.expectedItems[0].catalogPriceSnapshot, 8500)
assert.equal(quantityPayload.itemContentReplacement.items[0].catalogPriceSnapshot, 8500,
  'Editing quantity must preserve historic Catalog price snapshot')
assert.deepEqual(editInvalidated, ['finance', 'stock'],
  'Only content rewrite must invalidate both Finance and Inventory')
assert.equal(editorClosed, 1)

editWrites = []
editCompleted = []
editInvalidated = []
editorClosed = 0
await createOrderEditPersistenceActions({
  ...editArgs,
  apiFetch: async (url, init = {}) => {
    editWrites.push({ url: String(url), init })
    throw new Error('uncertain network edit outcome')
  },
}).persistOrder(editingDraft)
assert.equal(editWrites.length, 1)
assert.equal(JSON.parse(editWrites[0].init.body).requestId, 'qa-idempotent-edit-991')
assert.equal(editCompleted.length, 0, 'Unknown edit outcome must preserve the critical requestId for safe replay')
assert.equal(editorClosed, 0, 'Unknown edit outcome cannot close the editor as though the order saved')
assert.deepEqual(editInvalidated, [], 'Unknown edit outcome cannot pretend to commit stock or money')
assert.match(editError, /uncertain network edit outcome/)

sql.close()
console.log('MAIN_STAGE16_ATOMIC_ADMISSION_SQLITE_PASS: last-piece, stale approval, sources, wrong SKU, trigger and no phantom stock')
console.log('MAIN_STAGE16_PENDING_RECOVERY_PASS: arrival/second send, concurrent retries, preserved identity, returned/sent/archived/mismatched guards, idempotent')

