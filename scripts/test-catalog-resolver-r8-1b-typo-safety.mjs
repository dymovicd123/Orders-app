import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const flowSource = fs.readFileSync('src/features/orders/catalogResolutionFlow.ts', 'utf8')
const module = { exports: {} }
vm.runInNewContext(ts.transpileModule(flowSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports: module.exports, module })
const { rankedProducts, rankedReferenceValues } = module.exports
const modal = fs.readFileSync('src/features/orders/OrderCatalogResolutionModal.tsx', 'utf8')

const typo = rankedProducts([{ id: 1, name: 'ШАПАН' }, { id: 2, name: 'ЮБКА' }], 'ШОПАН')
assert.equal(typo[0].product.id, 1, 'One-character typo should surface the existing product first')
assert.ok(typo[0].score > 0, 'Typo match must be visible as a suggestion')
assert.equal(rankedProducts([{ id: 1, name: 'ШАПАН' }], 'ЮБКА')[0].score, 0, 'Unrelated names must not become fuzzy suggestions')

const prefix = rankedProducts([{ id: 3, name: 'ДАРА ШАПАН' }, { id: 4, name: 'ЮБКА' }], 'Д')
assert.equal(prefix[0].product.id, 3, 'Short prefix search should surface a matching product immediately')
assert.ok(prefix[0].score > 0, 'Short prefix match must remain visible')
const tokenMatches = rankedProducts([{ id: 5, name: 'ДАРА ШАПАН' }, { id: 6, name: 'АБАЙ ШАПАН' }, { id: 7, name: 'ЮБКА' }], 'ШАПАН')
assert.ok(tokenMatches[0].score > 0 && tokenMatches[1].score > 0, 'Token search should keep multiple matching products visible')

assert.ok(modal.includes("const searchRanked = rankedProducts(choices, search || item.productName)"), 'Typed product search is not using the same safe ranking')
const materialTypo = rankedReferenceValues(['ЗАМША ВЕЛЮР', 'АТЛАС'], 'ЗАМША ВЕЛЮРР', 'material')
assert.equal(materialTypo[0].value, 'ЗАМША ВЕЛЮР', 'Reference typo should surface the canonical material first')
assert.ok(materialTypo[0].score >= 5000, 'Reference typo must be promoted as a visible suggestion')
assert.ok(modal.includes('В заказе указано <strong>«{draft[field]}»</strong>'), 'Unknown reference value no longer explains the raw value in user language')
assert.ok(modal.includes('Похоже, имелось в виду'), 'Reference typo flow no longer explains its recommendation')
assert.ok(modal.includes('Выбрать из справочника'), 'Existing reference picker is no longer offered')
assert.ok(modal.includes('setCreatingReference(field)'), 'Creating a reference value is no longer an explicit action')
assert.ok(modal.includes('Название нового значения'), 'New reference value can no longer be edited before creation')

console.log('CATALOG RESOLVER R8.1B TYPO SAFETY TESTS PASSED — product/reference typos are suggestions only, and new reference values stay explicit and editable.')
