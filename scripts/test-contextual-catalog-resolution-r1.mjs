import fs from 'node:fs'

const read = (path) => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

try {
  const worker = read('worker/index.ts')
  const review = read('worker/domains/catalog-review.ts')
  const catalog = read('worker/domains/catalog.ts')
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

  check(modal.includes('Связать выбранный существующий вариант'), 'R2 must retain a fast exact-existing-variant path')
  check(modal.includes('/resolve-existing'), 'Orders UI must retain the narrow existing-variant resolver')
  check(modal.includes('/resolve-facts'), 'R2 must resolve new/corrected characteristics without leaving Orders')
  check(modal.includes('Можно исправить любое поле'), 'R2 must not freeze fields merely because the backend recognized a placeholder')
  check(modal.includes('Новое значение — добавить'), 'R2 must add a new reference value inline with explicit confirmation')
  check(modal.includes('Пустое поле из заказа не считается фактом'), 'Missing color/size must require an explicit operator decision')
  check(modal.includes('В исходном названии остался текст'), 'R2 must surface compound-name residue instead of treating the whole dirty string as a canonical product')
  check(modal.includes('как материал'), 'Compound-name residue must be reusable as a material hypothesis')
  check(modal.includes('rankedProducts(catalog, activeItem?.productName'), 'R2 must keep contextual base-product suggestions in the same resolver')
  check(!modal.includes('Нужна новая характеристика'), 'R2 must not send the operator to the old lossy full-review detour')
  check(modal.includes('Отправить заказ в обход этой проверки нельзя'), 'Resolver must not add a send-anyway bypass')
  check(modal.includes('const load = async (completeWhenEmpty = false)'), 'Resolver initial load must distinguish passive open from post-resolution completion')
  check(modal.includes('if (completeWhenEmpty)'), 'Resolver must never auto-complete from an empty initial review response')
  check((modal.match(/await load\(true\)/g) || []).length === 2, 'Resolver may auto-complete only after the two explicit successful resolution actions')
  check(modal.includes('void load()'), 'Resolver initial open must remain a non-completing load')

  check(catalog.includes("raw === 'СТАНДАРТ' || canonical === 'СТАНДАРТ'"), 'Placeholder STANDARD must never become a learned value alias')
  check(catalog.includes("['БЕЗ ЦВЕТА', 'НЕТ ЦВЕТА', 'НЕ УКАЗАН'].includes(raw)"), 'No-color placeholders must never become learned value aliases')
  check(catalog.includes("['БЕЗ РАЗМЕРА', 'БЕЗРАЗМЕРА', 'Б/Р', 'НЕ УКАЗАН'].includes(raw)"), 'No-size placeholders must never become learned value aliases')

  console.log('CONTEXTUAL CATALOG RESOLUTION R2 PASSED — ambiguous shipping rows stay blocked, existing variants remain fast, and admins can correct/create exact catalog facts inline without learning placeholder aliases')
} catch (error) {
  console.error(`CONTEXTUAL CATALOG RESOLUTION R2 FAILED: ${error?.message || error}`)
  process.exit(1)
}
