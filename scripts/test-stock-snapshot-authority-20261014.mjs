import fs from 'node:fs'
import assert from 'node:assert/strict'

// Execute the actual stock overlay function from the current view model with
// production-shaped, anonymized inventory rows. No database/network mutations.
const code = fs.readFileSync('src/app/controllers/useOperationalViewModel.ts', 'utf8')
const head = "    const appendOrphanStockRow = (row: InventoryStockRecord, source: InventorySourceKey) => {"
const tail = "    ;(warehouseInventory?.items || []).forEach((row) => appendOrphanStockRow(row, 'warehouse'))"
const begin = code.indexOf(head)
const end = code.indexOf(tail, begin)
assert.ok(begin !== -1 && end > begin, 'Stock source reconciliation is missing')
const functionCode = code.slice(begin, end)
  .replace('(row: InventoryStockRecord, source: InventorySourceKey)', '(row, source)')
assert.doesNotMatch(functionCode, /rows\.has\(`variant:\$\{variantId\}`\)\) return/,
  'Matched source rows must not be discarded just because catalogue created a variant')
assert.match(functionCode, /existing\.boutiqueQuantity = sourceQuantity/,
  'Boutique values must be reconciled from physical API rows')
assert.match(functionCode, /existing\.warehouseQuantity = sourceQuantity/,
  'Warehouse values must be independently reconciled')
const normalizeSuggestion = (value) => String(value || '').trim().toLowerCase()
const rows = new Map([
  ['variant:655', {
    key: 'variant:655', variantId: 655, productId: 10,
    productName: 'Test clothing', color: 'Ivory', material: 'Atlas', size: '46',
    warehouseQuantity: 0, warehouseReserved: 0, warehouseAvailable: 0,
    boutiqueQuantity: 0, boutiqueReserved: 0, boutiqueAvailable: 0,
    totalQuantity: 0, totalReserved: 0, totalAvailable: 0,
  }],
])
const merge = new Function('rows', 'normalizeSuggestion',
  functionCode + '\nreturn appendOrphanStockRow;')(rows, normalizeSuggestion)
merge({
  variantId: 655, productId: 10, productName: 'Test clothing',
  color: 'Ivory', material: 'Atlas', size: '46',
  quantity: 2, reservedQuantity: 0, availableQuantity: 2,
}, 'boutique')
assert.equal(rows.size, 1, 'Catalogue and stock must refer to the same one SKU')
assert.deepEqual([
  rows.get('variant:655').boutiqueQuantity,
  rows.get('variant:655').boutiqueReserved,
  rows.get('variant:655').boutiqueAvailable,
  rows.get('variant:655').totalQuantity,
], [2, 0, 2, 2], 'Real boutique row 655 must override catalogue zero in rendered state')
merge({
  variantId: 655, productId: 10, productName: 'Test clothing',
  quantity: 1, reservedQuantity: 1, availableQuantity: 0,
}, 'warehouse')
assert.deepEqual([
  rows.get('variant:655').warehouseQuantity,
  rows.get('variant:655').warehouseReserved,
  rows.get('variant:655').boutiqueQuantity,
  rows.get('variant:655').totalQuantity,
  rows.get('variant:655').totalReserved,
  rows.get('variant:655').totalAvailable,
], [1, 1, 2, 3, 1, 2], 'Overlay must preserve independent locations and totals')
merge({
  variantId: 1041, productId: 10, productName: 'Test clothing', color: 'Pink', size: '44',
  quantity: 0, reservedQuantity: 1, availableQuantity: -1,
}, 'boutique')
assert.equal(rows.get('variant:1041').boutiqueAvailable, -1,
  'Existing shortage at another SKU must remain visible')
console.log('STOCK SNAPSHOT AUTHORITY PASSED — real source rows override catalogue zero, no stock writes')
