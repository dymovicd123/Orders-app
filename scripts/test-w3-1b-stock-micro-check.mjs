import fs from 'node:fs'

const read = (path) => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }
const overview = read('src/features/inventory/views/renderInventoryOverviewPanel.tsx')
const attention = read('src/features/inventory/useInventoryAttentionActions.ts')
const app = read('src/App.tsx')
const inventorySection = read('src/features/sections/InventorySection.tsx')
const preservation = read('scripts/test-step1906b-frontend-modularization.mjs')
const manifest = JSON.parse(read('scripts/w3-1b-stock-micro-check-frontend-manifest.json'))

check(overview.includes('const openConcreteStockDetail =') && overview.includes('openSimpleStockRowsDetail([row]'), 'exact SKU must open the neutral detail card')
check(inventorySection.includes('microCheck: false'), 'opening an SKU must not silently enter count mode')
check((overview.match(/warehouse-w3-micro-check-entry/g) || []).length >= 2, 'single and multi-SKU paths must expose the explicit count entry')
check(overview.includes('warehouse-w3-micro-check-start') && overview.includes('microCheck: true'), 'neutral SKU detail lost the explicit quick-check start')
check(overview.includes('data-w3-micro-check="true"'), 'micro-check surface missing')
check(overview.includes('Это добровольная сверка этой конкретной позиции. Открытие ничего не меняет'), 'voluntary/non-mutating copy missing')
check(overview.includes('Да, на месте ${simpleStockDetail.physical}'), 'one-click same-quantity confirmation missing')
check(overview.includes('Нет, другое количество'), 'alternate factual quantity path missing')
check(overview.includes('simpleStockDetail.physical < 0') && overview.includes('подтвердить его одним нажатием нельзя'), 'negative system quantity must require an explicit fact')
check(overview.includes('Подробнее о позиции') && overview.includes('openSimpleStockRowsDetail([microCheckDetailRow(simpleStockDetail)]'), 'full detail must remain available after a quick check')

check(attention.includes('async function applyQuickStocktake(countedOverride?: number)'), 'quick stocktake does not accept exact one-click override')
check(attention.includes("countedOverride === undefined ? (quickStocktakeValues[String(simpleStockDetail.variantId)] ?? '') : String(countedOverride)"), 'one-click override does not share the existing CAS-protected write path')
check(attention.includes('expectedQuantity: simpleStockDetail.physical'), 'CAS expected quantity guard disappeared')

const invalidatorStart = app.indexOf('function invalidateInventoryStockCaches(includeCatalogReview = false)')
const invalidatorEnd = app.indexOf('async function loadCatalogData(force = false)', invalidatorStart)
check(invalidatorStart >= 0 && invalidatorEnd > invalidatorStart, 'W3.1A invalidation boundary missing')
const invalidator = app.slice(invalidatorStart, invalidatorEnd)
check(invalidator.includes('warehouseAttentionSummaryCache = null') && !invalidator.includes('loadWarehouseAttention('), 'W3.1A Attention invalidation regressed')
check(!app.includes('if (postSaveShortages.length) void loadWarehouseAttention()'), 'order save unsolicited Attention read returned')

check(manifest.version === 1 && manifest.revision === 'w3-1b-stock-micro-check', 'W3.1B frontend manifest invalid')
check(Boolean(manifest.frontend?.panelReturnChanges?.renderInventoryOverviewPanel), 'W3.1B overview preservation delta missing')
check(preservation.includes('w3StockMicroCheckPath') && preservation.includes('W3.1B stock micro-check panel baseline hash mismatch'), '1906B preservation chain is not aware of W3.1B')
check(inventorySection.includes('<div className="inventory-arrival-legacy-workspace">'), 'frozen Arrival workspace changed')
check(inventorySection.includes('<button className="inventory-arrival-add-position" type="button" onClick={addInventoryArrivalPosition}>+ Добавить позицию</button>'), 'frozen Arrival add-position action changed')

console.log('W3.1B STOCK MICRO-CHECK PASSED — SKU browsing is neutral; explicit one-tap/mismatch counting stays voluntary, exact and CAS-protected')
