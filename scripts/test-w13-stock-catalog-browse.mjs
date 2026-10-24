import assert from 'node:assert/strict'
import fs from 'node:fs'
import { buildStockBrowseLayout, stockRowHasBalance } from '../src/features/inventory/stockBrowseLayout.ts'
const r=(id, material, color, size, gender='МУЖ', category='adult', length='СТАНДАРТ')=>
  ({variantId:id, material, color, size, gender, category, length})
const rows=[
  r(101,'ДРАП КАШЕМИР','СВЕТЛО-БЕЖЕВЫЙ','60'),
  r(102,'ДРАП КАШЕМИР','СВЕТЛО-БЕЖЕВЫЙ','58'),
  r(103,'ДРАП КАШЕМИР','ТЁМНО-СИНИЙ','54'),
  r(104,'ЗАМША ВЕЛЮР','БЕЛЫЙ','55'),
  r(105,'ДРАП КАШЕМИР','СВЕТЛО-БЕЖЕВЫЙ','58','ЖЕН'),
  r(106,'ДРАП КАШЕМИР','СВЕТЛО-БЕЖЕВЫЙ','58','МУЖ','child'),
]
const groups=buildStockBrowseLayout(rows)
assert.equal(groups.length,4,'Different material/gender/category never share an execution')
const male=groups.find(g=>g.title.includes('ДРАП КАШЕМИР') && g.title.includes('МУЖ') && !g.title.includes('Детский'))
assert.ok(male)
assert.equal(male.colors.length,2)
assert.deepEqual(male.colors.find(c=>c.color==='СВЕТЛО-БЕЖЕВЫЙ').rows.map(r=>r.size),['58','60'])
assert.ok(groups.some(g=>g.title.includes('ЗАМША ВЕЛЮР')))
assert.equal(stockRowHasBalance(0,0,0),false,'Zero-only rows are hidden by default')
assert.equal(stockRowHasBalance(0,2,-2),true,'Reserved shortage must not disappear')
assert.equal(stockRowHasBalance(-1,0,-1),true,'Negative physical stock must be visible')
assert.equal(stockRowHasBalance(2,2,0),true,'Fully reserved size must remain visible')
assert.equal(rows.length,6,'Filtering may not mutate source SKU objects')
const read=x=>fs.readFileSync(x,'utf8')
const overview=read('src/features/inventory/views/renderInventoryOverviewPanel.tsx')
const detail=read('src/features/inventory/views/StockBrowseDetail.tsx')
const css=read('src/styles/w13-stock-catalog-browse.css')
const section=read('src/features/sections/InventorySection.tsx')
assert.match(overview,/data-stock-browser="catalog-master-detail"/)
assert.match(overview,/stock-v13-master-list/)
assert.match(overview,/<StockBrowseDetail/)
assert.match(overview,/setSimpleStockOpenProductKey\(group.key\)/)
assert.doesNotMatch(overview,/<table|inventory-stock-flat-table/)
assert.match(detail,/stock-v13-size-grid/)
for (const label of ['На месте','Резерв','Свободно','Нулевые варианты','История'])
  assert.ok(detail.includes(label), 'Required on exact SKU card: '+label)
assert.match(detail,/rows\.filter\(nonEmpty\)/, 'Zero variants must not flood default viewport')
assert.match(detail,/stock-v13-zero-disclosure/)
assert.match(overview,/simpleStockPhysical/)
assert.match(overview,/simpleStockReserved/)
assert.match(overview,/simpleStockQuantity/)
assert.match(overview,/onOpenHistory/)
assert.match(section,/loadInventoryData\(source, true, '', false\)/, 'Source switch still reloads server stock')
assert.match(section,/simpleStockSourceRefresh\.status === 'ready'/, 'Source-specific freshness gate retained')
assert.doesNotMatch(overview,/saveInventoryMovement\(/, 'Overview must not introduce a stock write')
assert.match(css,/@media\(max-width:690px\)/)
console.log('W13 STOCK CATALOG BROWSE PASSED: master-detail, grouped variants, exact balances, zero-hidden by default, reserve/shortage visible, source refresh retained')
