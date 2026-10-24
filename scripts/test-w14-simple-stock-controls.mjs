import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { selectStockOverviewModels } from '../src/features/inventory/stockOverviewSelectors.ts'

const groups = [
 { productName: 'ЭТНО КАРДИГАН', key: 'a', rows: [
   { variantId: 1, size: '52', physical: 7, reserved: 3 },
   { variantId: 2, size: '54', physical: 0, reserved: 0 },
 ] },
 { productName: 'АЙ-НӘЗІГІМ КӨЙЛЕК', key: 'b', rows: [
   { variantId: 3, size: '46', physical: 2, reserved: 3 },
 ] },
 { productName: 'АБАЙ ТАКИЯ', key: 'c', rows: [
   { variantId: 4, size: '58', physical: 0, reserved: 0 },
 ] },
]
const hasStock = row => row.physical !== 0 || row.reserved !== 0
const all = selectStockOverviewModels(groups, '', 'all', hasStock)
assert.equal(all.length, 3)
const withStock = selectStockOverviewModels(groups, '', 'withStock', hasStock)
assert.deepEqual(withStock.map(g=>g.key),['a','b'])
assert.equal(selectStockOverviewModels(groups, 'этно', 'withStock', hasStock)[0].rows.length,2,
 'Searching by model must not remove zero sizes or change model totals')
assert.equal(selectStockOverviewModels(groups, '52', 'all', hasStock).length,0,
 'Searching in Stock model list may NOT accidentally trim sizes')
assert.equal(selectStockOverviewModels(groups, 'такия', 'withStock', hasStock).length,0,
 'The stock-only model list hides zero-without-reserve models')
assert.equal(selectStockOverviewModels(groups, 'такия', 'all', hasStock).length,1)
assert.equal(selectStockOverviewModels(groups,'АЙ-нәзігім','withStock',hasStock)[0].rows[0].reserved,3,
 'Fully or over-reserved SKU stays visible in stock list')
assert.deepEqual(groups[0].rows.map(r=>r.variantId),[1,2], 'No input mutation')
assert.equal(all[0].allRows,groups[0].rows,'Model cards must retain all size rows')
const total = groups.flatMap(group=>group.rows).reduce((n,row)=>n+row.physical,0)
assert.equal(total,9)
assert.equal(groups.flatMap(group=>group.rows).reduce((n,row)=>n+row.reserved,0),6)
assert.equal(total-6,3)

const section=readFileSync('src/features/sections/InventorySection.tsx','utf8')
const view=readFileSync('src/features/inventory/views/renderInventoryOverviewPanel.tsx','utf8')
const css=readFileSync('src/styles/w14-simple-stock-controls.css','utf8')
assert.match(section,/inventoryStocktakeAllGroups \|\| \[\]/)
assert.match(section,/const \[simpleStockSearch, setSimpleStockSearch\] = useState\(''\)/)
assert.match(section,/selectStockOverviewModels\(/)
assert.match(section,/setSimpleStockAvailabilityFilter\] = useState<\x27all\x27 \| \x27withStock\x27>/)
assert.match(section,/const simpleStockStats = useMemo\(\(\) => \{[\s\S]*?inventoryStocktakeAllGroups \|\| \[\]/)
assert.doesNotMatch(view,/inventory-calm-filters|inventory-stock-flat-table/)
assert.doesNotMatch(view,/value=\{inventoryQuery\}/)
assert.match(view,/placeholder="Найти модель…"/)
assert.match(view,/ensureSimpleStockCatalog\(\); setSimpleStockAvailabilityFilter\('all'\)/)
assert.match(view,/simpleStockSearch/)
assert.match(view,/stock-v14-heading/)
assert.match(view,/stock-v14-master-controls/)
assert.match(view,/<StockBrowseDetail/)
assert.match(section,/loadInventoryData\(source, true, '', false\)/,
  'Source switching must refresh its own snapshot')
assert.match(section,/simpleStockSourceRefresh\.status === 'ready'/,
  'Stale remote data must not be shown as fresh')
assert.doesNotMatch(view,/saveInventoryMovement\(/)
assert.match(css,/stock-v14-master-controls/)
assert.match(css,/@media\(max-width:740px\)/)
console.log('W14 STOCK CONTROLS PASSED: model search, all sizes, totals unfiltered, reserved shortages, separate source refresh, read-only UI')
