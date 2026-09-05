import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }
const between = (source, startMarker, endMarker) => {
  const start = source.indexOf(startMarker)
  check(start >= 0, `Marker missing: ${startMarker}`)
  const end = source.indexOf(endMarker, start + startMarker.length)
  check(end > start, `End marker missing after: ${startMarker}`)
  return source.slice(start, end)
}

try {
  const pkg = JSON.parse(read('package.json'))
  const app = read('src/App.tsx')
  const inventory = read('src/features/sections/InventorySection.tsx')
  const overview = read('src/features/inventory/views/renderInventoryOverviewPanel.tsx')
  const attention = read('src/features/inventory/views/renderInventoryAttentionPanel.tsx')
  const movement = read('src/features/inventory/views/renderInventoryMovementPanel.tsx')
  const stocktake = read('src/features/inventory/views/renderInventoryStocktakePanel.tsx')
  const css = read('src/styles/188b-human-inventory-ui.css')
  const manifest = JSON.parse(read('scripts/w2-human-warehouse-frontend-manifest.json'))

  check(manifest.version === 1 && manifest.revision === 'w2-human-warehouse', 'W2 preservation manifest missing or invalid')
  check(String(pkg.scripts?.['release:check'] || '').includes('node scripts/test-w2-human-warehouse.mjs'), 'W2 regression is not chained into release:check')

  const nav = between(inventory, '<div className="warehouse-w2-navigation"', '{renderInventoryAttentionPanel({')
  for (const label of ["label: 'Остатки'", "label: 'Операции'", "label: 'Проверка'", "label: 'История'"]) {
    check(nav.includes(label), `W2 primary Warehouse action missing: ${label}`)
  }
  check(nav.includes('warehouse-w2-primary'), 'W2 primary task navigation missing')
  check(nav.includes('warehouse-w2-secondary'), 'W2 secondary navigation missing')
  check(nav.includes('warehouse-w2-recovery') && nav.includes('Нужно уточнить'), 'Recovery inbox is not a clear secondary action')
  check(nav.includes("inventoryPanel === 'catalog'") && nav.includes('isAdmin ? <button'), 'Catalog is not an explicit admin-only secondary action')
  check(!nav.includes("label: `Внимание"), 'Legacy Attention main tab returned')
  check(!nav.includes("label: 'Движение товара'"), 'Legacy technical movement label returned')
  check(!nav.includes("label: 'Ревизия'"), 'Legacy technical stocktake label returned')

  check(app.includes("if (activeSector === 'inventory') {"), 'Warehouse Attention must load only when Warehouse is open')
  check(!app.includes("activeSector === 'inventory' || warehouseAttention === null"), 'Warehouse Attention still spends a D1 read outside Warehouse')
  check(!app.includes('warehouse-attention-nav-badge'), 'Recovery count leaked back into the global sidebar')

  const overviewOpenEffect = between(inventory, "  useEffect(() => {\n    if (inventoryPanel === 'overview' && cycleCountData", "  useEffect(() => {\n    if (!stocktakeSession || !currentStocktakeGroup")
  check(!overviewOpenEffect.includes('refreshCycleCountSuggestions(simpleStockSource, false, 5)'), 'Opening Остатки still spends the quick-check read automatically')
  check(overview.includes('refreshCycleCountSuggestions(simpleStockSource, false, 5)'), 'Quick-check has no explicit user-triggered load')
  for (const marker of ['Короткая проверка', 'Проверьте несколько вещей', 'его можно закончить за пару минут']) {
    check(overview.includes(marker), `Human quick-check copy missing: ${marker}`)
  }
  check(overview.includes('needsIndependentCount'), 'Risky quick-check rows no longer force an independent count')
  check(overview.includes('Сначала посчитайте физически'), 'Blind-first instruction missing for risky quick-check rows')
  check(overview.includes('inventory-cycle-count-system is-blind'), 'Risky quick-check rows expose the system count before physical count')
  check(overview.includes('Да, на месте {row.physical}') && overview.includes('Нет, другое количество'), 'Safe one-click count path changed unexpectedly')

  check(attention.includes('<h3>Нужно уточнить</h3>'), 'Recovery inbox heading is not human-readable')
  check(attention.includes("{ value: 'revision', label: 'Проверка' }"), 'Recovery stocktake category still uses technical wording')
  check(attention.includes('Требуется администратор'), 'Manager recovery rows do not explain admin-only cases')
  check(attention.includes('Продолжить проверку'), 'Unfinished physical check has no clear continuation action')
  check(attention.includes('Уточнять ничего не нужно'), 'Recovery empty state is unclear')
  check(movement.includes('<h3>Операции</h3>'), 'Movement workspace still presents itself as a technical subsystem')
  check(stocktake.includes('<h3>Проверка</h3>') && stocktake.includes('Продолжить проверку'), 'Stocktake workspace does not use the W2 human task language')

  const arrivalStart = inventory.indexOf('<div className="inventory-arrival-legacy-workspace">')
  const arrivalButton = '<button className="inventory-arrival-add-position" type="button" onClick={addInventoryArrivalPosition}>+ Добавить позицию</button>'
  check(arrivalStart >= 0 && inventory.indexOf(arrivalButton, arrivalStart) > arrivalStart, 'Frozen Arrival workspace changed or disappeared')

  for (const marker of ['.warehouse-w2-navigation', '.warehouse-w2-primary', '.warehouse-w2-secondary', '.warehouse-w2-recovery']) {
    check(css.includes(marker), `W2 navigation style missing: ${marker}`)
  }
  check(css.includes('@media(max-width:600px)') && css.includes('grid-template-columns:repeat(2,minmax(0,1fr))'), 'W2 mobile navigation does not collapse to a usable 2-column layout')
  check(css.includes('.inventory-cycle-count-system.is-blind'), 'W2 blind-count visual state missing')

  const visibleW2 = `${nav}\n${overview}\n${attention}\n${movement}\n${stocktake}`
  for (const forbidden of ['Step W2', 'W2 human', 'D1 query', 'frontend preservation', 'hash baseline']) {
    check(!visibleW2.includes(forbidden), `Developer-only W2 terminology leaked into user UI: ${forbidden}`)
  }

  console.log('W2 HUMAN WAREHOUSE TESTS PASSED — four task-first Warehouse actions, secondary recovery inbox/admin catalog, lazy quick-check reads, blind-first risky counts, responsive navigation, frozen Arrival')
} catch (error) {
  console.error(`W2 HUMAN WAREHOUSE TESTS FAILED: ${error?.message || error}`)
  process.exit(1)
}
