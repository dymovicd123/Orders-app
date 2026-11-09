import fs from 'node:fs'

const exchangeCreation = fs.readFileSync('worker/domains/order-exchange-creation.ts', 'utf8')
const receipt = fs.readFileSync('worker/domains/order-returned-item-receipt.ts', 'utf8')
const exchangeList = fs.readFileSync('worker/domains/order-exchange-list.ts', 'utf8')
const creation = fs.readFileSync('worker/domains/order-return-creation.ts', 'utf8')
const activity = fs.readFileSync('worker/domains/activity.ts', 'utf8')
const router = fs.readFileSync('worker/index.ts', 'utf8')
const migration = fs.readFileSync('migrations/0069_v72_return_exchange_physical_receipt.sql', 'utf8')
const types = fs.readFileSync('src/app/types.ts', 'utf8')
const utils = fs.readFileSync('src/app/utils.ts', 'utf8')
const app = fs.readFileSync('src/App.tsx', 'utf8')
const creationActions = fs.readFileSync('src/features/orders/returnExchangeCreationActions.ts', 'utf8')
const aftercareSource = fs.readFileSync('src/features/orders/returnExchangeAftercareActions.ts', 'utf8')
const legacyPrep = fs.readFileSync('src/app/legacyExchangePreparation.ts', 'utf8')
const legacyRequests = fs.readFileSync('src/app/legacyExchangeCriticalRequests.ts', 'utf8')
const returnCreateUi = fs.readFileSync('src/app/returnCreationOperation.ts', 'utf8')
const readController = fs.readFileSync('src/app/controllers/useReturnExchangeWorkspace.ts', 'utf8')
const returnSection = fs.readFileSync('src/features/sections/OrderReturnsSection.tsx', 'utf8')
const exchangeSection = fs.readFileSync('src/features/sections/OrderExchangeSection.tsx', 'utf8')

function expect(condition, message) {
  if (!condition) throw new Error(message)
}

expect(migration.includes('ALTER TABLE return_items ADD COLUMN physical_tracking'), 'return_items physical_tracking migration missing')
expect(migration.includes('ALTER TABLE return_items ADD COLUMN physical_received_at'), 'return_items physical_received_at migration missing')
expect(migration.includes('ALTER TABLE exchange_items ADD COLUMN physical_tracking'), 'exchange_items physical_tracking migration missing')
expect(migration.includes('ALTER TABLE exchange_items ADD COLUMN physical_received_at'), 'exchange_items physical_received_at migration missing')
expect(migration.includes('DEFAULT 0'), 'legacy rows must remain untracked by default')

expect(creation.includes("physicalState?: 'pending' | 'warehouse' | 'boutique' | 'no_stock'"), 'return item physicalState contract missing')
expect(exchangeCreation.includes("oldPhysicalState?: 'not_issued' | 'pending' | 'warehouse' | 'boutique' | 'no_stock'"), 'exchange oldPhysicalState contract missing')
expect(creation.includes('physical_tracking, physical_received_at'), 'physical receipt columns are not written by create flows')
expect(creation.includes("physicalState !== 'pending' ? createdAt : null"), 'return received timestamp semantics missing')
expect(exchangeCreation.includes("oldPhysicalTracking && oldPhysicalState !== 'pending' ? timestamp : null"), 'exchange received timestamp semantics missing')
expect(creation.includes('physicalTracking ? 1 : 0'), 'return tracking flag is not written')
expect(exchangeCreation.includes('oldPhysicalTracking ? 1 : 0'), 'exchange tracking flag is not written')
expect(creation.includes("physicalState === 'warehouse' || physicalState === 'boutique'"), 'return destination is not derived from physical state')
expect(exchangeCreation.includes("oldPhysicalState === 'warehouse' || oldPhysicalState === 'boutique'"), 'exchange destination is not derived from physical state')

// Compatibility guard: legacy payloads must still use the existing restock source semantics.
expect(creation.includes("physicalTracking ? trackedInventorySource : (restockSource !== 'none' && itemRestockRequested ? restockSource : null)"), 'legacy return restock fallback missing')
expect(exchangeCreation.includes("oldPhysicalTracking ? trackedOldReturnSource : normalizeExchangeReturnSource(input.oldReturnSource)"), 'legacy exchange restock fallback missing')
expect(exchangeCreation.includes("const oldWasNotIssued = oldPhysicalState === 'not_issued'"), 'exchange not-issued branch missing')
expect(exchangeCreation.includes("await releaseOrderReservationV2("), 'not-issued exchange does not release the old reservation without touching physical stock')
expect(exchangeCreation.includes("oldWasNotIssued ? 'not_issued'"), 'not-issued exchange marker is not persisted in the old snapshot')

// Delayed physical receipt must be a dedicated idempotent operation, not a generic arrival.
expect(receipt.includes('export async function receiveReturnedItem'), 'receiveReturnedItem domain operation missing')
expect(receipt.includes("beginCriticalOperation(db, 'returned_item_receive'"), 'physical receipt critical operation missing')
expect(receipt.includes("physical_tracking = 1 AND physical_received_at IS NULL"), 'receipt update is not guarded against double receive')
expect(receipt.includes('`return:${operationId}:item:${operationItemId}`'), 'return delayed receipt must reuse canonical lifecycle event key')
expect(receipt.includes('`exchange:${operationId}:old`'), 'exchange delayed receipt must reuse canonical lifecycle event key')
expect(receipt.includes("destination === 'no_stock'"), 'received-without-restock path missing')
expect(receipt.includes('completeCriticalOperation(db, criticalOperation, completedResponse)'), 'physical receipt completion cache missing')
expect(receipt.includes("eventType: 'returned_item_received'"), 'physical receipt audit event missing')

expect(router.includes("receiveReturnedItem"), 'receiveReturnedItem is not wired into Worker')
expect(router.includes("url.pathname === '/api/returned-items/receive'"), 'physical receipt API route missing')
expect(router.includes("destination?: 'warehouse' | 'boutique' | 'no_stock'"), 'physical receipt route destination contract missing')
expect(router.includes("X-Idempotency-Key"), 'physical receipt route must accept idempotency key')

// Existing history endpoints must expose the physical truth without a new heavy read path.
expect(activity.includes('ri.physical_tracking AS return_item_physical_tracking'), 'return history does not select physical tracking')
expect(activity.includes('ri.physical_received_at AS return_item_physical_received_at'), 'return history does not select received timestamp')
expect(activity.includes('physicalTracking: Boolean(toInt(row.return_item_physical_tracking, 0))'), 'return history does not map physical tracking')
expect(activity.includes('physicalReceivedAt: cleanText(row.return_item_physical_received_at) || null'), 'return history does not map received timestamp')
expect(exchangeList.includes('old_snapshot.physical_tracking AS old_physical_tracking'), 'exchange history does not select physical tracking')
expect(exchangeList.includes('old_snapshot.physical_received_at AS old_physical_received_at'), 'exchange history does not select received timestamp')
expect(exchangeList.includes('oldPhysicalTracking: Boolean(toInt(row.old_physical_tracking, 0))'), 'exchange history does not map physical tracking')
expect(exchangeList.includes('oldPhysicalReceivedAt: cleanText(row.old_physical_received_at) || null'), 'exchange history does not map received timestamp')
expect(exchangeList.includes("oldWasNotIssued: cleanText(row.old_inventory_source) === 'not_issued'"), 'exchange history does not expose not-issued marker')

// Frontend must expose one clear physical-state choice and a compact delayed-receipt action.
expect(types.includes("physicalState: 'pending' | 'warehouse' | 'boutique' | 'no_stock'"), 'return draft physicalState missing')
expect(types.includes("oldPhysicalState: 'not_issued' | 'pending' | 'warehouse' | 'boutique' | 'no_stock'"), 'exchange draft oldPhysicalState missing')
expect(types.includes('physicalTracking?: boolean'), 'return history physicalTracking type missing')
expect(types.includes('physicalReceivedAt?: string | null'), 'return history physicalReceivedAt type missing')
expect(types.includes('oldPhysicalTracking?: boolean'), 'exchange history physical tracking type missing')
expect(types.includes('oldPhysicalReceivedAt?: string | null'), 'exchange history physical received type missing')
// The form can now preselect actually-issued Workshop goods in fully sent orders.
// It must never mark these goods as physically received (no_stock) merely on open.
expect(utils.includes("physicalState: 'pending' as const"),
  'Return drafts, including auto-selected Workshop goods, must await actual physical receipt')
expect(utils.includes('restock: false'), 'Preselected Return goods must never create a stock arrival')
expect(utils.includes('issuedToClient') && utils.includes("issuedStockStatuses.has(stockStatus)"), 'return drafts must distinguish never-issued goods from real physical returns')
expect(utils.includes("order?.shipping_status === 'sent'") && utils.includes(": 'not_issued'"), 'unsent exchange drafts must default ordinary old items to the explicit not-issued path')
expect(app.includes('createReturnExchangeCreationActions({') && creationActions.includes('prepareReturnCreation(returnSelectedOrder, returnDraft)') && creationActions.includes('submitReturnCreation('), 'return save must use the guarded preparation and critical POST')
expect(returnCreateUi.includes('physicalState: item.physicalState'), 'return save payload must still send item physical state')
expect(creationActions.includes('prepareLegacyExchangePairs(exchangeSelectedOrder, exchangeDraft, getOrderSourceAvailability)') && legacyPrep.includes('oldPhysicalState: exchangeDraft.oldPhysicalState') && creationActions.includes('submitLegacyExchangePair(') && legacyRequests.includes('oldPhysicalState: pair.oldPhysicalState'), 'legacy Exchange must preserve the operator-selected physical state through preparation and POST')
expect(app.includes('createReturnExchangeAftercareActions({') && aftercareSource.includes('async function receiveReturnedItemAction'), 'frontend receive action missing')
expect(aftercareSource.includes("apiFetch('/api/returned-items/receive'"), 'frontend receive action route missing')
expect(app.includes('receiveReturnedItemAction'), 'receive action not passed to sections')
expect(returnSection.includes('Где товар сейчас?'), 'return form physical-state choice missing')
expect(returnSection.includes('Ещё едет обратно'), 'return form waiting choice missing')
expect(returnSection.includes('Уже вернули'), 'return form received choice missing')
expect(returnSection.includes('<option value="warehouse">Склад</option>'), 'return form warehouse receipt option missing')
expect(returnSection.includes('<option value="no_stock">Не добавлять в остаток</option>'), 'return form no-stock receipt option missing')
expect(!returnSection.includes('<span>Куда вернуть товар</span>'), 'old ambiguous return destination field still shown')
expect(returnSection.includes('Принять товар'), 'return history delayed receipt button missing')
expect(returnSection.includes('Старая запись — физическое получение не отслеживалось'), 'return legacy status explanation missing')
expect(exchangeSection.includes('Старая вещь сейчас'), 'exchange form physical-state field missing')
expect(exchangeSection.includes('Не выдавали клиенту — остаётся на месте'), 'exchange form not-issued option missing')
expect(exchangeSection.includes('Клиент ещё не вернул'), 'exchange form waiting option missing')
expect(!exchangeSection.includes('<span>Куда вернуть старую вещь</span>'), 'old ambiguous exchange destination field still shown')
expect(exchangeSection.includes('Принять товар'), 'exchange history delayed receipt button missing')
expect(exchangeSection.includes('Старая запись — физическое получение не отслеживалось'), 'exchange legacy status explanation missing')

expect(activity.includes('AS pending_physical_quantity'), 'return history pending physical quantity summary missing')
expect(activity.includes('pendingPhysicalQuantity: Math.max(0, toInt(summary?.pending_physical_quantity, 0))'), 'return history pending physical quantity response missing')
expect(exchangeList.includes('old_summary.physical_tracking = 1'), 'exchange pending physical quantity summary missing')
expect(exchangeList.includes('pendingPhysicalQuantity: Math.max(0, toInt(summary?.pending_physical_quantity, 0))'), 'exchange pending physical quantity response missing')
expect(app.includes('useReturnExchangeWorkspace({ apiFetch, reportReadFailure })'), 'App must wire the Return/Exchange read controller')
expect(readController.includes('pendingPhysicalQuantity: Number(data.summary?.pendingPhysicalQuantity || 0)'), 'read controller must consume pending physical quantity')
expect(readController.includes("pendingOnly: '1'") && readController.includes('++returnPendingInboxToken.current') && readController.includes('++exchangePendingInboxToken.current'),
  'physical receipt inboxes must remain independent of history filters and reject stale responses')
expect(returnSection.includes('Ожидают приёмки'), 'return summary does not show pending physical quantity')
expect(exchangeSection.includes('Ожидают приёмки'), 'exchange summary does not show pending physical quantity')

// Run the actual compiled Return/Exchange frontend controllers, not duplicated
// request logic. Worker SQL physical and financial tests remain separate.
const { default: assert } = await import('node:assert/strict')
const { build } = await import('esbuild')
const { createReturnDraft, createExchangeDraft } = await import('../src/app/utils.ts')
async function bundledActions(path, name) {
  const output = await build({ entryPoints: [path], bundle: true, platform: 'node',
    format: 'esm', target: 'es2022', write: false, logLevel: 'silent' })
  const lib = await import('data:text/javascript;base64,' + Buffer.from(output.outputFiles[0].text).toString('base64'))
  assert.equal(typeof lib[name], 'function')
  return lib[name]
}
const createActions = await bundledActions('src/features/orders/returnExchangeCreationActions.ts', 'createReturnExchangeCreationActions')
const aftercareActions = await bundledActions('src/features/orders/returnExchangeAftercareActions.ts', 'createReturnExchangeAftercareActions')
assert(app.includes('createReturnExchangeCreationActions({') && app.includes('createReturnExchangeAftercareActions({'),
  'App must invoke both real Return/Exchange owners')
const order = { id: 501, external_id: 'QA-501', order_status: 'active',
  shipping_status: 'sent', received_amount: 6000, return_amount: 0,
  items: [{ id: 61, quantity: 1, availableOperationQuantity: 1, sourceType: 'warehouse',
    productName: 'ШАПАН QA', unitPrice: 6000, lineTotal: 6000, catalogPriceSnapshot: 5200 }] }
let draft = createReturnDraft(order)
draft.amount = 1200
draft.paymentMethod = 'КАРТА'
draft.returnDate = '2026-11-08'
let posts = [], finished = [], errors = [], messages = [], replacements = []
let invalidations = [], refreshed = []
const req = (key, payload) => ({ requestId: 'qa-fixed-' + key,
  payload: { ...payload, requestId: 'qa-fixed-' + key } })
const client = {
  apiFetch: async (url, init = {}) => {
    posts.push({ url: String(url), init })
    return new Response(JSON.stringify({ ok: true, order, pendingInventoryCount: 0 }),
      { status: 201, headers: { 'content-type': 'application/json' } })
  },
  prepareCriticalRequest: req,
  completeCriticalRequest: (key, id) => finished.push({ key, id }),
}
const creationParams = {
  returnSelectedOrder: order, returnDraft: draft, exchangeSelectedOrder: null,
  exchangeDraft: createExchangeDraft(), getOrderSourceAvailability: () => null,
  isAdmin: false,
  setReturnBusy: () => {}, setExchangeBusy: () => {},
  setError: value => { if (value) errors.push(value) },
  setMessage: value => { if (value) messages.push(value) },
  setReturnSelectedOrderId: id => replacements.push(['returnId', id]),
  setReturnDraft: value => { draft = typeof value === 'function' ? value(draft) : value },
  setExchangeSelectedOrderId: () => {}, setExchangeDraft: () => {},
  setSelectedOrderId: () => {}, setOrderPanel: () => {},
  ...client,
  upsertOrderInState: next => replacements.push(['order', next.id]),
  loadReturnHistory: async () => refreshed.push('returns'),
  loadExchangeHistory: async () => refreshed.push('exchanges'),
  refreshActivityLogIfVisible: () => refreshed.push('activity'),
  refreshFinanceReportsIfVisible: () => refreshed.push('finance'),
  loadDashboard: async () => refreshed.push('orders'),
  loadInventoryData: async source => refreshed.push(source),
  loadInventoryLifecycle: async () => refreshed.push('lifecycle'),
  loadWorkshopData: async () => refreshed.push('workshop'),
}
await createActions(creationParams).saveReturn()
assert.equal(posts.length, 1)
assert.equal(posts[0].url, '/api/returns')
assert.equal(posts[0].init.method, 'POST')
const postedReturn = JSON.parse(posts[0].init.body)
assert.equal(posts[0].init.headers['X-Idempotency-Key'], 'qa-fixed-return-create:501')
assert.equal(postedReturn.requestId, 'qa-fixed-return-create:501')
assert.equal(postedReturn.amount, 1200)
assert.deepEqual(postedReturn.paymentParts, [{ method: 'КАРТА', amount: 1200 }])
assert.deepEqual(postedReturn.items, [], 'Money-only return cannot invent an unreceived physical item')
assert.deepEqual(finished, [{ key: 'return-create:501', id: 'qa-fixed-return-create:501' }])
assert.deepEqual(replacements, [['order', 501], ['returnId', null]])
assert.equal(draft.amount, 0)
assert(refreshed.includes('warehouse') && refreshed.includes('boutique'))
assert(messages.at(-1).includes('сохранён'))

posts = []; finished = []; replacements = []; errors = []
const savedDraft = { ...createReturnDraft(order), amount: 1200, paymentMethod: 'КАРТА', returnDate: '2026-11-08' }
await createActions({
  ...creationParams, returnDraft: savedDraft,
  apiFetch: async (url, init = {}) => { posts.push({ url, init }); throw Error('uncertain return network outcome') },
  setReturnDraft: () => { throw Error('Unknown outcome cannot clear draft') },
}).saveReturn()
assert.equal(posts.length, 1)
assert.equal(JSON.parse(posts[0].init.body).requestId, 'qa-fixed-return-create:501')
assert.equal(finished.length, 0, 'Unknown result cannot complete a return requestId')
assert.deepEqual(replacements, [], 'Unknown result cannot fabricate a financial refund')
assert.match(errors.at(-1), /uncertain return network outcome/)

const oldOrder = { ...order, pricing_mode: 'legacy', shipping_status: 'not_sent' }
const legacyDraft = createExchangeDraft(oldOrder)
legacyDraft.newItem = { ...legacyDraft.newItem, productName: 'ШАПАН QA ЗАМЕНА', quantity: 1 }
posts = []; finished = []; errors = []; messages = []
await createActions({
  ...creationParams,
  exchangeSelectedOrder: oldOrder,
  exchangeDraft: legacyDraft,
  apiFetch: async (url, init = {}) => {
    posts.push({ url: String(url), init })
    return new Response(JSON.stringify({ ok: true, exchangeId: 92, order: oldOrder }),
      { status: 201, headers: { 'content-type': 'application/json' } })
  },
}).saveExchange()
assert.equal(posts.length, 1, 'One legacy replacement must be recorded exactly once')
assert.equal(posts[0].url, '/api/exchanges')
const exchangePayload = JSON.parse(posts[0].init.body)
assert.equal(exchangePayload.oldItemId, 61)
assert.equal(exchangePayload.oldPhysicalState, 'not_issued')
assert.equal(exchangePayload.oldReturnSource, 'none',
  'Never-issued old exchange item must not be physically returned again')
assert.equal(exchangePayload.newItem.sourceType, 'warehouse')
assert.equal(exchangePayload.financialAction, 'none')
assert.equal(exchangePayload.financialAmount, 0)
assert.equal(finished.length, 1, 'Only confirmed exchange creation may retire its requestId')

let receiptDrafts = [], receivedMessages = [], prompts = [], stockUpdates = 0
let receiptComplete = [], receiptCalls = [], latestEvent = null, receiptRefresh = []
let busyStates = []
const aftercareParams = {
  apiFetch: async () => { throw Error('Provide explicit receipt response') },
  askStockResolution: async prompt => { prompts.push(prompt); return true },
  criticalReturnExchangeClient: client,
  setReturnBusy: flag => busyStates.push(flag), setExchangeBusy: flag => busyStates.push(flag),
  setError: value => { if (value) errors.push(value) },
  setMessage: value => { if (value) receivedMessages.push(value) },
  setReturnedItemResolutionEventId: id => { latestEvent = id },
  isAdmin: false, cashRegister: null,
  setReturnSelectedOrderId: () => {}, setReturnDraft: value => receiptDrafts.push(value),
  setExchangeSelectedOrderId: () => {}, setSelectedOrderId: () => {},
  upsertOrderInState: () => {},
  prepareCriticalRequest: req,
  completeCriticalRequest: (key, id) => receiptComplete.push({ key, id }),
  invalidateInventoryStockCaches: () => { stockUpdates += 1 },
  invalidateFinanceReadCaches: () => {},
  loadReturnHistory: async () => receiptRefresh.push('returns'),
  loadExchangeHistory: async () => receiptRefresh.push('exchanges'),
  refreshActivityLogIfVisible: () => {}, refreshFinanceReportsIfVisible: () => {},
  loadDashboard: async () => {}, loadWorkshopData: async () => {},
  loadInventoryData: async source => receiptRefresh.push(source),
  loadInventoryLifecycle: async () => receiptRefresh.push('lifecycle'),
  loadCashRegister: async () => {},
}
const after = aftercareActions({
  ...aftercareParams,
  apiFetch: async (url, init = {}) => {
    receiptCalls.push({ url: String(url), init })
    if (receiptCalls.length === 1) return new Response(JSON.stringify({
      ok: false, code: 'intake_freshness_confirmation_required',
      productName: 'ШАПАН QA', quantity: 1,
      latestCheck: { id: 98, checkedAt: '2026-11-07T10:00:00Z', countedQuantity: 1 },
    }), { status: 200, headers: { 'content-type': 'application/json' } })
    return new Response(JSON.stringify({ ok: true, freshnessProtected: true }),
      { status: 200, headers: { 'content-type': 'application/json' } })
  },
})
const input = {
  operationType: 'return', operationId: 71, operationItemId: 33,
  destination: 'warehouse', productName: 'ШАПАН QA', externalId: 'QA-501',
}
assert.equal(await after.receiveReturnedItemAction(input), true)
assert.equal(receiptCalls.length, 2)
assert.deepEqual(receiptCalls.map(x => x.url), ['/api/returned-items/receive', '/api/returned-items/receive'])
assert.equal(prompts.length, 1, 'After a later stocktake, the operator must decide whether goods were counted')
assert.deepEqual(receiptCalls.map(x => JSON.parse(x.init.body).freshnessDecision), [undefined, 'already_counted'])
assert.equal(JSON.parse(receiptCalls[1].init.body).destination, 'warehouse')
assert.equal(receiptComplete.length, 2, 'Each successful preflight and final receive must preserve a distinct request token')
assert.equal(stockUpdates, 1, 'Confirmed receipt must invalidate cached stock once, without another physical write')
assert(receivedMessages.at(-1).includes('Повторно'))
assert.equal(latestEvent, null)
assert.deepEqual(busyStates.slice(-2), [true, false])

receiptCalls = []; receiptComplete = []; stockUpdates = 0; errors = []
const failedReceive = aftercareActions({
  ...aftercareParams,
  apiFetch: async (url, init = {}) => { receiptCalls.push({ url, init }); throw Error('uncertain physical intake result') },
})
assert.equal(await failedReceive.receiveReturnedItemAction(input), false)
assert.equal(receiptComplete.length, 0)
assert.equal(stockUpdates, 0, 'Unknown receipt status cannot pretend stock increased')
assert.match(errors.at(-1), /uncertain physical intake result/)


console.log('Return/exchange physical receipt R1 regression: OK')
