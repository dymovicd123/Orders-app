import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import {
  cancelPreparedUnitLabelBatch, lookupIndividualUnitBarcode, prepareUnitLabelBatch, previewUnitBarcodePreparation, readPreparedUnitLabelBatch,
} from '../worker/domains/barcode-unit-preparation.ts'
import { isUnitBarcode } from '../shared/barcode-unit.ts'
import { encodeCode128B } from '../shared/barcode-code128.ts'

const sqlite = new DatabaseSync(':memory:')
sqlite.exec('PRAGMA foreign_keys=ON')
sqlite.exec(`
  CREATE TABLE catalog_products(id INTEGER PRIMARY KEY,name TEXT,is_active INTEGER NOT NULL);
  CREATE TABLE catalog_stock_positions(id INTEGER PRIMARY KEY,product_id INTEGER,is_active INTEGER NOT NULL);
  CREATE TABLE catalog_variants(
    id INTEGER PRIMARY KEY,product_id INTEGER,stock_position_id INTEGER,
    category TEXT,gender TEXT,color TEXT,material TEXT,length TEXT,size_label TEXT,is_active INTEGER NOT NULL
  );
  CREATE TABLE inventory_stock(id INTEGER PRIMARY KEY,variant_id INTEGER,
    inventory_source TEXT,quantity INTEGER NOT NULL,reserved_quantity INTEGER NOT NULL DEFAULT 0);
  INSERT INTO catalog_products VALUES (1,'АЛАН',1),(2,'УДАЛЁН',0);
  INSERT INTO catalog_stock_positions VALUES (10,1,1),(20,2,1);
  INSERT INTO catalog_variants VALUES
    (101,1,10,'adult','МУЖ','ХАКИ','СТАНДАРТ','СТАНДАРТ','48',1),
    (102,1,10,'adult','МУЖ','БЕЖЕВЫЙ','СТАНДАРТ','СТАНДАРТ','50',0),
    (103,2,20,'adult','МУЖ','ХАКИ','СТАНДАРТ','СТАНДАРТ','52',1);
  INSERT INTO inventory_stock VALUES(1,101,'warehouse',3,2),(2,101,'boutique',1,0);
`)
for (const path of [
  'migrations/0136_barcode_physical_units_foundation.sql',
  'migrations/0137_barcode_unit_catalog_integrity.sql',
  'migrations/0138_barcode_unit_preparation_capacity.sql',
]) sqlite.exec(readFileSync(path, 'utf8'))

function prepareStatement(sql, params) {
  return {
    sql, params,
    async first() { return sqlite.prepare(sql).get(...params) || null },
    async all() { return { results: sqlite.prepare(sql).all(...params) } },
    async run() { return { meta: { changes: sqlite.prepare(sql).run(...params).changes } } },
  }
}
const d1 = {
  prepare(sql) {
    return {
      ...prepareStatement(sql, []),
      bind(...params) { return prepareStatement(sql, params) },
    }
  },
  async batch(statements) {
    sqlite.exec('BEGIN IMMEDIATE')
    try {
      const result = []
      for (const s of statements) result.push(await s.run())
      sqlite.exec('COMMIT')
      return result
    } catch (error) {
      sqlite.exec('ROLLBACK')
      throw error
    }
  },
}
const id = (n) => '11111111-1111-4111-8111-' + String(n).padStart(12,'0')
const count = (table) => sqlite.prepare('SELECT COUNT(*) AS n FROM ' + table).get().n
const stock = () => sqlite.prepare('SELECT quantity,reserved_quantity FROM inventory_stock WHERE id=1').get()
const snapshot = stock()

const before = await previewUnitBarcodePreparation(d1, 101)
assert.equal(before.locations.find(x => x.source === 'warehouse').available, 3)
assert.equal(before.locations.find(x => x.source === 'boutique').available, 1)
assert.equal(before.maximumPerBatch, 20)

const first = await prepareUnitLabelBatch(d1,
  { variantId:101, source:'warehouse', quantity:2, requestId:id(1) }, 'admin')
assert.equal(first.quantity, 2)
assert.equal(first.duplicate, false)
assert.equal(first.labels.length, 2)
assert(new Set(first.labels.map(label => label.token)).size === 2)
for (const label of first.labels) {
  assert(isUnitBarcode(label.token))
  assert(encodeCode128B(label.token).bars.length > 15)
}
assert.deepEqual(stock(), snapshot, 'Label preparation must not modify physical stock or reservations')
assert.equal(count('inventory_units'), 2)
assert.equal(count('inventory_unit_labels'), 2)
assert.equal(count('inventory_unit_events'), 2)
assert.equal(count('barcode_print_batch_labels'), 2)
assert.equal(count('barcode_print_batches'), 1)

const replay = await prepareUnitLabelBatch(d1,
  { variantId:101, source:'warehouse', quantity:2, requestId:id(1) }, 'admin')
assert.equal(replay.duplicate, true)
assert.deepEqual(replay.labels, first.labels)
assert.equal(count('inventory_units'), 2)
await assert.rejects(
  prepareUnitLabelBatch(d1, { variantId:101, source:'warehouse', quantity:1, requestId:id(1) }, 'admin'),
  /уже сохранён/
)

const current = await previewUnitBarcodePreparation(d1, 101)
assert.equal(current.locations.find(x => x.source === 'warehouse').available, 1)
assert.equal(current.recentBatches[0].quantity, 2)
assert.equal(current.recentBatches[0].canReprint, true)

await assert.rejects(
  prepareUnitLabelBatch(d1, { variantId:101, source:'warehouse', quantity:2, requestId:id(2) }, 'admin'),
  /Нельзя подготовить больше/
)
assert.equal(count('inventory_units'), 2)
const last = await prepareUnitLabelBatch(d1,
  { variantId:101, source:'warehouse', quantity:1, requestId:id(3) }, 'admin')
assert.equal(last.labels.length, 1)
const boutique = await prepareUnitLabelBatch(d1,
  { variantId:101, source:'boutique', quantity:1, requestId:id(4) }, 'admin')
assert.equal(boutique.labels.length, 1)
assert.equal(count('inventory_units'), 4)
assert.deepEqual(stock(), snapshot)

const after = await previewUnitBarcodePreparation(d1, 101)
assert.deepEqual(after.locations.map(x => x.available), [0,0])
await assert.rejects(
  prepareUnitLabelBatch(d1, { variantId:101, source:'warehouse', quantity:1, requestId:id(5) }, 'admin'),
  /Нельзя подготовить больше/
)
const cancelled = await cancelPreparedUnitLabelBatch(d1, boutique.batchId, 'admin')
assert.equal(cancelled.cancelled, true)
assert.equal(cancelled.duplicate, false)
assert.equal((await cancelPreparedUnitLabelBatch(d1, boutique.batchId, 'admin')).duplicate, true)
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM inventory_unit_labels WHERE state='revoked'").get().n, 1)
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM inventory_units WHERE unit_status='retired' AND coverage_status='excluded'").get().n, 1)
assert.equal((await previewUnitBarcodePreparation(d1, 101)).locations.find(x => x.source === 'boutique').available, 1)
await assert.rejects(readPreparedUnitLabelBatch(d1, boutique.batchId), /аннулирована/)
const boutiqueAgain = await prepareUnitLabelBatch(d1,
  { variantId:101, source:'boutique', quantity:1, requestId:id(11) }, 'admin')
assert.notEqual(boutiqueAgain.labels[0].token, boutique.labels[0].token)
assert.deepEqual(stock(), snapshot, 'Cancel and reprepare must not change physical totals')

const beforeIllegal = count('inventory_units')
assert.throws(() => sqlite.prepare(`INSERT INTO inventory_units
(unit_id,original_variant_id,variant_id,origin_kind,origin_ref,inventory_source,unit_status,coverage_status,created_at,updated_at)
VALUES('unexpected',101,101,'existing_stock','UBL1-notenough','warehouse','unverified','unlinked','now','now')`).run(),
/BARCODE_PREPARATION_CAPACITY_EXCEEDED/)
assert.equal(count('inventory_units'), beforeIllegal)
assert.deepEqual(await readPreparedUnitLabelBatch(d1, first.batchId),
  { ok:true, batchId:first.batchId, createdAt:first.createdAt,
    variantId:101, source:'warehouse', quantity:2,
    labels:first.labels, stockChanged:false, requiresVerification:true })

await assert.rejects(
  prepareUnitLabelBatch(d1, { variantId:102, source:'warehouse', quantity:1, requestId:id(6) }, 'admin'),
  /больше недоступен/
)
await assert.rejects(
  prepareUnitLabelBatch(d1, { variantId:103, source:'warehouse', quantity:1, requestId:id(7) }, 'admin'),
  /больше недоступен/
)
await assert.rejects(
  prepareUnitLabelBatch(d1, { variantId:101, source:'customer', quantity:1, requestId:id(8) }, 'admin'),
  /Склад или Бутик/
)
await assert.rejects(
  prepareUnitLabelBatch(d1, { variantId:101, source:'warehouse', quantity:21, requestId:id(9) }, 'admin'),
  /от 1 до 20/
)

sqlite.prepare("UPDATE inventory_unit_labels SET state='revoked',revoked_at='now' WHERE token=?").run(first.labels[0].token)
await assert.rejects(readPreparedUnitLabelBatch(d1, first.batchId), /отозванные коды/)
assert.equal((await previewUnitBarcodePreparation(d1, 101)).recentBatches.some(x =>
  x.batchId === first.batchId && !x.canReprint), true)
assert.deepEqual(stock(), snapshot)
const found = await lookupIndividualUnitBarcode(d1, last.labels[0].token.toLowerCase())
assert.equal(found.ok, true)
assert.equal(found.barcodeType, 'unit')
assert.equal(found.variantId, 101)
assert.equal(found.active, true)
assert.equal(found.verified, false)
assert.equal(found.status, 'prepared')
const expired = await lookupIndividualUnitBarcode(d1, boutique.labels[0].token)
assert.equal(expired.ok, true)
assert.equal(expired.status, 'revoked')
assert.equal(expired.active, false)
assert.equal((await lookupIndividualUnitBarcode(d1, 'OCU1-INVALID')).code, 'invalid_unit_barcode')
assert.deepEqual(stock(), snapshot)

assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(), [])

const routes = readFileSync('worker/index.ts','utf8')
const ui = readFileSync('src/features/inventory/views/UnitBarcodePreparation.tsx','utf8')
const card = readFileSync('src/features/inventory/views/catalogPolishExecutionGroups.tsx','utf8')
assert(routes.includes("requireAdminAccess(request)"), 'write endpoint must require privileged account')
assert(routes.includes("url.pathname === '/api/barcodes/units/batches' && request.method === 'POST'"))
assert(ui.includes('Маркировать вещи') && ui.includes('повторная печать'), 'human marking/reprint UI missing')
assert(ui.includes('Подтвердить аннулирование'), 'must allow safe mistaken label cancellation')
assert(routes.includes("barcodeCancelMatch && request.method === 'POST'"), 'cancel route must be authenticated and available')
assert(ui.includes('window.open(\'\', \'_blank\''), 'printing must open browser popup before await')
assert(card.includes('<UnitBarcodePreparation'), 'marking must be reachable in exact variant card')
assert(routes.includes("code.trim().toUpperCase().startsWith('OCU1-')"), 'the same scanner must look up OCU1')
const scanner = readFileSync('src/features/inventory/views/SkuBarcodeLookup.tsx', 'utf8')
assert(scanner.includes('Индивидуальная метка аннулирована') && scanner.includes('наличие не подтверждено'), 'scanner status must be human readable')
for (const name of ['inventory_stock','inventory_movements','inventory_reservations','order_items']) {
  const source = readFileSync('worker/domains/barcode-unit-preparation.ts','utf8')
  assert(!new RegExp('(?:UPDATE|DELETE\\s+FROM|INSERT\\s+INTO)\\s+' + name, 'i').test(source),
    'label endpoint must never write to ' + name)
}
sqlite.close()
console.log('BARCODE LABEL PREPARATION PASS: exact source/count capacity, idempotent batch, reprint, revoked guard, zero stock mutations')
