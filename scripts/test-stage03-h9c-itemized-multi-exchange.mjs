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
const worker = read('worker/domains/returns-exchanges.ts')
const doc = read('docs/continuation/STAGE03_H9_ITEMIZED_EXCHANGE_20260925.md')

check(wrangler.includes('"name": "orders-app-branch2"'), 'H9C must stay on Branch2 Worker')
check(wrangler.includes('"database_name": "orders_db_branch2"') && wrangler.includes('"database_id": "40065052-854e-44b8-bcd5-251bdd488301"'), 'H9C Branch2 D1 identity drifted')
check(!wrangler.includes('orders_db_prod') && !wrangler.includes('17e68a41-1d58-4a36-8a63-47c3e32443c4'), 'H9C leaked Production D1 identity')

const saveExchange = between(app, 'async function saveExchange()', '\n\n  async function receiveReturnedItemAction')
check(!saveExchange.includes('itemizedExchange && pairDrafts.length !== 1'), 'H9C old itemized single-pair guard still blocks the UI')
check(saveExchange.includes('itemizedExchange && unsavedPairs.length > 1'), 'H9C multi-pair branch missing from saveExchange')
check(saveExchange.includes("apiFetch('/api/exchanges/batch'"), 'H9C UI does not call the batch endpoint')
check(saveExchange.includes('expectedOrderTotal: Number(exchangeSelectedOrder.total_amount)'), 'H9C batch is missing the order-total stale snapshot')
for (const field of ['expectedOldActiveQuantity', 'expectedOldUnitPrice', 'expectedOldLineTotal', 'expectedOldCatalogPriceSnapshot']) {
  check(saveExchange.includes(field), 'H9C batch pair stale snapshot missing ' + field)
}
check(saveExchange.includes("'X-Idempotency-Key': critical.requestId"), 'H9C browser batch write is not transport-retry safe')
check(saveExchange.includes('completeCriticalRequest(batchKey, critical.requestId)'), 'H9C browser does not retire a completed batch idempotency token')

check(ui.includes('Добавить ещё позицию'), 'H9C multi-pair control missing')
check(!ui.includes('if (itemizedExchange || !currentPairReady) return'), 'H9C queue still silently rejects itemized orders')
check(ui.includes('exchangeBatchRequired') && ui.includes('queuedSameNewQuantity'), 'H9C same-SKU aggregate stock requirement missing')
check(ui.includes('queuedObservedPhysical') && ui.includes('exchangeConfirmedPhysical'), 'H9C queued physical observation is not reused safely')
check(ui.includes('nextRequestedByOldItem') && ui.includes('nextOldItem'), 'H9C queue does not advance to a remaining old item')
check(ui.includes("priceOrigin: nextOldItem") && ui.includes('unitPrice: nextOldItem'), 'H9C next itemized row does not seed its own historical sold price')

check(workerIndex.includes("url.pathname === '/api/exchanges/batch'") && workerIndex.includes('createItemizedExchangeBatch'), 'H9C Worker route missing')

const batchStart = worker.indexOf('export async function createItemizedExchangeBatch')
const batchEnd = worker.indexOf('\n\nexport async function correctExchangeFinancials', batchStart)
check(batchStart >= 0 && batchEnd > batchStart, 'H9C backend batch function boundary missing')
const batch = worker.slice(batchStart, batchEnd)

check(batch.includes("beginCriticalOperation(db, 'exchange_itemized_batch_create'"), 'H9C parent critical operation missing')
check(batch.includes('criticalOperation.cachedResponse'), 'H9C parent replay cache missing')
check(batch.includes('executionPlan = operationContext.executionPlan'), 'H9C frozen execution plan missing')
check(batch.includes("cleanText((existing as any).pricing_mode) !== 'itemized_v1'"), 'H9C batch is not isolated to itemized orders')
check(batch.includes('derivedCurrentTotal !== ledger.totalAmount'), 'H9C does not fail closed on itemized total drift')
check(batch.includes('requestedByOldItem') && batch.includes('standalone_returned_quantity'), 'H9C aggregate old-item capacity guard missing')
check(batch.includes('buildItemizedOrderWritePlan'), 'H9C does not validate every new line price')
check(batch.includes('finalNetPaid > finalTotalAmount'), 'H9C final aggregate overpayment guard missing')
check(batch.includes('right.delta - left.delta'), 'H9C safe positive-before-negative execution ordering missing')
check(batch.includes("financialAction === 'refund' && position === 0"), 'H9C refund is not placed early enough to keep intermediate states valid')
check(batch.includes("financialAction === 'extra_payment' && position === orderedPairs.length - 1"), 'H9C extra payment is not placed on the final child')
check(batch.includes('stockGroups') && batch.includes('group.requestedQuantity'), 'H9C repeated-SKU physical preflight missing')
check(batch.includes('observedAssigned') && batch.includes('observedPhysicalQuantity = null'), 'H9C physical observation is not deduplicated across repeated SKU children')
check(batch.includes('const childRequestId =') && batch.includes('criticalOperation.requestId') && batch.includes(':p'), 'H9C deterministic child idempotency key missing')
check(batch.includes('await createExchange(db, {'), 'H9C batch does not reuse the proven single-exchange mutation path')
check(batch.includes('completedPairs}_done') && batch.includes('advanceCriticalOperation(db, criticalOperation'), 'H9C parent progress checkpoint missing')
check(batch.includes('await completeCriticalOperation(db, criticalOperation, response)'), 'H9C parent completion cache missing')

for (const marker of [
  'H9C itemized multi-pair Exchange',
  'parent critical operation plus deterministic idempotent child Exchange operations',
  'price-increasing/neutral replacements execute before price-decreasing replacements',
  'repeated new SKUs are aggregated for the physical-stock preflight',
  'Production/main must not receive H9C until that acceptance is complete',
]) check(doc.includes(marker), 'H9C continuation contract missing: ' + marker)

console.log('STAGE03-H9C ITEMIZED MULTI-EXCHANGE PASSED — Branch2 queues multiple itemized replacement pairs, validates final commercial/money truth before mutation, executes a resumable idempotent child plan, and deduplicates repeated-SKU physical observations')
