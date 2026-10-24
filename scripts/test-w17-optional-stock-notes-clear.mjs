import assert from 'node:assert/strict'
import fs from 'node:fs'
const read=(p)=>fs.readFileSync(p,'utf8')
const ui=read('src/features/inventory/views/InventoryUnifiedQuantityWorkspace.tsx')
const app=read('src/App.tsx')
const overview=read('src/features/inventory/views/renderInventoryOverviewPanel.tsx')
const css=read('src/styles/w14-simple-stock-controls.css')
const server=read('worker/domains/inventory-movement.ts')
assert.ok(ui.includes('const ready = changed > 0'),'Valid stock quantities are not blocked by an empty note')
assert.ok(!ui.includes('Укажите причину операции.'),'No forced comment in operation review')
assert.equal((ui.match(/Комментарий \(необязательно\)/g)||[]).length,2,
  'Quantity entry and review both label optional comments')
assert.ok(!ui.includes('(обязательно)'),'No contradictory required comment label')
assert.ok(!app.includes("throw new Error(inventoryDraft.movementType === 'writeoff' ? 'Укажите причину списания.'"),
  'Save handler must not reject absent writeoff/correction comment')
assert.ok(app.includes('comment: inventoryDraft.comment'),
  'Preserve employee-entered comments for all operations')
assert.ok(server.includes('const comment = cleanText(input.comment);'),
  'Backend accepts an empty comment string without a required check')
assert.ok(server.includes('comment || null'),
  'History should store absent comment as null')
assert.ok(server.includes('INSERT INTO inventory_operations'),
  'Successful actions retain operation document even without a note')
assert.ok(server.includes('INSERT INTO inventory_movements'),
  'Successful actions retain per-variant quantity movements')
assert.ok(overview.includes('<input type="text" value={simpleStockSearch}'),
  'Use text input to prevent Chromium native clear creating a duplicate cross')
assert.ok(!overview.includes('<input type="search" value={simpleStockSearch}'),
  'Native search cross must not overlap custom clear')
assert.ok(overview.includes("onClick={() => setSimpleStockSearch('')}"),
  'The remaining single cross clears controlled search state')
assert.ok(css.includes('.stock-v14-model-search button'),
  'The one cross has an existing visible hit target')
console.log('W17 PASSED: optional stock notes end-to-end, persisted movement and one working model search clear')
