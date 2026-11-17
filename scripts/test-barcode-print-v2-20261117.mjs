import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  paginateBarcodeLabels, A4_LABELS_PER_PAGE, MAX_BARCODE_PRINT_LABELS
} from '../src/features/inventory/views/barcodePrintPages.ts'
import { skuBarcodeForVariantId } from '../shared/barcode-sku.ts'

const ids = Array.from({ length: MAX_BARCODE_PRINT_LABELS }, (_, index) => index + 1)
assert.equal(A4_LABELS_PER_PAGE, 21)
assert.equal(MAX_BARCODE_PRINT_LABELS, 1000)
for (const size of [1, 3, 20, 21, 22, 42, 43, 300, 500, 1000]) {
  const labels = ids.slice(0, size)
  const pages = paginateBarcodeLabels(labels, 'a4')
  assert.equal(pages.length, Math.ceil(size / 21), 'wrong A4 page count ' + size)
  assert(pages.every(page => page.length >= 1 && page.length <= 21))
  assert.deepEqual(pages.flat(), labels, 'A4 pagination cannot omit or duplicate labels')
  const thermal = paginateBarcodeLabels(labels, 'thermal')
  assert.equal(thermal.length, size, 'thermal print must use one physical sticker per media page')
  assert.deepEqual(thermal.flat(), labels)
}
assert.deepEqual(paginateBarcodeLabels([], 'a4'), [])
assert.deepEqual(paginateBarcodeLabels([], 'thermal'), [])
assert.equal(skuBarcodeForVariantId(42), skuBarcodeForVariantId(42), 'copies of one SKU share the same code')
assert.notEqual(skuBarcodeForVariantId(42), skuBarcodeForVariantId(43), 'different variants need distinct codes')

const page = readFileSync('src/features/inventory/views/BarcodePrintWorkspace.tsx','utf8')
const css = readFileSync('src/features/inventory/views/barcodePrintWorkspace.css','utf8')
assert(page.includes('paginateBarcodeLabels(labelMarkup, mode)') &&
  page.includes("grid-template-columns:repeat(3,58mm)") &&
  page.includes("grid-template-rows:repeat(7,35mm)") &&
  page.includes("gap:3mm") &&
  page.includes("'.sheet{width:58mm;height:35mm;padding:0;display:block}'"),
  'A4 should pack 3x7 labels, while thermal mode makes one 58x35 sheet per label')
assert(page.includes('@page{size:A4;margin:0}') && page.includes('@page{size:58mm 35mm;margin:0}'),
  'Page size must be explicit for both paper and thermal printer')
assert(page.includes('<path d=') && page.includes('encoded.bars.map(bar =>'),
  'The 1000-label print should use compact Code128 vector paths instead of thousands of DOM rectangles')
assert(page.includes('Все копии одного варианта') || page.includes('Все копии одного варианта имеют одинаковый код'),
  'Explain common SKU identity')
assert(page.includes('Остатки служат ориентиром') &&
  !page.includes('if (item.quantity > physical)') &&
  !page.includes('!invalidStock && excess.length === 0'),
  'Printing extras must not be blocked by system stock or alter inventory')
assert(page.includes('type="text" inputMode="numeric" pattern="[0-9]*" placeholder="0"') &&
  page.includes('onFocus={event => event.currentTarget.select()}') &&
  page.includes('value={quantityDrafts[variant.id] ??') &&
  page.includes('setQuantityDrafts({})'),
  'Count field must have an empty zero placeholder, select on focus, and clean reset')
assert(page.includes('colorGroups.map') && page.includes('aria-expanded={expanded}') &&
  page.includes('value={colorFilter}') && page.includes('value={sizeFilter}') &&
  page.includes('value={variantQuery}'),
  'Large multi-variant products must have collapsible groups and narrow filters')
assert(page.includes('По остатку: {visibleVariants.length} вариантов') &&
  page.includes("onClick={useVisibleStock}"),
  'High-volume printing needs a single action to fill visible variants from stock')
assert(page.includes("name=\"barcode-paper-mode\"") &&
  page.includes("setPrintMode('a4')") && page.includes("setPrintMode('thermal')"),
  'Both paper and roll printer modes must be clearly selectable')
assert(css.includes('.barcode-color-group') && css.includes('.barcode-variant-filters') &&
  css.includes('@media(max-width:740px)'),
  'Variant grouping and filters must have a responsive layout')
console.log('BARCODE_PRINT_V2_PASS: 3x7 A4 sheets, thermal 58x35, 1000-label cap, stock-independent copies, variant filters, zero-safe inputs')
