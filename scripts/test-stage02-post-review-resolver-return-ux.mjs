import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

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

const returnsWorker = read('worker/domains/returns-exchanges.ts')
assert.ok(returnsWorker.includes('if (amount <= 0 && selectedItems.length === 0)'), 'Zero-money return must require a returned item, not positive money')
assert.ok(returnsWorker.includes('if (amount > 0 && !paymentMethod)'), 'Payment method must only be required when money is actually refunded')
assert.ok(returnsWorker.includes('if (amount > 0) {\n      createStatements.push(refundMoneyEventStatement'), 'Zero-money item return must not manufacture a money event')
assert.ok(returnsWorker.includes('if (toInt(ret.amount, 0) > 0)'), 'Cancelling a zero-money return must not manufacture a refund reversal')
assert.ok(returnsWorker.includes("code: 'intake_freshness_confirmation_required'"), 'Delayed intake does not stop on a newer physical count')
assert.ok(returnsWorker.includes("freshnessDecision === 'already_counted'"), 'Delayed intake cannot preserve a newer count when the returned unit was already included')
assert.ok(returnsWorker.includes('freshnessProtected = true'), 'Fresh-count intake protection is not recorded in the response')

const app = read('src/App.tsx')
assert.ok(app.includes('selectedReturnItems.length === 0'), 'Frontend zero-money return item guard is missing')
assert.ok(app.includes('amount > 0 && !returnDraft.paymentMethod.trim()'), 'Frontend still requires a payment method for 0 ₸ returns')
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
assert.ok(stockModal.includes('По учёту:'))
assert.ok(stockModal.includes('В этой операции:'))
assert.ok(stockModal.includes('Эти вещи прямо сейчас физически у вас?'))
assert.ok(stockModal.includes('prompt.question ||') && stockModal.includes('prompt.cancelLabel ||'), 'Shared confirmation modal cannot express intake freshness choices')

const returnSection = read('src/features/sections/OrderReturnsSection.tsx')
const exchangeSection = read('src/features/sections/OrderExchangeSection.tsx')
assert.ok(returnSection.includes("item.isWorkshop ? 'no_stock' : 'warehouse'"), 'Return intake queue loses Workshop no-stock default')
assert.ok(exchangeSection.includes("entry.oldIsWorkshop ? 'no_stock' : 'warehouse'"), 'Exchange intake queue loses Workshop no-stock default')

const historyPanel = read('src/features/inventory/views/renderInventoryHistoryPanel.tsx')
assert.ok(historyPanel.includes('Физическая операция') && historyPanel.includes('transferLineQuantity'), 'Inventory history still hides physical operation quantity behind stock delta')

const header = read('src/features/sections/OrdersHeaderSection.tsx')
assert.ok(header.includes('order-tab-attention'))
assert.ok(header.includes("panel.kind === 'returns'") && header.includes("panel.kind === 'exchange'"))

console.log('STAGE02 POST-REVIEW RESOLVER/RETURN UX PASSED — incremental search, safe learning, zero-money item returns, in-flow receipt resolution, friendly possession confirmation, and visible pending intake are protected.')
