import fs from 'node:fs'

const read = (path) => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }
const section = (text, start, end) => {
  const a = text.indexOf(start)
  check(a >= 0, `Missing section: ${start}`)
  const b = end ? text.indexOf(end, a + start.length) : -1
  return text.slice(a, b > a ? b : undefined)
}

const review = read('worker/domains/catalog-review.ts')
const lifecycle = read('worker/domains/lifecycle.ts')
const orderUi = read('src/features/orders/OrderCatalogResolutionModal.tsx')
const returnUi = read('src/features/orders/ReturnedItemResolutionModal.tsx')
const types = read('src/app/types.ts')
const contracts = read('shared/api-contracts.ts')

const orderResolve = section(review, 'export async function resolveOrderCatalogReviewExistingVariant', 'export async function listCatalogReviewQueue')
const resolveRows = section(review, 'export async function resolveCatalogReviewRows', 'export async function reconcileCatalogReviewQueue')
const orderAuto = section(review, 'export async function reconcileCatalogReviewOrder', 'export async function resolveOrderCatalogReviewExistingVariant')
const queueAuto = section(review, 'export async function reconcileCatalogReviewQueue', 'export async function excludeCatalogReviewQueueItem')
const returnCandidate = section(lifecycle, 'export async function resolveInventoryLifecycleCandidate', 'export async function trustedInventoryFullStocktakeBoundary')
const pendingQueue = section(lifecycle, 'export async function listInventoryLifecyclePending', 'async function loadLifecycleRetiredCatalogLink')
const returnContext = section(lifecycle, 'export async function getInventoryLifecycleContext', 'export async function resolveInventoryLifecycleFacts')
const returnFacts = section(lifecycle, 'export async function resolveInventoryLifecycleFacts', 'export async function listInventoryLifecyclePending')
const reconcileKnown = section(lifecycle, 'export async function reconcileKnownPendingInventoryInbound', 'export async function insertInventoryLifecycleEvent')

// Open unsent order demand must become explicit resolver work, never silent auto-reconciliation.
check(review.includes("stock_writeoff_status, '') IN ('catalog_unresolved', 'catalog_retired')"), 'catalog_retired open demand is absent from Resolver queue')
check(orderAuto.includes("stock_writeoff_status) !== 'catalog_retired'"), 'order auto-reconcile can silently recover retired demand')
check(queueAuto.includes("stock_writeoff_status) !== 'catalog_retired'"), 'global auto-reconcile can silently recover retired demand')
check(orderResolve.includes("const retiredRecovery = cleanText(anchor.stock_writeoff_status) === 'catalog_retired'"), 'retired order recovery mode missing')
check(orderResolve.includes('const exactFreshIdentity ='), 'retired order recovery does not require exact fresh identity')
check(orderResolve.includes('Исторические характеристики заказа менять нельзя'), 'retired order exact-identity rejection missing')
check(orderResolve.includes('const reusableExactInput = !retiredRecovery'), 'retired order confirmation can fan out through learned aliases')
check(resolveRows.includes("const retiredDemand = cleanText(row.stock_writeoff_status) === 'catalog_retired'"), 'retired demand not distinguished during reservation repair')
check(resolveRows.includes("retiredDemand ? 'catalog_retired' : 'catalog_unresolved'"), 'failed retired recovery loses its explicit recovery marker')
check(resolveRows.includes('if (!retiredDemand) {') && resolveRows.includes('UPDATE order_items SET product_id = ?, variant_id = ?'), 'retired recovery can rewrite historical order SKU identity')
check(resolveRows.includes('committedMatchesTarget') && resolveRows.indexOf('committedMatchesTarget') < resolveRows.indexOf('if (!retiredDemand) {'), 'fresh reservation is not proven before retired recovery success')
check(resolveRows.includes('retiredRecovered += 1'), 'retired recovery result is not observable')
check(review.includes("retired_demand_ready") && review.includes("retired_demand_waiting_restore"), 'retired order read model does not distinguish fresh-version readiness')
check(orderUi.includes('Старую SKU мы не оживляем и не переписываем в заказе'), 'order recovery UI does not explain historical identity preservation')
check(orderUi.includes('Привязать резерв к свежей версии'), 'order recovery has no explicit fresh-reservation action')
check(orderUi.includes('Сначала восстановите товар/исполнение через «Склад → Товары → Удалённые»'), 'order recovery does not explain restore-first path')
check(orderUi.includes('!retiredRecovery ? <footer>'), 'retired recovery still exposes generic manual identity editing')

// Returned historical SKU must enter a deliberate intake lane and can only write stock to fresh active identity.
check(returnCandidate.includes("matchStatus: 'retired_historical'"), 'retired return candidate can silently map old inactive SKU to current stock')
check(pendingQueue.includes('retired_historical_sku = 1') && pendingQueue.includes('retiredHistoricalSku:'), 'retired historical inbound can disappear from manual intake')
check(returnContext.includes('retiredHistoricalSku') && returnContext.includes('retirementId') && returnContext.includes('freshVariantReady'), 'return context lacks retired/fresh recovery state')
check(returnContext.includes("retired_return_ready") && returnContext.includes("retired_return_waiting_restore"), 'return read model does not distinguish restore readiness')
check(returnFacts.includes("pending_reason) === 'retired_historical'") && returnFacts.includes('старая SKU не будет оживлена'), 'generic return resolver can recreate/write into retired historical path')
check(reconcileKnown.includes("const retiredHistorical = cleanText(event.pending_reason) === 'retired_historical'"), 'known-return reconciliation does not recognize retired historical intake')
check(reconcileKnown.includes('variant_id: retiredHistorical ? null'), 'known-return reconciliation still trusts old retired variant FK')
check(lifecycle.includes('loadCanonicalVariantSnapshot(db, variantId, { activeOnly: true })'), 'physical lifecycle apply is not active-SKU-only')
check(returnUi.includes('Куда принять исторический товар?'), 'return UI lacks retired historical mode')
check(returnUi.includes('Принять в свежую версию') && returnUi.includes('/reconcile-known'), 'return UI lacks explicit fresh-identity intake action')
check(returnUi.includes('Восстановить рабочую версию') && returnUi.includes('/api/catalog/retirements/'), 'return UI lacks explicit restore-first action')
check(returnUi.includes('Старая SKU останется историей и не получит новый остаток'), 'return UI does not state old SKU stock isolation')
check(returnUi.includes('!retiredHistoricalSku && (context.product || draft.productId || draft.createProduct)'), 'retired return still exposes generic product/SKU creation form')

check(types.includes('retiredRecovery?: boolean') && types.includes('retiredHistoricalSku?: boolean'), 'frontend retired recovery types missing')
check(contracts.includes('historicalVariantId?: number | null') && contracts.includes('retirementId?: number | null') && contracts.includes('freshVariantReady?: boolean'), 'API retired recovery contract missing')
check(contracts.includes('retiredRecovered?: number'), 'order retired recovery result contract missing')

console.log('CATALOG RETIRED RECOVERY PASSED — open retired order demand reserves only a fresh exact SKU without rewriting historical order identity; returned retired SKU stays explicit and can add Physical only to a fresh active identity')
