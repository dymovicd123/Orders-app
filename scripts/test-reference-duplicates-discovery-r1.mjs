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
assert.match(movement, /InventoryUnifiedQuantityWorkspace/,
  'The active operation screen must use the unified writeoff form')
assert.match(unified, /\['writeoff','Списание','Вычесть из остатка'\]/,
  'Writeoff is an explicitly selected inventory mode')
assert.match(unified, /setStage\('review'\)/,
  'Writeoff still requires an explicit review step')
assert.match(unified, /onClick=\{\(\)=>void p.onSave\(\)\}/,
  'Confirm in the review stage must submit through the inventory writer')
assert.match(unified, /mode !== 'arrival' && mode !== 'transfer' && !reason.trim\(\)/,
  'Writeoff cannot be reviewed without a reason')
console.log('DUPLICATE DISCOVERY / WRITEOFF ENTRY PASSED — visible all-role entry, admin guard, unified two-stage writeoff')
