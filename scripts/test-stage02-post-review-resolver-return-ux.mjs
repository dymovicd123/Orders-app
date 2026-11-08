import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { build } from 'esbuild'

const read = (path) => fs.readFileSync(path, 'utf8')
const flowSource = read('src/features/orders/catalogResolutionFlow.ts')
const module = { exports: {} }
vm.runInNewContext(ts.transpileModule(flowSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports: module.exports, module })
const { rankedProducts } = module.exports

const prefix = rankedProducts([
  { id: 1, name: 'ДАРА ШАПАН' },
  { id: 2, name: 'ДВОЙКА' },
  { id: 3, name: 'ЮБКА' },
], 'Д')
assert.equal(prefix[0].product.id, 1)
assert.ok(prefix.filter(row => row.score > 0).length >= 2, 'Short prefix search must expose several plausible candidates, not wait for exact input')

const shapan = rankedProducts([
  { id: 1, name: 'ДАРА ШАПАН' },
  { id: 2, name: 'АБАЙ ШАПАН' },
  { id: 3, name: 'ЮБКА' },
], 'ШАПАН')
assert.deepEqual(shapan.filter(row => row.score > 0).map(row => row.product.id).sort(), [1, 2])

const review = read('worker/domains/catalog-review.ts')
assert.ok(review.includes('export function catalogReviewInputCanLearnExact'))
assert.ok(review.includes('cleanText(row.product_name_snapshot)') && review.includes('cleanText(row.color_snapshot)') && review.includes('cleanText(row.size_snapshot)'))
assert.ok(review.includes('writeAlias: reusableExactInput'), 'Exact complete human confirmation must teach a reusable full-signature alias')
assert.ok(review.includes('normalizedCatalogReviewKey(row) === inputKey'), 'Exact complete confirmation must fan out to already-open identical raw rows')
assert.ok(review.includes('toInt(row.id ?? row.order_item_id, 0) === orderItemId'), 'Incomplete/ambiguous confirmation must remain single-row scoped')

const receiptWorker = read('worker/domains/order-returned-item-receipt.ts')
const creationWorker = read('worker/domains/order-return-creation.ts')
assert.ok(creationWorker.includes('if (amount <= 0 && selectedItems.length === 0)'), 'Zero-money return must require a returned item, not positive money')
assert.ok(creationWorker.includes('if (amount > 0 && !paymentMethod)'), 'Payment method must only be required when money is actually refunded')
// Inspect the TypeScript syntax tree instead of pinning the exact whitespace
// or number of nested payment-method loops in order-return-creation.ts.
const returnAst = ts.createSourceFile('order-return-creation.ts', creationWorker, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
function includesRefundEventCall(node) {
  if (ts.isCallExpression(node) && node.expression.getText(returnAst) === 'refundMoneyEventStatement') return true
  return ts.forEachChild(node, includesRefundEventCall) === true
}
function hasMoneyGuardedRefund(node) {
  if (ts.isIfStatement(node) && node.expression.getText(returnAst).replace(/\s/g, '') === 'amount>0'
    && includesRefundEventCall(node.thenStatement)) return true
  return ts.forEachChild(node, hasMoneyGuardedRefund) === true
}
assert.ok(hasMoneyGuardedRefund(returnAst), 'Zero-money item return must not manufacture a money event')
// The cancellation workflow now lives in its own domain. Verify the actual
// guarded reversal calls in its syntax tree rather than their old file location.
const cancellationSource = read('worker/domains/order-return-cancellation.ts')
const cancellationAst = ts.createSourceFile('order-return-cancellation.ts', cancellationSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
function hasCallInCancellation(node, name) {
  if (ts.isCallExpression(node) && node.expression.getText(cancellationAst) === name) return true
  return ts.forEachChild(node, child => hasCallInCancellation(child, name)) === true
}
function hasAmountGuardedRefundReversal(node) {
  if (ts.isIfStatement(node)
      && node.expression.getText(cancellationAst).replace(/\s/g,'') === 'toInt(ret.amount,0)>0'
      && hasCallInCancellation(node.thenStatement, 'splitRefundReversalStatements')
      && hasCallInCancellation(node.thenStatement, 'refundReversalMoneyEventStatement')) return true
  return ts.forEachChild(node, hasAmountGuardedRefundReversal) === true
}
assert.ok(hasAmountGuardedRefundReversal(cancellationAst),
  'Cancelling a zero-money return must not manufacture a refund reversal')
assert.ok(receiptWorker.includes("code: 'intake_freshness_confirmation_required'"), 'Delayed intake does not stop on a newer physical count')
assert.ok(receiptWorker.includes("freshnessDecision === 'already_counted'"), 'Delayed intake cannot preserve a newer count when the returned unit was already included')
assert.ok(receiptWorker.includes('freshnessProtected = true'), 'Fresh-count intake protection is not recorded in the response')

const app = read('src/App.tsx')
const returnCreation = read('src/app/returnCreationOperation.ts')
assert.ok(app.includes('prepareReturnCreation(returnSelectedOrder, returnDraft)'), 'App must prepare Return payload before any write')
assert.ok(returnCreation.includes('selectedReturnItems.length === 0'), 'Frontend zero-money Return item guard must stay in the preparation helper')
assert.ok(returnCreation.includes('amount > 0 && !draft.paymentMethod.trim()'), 'Frontend must require payment method only for positive refund')
assert.ok(app.includes('<StockResolutionConfirmModal prompt={stockResolutionPrompt} onDecision={answerStockResolution} />'), 'Friendly possession resolver modal is not wired')
assert.ok(app.includes('await askStockResolution({'), 'Possession resolver still lacks in-app confirmation flow')
assert.ok(!app.includes('По учёту товара меньше, чем нужно для этой отправки.\\n\\n${lines.join'), 'Shipping shortage still uses the browser confirm text')
assert.ok(app.includes('setReturnedItemResolutionEventId(eventId)'), 'Pending returned item does not open in-flow item resolver')
assert.ok(app.includes('<ReturnedItemResolutionModal'), 'Returned-item resolver is not mounted')
assert.ok(app.includes('Promise.allSettled([loadReturnHistory(), loadExchangeHistory()])'), 'Orders workspace does not proactively load pending intake counts')
assert.ok(app.includes("result.code === 'intake_freshness_confirmation_required'"), 'Frontend does not ask what a newer physical count already included')
assert.ok(app.includes("'already_counted' : 'arrived_after_check'"), 'Frontend does not preserve the operator freshness decision')

const index = read('worker/index.ts')
assert.ok(index.includes("operation_type IN ('return','exchange')"), 'Manager lifecycle exception is not restricted to return/exchange intake')
assert.ok(index.includes("status = 'pending' AND direction = 'in'"), 'Manager lifecycle exception is not restricted to pending inbound events')
assert.ok(index.includes('Boolean(input.createProduct) || createFields.length > 0'), 'Master-data creation no longer keeps its Admin gate')

const receiptModal = read('src/features/orders/ReturnedItemResolutionModal.tsx')
assert.ok(receiptModal.includes('Что именно приехало?'))
assert.ok(receiptModal.includes('rankedProducts(products, search'))
assert.ok(receiptModal.includes('Товара нет в каталоге — нужен админ'))
assert.ok(receiptModal.includes('Подтвердить и принять в остаток'))

const stockModal = read('src/features/orders/StockResolutionConfirmModal.tsx')
assert.ok(stockModal.includes("prompt.trackedLabel || 'По учёту'"))
assert.ok(stockModal.includes("prompt.neededLabel || 'В этой операции'"))
assert.ok(stockModal.includes('Эти вещи прямо сейчас физически у вас?'))
assert.ok(stockModal.includes('prompt.question ||') && stockModal.includes('prompt.cancelLabel ||'), 'Shared confirmation modal cannot express intake freshness choices')

const returnSection = read('src/features/sections/OrderReturnsSection.tsx')
const exchangeSection = read('src/features/sections/OrderExchangeSection.tsx')
assert.ok(returnSection.includes("item.isWorkshop ? 'no_stock' : 'warehouse'"), 'Return intake queue loses Workshop no-stock default')
assert.ok(exchangeSection.includes("receiptDestinations[receiptKey] || (isWorkshop ? 'no_stock' : 'warehouse')"),
  'Active Exchange intake queue must default Workshop returns to no_stock')
assert.ok(exchangeSection.includes("receiptDestinations[\`exchange:\${entry.id}:\${entry.oldOperationItemId}\`] || (entry.oldIsWorkshop ? 'no_stock' : 'warehouse')"),
  'Legacy Exchange history fallback must also preserve the no_stock Workshop default')

const historyPanel = read('src/features/inventory/views/renderInventoryHistoryPanel.tsx')
assert.ok(historyPanel.includes('Физическая операция') && historyPanel.includes('transferLineQuantity'), 'Inventory history still hides physical operation quantity behind stock delta')

const header = read('src/features/sections/OrdersHeaderSection.tsx')
assert.ok(header.includes('order-tab-attention'))
assert.ok(header.includes("panel.kind === 'returns'") && header.includes("panel.kind === 'exchange'"))

// Run the exact production Return preparation + POST module compiled by esbuild.
// This checks monetary/physical separation and retry semantics rather than merely
// searching the App monolith for old textual guards.
const compiled = await build({
  entryPoints: ['src/app/returnCreationOperation.ts'], bundle: true,
  platform: 'node', format: 'esm', target: 'es2022', write: false, logLevel: 'silent',
})
const returnModule = await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'))
const { prepareReturnCreation, submitReturnCreation } = returnModule
const returnOrder = { id: 987, external_id: 'ORDER-RETURN-TEST', received_amount: 20000, return_amount: 3000 }
const returnItem = {
  orderItemId: 91, productName: 'ТЕСТ ШАПАН', quantity: 1, maxQuantity: 1,
  sourceType: 'warehouse', issuedToClient: true,
  restock: false, physicalState: 'pending',
}
const returnDraft = {
  returnDate: '2026-11-08', amount: 0, paymentMethod: '', extraRefundEnabled: false,
  extraRefundAmount: 0, extraRefundMethod: '', comment: 'без денег',
  restockSource: 'none', items: [returnItem],
}
const physOnly = prepareReturnCreation(returnOrder, returnDraft)
assert.equal(physOnly.ok, true)
assert.equal(physOnly.payload.amount, 0)
assert.deepEqual(physOnly.payload.paymentParts, [], 'Physical-only return must not manufacture a payment')
assert.deepEqual(physOnly.payload.items, [{
  orderItemId: 91, quantity: 1, restock: false, physicalState: 'pending',
}])
assert.equal(prepareReturnCreation(returnOrder, {...returnDraft,items:[]}).ok, false,
  'An empty 0 ₸ return is invalid')
const moneyOnly = prepareReturnCreation(returnOrder, {...returnDraft,amount:2500,items:[],paymentMethod:'KASPI'})
assert.equal(moneyOnly.ok,true)
assert.deepEqual(moneyOnly.payload.paymentParts,[{method:'KASPI',amount:2500}])
assert.deepEqual(moneyOnly.payload.items,[], 'Money-only return must not fake item intake')
assert.match(prepareReturnCreation(returnOrder,{...returnDraft,items:[{...returnItem,issuedToClient:false}]}).error,
  /не выдавали клиенту/i, 'Never-issued merchandise cannot be returned as a physical fact')
assert.match(prepareReturnCreation(returnOrder,{...returnDraft,amount:20000,paymentMethod:'KASPI'}).error,
  /больше доступной суммы/i)
assert.match(prepareReturnCreation(returnOrder,{...returnDraft,amount:1000}).error,
  /Выберите способ возврата денег/i)
const split = prepareReturnCreation(returnOrder,{
  ...returnDraft,amount:2500,paymentMethod:'KASPI',
  extraRefundEnabled:true,extraRefundAmount:500,extraRefundMethod:'НАЛИЧНЫЕ',
  items:[{...returnItem,physicalState:'warehouse'}],
})
assert.equal(split.ok,true)
assert.deepEqual(split.payload.paymentParts,[
  {method:'KASPI',amount:2000},{method:'НАЛИЧНЫЕ',amount:500},
])
assert.equal(split.payload.items[0].restock,true,'Received warehouse item has physical intake truth')
assert.match(prepareReturnCreation(returnOrder,{
  ...returnDraft,amount:2500,paymentMethod:'KASPI',
  extraRefundEnabled:true,extraRefundAmount:500,extraRefundMethod:'kaspi',
}).error,/второго способа/i,'Duplicated payment method must be rejected')
assert.match(prepareReturnCreation(returnOrder,{
  ...returnDraft,amount:2500,paymentMethod:'KASPI',
  extraRefundEnabled:true,extraRefundAmount:2500,extraRefundMethod:'НАЛИЧНЫЕ',
}).error,/второго способа/i,'Second method must not consume the entire refund')
assert.equal(prepareReturnCreation(returnOrder,{
  ...returnDraft,items:[{...returnItem,physicalState:'no_stock'}],
}).payload.items[0].restock,false,'No-stock received item must not write physical stock')

const outstanding = new Map(), sent = [], completed = []
let counter = 0
let dropNext = true
const fakeClient = {
  prepareCriticalRequest(key,payload) {
    const fingerprint = JSON.stringify(payload)
    let prev = outstanding.get(key)
    if (!prev || prev.fingerprint !== fingerprint) {
      prev={fingerprint,requestId:'return-test-'+(++counter)}
      outstanding.set(key,prev)
    }
    return {requestId:prev.requestId,payload:{...payload,requestId:prev.requestId}}
  },
  completeCriticalRequest(key,requestId) {
    completed.push({key,requestId})
    if(outstanding.get(key)?.requestId===requestId)outstanding.delete(key)
  },
  async apiFetch(url,init) {
    sent.push({url,method:init.method,headers:init.headers,payload:JSON.parse(init.body)})
    if(dropNext){dropNext=false;throw new Error('Network result unknown')}
    return new Response(JSON.stringify({ok:true,order:{id:987},pendingInventoryCount:1}),
      {status:200,headers:{'Content-Type':'application/json'}})
  },
}
await assert.rejects(()=>submitReturnCreation(fakeClient,split.payload),/Network result unknown/)
assert.equal(completed.length,0,'Failed/unknown Return write must not clear its requestId')
const committed = await submitReturnCreation(fakeClient,split.payload)
assert.equal(committed.pendingInventoryCount,1)
assert.equal(committed.order.id,987)
assert.equal(sent[0].url,'/api/returns')
assert.equal(sent[0].method,'POST')
assert.equal(sent[0].headers['X-Idempotency-Key'],sent[1].headers['X-Idempotency-Key'])
assert.deepEqual(sent[1].payload,{...split.payload,requestId:sent[1].headers['X-Idempotency-Key']})
assert.deepEqual(completed,[{key:'return-create:987',requestId:sent[1].headers['X-Idempotency-Key']}],
 'Complete critical request only after a durably successful Worker response')
assert.ok(app.includes('submitReturnCreation('),'Return UI must use the tested exact POST helper')
console.log('RETURN_CREATION_PREPARATION_AND_CRITICAL_REPLAY_PASS')

console.log('STAGE02 POST-REVIEW RESOLVER/RETURN UX PASSED — incremental search, safe learning, zero-money item returns, in-flow receipt resolution, friendly possession confirmation, and visible pending intake are protected.')
