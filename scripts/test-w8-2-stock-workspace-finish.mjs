import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')
const check = (ok, message) => { if (!ok) throw new Error(message) }

try {
  const pkg = JSON.parse(read('package.json'))
  const overview = read('src/features/inventory/views/renderInventoryOverviewPanel.tsx')
  const inventory = read('src/features/sections/InventorySection.tsx')
  const css = read('src/styles/w8-2-stock-workspace.css')

  check(String(pkg.scripts?.['release:check'] || '').includes('test-w8-2-stock-workspace-finish.mjs'), 'W8.2 regression is not chained into release:check')
  check(overview.includes("import '../../../styles/w8-2-stock-workspace.css'"), 'W8.2 CSS is not owned by Overview')
  check(inventory.includes('const hasExplicitStockSearch = Boolean(inventoryQuery.trim())'), 'explicit stock search override missing')
  check(inventory.includes('const visibleRows = hasExplicitStockSearch ? allRows : allRows.filter'), 'availability filter still hides explicit search results')
  check(inventory.includes('allRows,') && inventory.includes('availabilityFilterApplied: !hasExplicitStockSearch'), 'product truth scope is not carried into Overview')
  check(overview.includes('фильтр наличия не скрывает найденные позиции'), 'search/filter truth is not explained')
  check(overview.includes('const productRows = group.allRows || rows') && overview.includes('hiddenByAvailability'), 'product totals still pretend filtered rows are the whole product')
  check(overview.includes('Открыть позицию') && overview.includes('openConcreteStockDetail'), 'SKU tile is not a neutral detail entry')
  check(inventory.includes('microCheck: false'), 'opening a detail still silently starts a check')
  check(overview.includes('warehouse-w3-micro-check-start') && overview.includes('microCheck: true'), 'explicit quick-check action is missing from neutral SKU card')
  check(overview.indexOf('inventory-stock-routine-disclosure') > overview.indexOf('inventory-calm-list'), 'routine check still precedes the primary stock list')
  check(overview.includes('is-simple-execution') && overview.includes('execution.colors.length <= 3 || hasExplicitStockSearch'), 'large products are not adaptively compact/collapsible')
  check(overview.includes("${isOpen ? 'is-open' : ''}"), 'open product sticky context marker missing')
  check(inventory.includes('simpleStockReservationsRequestRef') && inventory.includes('requestId !== simpleStockReservationsRequestRef.current'), 'reservation detail is not latest-request-wins safe')
  check(css.includes('.inventory-calm-product.is-open > .inventory-calm-product-main') && css.includes('position: sticky'), 'desktop product context is not sticky')
  check(css.includes('.inventory-stock-color:not([open]) > .inventory-stock-subgroups') && css.includes('display: none'), 'collapsed colors do not actually reduce long product pages')
  check(css.includes('.inventory-stock-size-value { font-size: 18px') && css.includes('.inventory-stock-size-meta { font-size: 10px'), 'size/meta readability was not improved')
  check(!overview.includes('saveInventoryMovement') && !overview.includes('quickInventoryStocktake'), 'W8.2 introduced a direct mutation path into presentation')
  check(inventory.includes('<div className="inventory-arrival-legacy-workspace">'), 'Arrival workspace changed')

  console.log('W8.2 STOCK WORKSPACE FINISH PASSED — search is honest, product totals are truthful, SKU browsing is neutral, large products stay navigable and reservation detail is race-safe')
} catch (error) {
  console.error(`W8.2 STOCK WORKSPACE FINISH FAILED: ${error?.message || error}`)
  process.exit(1)
}
