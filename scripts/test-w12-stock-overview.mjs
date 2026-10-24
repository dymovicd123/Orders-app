import assert from 'node:assert/strict'
import fs from 'node:fs'
const read = name => fs.readFileSync(name,'utf8')
const view=read('src/features/inventory/views/renderInventoryOverviewPanel.tsx')
const section=read('src/features/sections/InventorySection.tsx')
const css=read('src/styles/w8-1-stock-overview.css')
for(const s of ['inventory-stock-flat-workspace','inventory-stock-flat-table','inventory-stock-flat-free',
'На месте','В заказах','Свободно','simpleStockPhysical(row)','simpleStockReserved(row)','simpleStockQuantity(row)',
'openConcreteStockDetail(row','sourceLabel(simpleStockSource)'])
  assert.ok(view.includes(s), 'Missing W12 stock UI contract: '+s)
assert.ok(!view.includes('buildStockBrowseHierarchy'), 'Old 4-level hierarchy must not remain')
assert.ok(!view.includes('saveInventoryMovement('), 'Read-only overview cannot save movements')
assert.ok(!view.includes('quickInventoryStocktake('), 'Do not add a new direct write flow')
assert.ok(view.includes('Сверить количество'), 'Exact variant still offers physical check')
assert.ok(view.includes('openSimpleStockHistory(simpleStockDetail)'), 'Exact variant still opens its history')
assert.ok(view.includes('setSimpleStockSource(simpleStockSource)'), 'Explicit selected source refresh must exist')
assert.ok(section.includes("loadInventoryData(source, true, '', false)"), 'Source switch must reload remote stock')
assert.ok(section.includes("simpleStockSourceRefresh.status === 'ready'"), 'Stale source must be hidden during refresh')
assert.ok(css.includes('.inventory-stock-flat-table'), 'New table styles must be present')
console.log('W12.2 STOCK OVERVIEW PASSED — single-source exact SKU table, safe detail, existing refresh and no direct writes')
