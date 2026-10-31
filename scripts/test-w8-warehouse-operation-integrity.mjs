import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { warehouseOperationFeedback } from '../worker/domains/warehouse-operation-feedback.ts'

const read=file=>readFileSync(new URL(file,import.meta.url),'utf8')
const worker=read('../worker/index.ts')
const app=read('../src/App.tsx')
const section=read('../src/features/sections/InventorySection.tsx')
const panel=read('../src/features/inventory/views/renderInventoryMovementPanel.tsx')
const view=read('../src/features/inventory/views/InventoryUnifiedQuantityWorkspace.tsx')
const stylesheet=read('../src/styles/193-unified-inventory-operations.css')

const stale=warehouseOperationFeedback(
 new Error('Остатки изменились после открытия таблицы: АБАЙ ШАПАН 42. Было 60, сейчас 55. Обновите данные и повторите установку.'),
 'manual_set','manual-test-1234')
assert.equal(stale.status,409)
assert.equal(stale.code,'warehouse_stock_stale')
for(const [suffix,details] of [
 ['product','выбранный размер относится к другому товару'],
 ['gender','пол, цвет, материал, длина, размер или тип не совпадают с выбранным вариантом'],
 ['color','пол, цвет, материал, длина, размер или тип не совпадают с выбранным вариантом'],
 ['size','выбранный размер относится к другой комбинации'],
]){
 const issue=warehouseOperationFeedback(new Error('Приход «АБАЙКА»: '+details+'. Склад не изменён.'),'arrival','synthetic-'+suffix)
 assert.equal(issue.status,409,'Known invalid arrival SKU must return actionable conflict')
 assert.equal(issue.code,'warehouse_sku_mismatch')
 assert.match(issue.message,/Склад не изменён/)
}
assert.equal(warehouseOperationFeedback(new Error('D1_ERROR: SQLITE_CONSTRAINT Приход «АБАЙКА»: problem'),'arrival','x').status,500,
 'Actual persistence errors must stay server failures')

assert.match(stale.message,/60, сейчас 55/)
assert.match(stale.message,/обновите/i)

const missing=warehouseOperationFeedback(new Error('Корректировка: выбранной позиции больше нет на выбранной точке. Обновите остатки.'),'manual_set','r1')
assert.equal(missing.code,'warehouse_variant_missing')
assert.equal(missing.status,409)

const active=warehouseOperationFeedback(new Error('Сейчас в точке «Бутик» идёт ревизия. Сначала завершите её.'),'transfer','r2')
assert.equal(active.code,'warehouse_stocktake_active')
assert.equal(active.status,409)

const sql=warehouseOperationFeedback(new Error('D1_ERROR: sqlite_constraint_unique near internal_inventory table'),'transfer','transfer-abc123456')
assert.equal(sql.code,'warehouse_write_failed')
assert.equal(sql.status,500)
assert.ok(!/sqlite|internal_inventory|D1_ERROR/i.test(sql.message),'SQL schema must not leak to employee')
assert.match(sql.message,/историю движений/)
assert.match(sql.message,/abc123456/)
assert.equal(warehouseOperationFeedback(new Error('База временно занята другой операцией'),'arrival','r3').status,500)

assert.ok(worker.includes("warehouseOperationFeedback(error,'transfer',input.requestId)"),'Transfer errors use scoped safe mapping')
assert.ok(worker.includes("movementType === 'manual_set' ? 'manual_set'"),'Manual correction gets structured error')
assert.ok(worker.includes("event:'warehouse_transfer_failed'"),'Server retains diagnostic log')
assert.ok(worker.includes("event:'warehouse_movement_failed'"),'Manual operation retains diagnostic log')
assert.ok(app.includes('setInventoryMovementError(err instanceof Error ? err.message'),'Keep a local error rather than generic global toast')
assert.ok(app.includes("setInventoryMovementError('')"),'Clear error on next operation')
assert.ok(section.includes("inventoryPanel !== 'movement') return"),'Arrival also loads current inventory snapshot')
assert.ok(section.includes("inventoryPanel !== 'stocktake' && inventoryPanel !== 'movement'"),'Check active stocktakes in operation tab before transfer')
assert.ok(section.includes('stocktakeActiveSources: stocktakeActiveSessions.map'), 'Pass active stocktake locations into transfer')
assert.ok(panel.includes("blockedTransferSource={mode==='transfer'"), 'Guard transfer on source or destination active stocktake')
assert.ok(view.includes('w8-transfer-stocktake-lock'),'Transfer must explain active stocktake before submit')
assert.ok(view.includes('mode===\'transfer\'&&Boolean(blockedTransferSource)'),'Cannot submit transfer during active stocktake')
assert.ok(view.includes('Открыть проверку'),'Prompt directly opens stocktake, not another random menu')
assert.ok(!section.includes("inventoryDraft.movementType === 'arrival') return"),'Arrival can no longer skip refresh')
assert.ok(panel.includes('saveError={ctx.inventoryMovementError ||'), 'Show exact save errors within review')
assert.ok(panel.includes('ctx.clearInventoryMovementError()'),'Changing input clears old errors')
assert.ok(view.includes('w8-operation-save-error') && view.includes('Обновить актуальные остатки'),'Actionable error local to review')
assert.ok(view.includes("const limit=mode==='transfer'?60:100"),'Respect transfer-specific 60-variant server limit')
assert.ok(view.includes('if(changed>limit)'), 'Count existing and new SKU lines')
assert.ok(view.includes("(mode === 'arrival' || mode==='manual_set')"),'Correction can now add a new size using shared picker')
assert.ok(!view.includes("{mode !== 'writeoff' && mode !== 'transfer' &&"),'Dead correction + size removed')
assert.equal((view.match(/Комментарий \(необязательно\)/g)||[]).length,2,'Every operation and review accepts empty comment')
assert.ok(!view.includes('Укажите причину операции.'),'No forced stock note')
assert.ok(stylesheet.includes('w8-operation-save-error'),'Scoped error styling')
console.log('W8_WAREHOUSE_ERRORS_AND_LIMITS_PASSED')
