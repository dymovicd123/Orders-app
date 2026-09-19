import fs from 'node:fs'

const read = (path) => fs.readFileSync(path, 'utf8')
const check = (ok, message) => { if (!ok) throw new Error(message) }

const app = read('src/App.tsx')
const flow = read('src/features/orders/catalogResolutionFlow.ts')
const modal = read('src/features/orders/OrderCatalogResolutionModal.tsx')
const returnView = read('src/features/sections/OrderReturnsSection.tsx')
const exchangeView = read('src/features/sections/OrderExchangeSection.tsx')
const review = read('worker/domains/catalog-review.ts')
const lifecycle = read('worker/domains/lifecycle.ts')
const returnWorker = read('worker/domains/returns-exchanges.ts')
const router = read('worker/index.ts')
const confirmDialog = read('src/components/OperationalConfirmationDialog.tsx')
const returnedResolver = read('src/features/orders/ReturnedItemResolutionModal.tsx')

check(flow.includes('nameStartsWithQuery') && flow.includes('anyTokenStartsWithQuery') && flow.includes('containsQuery'), 'Resolver search lacks progressive prefix/substring ranking')
check(modal.includes('Уточнение товара') && modal.includes('Поиск по каталогу') && modal.includes('Похожих товаров не нашли'), 'Resolver still exposes technical/diagnostic wording')

check(app.includes('askOperationalConfirmation({') && app.includes("confirmLabel: 'Да, отправляю клиенту'"), 'Shipping still lacks app-native possession confirmation')
check(app.includes("confirmLabel: 'Да, передаю клиенту'"), 'Early handover still lacks app-native possession confirmation')
check(confirmDialog.includes('Нужно подтверждение') && confirmDialog.includes('operation-confirm-actions'), 'Friendly operational confirmation dialog is missing')

check(app.includes('const selectedReturnItems = returnDraft.items') && app.includes('amount <= 0 && selectedReturnItems.length === 0'), 'Frontend still blocks legitimate zero-money item returns')
check(app.includes("amount > 0 && !returnDraft.paymentMethod.trim()"), 'Frontend requires payment method for zero-money item return')
check(returnWorker.includes('amount <= 0 && selectedItems.length === 0'), 'Worker still blocks zero-money item returns')
check(returnWorker.includes('if (amount > 0) {') && returnWorker.includes('createReturnStatements.push(refundMoneyEventStatement'), 'Worker may create a zero-value refund financial event')
check(returnWorker.includes('if (toInt(ret.amount, 0) > 0)') && returnWorker.includes('cancelReturnStatements.push(refundReversalMoneyEventStatement'), 'Cancelling zero-money return may create a zero-value reversal')

check(app.includes('pendingInventory?: { eventId?: number') && app.includes('setReturnedItemResolution({ eventId, productName: input.productName'), 'Unknown returned item does not immediately open resolver')
check(returnedResolver.includes('Что именно пришло?') && returnedResolver.includes('/api/inventory/lifecycle/${eventId}/resolve-facts'), 'Returned-item resolver is not attached to lifecycle intake')
check(returnView.includes('Есть товары, которые ещё нужно принять') && returnView.includes('Определить товар и завершить приёмку'), 'Return pending receipt remains hidden')
check(exchangeView.includes('Ожидается приём старых вещей') && exchangeView.includes('Определить товар и завершить приёмку'), 'Exchange pending receipt remains hidden')

check(review.includes('const hasCompleteRawIdentity = Boolean(') && review.includes('const targetRows = identical.length ? identical : matching'), 'Complete human-confirmed identity is not reused across matching unresolved rows')
check(review.includes('rememberCatalogProductAlias(db, anchor.product_name_snapshot') && review.includes('{ writeAlias: true }'), 'Complete resolver confirmation is not learned for future orders')
check(lifecycle.includes('let autoResolvedMatching = 0') && lifecycle.includes('reconcileKnownPendingInventoryInbound(db, toInt(sibling.id, 0))'), 'Learned returned-item identity is not reused for already-pending matching receipts')

const lifecycleContextRoute = router.slice(router.indexOf('const inventoryLifecycleContextMatch'), router.indexOf("if (url.pathname === '/api/catalog/review/reconcile'"))
check(lifecycleContextRoute.includes('needsAdminCatalogMutation') && lifecycleContextRoute.includes('requireAdminAccess(request)'), 'Lifecycle resolver no longer protects catalog-creating mutations')
check(!/inventoryLifecycleContextMatch[\s\S]{0,250}requireAdminAccess/.test(lifecycleContextRoute), 'Routine returned-item context is still Admin-only')

console.log('STAGE02 RESOLVER/RETURN UX FIXES PASSED — friendly confirmations, useful search, zero-money item returns, immediate intake resolution, visible pending receipt, and safe learned identity reuse are protected.')
