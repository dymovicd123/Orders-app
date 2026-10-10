// Regression for the four read-only visual QA findings in References.
// The missing-record check exercises the real domain error and API sanitization.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { previewCatalogConsolidationUndo } from '../worker/domains/catalog-consolidation-undo-preview.ts'
import { publicApiError } from '../worker/core/http.ts'

const read = path => fs.readFileSync(path, 'utf8')
const references = read('src/features/sections/ReferencesSection.tsx')
const duplicates = read('src/features/sections/ReferenceIntegrityPanel.tsx')
const undo = read('src/features/sections/CatalogUndoCases.tsx')

assert.match(references, /Всего в выбранном списке: \{referenceStats\.total\}/)
assert.match(references, /Списков всего: \{referenceStats\.kinds\}/)
assert.match(references, /setNavigationRequest\(previous =>/)
assert.match(references, /sequence: \(previous\?\.sequence \?\? 0\) \+ 1/)
assert.match(references, /useEffect\(\(\) => \{/)
assert.match(references, /summary\.scrollIntoView\(/)
assert.match(references, /summary\.focus\(\{ preventScroll: true \}\)/)

assert.match(duplicates, /\{skuGroups\.length > 0 \? <p className="mini-panel-note">Сначала выберите основной вариант\./)
assert.match(undo, /Объединение с таким номером не найдено\. Проверьте номер в истории объединений\./)

const fakeDb = {
  prepare(sql) {
    assert.match(sql, /FROM catalog_variant_consolidations WHERE id=\?/)
    return {
      bind(id) {
        assert.equal(id, 999999)
        return { first: async () => null }
      }
    }
  }
}
await assert.rejects(
  previewCatalogConsolidationUndo(fakeDb, 999999),
  error => {
    const publicError = publicApiError(error)
    assert.equal(publicError.status, 404)
    assert.equal(publicError.code, 'catalog_merge_not_found')
    assert.equal(publicError.message, 'Объединение с таким номером не найдено.')
    return true
  }
)
assert.equal(publicApiError(new Error('no such table')).status, 500)
console.log('References visual QA regressions passed (4 issues, read-only)')
