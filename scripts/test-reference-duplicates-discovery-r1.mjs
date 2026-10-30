import assert from 'node:assert/strict'
import fs from 'node:fs'
const refs=fs.readFileSync('src/features/sections/ReferencesSection.tsx','utf8')
const panel=fs.readFileSync('src/features/sections/ReferenceIntegrityPanel.tsx','utf8')
const movement=fs.readFileSync('src/features/inventory/views/renderInventoryMovementPanel.tsx','utf8')
const unified=fs.readFileSync('src/features/inventory/views/InventoryUnifiedQuantityWorkspace.tsx','utf8')
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
// This catalog visibility regression must follow the currently mounted unified
// operations UI rather than the retired separate two-page WriteoffReview.
assert.match(movement,/InventoryUnifiedQuantityWorkspace/)
assert.match(movement,/onSave={\(\)=>ctx\.saveInventoryMovement\(\)}/)
assert.match(unified,/writeoff:\s*\{ title: 'Списание', action: 'Подтвердить списание'/)
assert.match(unified,/Комментарий \(необязательно\)/)
assert.match(unified,/Нужно подтвердить фактическую выдачу/)
console.log('DUPLICATE DISCOVERY / WRITEOFF ENTRY PASSED — visible all-role catalog entry, admin guard, current guarded unified writeoff')
