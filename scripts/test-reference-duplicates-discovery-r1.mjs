import assert from 'node:assert/strict'
import fs from 'node:fs'
const refs=fs.readFileSync('src/features/sections/ReferencesSection.tsx','utf8')
const panel=fs.readFileSync('src/features/sections/ReferenceIntegrityPanel.tsx','utf8')
const movement=fs.readFileSync('src/features/inventory/views/renderInventoryMovementPanel.tsx','utf8')
const review=fs.readFileSync('src/features/inventory/views/WriteoffReview.tsx','utf8')
assert.match(refs, /<details className="reference-integrity-entry"/)
assert.match(refs, /<strong>Проверка дублей<\/strong>/)
assert.ok(refs.indexOf('reference-integrity-entry-summary') < refs.indexOf('{isAdmin ?'),
  'A user of any role must see the feature entry, even when merging requires admin role')
assert.match(refs, /Проверка и объединение дублей доступны администратору/)
assert.match(panel, /<h3>Проверка дублей товаров и справочников<\/h3>/)
assert.match(panel, /api\/reference-values\/duplicates/)
assert.match(movement, /<h3>\{inventoryDraft\.movementType === 'writeoff' \? 'Списание товаров'/)
assert.match(movement, /inventory-writeoff-intro/)
assert.match(movement, /Шаг 1 из 2/)
assert.match(review, /Шаг 2 из 2 — проверка списания/)
assert.match(movement, /<WriteoffReview source=/)
assert.match(movement, /inventoryDraft\.movementType!=='writeoff'/,
  'writeoff continues through review before submit, never through the old direct-submit button')
console.log('DUPLICATE DISCOVERY / WRITEOFF ENTRY PASSED — visible all-role entry, admin guard, two-stage writeoff')
