import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readCatalogSkuBarcode, lookupCatalogSkuBarcode } from '../worker/domains/barcode-sku.ts'
import { skuBarcodeForVariantId } from '../shared/barcode-sku.ts'

const sqlite = new DatabaseSync(':memory:')
sqlite.exec(
  'CREATE TABLE catalog_products (id INTEGER PRIMARY KEY, name TEXT, is_active INTEGER);' +
  'CREATE TABLE catalog_stock_positions (id INTEGER PRIMARY KEY, is_active INTEGER);' +
  'CREATE TABLE catalog_variants (' +
  'id INTEGER PRIMARY KEY, product_id INTEGER, stock_position_id INTEGER,' +
  'category TEXT, gender TEXT, color TEXT, material TEXT, length TEXT, size_label TEXT, is_active INTEGER);' +
  'INSERT INTO catalog_products VALUES (1,\'АЛАН\',1), (2,\'СТАРЫЙ\',0);' +
  'INSERT INTO catalog_stock_positions VALUES (10,1), (11,0);' +
  'INSERT INTO catalog_variants VALUES (1593,1,10,\'adult\',\'МУЖ\',\'ХАКИ\',\'СТАНДАРТ\',\'СТАНДАРТ\',\'48\',1);' +
  'INSERT INTO catalog_variants VALUES (1594,1,10,\'adult\',\'МУЖ\',\'БЕЖЕВЫЙ\',\'СТАНДАРТ\',\'СТАНДАРТ\',\'50\',0);' +
  'INSERT INTO catalog_variants VALUES (1595,1,11,\'adult\',\'МУЖ\',\'ХАКИ\',\'СТАНДАРТ\',\'СТАНДАРТ\',\'52\',1);' +
  'INSERT INTO catalog_variants VALUES (1596,2,10,\'adult\',\'МУЖ\',\'ХАКИ\',\'СТАНДАРТ\',\'СТАНДАРТ\',\'54\',1);'
)
const d1 = {
  prepare(sql) {
    return {
      bind(...args) {
        return {
          async first() { return sqlite.prepare(sql).get(...args) || null },
        }
      },
    }
  },
}
const live = await readCatalogSkuBarcode(d1, 1593)
assert.equal(live.ok, true)
assert.equal(live.active, true)
assert.equal(live.barcodeType, 'sku')
assert.equal(live.variantId, 1593)
assert.equal(live.size, '48')
assert.equal(live.physicalUnit, false)
assert.equal(live.barcode, skuBarcodeForVariantId(1593))
assert.deepEqual(await lookupCatalogSkuBarcode(d1, live.barcode), live)
for (const id of [1594, 1595, 1596]) {
  const old = await readCatalogSkuBarcode(d1, id)
  assert.equal(old.ok, true)
  assert.equal(old.active, false)
  assert.equal(old.status, 'retired')
  assert.equal(old.barcode, skuBarcodeForVariantId(id))
}
const unknown = await readCatalogSkuBarcode(d1, 999999)
assert.equal(unknown.ok, false)
assert.equal(unknown.code, 'sku_not_found')
const invalid = await lookupCatalogSkuBarcode(d1, 'OCS1-0000AB-00')
assert.equal(invalid.ok, false)
assert.equal(invalid.code, 'invalid_barcode')
assert.equal((await readCatalogSkuBarcode(d1, -2)).code, 'invalid_sku')
sqlite.close()
console.log('BARCODE SKU D1 PASS: active and retired generations, canonical attributes, no stock table or movements needed')
