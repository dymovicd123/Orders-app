import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { readSavedArrivalLabels } from '../worker/domains/inventory-arrival-label-reprint.ts'

const arrival = readFileSync('src/features/inventory/views/InventoryUnifiedQuantityWorkspace.tsx', 'utf8')
const panel = readFileSync('src/features/inventory/views/renderInventoryMovementPanel.tsx', 'utf8')
const section = readFileSync('src/features/sections/InventorySection.tsx', 'utf8')
const history = readFileSync('src/features/inventory/views/renderInventoryHistoryPanel.tsx', 'utf8')
const printer = readFileSync('src/features/inventory/views/BarcodePrintWorkspace.tsx', 'utf8')
const api = readFileSync('worker/index.ts', 'utf8')
const css = readFileSync('src/styles/193-unified-inventory-operations.css', 'utf8')

assert(arrival.includes("type Stage = 'select' | 'quantities' | 'review' | 'complete'") &&
  arrival.includes("setStage('complete')") &&
  arrival.includes("if (mode === 'arrival' && stage === 'complete') return") &&
  arrival.includes('Приход сохранён') && arrival.includes('Завершить без печати') &&
  arrival.includes('Распечатать этикетки'),
  'Arrival needs a dedicated visible saved-result step, not a hidden appended banner')
assert(arrival.includes('p.onFinishArrivalResult?.()') &&
  arrival.includes("setStage('select')") &&
  arrival.includes('setShowArrivalPrint(true)'),
  'Finish or print are next-step choices, not stock operations')
assert(panel.includes('arrivalPrintAvailable={Boolean(ctx.arrivalPrintReceipt?.items.length)}') &&
  panel.includes('arrivalLabelPrinter={ctx.renderArrivalLabels}'),
  'Save result step must use the verified receipt, not independently invent quantities')
assert(section.includes('renderArrivalLabels: arrivalBarcodeReceipt ? <BarcodePrintWorkspace') &&
  section.includes('embeddedAfterArrival') &&
  !section.includes('<section className="inventory-post-arrival-labels"'),
  'Label printer must display inside the result screen instead of below the save form')
assert(printer.includes('embeddedAfterArrival ?') &&
  printer.includes('receipt.items.filter(row => row.variantId === item.variantId)'),
  'Printer must use shared arrival receipt and avoid duplicate item selections')
assert(css.includes('.inventory-arrival-finished') &&
  css.includes('.inventory-arrival-result-actions') &&
  css.includes('@media(max-width:600px)'),
  'The success step requires a clear responsive visual hierarchy')
assert(history.includes("entry.row.movementType === 'arrival'") &&
  history.includes("entry.row.referenceType === 'manual'") &&
  history.includes('Распечатать этикетки прихода') &&
  history.includes('historyArrivalPrint?.rowId === entry.row.id'),
  'Warehouse history should expose specific read-only arrival reprint for the selected receipt')
assert(api.includes("savedArrivalLabelsMatch && request.method === 'GET'") &&
  api.includes('readSavedArrivalLabels(env.DB, operationId)'),
  'History reprint must only be a GET route with no D1 mutations')
assert(section.includes("method: 'GET', credentials: 'same-origin', cache: 'no-store'") &&
  section.includes('receipt.operationId !== row.referenceId'),
  'Client should verify returned receipt identity against selected historical operation')

const header = { operation_id: 'arr-17', operation_type: 'arrival', source_type: 'warehouse',
  status: 'completed', item_count: 3 }
const rows = [
  { variant_id: 12, product_name_snapshot: 'Абай', color_snapshot: 'Белый',
    size_snapshot: '48', quantity_delta: 2, inventory_source: 'warehouse', reversed_at: null },
  { variant_id: 21, product_name_snapshot: 'Баян', color_snapshot: 'Хаки',
    size_snapshot: '50', quantity_delta: 3, inventory_source: 'warehouse', reversed_at: null },
  { variant_id: 12, product_name_snapshot: 'Абай', color_snapshot: 'Белый',
    size_snapshot: '48', quantity_delta: 1, inventory_source: 'warehouse', reversed_at: null },
]
function fakeDb(operation, movements) {
  let calls = 0
  return {
    prepare(sql) {
      assert(sql.startsWith('SELECT') || sql.trimStart().startsWith('SELECT'), 'reprint must never write to D1')
      return { bind(...values) {
        assert.deepEqual(values, ['arr-17'])
        calls += 1
        return calls === 1
          ? { first: async () => operation }
          : { all: async () => ({ results: movements }) }
      } }
    },
  }
}
const ok = await readSavedArrivalLabels(fakeDb(header, rows), 'arr-17')
assert.equal(ok.ok, true)
assert.equal(ok.receipt?.source, 'warehouse')
assert.equal(ok.receipt?.items.length, 3)
assert.deepEqual(ok.receipt?.items.map(row=>row.quantity), [2,3,1])
assert.equal(ok.receipt?.items[0].variantId,12)

const cancelRows = rows.map((row,i)=>i===1?{...row,reversed_at:'2026-11-17T15:00:00'}:row)
assert.equal((await readSavedArrivalLabels(fakeDb(header,cancelRows),'arr-17')).ok,false)
assert.equal((await readSavedArrivalLabels(fakeDb(header,rows.slice(0,2)),'arr-17')).ok,false)
assert.equal((await readSavedArrivalLabels(fakeDb({...header,operation_type:'writeoff'},rows),'arr-17')).ok,false)
assert.equal((await readSavedArrivalLabels(fakeDb(header,rows.map(row=>({...row,inventory_source:'boutique'}))),'arr-17')).ok,false)
assert.equal((await readSavedArrivalLabels(fakeDb(header,rows.map(row=>({...row,quantity_delta:0}))),'arr-17')).ok,false)
console.log('ARRIVAL_SUCCESS_REPRINT_PASS: immediate result step and complete GET-only historical receipt, no D1 writes')
