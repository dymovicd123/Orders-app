import fs from 'node:fs'

const read = path => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }
const between = (source, start, end) => {
  const a = source.indexOf(start)
  const b = source.indexOf(end, a + start.length)
  check(a >= 0 && b > a, 'Missing source boundary: ' + start)
  return source.slice(a, b)
}

const wrangler = read('wrangler.jsonc')
const app = read('src/App.tsx')
const ui = read('src/features/sections/OrderExchangeSection.tsx')
const workerIndex = read('worker/index.ts')
const batchWorker = read('worker/domains/exchange-batch.ts')

check(wrangler.includes('"name": "orders-app"'), 'H9C Production Worker identity drifted')
check(wrangler.includes('"database_name": "orders_db_prod"') && wrangler.includes('"database_id": "17e68a41-1d58-4a36-8a63-47c3e32443c4"'), 'H9C Production D1 identity drifted')
check(!wrangler.includes('orders_db_branch2') && !wrangler.includes('40065052-854e-44b8-bcd5-251bdd488301'), 'H9C Branch2 D1 identity leaked into Production')

const saveExchange = between(app, 'async function saveExchange()', '\n\n  async function receiveReturnedItemAction')
check(!saveExchange.includes('itemizedExchange && pairDrafts.length !== 1'), 'H9C Production still blocks itemized multi-pair exchange')
check(saveExchange.includes('itemizedExchange && unsavedPairs.length > 1'), 'H9C Production multi-pair save branch missing')
check(saveExchange.includes("apiFetch('/api/exchanges/batch'"), 'H9C Production batch endpoint call missing')
check(saveExchange.includes('expectedOrderTotal: Number(exchangeSelectedOrder.total_amount)'), 'H9C Production order-total stale snapshot missing')
for (const field of ['expectedOldActiveQuantity', 'expectedOldUnitPrice', 'expectedOldLineTotal', 'expectedOldCatalogPriceSnapshot']) {
  check(saveExchange.includes(field), 'H9C Production pair stale snapshot missing ' + field)
}
check(saveExchange.includes("'X-Idempotency-Key': critical.requestId"), 'H9C Production browser batch write is not retry-safe')
check(saveExchange.includes('completeCriticalRequest(batchKey, critical.requestId)'), 'H9C Production browser does not retire completed batch idempotency token')

check(ui.includes('Добавить ещё позицию'), 'H9C Production multi-pair control missing')
check(!ui.includes('if (itemizedExchange || !currentPairReady) return'), 'H9C Production queue still rejects itemized orders')
check(ui.includes('exchangeBatchRequired') && ui.includes('queuedSameNewQuantity'), 'H9C Production aggregate same-SKU stock guard missing')
check(ui.includes('queuedObservedPhysical') && ui.includes('exchangeConfirmedPhysical'), 'H9C Production queued physical observation reuse missing')
check(ui.includes('nextRequestedByOldItem') && ui.includes('nextOldItem'), 'H9C Production queue does not advance to remaining old item')

check(workerIndex.includes("url.pathname === '/api/exchanges/batch'") && workerIndex.includes('createItemizedExchangeBatchFromRequest'), 'H9C Production Worker batch route missing')
const batchStart = batchWorker.indexOf('export async function createItemizedExchangeBatch')
check(batchStart >= 0, 'H9C Production backend batch function missing')
const batch = batchWorker.slice(batchStart)
check(batch.includes("beginCriticalOperation(db, 'exchange_itemized_batch_create'"), 'H9C Production parent critical operation missing')
check(batch.includes('criticalOperation.cachedResponse'), 'H9C Production parent replay cache missing')
check(batch.includes('executionPlan = operationContext.executionPlan'), 'H9C Production frozen execution plan missing')
check(batch.includes("cleanText((existing as any).pricing_mode) !== 'itemized_v1'"), 'H9C Production batch not isolated to itemized orders')
check(batch.includes('derivedCurrentTotal !== ledger.totalAmount'), 'H9C Production itemized total drift guard missing')
check(batch.includes('finalNetPaid > finalTotalAmount'), 'H9C Production aggregate overpayment guard missing')
check(batch.includes('right.delta - left.delta'), 'H9C Production safe child execution ordering missing')
check(batch.includes("financialAction === 'refund' && position === 0"), 'H9C Production refund ordering missing')
check(batch.includes("financialAction === 'extra_payment' && position === orderedPairs.length - 1"), 'H9C Production extra-payment ordering missing')
check(batch.includes('stockGroups') && batch.includes('group.requestedQuantity'), 'H9C Production repeated-SKU stock preflight missing')
check(batch.includes('observedAssigned') && batch.includes('observedPhysicalQuantity = null'), 'H9C Production physical observation dedupe missing')
check(batch.includes('const childRequestId =') && batch.includes('criticalOperation.requestId') && batch.includes(':p'), 'H9C Production deterministic child idempotency missing')
check(batch.includes('await createExchange(db, {'), 'H9C Production batch does not reuse proven single-exchange mutation path')
check(batch.includes('completedPairs}_done') && batch.includes('advanceCriticalOperation(db, criticalOperation'), 'H9C Production resumable progress checkpoint missing')
check(batch.includes('await completeCriticalOperation(db, criticalOperation, response)'), 'H9C Production parent completion cache missing')

console.log('STAGE03-H9C PRODUCTION MULTI-EXCHANGE PASSED — Production has the Branch2-tested multi-position itemized Exchange path with stale-safe aggregate validation, resumable idempotency and repeated-SKU stock protection')
