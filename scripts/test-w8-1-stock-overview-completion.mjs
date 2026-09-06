import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')
const check = (ok, message) => { if (!ok) throw new Error(message) }

try {
  const pkg = JSON.parse(read('package.json'))
  const overview = read('src/features/inventory/views/renderInventoryOverviewPanel.tsx')
  const css = read('src/styles/w8-1-stock-overview.css')
  const inventory = read('src/features/sections/InventorySection.tsx')
  const arrivalStart = inventory.indexOf('<div className="inventory-arrival-legacy-workspace">')
  const arrivalButton = '<button className="inventory-arrival-add-position" type="button" onClick={addInventoryArrivalPosition}>+ Добавить позицию</button>'

  check(String(pkg.scripts?.['release:check'] || '').includes('test-w8-1-stock-overview-completion.mjs'), 'W8.1 regression is not chained into release:check')
  check(overview.includes("import '../../../styles/w8-1-stock-overview.css'"), 'W8.1 visual layer is not owned by Overview')
  check(overview.includes('data-w8-stock-hierarchy="execution-color-size"'), 'Execution -> color -> size hierarchy missing')
  for (const marker of ['Основное исполнение', 'inventory-stock-execution', 'inventory-stock-color', 'inventory-stock-size-grid', 'inventory-stock-size-tile']) {
    check(overview.includes(marker), `W8.1 Overview marker missing: ${marker}`)
  }
  check(overview.includes('inventory-stock-size-value') && overview.includes("subgroup.category === 'child' ? '— возраст' : '— размер'"), 'Size/age is not the primary tile discriminator')
  check(overview.includes('inventory-stock-size-free') && overview.includes('inventory-stock-size-meta'), 'Exact SKU tile lost free/physical/reserved hierarchy')
  check(overview.includes('data-variant-id={row.variantId}') && overview.includes('openConcreteStockDetail(row, primary)'), 'Exact SKU identity/detail path disappeared from stock tile')
  check(overview.includes('warehouse-w3-micro-check-start') && overview.includes('Да, на месте ${simpleStockDetail.physical}'), 'W8.1 exact safe check is no longer reachable from the SKU detail')
  check(overview.includes('inventory-stock-result-meta'), 'Filtered-result scope is not explicit')
  check(overview.includes('Да, на месте {row.physical}') && overview.includes('Нет, другое количество'), 'Routine one-tap confirmation changed')
  check(overview.includes('needsIndependentCount') && overview.includes('Сначала посчитайте физически'), 'Blind-first risky count changed')
  check(!overview.includes('loadInventoryData(') && !overview.includes('loadInventoryCycleCounts('), 'Overview introduced a new inventory/cycle read path')
  check(!overview.includes('saveInventoryMovement') && !overview.includes('quickInventoryStocktake'), 'Overview introduced a new direct write path')
  check(css.includes('grid-template-columns: repeat(3, minmax(0, 1fr))') && css.includes('min-height: 78px'), 'Phone size tiles are not large/readable enough')
  check(css.includes('.inventory-stock-size-tile.needs-attention') && css.includes('.inventory-stock-size-tile.has-free'), 'Stock tile states are not visually differentiated')
  check(arrivalStart >= 0 && inventory.indexOf(arrivalButton, arrivalStart) > arrivalStart, 'Frozen Arrival structure changed')

  console.log('W8.1 STOCK OVERVIEW COMPLETION PASSED — exact stock truth and execution/color/size browsing remain preserved under later workspace polish')
} catch (error) {
  console.error(`W8.1 STOCK OVERVIEW COMPLETION FAILED: ${error?.message || error}`)
  process.exit(1)
}
