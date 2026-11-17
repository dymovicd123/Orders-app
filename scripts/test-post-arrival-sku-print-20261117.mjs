import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { skuBarcodeForVariantId, variantIdFromSkuBarcode } from '../shared/barcode-sku.ts'
import { paginateBarcodeLabels } from '../src/features/inventory/views/barcodePrintPages.ts'

const section = readFileSync('src/features/sections/InventorySection.tsx','utf8')
const printer = readFileSync('src/features/inventory/views/BarcodePrintWorkspace.tsx','utf8')
const movement = readFileSync('src/features/inventory/inventoryMovementActions.ts','utf8')
const stockCss = readFileSync('src/styles/193-unified-inventory-operations.css','utf8')
const printCss = readFileSync('src/features/inventory/views/barcodePrintWorkspace.css','utf8')
assert(section.includes('receipt={arrivalBarcodeReceipt} catalog={catalogData} stock={inventoryData}'),
  'Printer must use actual canonical arrival receipt and current catalogue')
assert(section.includes('onDismiss={() => setArrivalBarcodeReceipt(null)}') &&
  section.includes('return saveInventoryMovement(codes, setArrivalBarcodeReceipt)'),
  'Skipping print must not re-execute arrival movement')
assert(section.includes('setArrivalBarcodeReceipt(null)') &&
  section.includes('arrivalPrintRef.current?.scrollIntoView'),
  'Existing arrival receipt must be cleared when saving another operation, and new print offer must be brought into view')
assert(!section.includes('<UnitBarcodePreparation'), 'Individual unit label process must be removed from the arrival flow')
assert(printer.includes('for (const item of receipt?.items || [])') &&
  printer.includes('initial[id] = (initial[id] || 0) + quantity'),
  'Confirmed arrival quantities including duplicate variant lines must be preselected in print form')
assert(printer.includes('receipt.items.filter(row => row.variantId === item.variantId)') &&
  printer.includes('.reduce((sum, row) => sum + row.quantity, 0)'),
  'Duplicate arrival lines must be presented as the same total count, never printed twice silently')
assert(printer.includes('missingReceiptVariants.length === 0') &&
  printer.includes('const variant = activeVariants.find(row => row.id === item.variantId)') &&
  printer.includes('disabled={printing || !variant}'),
  'Do not print a retired or unresolved SKU from a stale arrival')
assert(printer.includes('onFocus={event => event.currentTarget.select()}') &&
  printer.includes("inputMode=\"numeric\" pattern=\"[0-9]*\" placeholder=\"0\"") &&
  printer.includes('onChange={event => updateCount(item.variantId, event.target.value)}'),
  'Arrival print quantities must be easily editable without the zero-input bug')
assert(printer.includes('onClick={onDismiss}>Не печатать') &&
  printer.includes('Остатки') &&
  printer.includes('receipt.source') &&
  printer.includes('Поступило <strong>{received} шт.</strong>'),
  'Arrival print offer must show stock source and receipt quantities with a clear skip action')
assert(printer.includes('setPrintMode(\'a4\')') && printer.includes('setPrintMode(\'thermal\')') &&
  printer.includes('renderPrintSheet(target, verified, printMode)'),
  'Arrival print must reuse the same A4 and thermal preview, not duplicate print logic')
assert(printer.includes("await fetch('/api/barcodes/sku/'") &&
  printer.includes('record.physicalUnit !== false') &&
  printer.includes('record.active'),
  'Printing after arrival needs the same read-only active SKU verification')
assert(!/fetch\([^)]*,\s*\{[^}]*method:\s*['"]POST/s.test(printer),
  'Printing and skipping must never mutate stock or write to D1')
assert(movement.includes('const verifiedInStockList = Boolean(arrivalReceipt?.verified && refreshedStock') &&
  movement.includes('!result.warnings?.length') &&
  movement.includes('onArrivalBarcodeReady({ operationId: result.operationId'),
  'Never offer post-arrival printing before a verified committed receipt')
assert(printCss.includes('.barcode-arrival-row') && printCss.includes('.barcode-arrival-quantity') &&
  printCss.includes('@media(max-width:620px)') && stockCss.includes('scroll-margin-top'),
  'Arrival print review must be compact, responsive, and visible after save')
const labels = [11, 11, 11, 12, 13, 13].map(variantId => skuBarcodeForVariantId(variantId))
assert(labels.every((code,i) => variantIdFromSkuBarcode(code)===[11,11,11,12,13,13][i]))
assert.deepEqual(paginateBarcodeLabels(labels,'a4').flat(),labels,
  'Shared A4/thermal print pagination must not reassign SKU labels')
console.log('POST_ARRIVAL_SKU_PRINT_PASS: verified single arrival, prefilled editable SKU labels, A4/thermal, safe skip, no stock mutations')
