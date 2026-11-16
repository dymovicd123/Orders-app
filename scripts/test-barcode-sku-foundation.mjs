import assert from 'node:assert/strict'
import { skuBarcodeForVariantId, variantIdFromSkuBarcode } from '../shared/barcode-sku.ts'
import { encodeCode128B } from '../shared/barcode-code128.ts'
import { readFileSync } from 'node:fs'

for (const id of [1, 35, 36, 1593, 1000000, Number.MAX_SAFE_INTEGER]) {
  const code = skuBarcodeForVariantId(id)
  assert.equal(variantIdFromSkuBarcode(code), id)
  assert.equal(variantIdFromSkuBarcode('  ' + code.toLowerCase() + ' '), id)
  const output = encodeCode128B(code)
  assert(output.bars.length > 20)
  assert(output.width > 30)
  assert.equal(output.bars[0].x, 10)
  assert.equal(output.bars[0].width, 2)
  const bad = code.slice(0, -1) + (code.endsWith('A') ? 'B' : 'A')
  assert.equal(variantIdFromSkuBarcode(bad), null)
}
for (const bad of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
  assert.throws(() => skuBarcodeForVariantId(bad))
}
for (const bad of ['','OCS1-000000-00','OCU1-000001-00','SKU-1','OCS1-000001-??']) {
  assert.equal(variantIdFromSkuBarcode(bad), null)
}
assert.throws(() => encodeCode128B('ПРОДУКТ'))
assert.throws(() => encodeCode128B('\n'))
assert.equal(encodeCode128B('A').checksum, (104 + (65 - 32)) % 103)
assert.equal(encodeCode128B('A').width, 10 + 11 * 3 + 13 + 10)
const patterns = readFileSync('shared/barcode-code128.ts', 'utf8').match(/const PATTERNS = '([^']+)'/)
assert(patterns)
const codes = patterns[1].split(',')
assert.equal(codes.length, 107)
for (let i = 0; i < codes.length; i++) {
  assert.match(codes[i], /^[1-4]{6,7}$/)
  assert.equal([...codes[i]].reduce((n, d) => n + Number(d), 0), i === 106 ? 13 : 11)
}
const worker = readFileSync('worker/index.ts', 'utf8')
assert(worker.includes('readCatalogSkuBarcode') && worker.includes('lookupCatalogSkuBarcode'))
assert(!readFileSync('shared/barcode-sku.ts', 'utf8').includes('inventory_stock'))
console.log('BARCODE SKU FOUNDATION PASS: deterministic versioned codes, checksum, correct Code128B patterns, read-only routing')
