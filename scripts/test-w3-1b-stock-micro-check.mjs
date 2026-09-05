import fs from 'node:fs'

const read = (path) => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }
const overview = read('src/features/inventory/views/renderInventoryOverviewPanel.tsx')
const attention = read('src/features/inventory/useInventoryAttentionActions.ts')
const app = read('src/App.tsx')
const inventorySection = read('src/features/sections/InventorySection.tsx')
const preservation = read('scripts/test-step1906b-frontend-modularization.mjs')
const manifest = JSON.parse(read('scripts/w3-1b-stock-micro-check-frontend-manifest.json'))

const between = (text, start, end) => {
  const from = text.indexOf(start)
  check(from >= 0, `Missing start: ${start}`)
  const to = text.indexOf(end, from + start.length)
  check(to > from, `Missing end after: ${start}`)
  return text.slice(from, to)
}

const opener = between(overview, 'const openConcreteStockCheck =', 'const microCheckDetailRow =')
check(opener.includes('simpleStockPhysical(row)') && opener.includes('simpleStockReserved(row)') && opener.includes('simpleStockQuantity(row)'), 'micro-check must use the already-loaded stock row')
check(opener.includes('microCheck: true'), 'micro-check detail mode marker missing')
for (const forbidden of ['loadInventory', 'loadWarehouseAttention', 'loadInventoryReservations', 'refreshCycleCountSuggestions', 'fetch(', '/api/']) {
  check(!opener.includes(forbidden), `opening a micro-check must not perform a read: ${forbidden}`)
}
check((overview.match(/>Проверить<\/button>/g) || []).length >= 2, 'concrete stock rows must expose the voluntary Проверить action')
check(overview.includes('data-w3-micro-check="true"'), 'micro-check surface missing')
check(overview.includes('Это добровольная сверка этой конкретной позиции. Открытие ничего не меняет'), 'voluntary/non-mutating copy missing')
check(overview.includes('Да, на месте ${simpleStockDetail.physical}'), 'one-click same-quantity confirmation missing')
check(overview.includes('Нет, другое количество'), 'alternate factual quantity path missing')
check(overview.includes('simpleStockDetail.physical < 0') && overview.includes('подтвердить его одним нажатием нельзя'), 'negative system quantity must require an explicit fact')
check(overview.includes('Подробнее о позиции') && overview.includes('openSimpleStockRowsDetail([microCheckDetailRow(simpleStockDetail)]'), 'full detail must remain available as an explicit second action')

check(attention.includes('async function applyQuickStocktake(countedOverride?: number)'), 'quick stocktake does not accept exact one-click override')
check(attention.includes("countedOverride === undefined ? (quickStocktakeValues[String(simpleStockDetail.variantId)] ?? '') : String(countedOverride)"), 'one-click override does not share the existing CAS-protected write path')
check(attention.includes('expectedQuantity: simpleStockDetail.physical'), 'CAS expected quantity guard disappeared')

// W3.1A demand-driven Attention invalidation remains intact outside the explicitly completed check flow.
const invalidator = between(app, 'function invalidateInventoryStockCaches(includeCatalogReview = false)', 'async function loadCatalogData(force = false)')
check(invalidator.includes('warehouseAttentionSummaryCache = null') && !invalidator.includes('loadWarehouseAttention('), 'W3.1A Attention invalidation regressed')
check(!app.includes('if (postSaveShortages.length) void loadWarehouseAttention()'), 'order save unsolicited Attention read returned')

check(manifest.version === 1 && manifest.revision === 'w3-1b-stock-micro-check', 'W3.1B frontend manifest invalid')
check(Boolean(manifest.frontend?.panelReturnChanges?.renderInventoryOverviewPanel), 'W3.1B overview preservation delta missing')
check(preservation.includes('w3StockMicroCheckPath') && preservation.includes('W3.1B stock micro-check panel baseline hash mismatch'), '1906B preservation chain is not aware of W3.1B')

// Frozen Arrival UI remains untouched.
check(inventorySection.includes('<div className="inventory-arrival-legacy-workspace">'), 'frozen Arrival workspace changed')
check(inventorySection.includes('<button className="inventory-arrival-add-position" type="button" onClick={addInventoryArrivalPosition}>+ Добавить позицию</button>'), 'frozen Arrival add-position action changed')

console.log('W3.1B STOCK MICRO-CHECK PASSED — concrete checks open from loaded stock, confirmation is voluntary/CAS-protected, and full detail remains explicit')
