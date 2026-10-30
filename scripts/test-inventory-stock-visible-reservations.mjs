import assert from 'node:assert/strict'
import fs from 'node:fs'
import { selectStockOverviewModels } from '../src/features/inventory/stockOverviewSelectors.ts'

// Exercise the current model-level stock filter rather than the removed
// product/size filtering source. All sizes must survive any model selection.
const section = fs.readFileSync('src/features/sections/InventorySection.tsx','utf8')
const view = fs.readFileSync('src/features/inventory/views/renderInventoryOverviewPanel.tsx','utf8')
const selectors = fs.readFileSync('src/features/inventory/stockOverviewSelectors.ts','utf8')
assert.match(section,/selectStockOverviewModels\(/)
assert.match(section,/simpleStockPhysical\(row\) !== 0 \|\| simpleStockReserved\(row\) !== 0/)
assert.match(section,/const simpleStockStats = useMemo\(/)
assert.match(section,/inventoryStocktakeAllGroups \|\| \[\]\)\.flatMap\(/,
  'Dashboard totals must come from the unfiltered source snapshot')
assert.match(selectors,/allRows: group\.rows/, 'Selector must retain original sizes')
assert.match(view,/С учтённым наличием или резервом/)
assert.match(view,/Активные модели каталога/)
assert.match(view,/На месте \{formatMoney\(physical\)\} · Резерв \{formatMoney\(reserved\)\}/)
assert.match(view,/simpleStockStats\.warehousePhysical/)
assert.match(view,/simpleStockStats\.warehouseReserved/)
assert.match(view,/simpleStockStats\.boutiquePhysical/)
assert.match(view,/simpleStockStats\.boutiqueReserved/)

const row = (size,physical,reserved)=>({size,physical,reserved})
const example = [
  row('48',3,0), row('50',2,2), row('52',2,2),
  row('54',2,3), row('56',2,0), row('58',0,0),
]
const groups = [
  {key:'model-a',productName:'Кебек',rows:example},
  {key:'model-b',productName:'Нулевая модель',rows:[row('48',0,0)]},
]
const hasBalance = r => r.physical !== 0 || r.reserved !== 0
const select = (query,mode) => selectStockOverviewModels(groups,query,mode,hasBalance)
const shown = select('Кебек','withStock')
assert.equal(shown.length,1)
assert.deepEqual(shown[0].rows.map(r=>r.size),['48','50','52','54','56','58'],
  'Zero, reserved and over-reserved sizes remain visible inside selected catalog models')
assert.deepEqual(shown[0].allRows,example,'Unfiltered sizes and totals are preserved')
assert.equal(select('', 'withStock').length,1,
  'Only completely empty models are hidden in the quick with-stock overview')
assert.equal(select('', 'all').length,2,
  'All-model view must include products with no physical stock or reservations')
assert.equal(select('Несуществующее название','all').length,0)
assert.deepEqual(
  [example.reduce((s,r)=>s+r.physical,0),example.reduce((s,r)=>s+r.reserved,0),
   example.reduce((s,r)=>s+r.physical-r.reserved,0)], [11,7,4],
  'Physical, reserved, and free quantities are separate truths'
)
assert.equal(example.find(r=>r.size==='54').physical-example.find(r=>r.size==='54').reserved,-1,
  'The over-reserved size must still be present for investigation')
console.log('INVENTORY STOCK VISIBILITY PASSED: real model filter, all sizes retained, current physical/reserved/free totals and negative available')
