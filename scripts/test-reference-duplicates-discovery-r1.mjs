import assert from 'node:assert/strict'
import fs from 'node:fs'
const refs=fs.readFileSync('src/features/sections/ReferencesSection.tsx','utf8')
const panel=fs.readFileSync('src/features/sections/ReferenceIntegrityPanel.tsx','utf8')
const movement=fs.readFileSync('src/features/inventory/views/renderInventoryMovementPanel.tsx','utf8')
const review=fs.readFileSync('src/features/inventory/views/WriteoffReview.tsx','utf8')
const duplicateEntry = refs.slice(refs.indexOf('id="reference-duplicates-actions"'))
assert.match(refs, /className="reference-integrity-entry"\s+id="reference-duplicates-actions"/)
assert.ok(duplicateEntry.includes('<strong>Найти похожие записи и варианты товаров</strong>'))
assert.ok(duplicateEntry.indexOf('reference-integrity-entry-summary') < duplicateEntry.indexOf('isAdmin ? ('),
  'The duplicate-check entry must stay visible to everyone, with the interactive panel restricted to admin')
assert.ok(refs.includes("showMaintenance('duplicates')"),
  'An always-visible shortcut should open the duplicate-check entry without forcing users through the full list')
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
