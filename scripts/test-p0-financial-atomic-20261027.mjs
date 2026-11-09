// Exact SQL from live Worker money/Return paths against disposable SQLite.
// No Cloudflare credentials, network, D1 binding or business-data mutation.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { build } from 'esbuild'
import { createEditorDraft, createEmptyEditorPayment } from '../src/app/utils.ts'

const moneySource=fs.readFileSync('worker/domains/money.ts','utf8')
const returnsSource=fs.readFileSync('worker/domains/order-return-creation.ts','utf8')
function sqlFrom(source, start, guard) {
  // The file also contains historical/general inserts. Exercise only the
  // guarded statement from the current critical-operation path.
  let from=0
  while (true) {
    const at=source.indexOf('\x60'+start,from)
    assert(at>=0,'Missing guarded production SQL: '+start)
    const end=source.indexOf('\x60',at+1)
    assert(end>at,'Unclosed production SQL')
    const sql=source.slice(at+1,end)
    if(sql.includes(guard))return sql
    from=end+1
  }
}
const paymentSql=sqlFrom(moneySource,'INSERT INTO payments (order_id, payment_date, method, amount, payment_kind, comment, created_at)','CASE WHEN EXISTS')
const refundSql=sqlFrom(returnsSource,'INSERT INTO returns (order_id, manager_id, return_date, amount, payment_method, comment, status, created_at)','CASE WHEN ? = 0 OR EXISTS')
assert.match(paymentSql,/CASE WHEN EXISTS/)
assert.match(refundSql,/CASE WHEN \? = 0 OR EXISTS/)
assert(moneySource.includes('not null constraint failed:\\s*payments\\.amount'),'Missing payment 409 classification')
assert(returnsSource.includes('not null constraint failed:\\s*returns\\.amount'),'Missing Return 409 classification')
const db=new DatabaseSync(':memory:')
db.exec(`
 CREATE TABLE orders (id INTEGER PRIMARY KEY, total_amount INTEGER NOT NULL, order_status TEXT NOT NULL DEFAULT 'new', archived_at TEXT);
 CREATE TABLE payments (id INTEGER PRIMARY KEY, order_id INTEGER, payment_date TEXT, method TEXT, amount INTEGER NOT NULL, payment_kind TEXT, comment TEXT, created_at TEXT);
 CREATE TABLE returns (id INTEGER PRIMARY KEY, order_id INTEGER, manager_id INTEGER, return_date TEXT, amount INTEGER NOT NULL, payment_method TEXT, comment TEXT, status TEXT, created_at TEXT);
`)
const now='2026-10-27T11:00:00.000Z'
const pay=(id,amount)=>db.prepare(paymentSql).run(id,'2026-10-27','НАЛИЧКА',id,amount,amount,'debt',null,now)
const refund=(id,amount)=>db.prepare(refundSql).run(id,null,'2026-10-27',amount,id,amount,amount,amount>0?'НАЛИЧКА':null,null,now)
const count=(table,id)=>({...db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(amount),0) AS amount FROM ${table} WHERE order_id=?`).get(id)})
const createOrder=id=>db.prepare('INSERT INTO orders (id,total_amount,order_status) VALUES (?,10000,?)').run(id,'new')

// Independent request ids both pass an earlier 10k preflight;
// only the first full payment INSERT is allowed to commit.
createOrder(1)
pay(1,10000)
assert.throws(()=>pay(1,10000),/NOT NULL constraint failed: payments.amount/i)
assert.deepEqual(count('payments',1),{n:1,amount:10000})
createOrder(2)
pay(2,6000)
assert.throws(()=>pay(2,6000),/NOT NULL constraint failed: payments.amount/i)
pay(2,4000)
assert.deepEqual(count('payments',2),{n:2,amount:10000})

// Money-only return: two preflighted 10k refunds cannot both
// commit against one paid order, regardless of distinct request ids.
createOrder(3)
pay(3,10000)
refund(3,10000)
assert.throws(()=>refund(3,10000),/NOT NULL constraint failed: returns.amount/i)
assert.deepEqual(count('returns',3),{n:1,amount:10000})
// A cancelled refund becomes refundable again.
db.prepare("UPDATE returns SET status='cancelled' WHERE order_id=3").run()
refund(3,10000)
assert.deepEqual(count('returns',3),{n:2,amount:20000})
assert.equal(db.prepare("SELECT SUM(amount) AS n FROM returns WHERE order_id=3 AND status!='cancelled'").get().n,10000)
refund(3,0) // old zero-sum Return remains supported

// Archived orders may not take fresh manual money writes.
createOrder(4)
db.prepare("UPDATE orders SET archived_at='2026-10-26' WHERE id=4").run()
assert.throws(()=>pay(4,5000),/NOT NULL constraint failed: payments.amount/i)
db.close()

// Exercise the actual module/API and real financial-event INSERT statements.
const {
  normalizeMoneyParts, moneyMethodsSummary, splitRefundReversalStatements,
  exchangeSetPaymentIds,
} = await import('../worker/domains/return-exchange-payment-channels.ts')
const legacyChannel = await import('../worker/domains/returns-exchanges.ts')
assert.strictEqual(legacyChannel.normalizeMoneyParts, normalizeMoneyParts,
  'Existing public payment-part API must remain unchanged')
assert.deepEqual(normalizeMoneyParts(undefined, 0, ''), [])
assert.deepEqual(normalizeMoneyParts(undefined, 3000, ' каспи '),
  [{method:'КАСПИ',amount:3000}])
const channels=normalizeMoneyParts([
  {method:' наличка ',amount:1200},{method:' каспи ',amount:1800},
],3000,'')
assert.deepEqual(channels,[
  {method:'НАЛИЧКА',amount:1200},{method:'КАСПИ',amount:1800},
])
assert.equal(moneyMethodsSummary(channels),'НАЛИЧКА + КАСПИ')
for(const [parts,total,legacy] of [
  [[{method:'КАСПИ',amount:1}],0,''],
  [undefined,100,''],
  [[{method:'КАСПИ',amount:0}],100,''],
  [[{method:'КАСПИ',amount:100.5}],100,''],
  [[{method:'КАСПИ',amount:30},{method:' каспи ',amount:70}],100,''],
  [[{method:'КАСПИ',amount:30},{method:'НАЛИЧКА',amount:60}],100,''],
  [[{method:'A',amount:30},{method:'B',amount:30},{method:'C',amount:40}],100,''],
  [undefined,-100,'КАСПИ'],
  [undefined,1.5,'КАСПИ'],
  [undefined,Number.MAX_SAFE_INTEGER+1,'КАСПИ'],
]) assert.throws(()=>normalizeMoneyParts(parts,total,legacy),
  'Invalid channels must fail before any financial event is written')

const financeSql=new DatabaseSync(':memory:')
financeSql.exec('CREATE TABLE financial_events (event_key TEXT PRIMARY KEY, order_id INTEGER, external_order_id TEXT, event_date TEXT, event_at TEXT, event_type TEXT, related_type TEXT, amount_delta INTEGER, payment_method TEXT, source_type TEXT, source_id INTEGER, source_ref TEXT, reason TEXT, comment TEXT, is_backfill INTEGER, created_at TEXT); CREATE TABLE critical_operations (request_id TEXT PRIMARY KEY,operation_type TEXT,target_id INTEGER,created_at TEXT); CREATE TABLE critical_operation_entities (request_id TEXT,entity_type TEXT,entity_key TEXT,entity_id INTEGER);')
const financeD1={
  prepare(query){
    return {bind(...args){
      const statement=financeSql.prepare(query)
      return {
        async all(){return {results:statement.all(...args)}},
        async run(){const x=statement.run(...args);return {success:true,meta:{changes:x.changes}}}
      }
    }}
  }
}
const seed=financeSql.prepare('INSERT INTO financial_events (event_key,event_type,amount_delta,payment_method,source_type,source_id,source_ref) VALUES (?,?,?,?,?,?,?)')
const critical=financeSql.prepare('INSERT INTO critical_operations (request_id,operation_type,target_id,created_at) VALUES (?,?,?,?)')
critical.run('real-return-91','return_create',91,'2026-11-08T10:00:00Z')
seed.run('return-original-1','order_refund',-1200,'НАЛИЧКА','return',91,'critical-operation:real-return-91')
seed.run('return-original-2','order_refund',-1800,'КАСПИ','return',91,'critical-operation:real-return-91')
const returnInput={orderId:10,externalOrderId:'ORD-TEST',amount:3000,
  methodSummary:'НАЛИЧКА + КАСПИ',timestamp:'2026-11-08T11:00:00Z',
  comment:'Test cancellation',reason:'return_cancel',returnId:91}
const reversal=await splitRefundReversalStatements(financeD1,returnInput)
assert.equal(reversal.length,2,'Return cancellation must reverse both actual channels')
for(const statement of reversal) await statement.run()
const reads=()=>financeSql.prepare('SELECT event_type,amount_delta,payment_method,source_type,source_id FROM financial_events WHERE event_type=? ORDER BY event_key').all('refund_reversal').map(row=>({...row}))
assert.deepEqual(reads(),[
  {event_type:'refund_reversal',amount_delta:1200,payment_method:'НАЛИЧКА',source_type:'return',source_id:91},
  {event_type:'refund_reversal',amount_delta:1800,payment_method:'КАСПИ',source_type:'return',source_id:91}
])
for(const statement of reversal) await statement.run()
assert.equal(reads().length,2,'Cancellation retry must never duplicate cash or journal events')
await assert.rejects(()=>splitRefundReversalStatements(financeD1,{...returnInput,amount:3001}),
  /Части возврата не совпадают/, 'Incorrect refund total must fail closed')
await assert.rejects(()=>splitRefundReversalStatements(financeD1,{
  ...returnInput,returnId:92
}),/Не найдены все исходные части/, 'Missing split refund must not invent a reversal')
assert.equal(reads().length,2,'Failed reversal validation cannot add money events')
assert.equal(await splitRefundReversalStatements(financeD1,{
  ...returnInput,returnId:92,methodSummary:'НАЛИЧКА'
}),null,'Legacy single-channel refund continues via original reversal')

seed.run('1901:test:exchange-set-refund:1','exchange_refund',-900,'ТЕРМИНАЛ','exchange',72,'exchanges:72')
seed.run('1901:test:exchange-set-refund:2','exchange_refund',-600,'НАЛИЧКА','exchange',72,'exchanges:72')
const exchangeReverse=await splitRefundReversalStatements(financeD1,{
  orderId:10,externalOrderId:'ORD-TEST',amount:1500,
  methodSummary:'ТЕРМИНАЛ + НАЛИЧКА',timestamp:'2026-11-08T12:00:00Z',
  comment:'Cancel exchange',reason:'exchange_cancel',exchangeId:72
})
assert.equal(exchangeReverse.length,2)
for(const statement of exchangeReverse)await statement.run()
assert.deepEqual(reads().filter(x=>x.source_type==='exchange'),[
  {event_type:'refund_reversal',amount_delta:900,payment_method:'ТЕРМИНАЛ',source_type:'exchange',source_id:72},
  {event_type:'refund_reversal',amount_delta:600,payment_method:'НАЛИЧКА',source_type:'exchange',source_id:72}
])
for(const statement of exchangeReverse)await statement.run()
assert.equal(reads().length,4,'Exchange refund cancellation must be idempotent')

critical.run('exchange-set-72','exchange_set_create',72,'2026-11-08T09:00:00Z')
const link=financeSql.prepare('INSERT INTO critical_operation_entities (request_id,entity_type,entity_key,entity_id) VALUES (?,?,?,?)')
link.run('exchange-set-72','payment','exchange:set:payment:1',501)
link.run('exchange-set-72','payment','exchange:set:payment:2',502)
assert.deepEqual(await exchangeSetPaymentIds(financeD1,72),[501,502],
  'Split exchange payment linkage must preserve both exact IDs')
assert.deepEqual(await exchangeSetPaymentIds(financeD1,999),[])
// Actual bundled editor payment client: adding cash is a separate idempotent write,
// and correcting historical payment method must not change the amount or its date.
const editorBundle = await build({
  entryPoints: ['src/features/orders/orderEditorActions.ts'],
  bundle: true, platform: 'node', format: 'esm', write: false, target: 'es2022', logLevel: 'silent',
})
const { createOrderEditorActions } = await import(
  'data:text/javascript;base64,' + Buffer.from(editorBundle.outputFiles[0].text).toString('base64')
)
const recordedOrder = {
  id: 917, external_id: 'QA-PAYMENT-917', pricing_mode: 'itemized_v1', order_date: '2026-11-08',
  manager_id: 1, total_amount: 25000, received_amount: 5000, debt_amount: 20000,
  order_status: 'active', workshop_status: 'ready', items: [],
  payments: [{ id: 901, paymentDate: '2026-11-08', method: 'КАРТА', amount: 5000, paymentKind: 'primary', comment: 'Оплачено' }],
}
let editorPaymentDraft = createEditorDraft(recordedOrder)
editorPaymentDraft.payments.push({
  ...createEmptyEditorPayment('2026-11-08'), draftKey: 'qa-917-new',
  paymentKind: 'debt_close', paymentDate: '2026-11-08', method: 'НАЛИЧНЫЕ', amount: 2500,
})
let editorPaymentCalls = []
let editorPaymentCompleted = []
let financeInvalidations = 0
let moneyErrors = []
const paymentArgs = {
  editorDraft: editorPaymentDraft, selectedOrder: recordedOrder, savingOrder: false,
  catalogData: null, getSizeOptions: () => ['44', '46'], isAdmin: true,
  setEditorDraft: next => { editorPaymentDraft = typeof next === 'function' ? next(editorPaymentDraft) : next },
  setSavingOrder: () => {}, setError: next => { if(next)moneyErrors.push(next) },
  setMessage: () => {},
  prepareCriticalRequest: (key, payload) => ({ requestId: 'qa-new-payment-917', payload: { ...payload, requestId: 'qa-new-payment-917' } }),
  completeCriticalRequest: (key, id) => { editorPaymentCompleted.push({ key, id }) },
  apiFetch: async (url, options = {}) => {
    editorPaymentCalls.push({ url: String(url), options })
    return new Response(JSON.stringify({ ok: true, paymentId: 902 }),
      { status: 200, headers: { 'content-type': 'application/json' } })
  },
  upsertOrderInState: () => {}, setSelectedOrderId: () => {},
  setEditorOrderOverride: () => {},
  invalidateFinanceReadCaches: () => { financeInvalidations++ },
  refreshDashboard: () => {}, refreshFinanceReports: () => {},
}
await createOrderEditorActions(paymentArgs).saveEditorPayment(1)
assert.equal(editorPaymentCalls.length, 1)
assert.equal(editorPaymentCalls[0].url, '/api/payments')
assert.equal(editorPaymentCalls[0].options.method, 'POST')
assert.equal(editorPaymentCalls[0].options.headers['X-Idempotency-Key'], 'qa-new-payment-917')
const postedPayment = JSON.parse(editorPaymentCalls[0].options.body)
assert.deepEqual({
  orderId: postedPayment.orderId, paymentDate: postedPayment.paymentDate,
  method: postedPayment.method, amount: postedPayment.amount, paymentKind: postedPayment.paymentKind,
}, {
  orderId: 917, paymentDate: '2026-11-08',
  method: 'НАЛИЧНЫЕ', amount: 2500, paymentKind: 'debt_close',
}, 'Only the intended debt-close money event may be recorded')
assert.equal(postedPayment.requestId, 'qa-new-payment-917')
assert.equal(editorPaymentDraft.payments[1].id, 902)
assert.equal(editorPaymentDraft.payments[1].draftKey, undefined)
assert.equal(editorPaymentCompleted.length, 1)
assert.equal(financeInvalidations, 1)

editorPaymentCalls = []
editorPaymentCompleted = []
const missingIdentityDraft = createEditorDraft(recordedOrder)
missingIdentityDraft.payments.push({
  ...createEmptyEditorPayment('2026-11-08'), paymentKind: 'primary',
  draftKey: 'qa-no-payment-id', method: 'КАРТА', amount: 2000,
})
await createOrderEditorActions({
  ...paymentArgs, editorDraft: missingIdentityDraft,
  apiFetch: async (url, options = {}) => {
    editorPaymentCalls.push({ url: String(url), options })
    return new Response(JSON.stringify({ ok: true, paymentId: null }),
      { status: 200, headers: { 'content-type': 'application/json' } })
  },
  setEditorDraft: () => { throw new Error('Unknown payment state must retain its draft') },
}).saveEditorPayment(1)
assert.equal(editorPaymentCalls.length, 1)
assert.equal(editorPaymentCompleted.length, 0, 'Missing payment ID after 2xx is not safe to acknowledge as locally committed')
assert.match(moneyErrors.at(-1), /могла сохраниться/, 'Ambiguous payment success must guide a safe retry')

let methodCorrectionCalls = []
let methodCompletion = []
const updated = createOrderEditorActions({
  ...paymentArgs,
  isAdmin: false,
  apiFetch: async () => { throw new Error('Manager is forbidden to correct posted payment methods') },
})
assert.equal((await updated.correctRecordedPaymentMethod(recordedOrder, recordedOrder.payments[0], 'НАЛИЧНЫЕ')).ok, false)
const correction = await createOrderEditorActions({
  ...paymentArgs,
  apiFetch: async (url, options = {}) => {
    methodCorrectionCalls.push({ url: String(url), options })
    return new Response(JSON.stringify({ ok: true }),
      { status: 200, headers: { 'content-type': 'application/json' } })
  },
  completeCriticalRequest: (key, id) => methodCompletion.push({ key, id }),
}).correctRecordedPaymentMethod(recordedOrder, recordedOrder.payments[0], 'ТЕРМИНАЛ')
assert.equal(correction.ok, true)
assert.equal(methodCorrectionCalls.length, 1)
assert.equal(methodCorrectionCalls[0].url, '/api/orders/917')
assert.equal(methodCorrectionCalls[0].options.method, 'PATCH')
const methodPayload = JSON.parse(methodCorrectionCalls[0].options.body)
assert.deepEqual(methodPayload.paymentCorrections[0], {
  paymentId: 901, method: 'ТЕРМИНАЛ',
  expectedPaymentDate: '2026-11-08', expectedMethod: 'КАРТА',
  expectedAmount: 5000, expectedPaymentKind: 'primary', expectedComment: 'Оплачено',
}, 'Historical method correction must supply unchanged amount/date/kind CAS and no second payment')
assert.equal(methodCompletion.length, 1)

financeSql.close()
console.log('P0_FINANCIAL_CHANNELS_PASSED: split validation, two-channel refunds/exchanges, idempotent reversal, exact linked payments')
console.log('P0_FINANCIAL_SQL_ATOMIC_GUARDS_PASSED: payment and Return limits execute against extracted Worker SQL')
