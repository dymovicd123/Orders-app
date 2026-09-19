import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const flowSource = fs.readFileSync('src/features/orders/catalogResolutionFlow.ts', 'utf8')
const module = { exports: {} }
vm.runInNewContext(ts.transpileModule(flowSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports: module.exports, module })
const { rankedProducts } = module.exports
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
assert.ok(modal.includes('В заказе указано <strong>«{draft[question.field]}»</strong>'), 'Unknown reference value no longer explains the raw value in user language')
assert.ok(modal.includes('className="primary-button" onClick={() => { setEditing(question.field); setAnswer(draft[question.field]) }}>Выбрать из справочника</button>'), 'Choosing an existing reference is not the primary action')
assert.ok(modal.includes('className="secondary-button" onClick={() => approveReference(question.field)}>Это новое значение</button>'), 'Creating a reference value is not an explicit secondary action')

console.log('CATALOG RESOLVER R8.1B TYPO SAFETY TESTS PASSED — typo matches are suggestions only, and new reference values require an explicit secondary action.')
