import assert from 'node:assert/strict'
import fs from 'node:fs'

const source=fs.readFileSync('src/features/sections/InventorySection.tsx','utf8')
const view=fs.readFileSync('src/features/inventory/views/renderInventoryOverviewPanel.tsx','utf8')
assert.match(source,/simpleStockAvailabilityFilter, setSimpleStockAvailabilityFilter.*\('all'\)/)
const start=source.indexOf('const matchingRows = allRows.filter(')
const end=source.indexOf('result.push({',start)
assert.ok(start>0&&end>start,'Expected current product-level warehouse selection')
const selection=source.slice(start,end)
assert.match(selection,/if \(!matchingRows.length\) continue/)
assert.match(selection,/simpleStockPhysical\(row\) !== 0 \|\| simpleStockReserved\(row\) !== 0/)
const body=selection.replace('if (!matchingRows.length) continue','if (!matchingRows.length) return null').replaceAll('(row: any)', '(row)')
const select=new Function('allRows','simpleStockAvailabilityFilter','hasExplicitStockSearch','simpleStockQuantity','simpleStockReserved','simpleStockPhysical',body+'return visibleRows')
const row=(size,physical,reserved)=>({size,physical,reserved})
const example=[
  row('48',3,0),row('50',2,2),row('52',2,2),row('54',2,3),row('56',2,0),row('58',0,0),
]
const physical=r=>r.physical
const reserved=r=>r.reserved
const free=r=>r.physical-r.reserved
const sizes=(mode,rs=example,search=false)=>select(rs,mode,search,free,reserved,physical)?.map(x=>x.size)||null
for(const filter of ['all','free','reserved','attention']){
  assert.deepEqual(sizes(filter),['48','50','52','54','56'],filter+': never hide reserved or deficit size inside a selected product')
}
assert.deepEqual(sizes('all',example,true),['48','50','52','54','56','58'],'Search may expose zero/zero sizes')
assert.equal(sizes('free',[row('50',2,2),row('54',2,3)]),null,'Free filter selects products, not zero-free SKUs')
assert.deepEqual(sizes('reserved',[row('50',2,2),row('54',2,3)]),['50','54'])
assert.deepEqual(sizes('attention',[row('50',2,2),row('54',2,3)]),['50','54'])
assert.equal(example.slice(0,5).reduce((s,r)=>s+r.physical,0),11)
assert.equal(example.slice(0,5).reduce((s,r)=>s+r.reserved,0),7)
assert.equal(example.slice(0,5).reduce((s,r)=>s+r.physical-r.reserved,0),4)
assert.match(view,/Фильтр выбирает товары, но внутри каждого товара видны все размеры/)
assert.match(view,/Есть нехватка по/)
assert.match(view,/Все с остатком/)
assert.match(view,/На месте \{formatMoney\(colorPhysical\)\}/)
assert.match(view,/rowReserved > 0/)
console.log('INVENTORY STOCK VISIBILITY PASSED: real Kebek 48/50/52/54/56 example, all filters, deficits and truthful aggregates')
