import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const read = (path) => fs.readFileSync(path, 'utf8')
const app = read('src/App.tsx')
const modal = read('src/features/orders/OrderCatalogResolutionModal.tsx')
const modalCss = read('src/features/orders/OrderCatalogResolutionModal.css')
const flowSource = read('src/features/orders/catalogResolutionFlow.ts')
const returns = read('src/features/sections/OrderReturnsSection.tsx')
const exchanges = read('src/features/sections/OrderExchangeSection.tsx')
const domain = read('worker/domains/returns-exchanges.ts')
const review = read('worker/domains/catalog-review.ts')
const lifecycle = read('worker/domains/lifecycle.ts')

const compiled = ts.transpileModule(flowSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const module = { exports: {} }
vm.runInNewContext(compiled, { exports: module.exports, module })
const { rankedProducts } = module.exports

const products = [
  { id: 1, name: 'ДАРА ШАПАН' },
  { id: 2, name: 'ДВОЙКА ШАПАН' },
  { id: 3, name: 'АБАЙ ШАПАН' },
  { id: 4, name: 'КАРДИГАН' },
]
const oneLetter = rankedProducts(products, 'Д')
assert.ok(oneLetter[0].score > 0 && /^Д/.test(oneLetter[0].product.name), 'Partial one-letter search does not surface matching products')
const shapan = rankedProducts(products, 'ШАП')
assert.ok(shapan.slice(0, 3).every(entry => entry.score > 0 && entry.product.name.includes('ШАПАН')), 'Token-prefix search does not surface all matching ШАПАН products')
assert.equal(rankedProducts(products, 'ДАРА')[0].product.name, 'ДАРА ШАПАН', 'Product prefix search ranks the wrong product first')

assert.ok(modal.includes('Введите название целиком или только часть') && modal.includes('resolution-product-results'), 'Resolver search still behaves like an exact-match technical field')
assert.ok(modal.includes("purpose?: 'shipping' | 'intake'") && modal.includes('preferredOrderItemId?: number | null'), 'Resolver cannot be reused directly from returned-item intake')
assert.ok(modal.includes("purpose === 'intake' ? 'Принять и уточнить товар' : 'Уточнить товар'"), 'Resolver still presents intake as a shipping/error dialog')
assert.ok(modal.includes('Нужно выбрать товар') && !modal.includes('Товар пока не определён'), 'Resolver still uses technical/error-like unresolved copy')
assert.ok(modalCss.includes('.resolution-product-choice') && modalCss.includes('.resolution-understanding'), 'Resolver polish styles missing')

assert.ok(app.includes('askStockResolution') && app.includes('stock-resolution-modal'), 'Operational possession resolver still uses browser confirm UI')
assert.ok(!app.includes('Подтвердите только если указанные вещи прямо сейчас физически у вас'), 'Old technical browser-confirm wording still present for shipping/handover')
assert.ok(app.includes("purpose: 'intake'") && app.includes('pendingInventory?.needsCatalogResolution'), 'Returned-item receipt does not launch catalog resolver inline when identity is unknown')
assert.ok(app.includes('reconcileKnownInventoryLifecycle(orderCatalogResolutionContinuation.lifecycleEventId)'), 'Intake resolver does not resume the exact pending lifecycle event after identity confirmation')

assert.ok(returns.includes('Ожидают физической приёмки') && returns.includes('Принять товар'), 'Return intake remains hidden in history')
assert.ok(exchanges.includes('Ожидают возврата старых вещей') && exchanges.includes('Принять товар'), 'Exchange intake remains hidden in history')
assert.ok(returns.includes('Не требуется: возврат товара без возврата денег.'), 'Zero-money product return UI still dead-ends on payment method')

assert.ok(domain.includes('amount <= 0 && !hasReturnedItems'), 'Backend still rejects zero-money product returns')
assert.ok(domain.includes('if (amount > 0 && !paymentMethod)'), 'Backend still requires payment method for zero-money product returns')
assert.ok(domain.includes('if (amount > 0) {\n      returnCreateStatements.push(refundMoneyEventStatement'), 'Zero-money return can still create a fake refund money event')
assert.ok(domain.includes('if (toInt(ret.amount, 0) > 0)'), 'Cancelling zero-money return can still create fake refund reversal')
assert.ok(domain.includes('needsCatalogResolution: !resolved.variantId'), 'Returned-item receipt does not tell frontend when catalog identity needs resolver')

assert.ok(review.includes('catalogReviewExactSignatureMatchesSelected') && review.includes('safeToLearnExactSignature'), 'Safe exact human confirmation is not distinguished from ambiguous/incomplete answers')
assert.ok(review.includes('rememberCatalogProductAlias') && review.includes('writeAlias: true'), 'Safe existing-SKU confirmation is not learned for later identical raw input')
assert.ok(lifecycle.includes('Sibling inbound auto-reconciliation skipped') && lifecycle.includes('autoReconciled'), 'Identical already-pending inbound rows are not auto-finished after exact confirmation')

console.log('POST-REVIEW RESOLVER/INTAKE UX REGRESSION PASSED — friendly possession dialog, partial product search, zero-money item returns, inline intake resolver, safe learning and sibling auto-reconciliation are protected.')
