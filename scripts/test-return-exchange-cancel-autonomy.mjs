import fs from 'node:fs'

function check(condition, message) {
  if (!condition) throw new Error(message)
}

const lifecycle = fs.readFileSync('worker/domains/lifecycle.ts', 'utf8')
const worker = fs.readFileSync('worker/index.ts', 'utf8')
const app = fs.readFileSync('src/App.tsx', 'utf8')
const aftercare = fs.readFileSync('src/features/orders/returnExchangeAftercareActions.ts', 'utf8')
const returnsSection = fs.readFileSync('src/features/sections/OrderReturnsSection.tsx', 'utf8')
const exchangeSection = fs.readFileSync('src/features/sections/OrderExchangeSection.tsx', 'utf8')

check(lifecycle.includes('inventoryLifecycleCancellationDisposition'), 'cancellation disposition helper missing')
check(lifecycle.includes("status = 'active'"), 'active stocktake safety gate missing')
check(lifecycle.includes('inventory_stock_checks'), 'later physical check safety gate missing')
check(lifecycle.includes("reason: 'insufficient_current_physical'"), 'negative physical protection missing')
check(lifecycle.includes('physicalReversalSkipped: true'), 'non-mutating cancellation outcome missing')
check(lifecycle.includes('protectedPhysicalTruth: true'), 'freshness protection result missing')
const returnRoute = worker.match(/const returnCancelMatch[\s\S]*?const exchangeCancelMatch/)?.[0] || ''
const exchangeStart = worker.indexOf('const exchangeCancelMatch')
const exchangeRoute = exchangeStart >= 0 ? worker.slice(exchangeStart, exchangeStart + 1600) : ''
check(returnRoute && !returnRoute.includes('requireAdminAccess(request)'), 'return cancellation is still admin-only')
check(exchangeRoute && !exchangeRoute.includes('requireAdminAccess(request)'), 'exchange cancellation is still admin-only')
check(worker.includes("returnExchangeCancelAutonomy: '192b2a5'"), 'health marker missing')
check(!app.includes('Отмена возврата доступна только администратору.') && !aftercare.includes('Отмена возврата доступна только администратору.'), 'frontend still blocks manager return cancellation')
check(!app.includes('Отмена обмена доступна только администратору.') && !aftercare.includes('Отмена обмена доступна только администратору.'), 'frontend still blocks manager exchange cancellation')
check(returnsSection.includes('>Отменить возврат</button>}'), 'return cancel action is not available in ordinary mode')
check(exchangeSection.includes("entry.status !== 'cancelled' ? <button"), 'exchange cancel action is not available in ordinary mode')
// Real critical-request transport, compiled from the same typed source consumed by App.
// No production requests: exercise retry, idempotency, optimistic snapshots and exact URLs.
const { default: assert } = await import('node:assert/strict')
const { build } = await import('esbuild')
const bundled = await build({
  entryPoints: ['src/app/controllers/returnExchangeCriticalRequests.ts'],
  bundle: true, platform: 'node', format: 'esm', write: false, target: 'es2022', logLevel: 'silent',
})
const isolated = await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64'))
const { cancelReturnCriticalRequest, cancelExchangeCriticalRequest, correctExchangeFinancialCriticalRequest } = isolated
const prepareCache = new Map()
const sent = []
const completed = []
let nextId = 0
let failNextTransport = false
let failWithConflict = false
const client = {
  prepareCriticalRequest(key, payload) {
    const fingerprint = JSON.stringify(payload)
    const cached = prepareCache.get(key)
    const requestId = cached?.fingerprint === fingerprint ? cached.requestId : 'guarded-' + ++nextId
    prepareCache.set(key, { fingerprint, requestId })
    return { requestId, payload: { ...payload, requestId } }
  },
  completeCriticalRequest(key, requestId) {
    completed.push({ key, requestId })
    if (prepareCache.get(key)?.requestId === requestId) prepareCache.delete(key)
  },
  async apiFetch(url, init) {
    sent.push({ url, ...init, body: JSON.parse(init.body), key: init.headers['X-Idempotency-Key'] })
    if (failNextTransport) {
      failNextTransport = false
      throw new Error('Uncertain network response')
    }
    if (failWithConflict) {
      failWithConflict = false
      return new Response(JSON.stringify({ message: 'Данные операции изменились' }), {
        status: 409, headers: { 'Content-Type': 'application/json' },
      })
    }
    return new Response(JSON.stringify({ ok: true, order: { id: 42 }, unchanged: false }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })
  },
}
failNextTransport = true
await assert.rejects(() => cancelReturnCriticalRequest(client, 71), /Uncertain network response/)
assert.equal(completed.length, 0, 'An uncertain return cancellation must retain requestId for replay')
const retried = await cancelReturnCriticalRequest(client, 71)
assert.equal(retried.order.id, 42)
assert.equal(sent[0].url, '/api/returns/71/cancel')
assert.equal(sent[0].method, 'PATCH')
assert.equal(sent[0].key, sent[1].key, 'Retry must reuse the original return requestId')
assert.deepEqual(sent[1].body, { comment: 'Отменено из интерфейса Cloudflare', requestId: sent[1].key })
assert.deepEqual(completed[0], { key: 'return-cancel:71', requestId: sent[1].key })
const cancelledExchange = await cancelExchangeCriticalRequest(client, 81)
assert.equal(cancelledExchange.order.id, 42)
assert.equal(sent[2].url, '/api/exchanges/81/cancel')
assert.equal(sent[2].method, 'PATCH')
assert.equal(sent[2].body.comment, 'Отменено из интерфейса Cloudflare')
assert.equal(completed[1].key, 'exchange-cancel:81')
const financePayload = {
  exchangeDate: '2026-11-01', financialAmount: 1500, paymentMethod: 'ТЕРМИНАЛ', comment: 'Исправлено',
  expectedExchangeDate: '2026-10-31', expectedFinancialAmount: 1000,
  expectedPaymentMethod: 'KASPI', expectedComment: '',
}
failWithConflict = true
await assert.rejects(() => correctExchangeFinancialCriticalRequest(client, 81, financePayload), /Данные операции изменились/)
assert.equal(completed.length, 2, 'A stale 409 must never finalize the critical financial request')
const correction = await correctExchangeFinancialCriticalRequest(client, 81, financePayload)
assert.equal(correction.unchanged, false)
assert.equal(sent[3].url, '/api/exchanges/81/financials')
assert.equal(sent[3].key, sent[4].key, 'Stale or uncertain money correction retry keeps request identity')
assert.deepEqual(sent[4].body, { ...financePayload, requestId: sent[4].key },
  'Optimistic finance snapshot and money fields must remain exact')
assert.deepEqual(completed[2], { key: 'exchange-financial-correct:81', requestId: sent[4].key })
assert(app.includes('createReturnExchangeAftercareActions({') && aftercare.includes('cancelReturnCriticalRequest(criticalReturnExchangeClient, entry.id)'))
assert(aftercare.includes('cancelExchangeCriticalRequest(criticalReturnExchangeClient, entry.id)'))
assert(aftercare.includes('correctExchangeFinancialCriticalRequest(criticalReturnExchangeClient, entry.id, payload)'))
assert(aftercare.includes('await Promise.allSettled([') && aftercare.includes('refreshFinanceReportsIfVisible()'),
  'App must still refresh operation, finance, stock and workshop after a successful write')
console.log('RETURN_EXCHANGE_TYPED_CRITICAL_PATCH_REPLAY_STALE_CAS_PASS')

console.log('RETURN/EXCHANGE CANCEL AUTONOMY PASSED')
