import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {selectStockOverviewModels} from '../src/features/inventory/stockOverviewSelectors.ts'

// Verify the real product-level selector, not obsolete UI text or old filter modes.
const rows=[
 {size:'48',warehouseQuantity:3,warehouseReserved:0},
 {size:'50',warehouseQuantity:2,warehouseReserved:2},
 {size:'52',warehouseQuantity:2,warehouseReserved:2},
 {size:'54',warehouseQuantity:2,warehouseReserved:3},
 {size:'56',warehouseQuantity:2,warehouseReserved:0},
 {size:'58',warehouseQuantity:0,warehouseReserved:0},
]
const groups=[{key:'kebek',productName:'КЕБЕК',rows},{key:'empty',productName:'ДРУГОЙ',rows:rows.slice(-1)}]
const physical=x=>x.warehouseQuantity
const reserved=x=>x.warehouseReserved
const free=x=>physical(x)-reserved(x)
const realBalance=x=>physical(x)!==0||reserved(x)!==0
const present=selectStockOverviewModels(groups,'','withStock',realBalance)
assert.equal(present.length,1,'Stock list must include a model with reserved or negative-free variants')
assert.equal(present[0].productName,'КЕБЕК')
assert.deepEqual(present[0].allRows.map(x=>x.size),['48','50','52','54','56','58'],
  'Selecting a product must preserve ALL of its variant sizes and zero rows for details')
assert.deepEqual(selectStockOverviewModels(groups,'кЕб','withStock',realBalance).map(x=>x.key),['kebek'])
assert.equal(selectStockOverviewModels(groups,'','all',realBalance).length,2)
assert.equal(rows.reduce((n,x)=>n+physical(x),0),11)
assert.equal(rows.reduce((n,x)=>n+reserved(x),0),7)
assert.equal(rows.reduce((n,x)=>n+free(x),0),4)
assert.equal(free(rows[3]),-1,'Size with more reservations than physical stays visible')

const section=readFileSync('src/features/sections/InventorySection.tsx','utf8')
const view=readFileSync('src/features/inventory/views/renderInventoryOverviewPanel.tsx','utf8')
const detail=readFileSync('src/features/inventory/views/StockBrowseDetail.tsx','utf8')
assert.match(section,/selectStockOverviewModels\(/,'Use tested group selector')
assert.match(view,/На месте \{formatMoney\(physical\)\} · Резерв \{formatMoney\(reserved\)\}/,
  'Show physical and reserved totals without mixing them')
assert.match(detail,/const rows = group\.allRows \|\| group\.rows \|\| \[\]/)
assert.match(detail,/На месте<\/span>/)
assert.match(detail,/Резерв<\/span>/)
assert.match(detail,/Свободно<\/span>/)
assert.match(detail,/Нулевые варианты/,'Zero-sized variants must remain reachable')
console.log('INVENTORY_STOCK_REAL_SELECTOR_RESERVED_AND_ALL_SIZES_PASS')
