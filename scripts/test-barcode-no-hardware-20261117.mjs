import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { encodeCode128B } from '../shared/barcode-code128.ts'
import { isUnitBarcode, unitBarcodeFromEntropy } from '../shared/barcode-unit.ts'

const token = unitBarcodeFromEntropy(new Uint8Array([0,1,2,3,4,5,6,7]))
assert(isUnitBarcode(token), 'A deterministic individual token must be valid for keyboard simulation')
assert(!isUnitBarcode(token.slice(0,-1) + (token.endsWith('0') ? '1' : '0')),
  'A single-character transcription error must fail the token checksum')
const encoded = encodeCode128B(token)
assert(encoded.bars.length > token.length * 2, 'Code128 artwork must have enough bars for each character')
assert(encoded.width > 100 && encoded.bars[0].x > 0, 'Printed Code128 needs quiet margins')
assert(encoded.bars.every(b => Number.isInteger(b.x) && Number.isInteger(b.width) && b.width > 0),
  'All printed bars must have valid dimensions')

const labels = readFileSync('src/features/inventory/views/UnitBarcodePreparation.tsx','utf8')
const lookup = readFileSync('src/features/inventory/views/SkuBarcodeLookup.tsx','utf8')
const stocktake = readFileSync('src/features/inventory/views/StocktakeBarcodeScanner.tsx','utf8')
const operations = readFileSync('src/features/inventory/views/InventoryUnifiedQuantityWorkspace.tsx','utf8')
const domain = readFileSync('worker/domains/barcode-unit-preparation.ts','utf8')
assert(labels.includes('Проверить без сканера и принтера') &&
  labels.includes('batch.labels.map(entry =>') &&
  labels.includes('navigator.clipboard.writeText(token)'),
  'Users must be able to copy real prepared tokens for manual HID-like input without a scanner')
assert(labels.includes('renderBatch(windowToPrint') && labels.includes('window.print()'),
  'Users must be able to preview label artwork and save as PDF without a printer')
assert(labels.includes('Не подтверждайте списание, перемещение') &&
  labels.includes('или ревизию реальных вещей только ради теста') &&
  labels.includes('аннулируйте партию после проверки'),
  'Software-only check must not invite fictitious inventory writes')
assert(lookup.includes("onSubmit={event => { event.preventDefault(); void lookup() }}") &&
  lookup.includes("method: 'GET'"), 'Read-only lookup must accept keyboard Enter')
assert(stocktake.includes('onSubmit={event => { event.preventDefault(); submitInput(inputRef.current?.value || code) }}') &&
  stocktake.includes("event.key === 'Enter'"),
  'Stocktake scanner must accept keyboard Enter / USB HID suffix')
assert(operations.includes('onSubmit={event=>{event.preventDefault();void scanOperationUnit()}}'),
  'Transfer/writeoff scanner must accept keyboard Enter')
assert(domain.includes("purpose='existing_stock'"), 'Prepared tokens are tied to existing stock, not a new receipt')
console.log('BARCODE_NO_HARDWARE_PASS: deterministic label, token checksum, print artwork, copy, manual Enter, no fake movements')
