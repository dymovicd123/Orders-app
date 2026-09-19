import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const app = fs.readFileSync('src/App.tsx', 'utf8')
const modal = fs.readFileSync('src/features/orders/OrderCatalogResolutionModal.tsx', 'utf8')
const flowSource = fs.readFileSync('src/features/orders/catalogResolutionFlow.ts', 'utf8')
const worker = fs.readFileSync('worker/index.ts', 'utf8')
const reservations = fs.readFileSync('worker/domains/order-reservations.ts', 'utf8')

const module = { exports: {} }
vm.runInNewContext(ts.transpileModule(flowSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports: module.exports, module })
const { createResolutionSession } = module.exports

// R9 contract 1: one resolver write, then retry only continuation until it is proven complete.
let writes = 0
let completions = 0
const session = createResolutionSession()
await session.run(async () => { writes++ }, async () => true, async () => { completions++; return false })
await session.run(null, async () => true, async () => { completions++; return true })
await session.run(null, async () => true, async () => { completions++; return true })
assert.equal(writes, 1, 'R9 final: resolver write replayed during continuation retry')
assert.equal(completions, 2, 'R9 final: completion did not retry exactly until proven success')

// R9 contract 2: empty review after a changed session is success, not a dead-end message.
const changedEmptyIndex = modal.indexOf('if (!items.length && session.current.changed) return true')
const emptyDeadEndIndex = modal.indexOf('Список уточнений пуст. Отправка не продолжена')
assert.ok(changedEmptyIndex >= 0, 'R9 final: changed session no longer treats zero remaining questions as completion')
assert.ok(emptyDeadEndIndex < 0 || changedEmptyIndex < emptyDeadEndIndex, 'R9 final: stale empty-list dead end wins before successful completion')

// R9 contract 3: completion reads fresh order truth, resumes the original send, and only then closes.
const completionStart = app.indexOf('onCompleted={async (resolvedOrder: OrderRecord) => {')
const completionEnd = app.indexOf('        }}', completionStart)
assert.ok(completionStart >= 0 && completionEnd > completionStart, 'R9 final: resolver completion handler missing')
const completion = app.slice(completionStart, completionEnd)
const freshIndex = completion.indexOf("apiFetch(\`/api/orders/\${resolvedOrder.id}\`, { cache: 'no-store' })")
const sendIndex = completion.indexOf('await markOrderSentToClient(freshResult.order)')
const closeIndex = completion.indexOf('setOrderCatalogResolutionOrder(null)')
assert.ok(freshIndex >= 0 && sendIndex > freshIndex, 'R9 final: original shipping does not resume from fresh server order truth')
assert.ok(completion.includes("freshResponse.headers.get('X-Orders-App-Stale') === '1'"), 'R9 final: stale cached order can still prove completion')
assert.ok(completion.includes('if (!sent) return false'), 'R9 final: failed shipping continuation cannot remain retryable')
assert.ok(closeIndex > sendIndex, 'R9 final: resolver closes before shipping succeeds')
assert.ok(!completion.includes("setActiveSector('inventory')") && !completion.includes('openInventoryPanel('), 'R9 final: ordinary resolver completion still detours to Warehouse')

// R9 contract 4: initial shipping can enter resolver, and successful continuation has an explicit boolean result.
const sendFnStart = app.indexOf('async function markOrderSentToClient(order: OrderRecord): Promise<boolean>')
const sendFnEnd = app.indexOf('\n\n  async function correctMistakenOrderShipping', sendFnStart)
assert.ok(sendFnStart >= 0 && sendFnEnd > sendFnStart, 'R9 final: shipping continuation function missing')
const sendFn = app.slice(sendFnStart, sendFnEnd)
assert.ok(sendFn.includes("result.code === 'catalog_review_required'"), 'R9 final: shipping no longer opens resolver for genuine catalog ambiguity')
assert.ok(sendFn.includes('setOrderCatalogResolutionOrder(order)'), 'R9 final: catalog-review order is not kept in the resolver session')
assert.ok(sendFn.includes("headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': critical.requestId }"), 'R9 final: client shipping retry key disappeared')
assert.ok(sendFn.includes('return true'), 'R9 final: successful shipping cannot prove completion')
assert.ok(sendFn.includes('return false'), 'R9 final: blocked/failed shipping cannot keep resolver open')

// R9 contract 5: server replay converges to one atomic physical+shipping commit.
const routeStart = worker.indexOf("const orderShippingMatch = url.pathname.match(/^\\/api\\/orders\\/(\\d+)\\/shipping$/)")
const routeEnd = worker.indexOf('const orderDeleteMatch', routeStart)
assert.ok(routeStart >= 0 && routeEnd > routeStart, 'R9 final: shipping route missing')
const route = worker.slice(routeStart, routeEnd)
assert.ok(route.includes("normalizeShippingStatus(existing.shipping_status) === 'sent'"), 'R9 final: already-sent replay guard missing')
assert.ok(route.includes('alreadySent: true'), 'R9 final: completed replay is not returned as success')
assert.ok(route.includes("let shippingCommitted = humanInventoryModelEnabled ? Boolean(inventoryDelivery?.shippingCommitted) : false"), 'R9 final: atomic fulfillment winner is ignored')
assert.ok(route.includes("...(!shippingCommitted ? { alreadySent: true } : {})"), 'R9 final: overlapping losing replay is not a success/no-op')
assert.ok(route.includes('if (shippingCommitted) {') && route.indexOf('if (shippingCommitted) {') < route.indexOf("eventType: 'order_shipping_updated'"), 'R9 final: replay can duplicate shipping activity log')

const fulfillStart = reservations.indexOf('export async function fulfillOrderReservationsV2')
const fulfillEnd = reservations.indexOf('export async function getOrderShipmentInventoryBlockers', fulfillStart)
assert.ok(fulfillStart >= 0 && fulfillEnd > fulfillStart, 'R9 final: fulfillment function missing')
const fulfill = reservations.slice(fulfillStart, fulfillEnd)
assert.ok(fulfill.includes("const orderStillUnsentSql = \"EXISTS (SELECT 1 FROM orders shipping_order WHERE shipping_order.id = ? AND COALESCE(shipping_order.shipping_status, 'not_sent') <> 'sent')\""), 'R9 final: physical mutations are not tied to current unsent order truth')
assert.ok((fulfill.match(/\$\{orderStillUnsentSql\}/g) || []).length >= 8, 'R9 final: at least one physical/movement mutation escaped replay guard')
assert.ok(fulfill.includes('shippingStatementIndex = statements.length'), 'R9 final: shipping CAS is not part of the fulfillment batch')
assert.ok(fulfill.includes("toInt(results[shippingStatementIndex]?.meta?.changes, 0) > 0"), 'R9 final: batch winner is not proven from shipping CAS')

// R9 contract 6: modal completion path itself forwards the completion result instead of swallowing it.
assert.ok(modal.includes('async () => owner === session.current ? await onCompleted(order) : false'), 'R9 final: finish path swallows completion result')
assert.ok(modal.includes('async () => order && owner === session.current ? await onCompleted(order) : false'), 'R9 final: retry path swallows completion result')

console.log('CATALOG RESOLVER R9 FINAL ACCEPTANCE PASSED — fresh truth, automatic original-send continuation, proven close, retryable failure, and replay-safe shipping are all connected end-to-end.')
