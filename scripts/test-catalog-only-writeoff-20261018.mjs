import assert from 'node:assert/strict'
import fs from 'node:fs'
import { summarizeWriteoff } from '../src/features/inventory/writeoffReview.ts'

const read = file => fs.readFileSync(file, 'utf8')
const view = read('src/app/controllers/useOperationalViewModel.ts')
const panel = read('src/features/inventory/views/renderInventoryMovementPanel.tsx')
const unified = read('src/features/inventory/views/InventoryUnifiedQuantityWorkspace.tsx')
const write = read('worker/domains/inventory-movement.ts')
const app = read('src/App.tsx')
const workshop = read('src/features/sections/WorkshopSection.tsx')

for (const text of [
  "inventoryDraft.movementType === 'writeoff'",
  "activeProductIds.has(Number(variant.productId))",
  "!sourceIds.has(Number(variant.id))",
  "quantity: 0",
  "reservedQuantity: 0",
  ": [...sourceRows, ...untracked]",
  "sourceRows.filter(row => activeProductIds.has(Number(row.productId))",
  "[inventoryData, catalogData, inventoryDraft.source",
])
  assert(view.includes(text), 'Catalog-only SKU missing in writeoff picker: '+text)
// The dedicated WriteoffReview/labels are retired. The real operation goes through
// the unified workspace and requires an explicit API confirmation for untracked stock.
assert.match(panel, /InventoryUnifiedQuantityWorkspace/, 'Unified operation view must be mounted')
assert.match(panel, /mode={mode}/, 'Selected writeoff mode must reach the operation form')
assert.match(panel, /groups={ctx\.inventoryOperationAllProductGroups}/, 'Catalog-only variants must reach the form')
assert.match(panel, /onSave={\(\)=>ctx\.saveInventoryMovement\(\)}/, 'Unified operation must save through the guarded API')
assert.match(unified, /writeoff:\s*\{ title: 'Списание', action: 'Подтвердить списание'/)
assert.match(unified, /Комментарий \(необязательно\)/)
assert.match(unified, /Нужно подтвердить фактическую выдачу/, 'Physical exception must be explained to staff')
assert(app.includes("result.code === 'stock_resolution_required'"))
assert(app.includes("stockConfirmations"))
assert(workshop.includes("workshopChannel === 'kaspi'"), 'Keep urgent Kaspi workshop channel')

assert(write.includes("movementType === 'manual_set' || movementType === 'delete'"),
  'Only stocktake/delete require preexisting stock')
assert(!write.includes("movementType === 'manual_set' || movementType === 'writeoff' || movementType === 'delete') && !existingStock?.id"),
  'Writeoff must not reject valid catalog-only SKU')
assert(write.includes("expectedQuantity !== null && currentQuantity !== expectedQuantity"),
  'Stale stock guard missing')
assert(write.includes("buildStockResolutionRequired('writeoff', stockResolutionItems)"),
  'Untracked writeoff must require explicit confirmation')
assert(write.includes("AND ? <> 'writeoff'"),
  'Untracked writeoff must not materialize a fake inventory_stock row')
assert(write.includes('inventory_operation_evidence'), 'Evidence journal missing')
assert(write.includes("MIN(x.current_quantity, x.operation_quantity), MAX(0, x.operation_quantity - x.current_quantity)"))
assert(write.includes("quantity_delta, quantity_after, reference_type, reference_id"),
  'Manual movement audit missing')
assert(write.includes("requestFingerprint"), 'Idempotency fingerprint missing')
assert(write.includes("WHERE (x.stock_existed = 1 AND (s.id IS NULL"), 'Concurrent stock safeguards missing')

const preview = summarizeWriteoff([
  { variantId: 333, productName: 'Тестовый шапан', detail: 'Айвори · 50', requested: 1, physical: 0, reserved: 0 },
  { variantId: 334, productName: 'Тестовый жилет', detail: 'Хаки · 52', requested: 2, physical: 5, reserved: 1 },
])
assert.equal(preview.totalRequested, 3)
assert.equal(preview.totalUntracked, 1)
assert.equal(preview.rows[0].after, 0)
assert.equal(preview.rows[0].untracked, 1)
assert.equal(preview.rows[1].after, 3)
console.log('CATALOG_ONLY_ZERO_STOCK_WRITEOFF_CONFIRMATION_NO_FAKE_STOCK_EVIDENCE_PASSED')
