import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }
function section(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker)
  check(start >= 0, `Section start missing: ${startMarker}`)
  const end = text.indexOf(endMarker, start + startMarker.length)
  check(end > start, `Section end missing: ${endMarker}`)
  return text.slice(start, end)
}

try {
  const reservations = read('worker/domains/order-reservations.ts')
  const review = read('worker/domains/catalog-review.ts')
  const movement = read('worker/domains/inventory-movement.ts')
  const stocktake = read('worker/domains/inventory-stocktake.ts')
  const lifecycle = read('worker/domains/lifecycle.ts')
  const catalog = read('worker/domains/catalog.ts')
  const pkg = JSON.parse(read('package.json'))

  const orderResolver = section(reservations, 'export async function resolveCatalogProductAndVariantV2(', 'export async function resolveCatalogProductAndVariant(')
  check(orderResolver.includes('order entry is lookup-only'), 'Ordinary order resolver is not explicitly lookup-only')
  check(orderResolver.includes("matchStatus: 'unresolved_execution'") && orderResolver.includes("matchStatus: 'unresolved_variant'"), 'Missing execution/variation is not preserved as unresolved demand')
  for (const forbidden of ['ensureCatalogExecutionV3(', 'createCatalogCombinationV3(', 'INSERT INTO catalog_stock_positions', 'INSERT INTO catalog_variants']) {
    check(!orderResolver.includes(forbidden), `Ordinary order resolver can still materialize catalog identity via ${forbidden}`)
  }

  const workshopResolver = section(reservations, 'export async function resolveWorkshopCatalogProductOnly(', 'export async function ensureHumanInventoryStockRow(')
  check(workshopResolver.includes('variantId: null'), 'Workshop resolver no longer stops at base product')

  const reviewResolver = section(review, 'export async function resolveCatalogReviewFacts(', 'export async function excludeCatalogReviewQueueItem(')
  check(reviewResolver.includes('only link an already-existing physical execution/variation'), 'Catalog review does not encode lookup-only normal-order semantics')
  check(reviewResolver.includes('findCatalogExecutionV3') && reviewResolver.includes('findCatalogCombinationV3'), 'Catalog review cannot link an existing physical combination')
  check(reviewResolver.includes('Разбор заказа не создаёт новые исполнения или вариации'), 'Catalog review lacks a clear physical-registration boundary')
  for (const forbidden of ['ensureCatalogExecutionV3(', 'createCatalogCombinationV3(', 'upsertReferenceValue(']) {
    check(!reviewResolver.includes(forbidden), `Catalog review can still create non-physical SKU identity via ${forbidden}`)
  }
  check(reviewResolver.includes('createCatalogProduct('), 'Explicit base-product creation was accidentally removed from catalog review')

  const bulkResolver = section(movement, 'export async function resolveInventoryCreatableItemsBulk(', 'export async function applyInventoryMovement(')
  check(bulkResolver.includes('allowCatalogMaterialization'), 'Inventory resolver has no explicit materialization policy')
  check(bulkResolver.includes('if (!allowCatalogMaterialization)'), 'Inventory resolver does not fail closed when materialization is forbidden')
  const movementApply = section(movement, 'export async function applyInventoryMovement(', 'export type PreparedInventoryTransferItem')
  check(movementApply.includes("allowCatalogMaterialization: ['arrival', 'return', 'revision'].includes(movementType)"), 'Inventory materialization is not limited to physical intake/revision movement kinds')

  const stocktakeAdd = section(stocktake, 'export async function addInventoryStocktakeCombination(', 'export async function listInventoryCycleCountSuggestions(')
  check(stocktakeAdd.includes('ensureCatalogExecutionV3') && stocktakeAdd.includes('INSERT OR IGNORE INTO catalog_variants'), 'Found-on-stocktake can no longer materialize physical catalog identity')

  const lifecycleResolve = section(lifecycle, 'export async function resolveInventoryLifecycleFacts(', '\n}')
  check(lifecycleResolve.includes('ensureCatalogExecutionV3') && lifecycleResolve.includes('createCatalogCombinationV3'), 'Explicit stock-affecting lifecycle resolution can no longer materialize a physical SKU')

  const baseProductCreate = section(catalog, 'export async function createCatalogProduct(', 'export async function updateCatalogProduct(')
  check(baseProductCreate.includes('INSERT INTO catalog_products'), 'Base catalog product creation is missing')
  check(!baseProductCreate.includes('catalog_variants') && !baseProductCreate.includes('catalog_stock_positions'), 'Creating a base product still creates synthetic execution/variation rows')

  check(String(pkg.scripts?.['release:check'] || '').includes('test-phase3a-catalog-physical-materialization.mjs'), 'Phase 3A regression is not wired into release:check')
  console.log('PHASE 3A CATALOG PHYSICAL MATERIALIZATION TESTS PASSED — orders/review are lookup-only while physical intake, stocktake discovery and explicit lifecycle intake retain controlled SKU materialization')
} catch (error) {
  console.error(`PHASE 3A CATALOG PHYSICAL MATERIALIZATION TESTS FAILED: ${error?.message || error}`)
  process.exit(1)
}
