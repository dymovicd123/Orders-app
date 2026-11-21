import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { prepareUnitLabelBatch } from '../worker/domains/barcode-unit-preparation.ts'
import { listStocktakeUnitScans, scanStocktakeUnit } from '../worker/domains/stocktake-barcode-scan.ts'

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
  INSERT INTO catalog_products VALUES(1,'ШАПАН',1);
  INSERT INTO catalog_stock_positions VALUES(10,1,1);
  INSERT INTO catalog_variants VALUES
    (101,1,10,'adult','МУЖ','СИНИЙ','СТАНДАРТ','СТАНДАРТ','48',1),
    (102,1,10,'adult','МУЖ','ЧЁРНЫЙ','СТАНДАРТ','СТАНДАРТ','50',1);
  INSERT INTO inventory_stock VALUES
    (1,101,'warehouse',3,1),(2,101,'boutique',1,0),(3,102,'warehouse',1,0);
`)
for(const path of [
  'migrations/0049_v72_inventory_stocktake_sessions.sql',
  'migrations/0136_barcode_physical_units_foundation.sql',
  'migrations/0137_barcode_unit_catalog_integrity.sql',
  'migrations/0138_barcode_unit_preparation_capacity.sql',
  'migrations/0140_barcode_stocktake_unit_scans.sql',
  'migrations/0142_barcode_stocktake_sku_scans.sql',
]) sqlite.exec(readFileSync(path,'utf8'))
sqlite.exec(`
  INSERT INTO inventory_stocktake_sessions
  (id,inventory_source,status,created_by,started_at,updated_at)
  VALUES ('REV-SCAN-1','warehouse','active','admin','now','now');
  INSERT INTO inventory_stocktake_items
  (id,session_id,inventory_source,stock_id,product_id,variant_id,product_name_snapshot,
   opening_quantity,opening_reserved_quantity,baseline_quantity,status,created_at,updated_at)
  VALUES (77,'REV-SCAN-1','warehouse',1,1,101,'ШАПАН',3,1,3,'pending','now','now');
`)
const stmt=(sql,params)=>({
  async first() { return sqlite.prepare(sql).get(...params) || null },
  async all() { return { results:sqlite.prepare(sql).all(...params) } },
  async run() { return { meta:{ changes:sqlite.prepare(sql).run(...params).changes } } },
})
const db={
  prepare(sql) { return { ...stmt(sql,[]),bind(...args){return stmt(sql,args)} } },
  async batch(statements) {
    sqlite.exec('BEGIN IMMEDIATE')
    try {
      const results=[]
      for(const statement of statements)results.push(await statement.run())
      sqlite.exec('COMMIT')
      return results
    } catch(error) {
      sqlite.exec('ROLLBACK')
      throw error
    }
  },
}
const id=n=>'22222222-2222-4222-8222-'+String(n).padStart(12,'0')
const count=()=>sqlite.prepare('SELECT counted_quantity AS n FROM inventory_stocktake_items WHERE id=77').get().n
const inventory=()=>sqlite.prepare('SELECT quantity,reserved_quantity FROM inventory_stock WHERE id=1').get()
const original=inventory()
const first=await prepareUnitLabelBatch(db,
  {variantId:101,source:'warehouse',quantity:3,requestId:id(1)},'admin')
const boutique=await prepareUnitLabelBatch(db,
  {variantId:101,source:'boutique',quantity:1,requestId:id(2)},'admin')
const other=await prepareUnitLabelBatch(db,
  {variantId:102,source:'warehouse',quantity:1,requestId:id(3)},'admin')
assert.equal((await listStocktakeUnitScans(db,'REV-SCAN-1')).total,0)
const [fresh,replay]=await Promise.all([
  scanStocktakeUnit(db,'REV-SCAN-1',first.labels[0].token,'admin'),
  scanStocktakeUnit(db,'REV-SCAN-1',first.labels[0].token,'admin'),
])
assert.equal([fresh,replay].filter(x=>!x.duplicate).length,1,'concurrent duplicate cannot count twice')
assert.equal(count(),1)
const retry=await scanStocktakeUnit(db,'REV-SCAN-1',first.labels[0].token,'admin')
assert.equal(retry.duplicate,true)
assert.equal(count(),1,'reloading or retrying the same scan never increments')
await assert.rejects(scanStocktakeUnit(db,'REV-SCAN-1','OCSKU-INVALID','admin'),/метка OCU1/i)
await assert.rejects(scanStocktakeUnit(db,'REV-SCAN-1',boutique.labels[0].token,'admin'),/другой точке/i)
const discovered=await scanStocktakeUnit(db,'REV-SCAN-1',other.labels[0].token,'admin')
assert.equal(discovered.countedQuantity,1,'Previously absent active SKU counts in one transaction')
assert.equal(discovered.addedItem?.variantId,102,'A newly found unit creates a visible review row')
assert.equal(discovered.addedItem?.baselineQuantity,1,'The source-specific baseline remains correct')
assert.equal((await scanStocktakeUnit(db,'REV-SCAN-1',other.labels[0].token,'admin')).duplicate,true)
assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM inventory_stocktake_items WHERE session_id='REV-SCAN-1' AND variant_id=102").get().n,1)
assert.equal(sqlite.prepare("SELECT quantity n FROM inventory_stock WHERE id=3").get().n,1,'Auto-add cannot mutate stock')
assert.equal(count(),1)
const second=await scanStocktakeUnit(db,'REV-SCAN-1',first.labels[1].token,'admin')
assert.equal(second.countedQuantity,2)
assert.equal((await listStocktakeUnitScans(db,'REV-SCAN-1')).total,3)
assert.deepEqual(inventory(),original,'scans never mutate physical stock or reservations')
assert.throws(()=>sqlite.prepare("UPDATE inventory_unit_labels SET state='revoked',revoked_at='now' WHERE token=?").run(first.labels[0].token),
  /STOCKTAKE_SCAN_LABEL_ALREADY_USED/)
await assert.rejects(scanStocktakeUnit(db,'REV-SCAN-1',boutique.labels[0].token,'admin'),/другой точке/i)

sqlite.exec('UPDATE inventory_stock SET quantity=4 WHERE id=1')
await assert.rejects(scanStocktakeUnit(db,'REV-SCAN-1',first.labels[2].token,'admin'),/Количество или состояние вещи изменилось/)
assert.equal(count(),2,'stale scan never overwrites previous physical count')
assert.equal((await listStocktakeUnitScans(db,'REV-SCAN-1')).total,3)
sqlite.exec('UPDATE inventory_stock SET quantity=3 WHERE id=1')
const third=await scanStocktakeUnit(db,'REV-SCAN-1',first.labels[2].token,'admin')
assert.equal(third.countedQuantity,3)
sqlite.exec('UPDATE inventory_stocktake_items SET counted_quantity=9 WHERE id=77')
assert.equal((await scanStocktakeUnit(db,'REV-SCAN-1',first.labels[2].token,'admin')).duplicate,true)
assert.equal(count(),9,'manual adjustment cannot replay a physical scan')
sqlite.exec("UPDATE inventory_stocktake_items SET status='recount_required' WHERE id=77")
assert.equal((await scanStocktakeUnit(db,'REV-SCAN-1',first.labels[0].token,'admin')).duplicate,true)
sqlite.exec("UPDATE inventory_stocktake_sessions SET status='completed' WHERE id='REV-SCAN-1'")
await assert.rejects(scanStocktakeUnit(db,'REV-SCAN-1',first.labels[0].token,'admin'),/завершена/)
assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(),[])

const route=readFileSync('worker/index.ts','utf8')
const ui=readFileSync('src/features/inventory/views/renderInventoryStocktakePanel.tsx','utf8')
const controller=readFileSync('src/features/sections/InventorySection.tsx','utf8')
const scanner=readFileSync('src/features/inventory/views/StocktakeBarcodeScanner.tsx','utf8')
assert(route.includes('scanStocktakeBarcode(env.DB, sessionId, input.code, input.requestId, actor)'))
assert(ui.includes('<StocktakeBarcodeScanner') && ui.includes('stocktakeUnsavedCount > 0'))
assert(controller.includes('onStocktakeBarcodeScan,'))
assert(scanner.includes("method: 'POST'") && scanner.includes("onScannedRef.current(result)"))
assert(!scanner.includes('localStorage') && !scanner.includes('sessionStorage'),
  'server—not browser—must own de-duplication')
sqlite.close()
console.log('STOCKTAKE UNIT SCAN PASS: atomic unique scan, concurrent duplicate, stale count guard, source guard, session guard, label revocation, manual count, no stock writes')
