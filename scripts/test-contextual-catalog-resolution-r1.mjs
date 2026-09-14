import fs from 'node:fs'

const read = (path) => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

try {
  const worker = read('worker/index.ts')
  const review = read('worker/domains/catalog-review.ts')
  const app = read('src/App.tsx')
  const modal = read('src/features/orders/OrderCatalogResolutionModal.tsx')
  const lazySections = read('src/app/lazySections.tsx')
  const utils = read('src/app/utils.ts')

  check(review.includes('export async function reconcileCatalogReviewOrder'), 'Order-scoped safe auto-reconciliation must exist')
  check(review.includes('fetchCatalogReviewRows(db, 160, orderId)'), 'Auto-reconciliation must stay scoped to one order')
  check(review.includes('export async function resolveOrderCatalogReviewExistingVariant'), 'Manager-safe existing-variant resolver must exist')
  check(review.includes('selected.product_id') && review.includes('anchor.product_id'), 'Existing-variant resolution must protect a known base-product identity')

  check(worker.includes('const orderCatalogReviewMatch = url.pathname.match('), 'Order-scoped catalog review GET route must exist')
  check(worker.includes('const orderCatalogReviewContextMatch = url.pathname.match('), 'Order-scoped catalog context route must exist')
  check(worker.includes('const orderCatalogReviewResolveMatch = url.pathname.match('), 'Order-scoped existing-variant mutation route must exist')
  check(worker.includes('await reconcileCatalogReviewOrder(env.DB, id)') && worker.includes('blockers = await getOrderShipmentInventoryBlockers(env.DB, id)'), 'Shipping must retry blockers after safe order-scoped auto-reconciliation')
  check(worker.includes("code: 'catalog_review_required'"), 'Shipping must still block unresolved catalog ambiguity')

  check(app.includes('OrderCatalogResolutionModal'), 'Orders UI must render the contextual resolver')
  check(!app.includes("from './features/orders/OrderCatalogResolutionModal'"), 'Contextual resolver must not regrow the initial static source graph')
  check(lazySections.includes("import('../features/orders/OrderCatalogResolutionModal')"), 'Contextual resolver must load through the established lazy feature boundary')
  check(app.includes('setOrderCatalogResolutionOrder(order)'), 'Shipping failure must open the resolver instead of redirecting ordinary staff')
  check(utils.includes('allowHttpError?: boolean'), 'Central API reader must support inspecting expected non-2xx business envelopes')
  check(app.includes("'Отправка клиенту', { allowHttpError: true })"), 'Shipping must inspect catalog_review_required before the generic HTTP error is thrown')
  check(!app.includes("Попросите администратора открыть «Склад → Товары → Требуют разбора»"), 'Ordinary staff must no longer be told to leave Orders for the old recovery queue')

  check(modal.includes('Подтвердить товар'), 'Contextual resolver must expose an explicit confirmation action')
  check(modal.includes('Точное совпадение'), 'Exact existing catalog identities must be obvious to the operator')
  check(modal.includes('Нельзя отправлять заказ «в обход»'), 'Resolver must not add a send-anyway bypass')
  check(modal.includes('/resolve-existing'), 'Orders UI must use the narrow existing-variant resolver')

  console.log('CONTEXTUAL CATALOG RESOLUTION R1 PASSED — exact catalog identities auto-heal before shipping, remaining ambiguity is resolved in Orders, and no send-anyway bypass exists')
} catch (error) {
  console.error(`CONTEXTUAL CATALOG RESOLUTION R1 FAILED: ${error?.message || error}`)
  process.exit(1)
}
