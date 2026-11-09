import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { findUniqueExactKpiProduct, normalizeKpiProductName } from '../src/features/sections/productKpiProductMatch.ts'

const products = [
  { id: 1, name: 'ШАРФ' },
  { id: 2, name: 'ШАРФ ШЕЛКОВЫЙ' },
  { id: 3, name: 'ШАРФ ЗИМНИЙ' },
]
assert.equal(normalizeKpiProductName('  ШаРф  '), 'ШАРФ')
assert.equal(findUniqueExactKpiProduct(products, 'шарф')?.id, 1)
assert.equal(findUniqueExactKpiProduct(products, '  шАрФ  ')?.id, 1)
assert.equal(findUniqueExactKpiProduct(products, 'ШАРФ')?.id, 1)
assert.equal(findUniqueExactKpiProduct([{id: 5,name:'ШАРФ  ШЕЛКОВЫЙ'}], ' шарф шелковый ')?.id,5)
assert.equal(findUniqueExactKpiProduct(products, 'шар'), undefined)
assert.equal(findUniqueExactKpiProduct(products, 'шарф ш'), undefined)
assert.equal(findUniqueExactKpiProduct(products, ''), undefined)
assert.equal(findUniqueExactKpiProduct([{id:1,name:'ШАРФ'},{id:4,name:'шарф'}], 'шарф'),undefined)
assert.equal(findUniqueExactKpiProduct([{id:1,name:'ПЛАТОК'},{id:2,name:'ШАРФ'}], 'шарф')?.id,2)

const ui = readFileSync(new URL('../src/features/sections/ProductKpiSection.tsx',import.meta.url),'utf8')
assert.match(ui,/findUniqueExactKpiProduct\(activeProducts,productQuery\)/)
assert.match(ui,/if\(exactProduct\)selectProduct\(exactProduct\.id\)/)
assert.match(ui,/const resolvedProductId=draft\.productId\|\|exactProduct\?\.id\|\|0/)
assert.match(ui,/JSON\.stringify\(\{\.\.\.draft,productId:resolvedProductId\}\)/)
assert.match(ui,/Boolean\(draft\.productId\|\|exactProduct\?\.id\)/)
console.log('MAIN_KPI_EXACT_PRODUCT_MATCH_PASS')
