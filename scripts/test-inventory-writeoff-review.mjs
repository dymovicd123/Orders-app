import assert from 'node:assert/strict'
import fs from 'node:fs'
import { summarizeWriteoff } from '../src/features/inventory/writeoffReview.ts'

const sample=[
 {variantId:1,productName:'Кардиган',detail:'Синий · 52',requested:3,physical:10,reserved:4},
 {variantId:2,productName:'Жилет',detail:'Хаки · 1 год',requested:2,physical:3,reserved:3},
 {variantId:3,productName:'Кепка',detail:'Белая',requested:5,physical:2,reserved:0},
 {variantId:4,productName:'Шапан',detail:'Чёрный',requested:1,physical:0,reserved:1},
 {variantId:5,productName:'Не выбран',detail:'',requested:0,physical:10,reserved:0},
]
const summary=summarizeWriteoff(sample)
assert.equal(summary.valid,true)
assert.equal(summary.rows.length,4,'Zero-quantity rows are not submitted')
assert.equal(summary.totalRequested,11)
assert.equal(summary.totalTracked,7)
assert.equal(summary.totalUntracked,4)
assert.equal(summary.totalNewShortage,2,'Only additional reserved-order shortage should be displayed')
assert.deepEqual(summary.rows.map(r=>[r.after,r.untracked,r.newShortage]),[
  [7,0,0],[1,0,2],[0,3,0],[0,1,0]
])
assert.equal(summarizeWriteoff([{...sample[0],requested:1.5}]).valid,false)
assert.equal(summarizeWriteoff([{...sample[0],requested:0}]).valid,false)
assert.equal(summarizeWriteoff([{...sample[0],requested:0},{...sample[1],requested:1}]).rows.length,1)

const panel=fs.readFileSync('src/features/inventory/views/renderInventoryMovementPanel.tsx','utf8')
const review=fs.readFileSync('src/features/inventory/views/WriteoffReview.tsx','utf8')
const api=fs.readFileSync('worker/domains/inventory-movement.ts','utf8')
assert.match(panel,/Списать товар/)
assert.match(panel,/selectInventoryOperationMode\('writeoff'\)/)
assert.match(panel,/WriteoffReview source=/)
assert.match(panel,/inventoryDraft.movementType!=='writeoff'/,
  'Writeoff must not use the old immediate-submit button')
assert.match(review,/reviewedSignature === signature/,
  'Any change to selected items, quantities or reason must require reviewing again')
assert.match(review,/Проверить списание/)
assert.match(review,/Подтвердить списание/)
assert.match(review,/onClick=\{onConfirm\}/)
assert.match(api,/buildStockResolutionRequired\('writeoff'/)
assert.match(api,/inventory_operation_evidence/)
assert.match(api,/inventory_operation_request_fingerprints/)
console.log('INVENTORY WRITEOFF REVIEW PASSED — per-line physical/reserve/shortage maths, extra physical proof, reason, review reset, guarded submission')
