import fs from 'node:fs'
import assert from 'node:assert/strict'

const section = fs.readFileSync('src/features/sections/InventorySection.tsx', 'utf8')
const model = fs.readFileSync('src/app/controllers/useOperationalViewModel.ts', 'utf8')

assert.match(model, /warehouseRow\?\.quantity \|\| 0/,
  'Test setup changed: missing stock snapshot must no longer be silently defaulted at the model level')
assert.match(section, /const simpleStockSnapshotReady = \(inventorySourceRows \|\| \[\]\)\.some\([\s\S]*?row\.source === simpleStockSource && row\.data\?\.ok === true/,
  'The selected source must have a confirmed stock snapshot')
assert.match(section, /simpleStockSnapshotReady \? renderInventoryOverviewPanel\(\{/,
  'The stock browse panel must never render inferred zero counts without source truth')
assert.match(section, /Остатки пока не загружены/)
assert.match(section, /Отсутствие ответа сервера не означает, что на складе ноль вещей/)
assert.match(section, /loadInventoryData\(simpleStockSource, true, '', false\)/,
  'The user must be able to force a retry instead of seeing made-up zero stock')
assert.match(section, /setSimpleStockSource\('boutique'\)/,
  'The user must still be able to switch warehouse/boutique while data is absent')

const loaded = [
  { source: 'warehouse', data: { ok: true, items: [{ quantity: 3 }] } },
  { source: 'boutique', data: null },
]
const ready = (source) => loaded.some(row => row.source === source && row.data?.ok === true)
assert.equal(ready('warehouse'), true, 'A successful zero/nonzero snapshot can be rendered')
assert.equal(ready('boutique'), false, 'A missing snapshot must not be rendered as zero')
loaded[1].data = { ok: false, items: [] }
assert.equal(ready('boutique'), false, 'An unsuccessful response must not be rendered as zero')
loaded[1].data = { ok: true, items: [] }
assert.equal(ready('boutique'), true, 'An authoritative empty stock snapshot may show zero')
console.log('STOCK SNAPSHOT NO FALSE ZEROS PASSED')
