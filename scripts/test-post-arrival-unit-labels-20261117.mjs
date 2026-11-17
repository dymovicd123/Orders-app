import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const movement = readFileSync('src/features/inventory/inventoryMovementActions.ts', 'utf8')
const panel = readFileSync('src/features/inventory/views/renderInventoryMovementPanel.tsx', 'utf8')
const section = readFileSync('src/features/sections/InventorySection.tsx', 'utf8')
const label = readFileSync('src/features/inventory/views/BarcodePrintWorkspace.tsx', 'utf8')
const domain = readFileSync('worker/domains/inventory-movement.ts', 'utf8')
const start = movement.indexOf('const finishMovement = async')
const end = movement.indexOf('const isArrivalRecoveryResult', start)
assert(start >= 0 && end > start, 'Preserve shared post-commit Arrival finish flow')
const finish = movement.slice(start, end)
assert(finish.includes("inventoryDraft.movementType === 'arrival' && verifiedInStockList && arrivalReceipt"),
  'Offer labels only after canonical saved Arrival and verified read-back')
assert(finish.includes('labelItems.length === arrivalReceipt.items.length'),
  'Reject incomplete or ambiguous arrival receipt for barcode offer')
assert(finish.includes('item.variantId > 0') && finish.includes('item.received > 0'),
  'Only positive, resolved receipt lines are eligible')
assert(finish.includes('onArrivalBarcodeReady({ operationId: result.operationId'),
  'The offer must include server-confirmed operation, source and variants')
assert(!finish.includes('prepareUnitLabelBatch('),
  'Arrival finish must never create labels automatically or alter physical stock')
assert(movement.includes("onSuccess: async (recoveryResult) => { await finishMovement(recoveryResult as InventoryMovementSaveResponse) }"),
  'Catalog recovery must use the exact same post-commit safe flow')
assert(panel.includes("onSave={codes=>ctx.saveInventoryMovement(codes)}"),
  'Preserve the original inventory operation callback and all existing barcode/writeoff tests')
assert(section.includes('return saveInventoryMovement(codes, setArrivalBarcodeReceipt, setArrivalCompletion)'),
  'Warehouse section forwards only a post-commit arrival result to optional UI')
assert(panel.includes('ctx.clearArrivalBarcodeReady()'), 'A new operation clears stale barcode suggestions')
assert(section.includes('arrivalPrintReceipt: arrivalBarcodeReceipt') &&
  panel.includes('arrivalPrintAvailable={Boolean(ctx.arrivalPrintReceipt?.items.length)}'),
  'Only a completed arrival result may expose optional print action')
assert(section.includes('receipt={arrivalBarcodeReceipt} catalog={catalogData} stock={inventoryData}') &&
  section.includes('onReload={reloadBarcodePrintData}') &&
  section.includes('onFinishArrivalResult: () => {') &&
  section.includes('setArrivalBarcodeReceipt(null)') && section.includes('setArrivalCompletion(null)'),
  'Offer a shared SKU printer in the completion step, with optional finish')
assert(!section.includes('<UnitBarcodePreparation'),
  'Never send completed arrival through the legacy individual-unit preparation UI')
assert(label.includes('receipt.source') && label.includes('receipt.items'),
  'Print receipt keeps original stock location and canonical confirmed line items')
assert(label.includes('missingReceiptVariants.length === 0'),
  'Stale or retired arrival SKU identities must block printing, not stock entry')
assert(domain.includes("movementType === 'arrival'"), 'Existing canonical stock movement remains authoritative')
console.log('POST_ARRIVAL_SKU_PRINT_PASS: canonical arrival, verified variants, optional shared SKU labels, no duplicate stock')
