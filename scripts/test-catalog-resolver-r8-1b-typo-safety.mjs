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

assert.ok(modal.includes("const searchRanked = rankedProducts(choices, search || item.productName)"), 'Typed product search is not using the same safe typo suggestions')
assert.ok(modal.includes('Такого значения ещё нет среди известных') && modal.includes('выберите его'), 'Unknown reference value no longer leads with correction to an existing value')
assert.ok(modal.includes('className="primary-button" onClick={() => { setEditing(question.field); setAnswer(draft[question.field]) }}>Выбрать существующее значение</button>'), 'Correction is not the primary reference-value action')
assert.ok(modal.includes('className="secondary-button" onClick={() => approveReference(question.field)}>Это новое значение</button>'), 'Creating a reference value is not an explicit secondary action')

console.log('CATALOG RESOLVER R8.1B TYPO SAFETY TESTS PASSED — typo matches are suggestions only, and new reference values require an explicit secondary action.')
