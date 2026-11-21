import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { skuBarcodeForVariantId } from '../shared/barcode-sku.ts'
import { StocktakeCameraScanGate } from '../src/features/inventory/stocktakeCameraScanGate.ts'
import { scanStocktakeSku, scanStocktakeBarcode, listStocktakeUnitScans } from '../worker/domains/stocktake-barcode-scan.ts'
import { saveInventoryStocktakeCount } from '../worker/domains/inventory-stocktake.ts'

const sql = new DatabaseSync(':memory:')
sql.exec('PRAGMA foreign_keys=ON')
sql.exec(`
  CREATE TABLE catalog_products(id INTEGER PRIMARY KEY,name TEXT,is_active INTEGER NOT NULL);
  CREATE TABLE catalog_stock_positions(id INTEGER PRIMARY KEY,product_id INTEGER,is_active INTEGER NOT NULL);
  CREATE TABLE catalog_variants(id INTEGER PRIMARY KEY,product_id INTEGER,stock_position_id INTEGER,
    category TEXT,gender TEXT,color TEXT,material TEXT,length TEXT,size_label TEXT,is_active INTEGER NOT NULL);
  CREATE TABLE inventory_stock(id INTEGER PRIMARY KEY,variant_id INTEGER,
    inventory_source TEXT,quantity INTEGER NOT NULL,reserved_quantity INTEGER NOT NULL DEFAULT 0);
  INSERT INTO catalog_products VALUES(1,'АБАЙ ТАКИЯ',1);
  INSERT INTO catalog_stock_positions VALUES(10,1,1);
  INSERT INTO catalog_variants VALUES
    (101,1,10,'adult','МУЖ','СИНИЙ','СТАНДАРТ','СТАНДАРТ','48',1),
    (102,1,10,'adult','МУЖ','КРАСНЫЙ','СТАНДАРТ','СТАНДАРТ','50',1),
    (103,1,10,'adult','МУЖ','ТЁМНЫЙ','СТАНДАРТ','СТАНДАРТ','52',0);
  INSERT INTO inventory_stock VALUES
    (1,101,'warehouse',3,1),(2,101,'boutique',1,0),(3,102,'warehouse',2,0);
`)
for (const migration of [
  'migrations/0049_v72_inventory_stocktake_sessions.sql',
  'migrations/0136_barcode_physical_units_foundation.sql',
  'migrations/0137_barcode_unit_catalog_integrity.sql',
  'migrations/0138_barcode_unit_preparation_capacity.sql',
  'migrations/0140_barcode_stocktake_unit_scans.sql',
  'migrations/0142_barcode_stocktake_sku_scans.sql',
]) sql.exec(readFileSync(migration,'utf8'))
sql.exec(`
  INSERT INTO inventory_stocktake_sessions(id,inventory_source,status,created_by,started_at,updated_at)
  VALUES ('REV-FAST','warehouse','active','admin','now','now');
  INSERT INTO inventory_stocktake_items
  (id,session_id,inventory_source,stock_id,product_id,variant_id,product_name_snapshot,
   opening_quantity,opening_reserved_quantity,baseline_quantity,status,created_at,updated_at)
  VALUES (77,'REV-FAST','warehouse',1,1,101,'АБАЙ ТАКИЯ',3,1,3,'pending','now','now');
`)
const query=(statement, args)=>({
  async first(){return sql.prepare(statement).get(...args)||null},
  async all(){return {results:sql.prepare(statement).all(...args)}},
  async run(){return {meta:{changes:sql.prepare(statement).run(...args).changes}}},
})
const db={
  prepare(statement){return {...query(statement,[]),bind(...args){return query(statement,args)}}},
  async batch(statements){
    sql.exec('BEGIN IMMEDIATE')
    try{const out=[];for(const statement of statements)out.push(await statement.run());sql.exec('COMMIT');return out}
    catch(error){sql.exec('ROLLBACK');throw error}
  },
}
const id=n=>'11111111-1111-4111-8111-'+String(n).padStart(12,'0')
const code=skuBarcodeForVariantId(101)
const qty=()=>sql.prepare('SELECT counted_quantity AS quantity FROM inventory_stocktake_items WHERE id=77').get().quantity
const stock=()=>sql.prepare('SELECT quantity,reserved_quantity FROM inventory_stock WHERE id=1').get()
const initialStock=stock()

const [fresh,replay]=await Promise.all([
  scanStocktakeSku(db,'REV-FAST',code,id(1),'admin'),
  scanStocktakeSku(db,'REV-FAST',code,id(1),'admin'),
])
assert.equal([fresh,replay].filter(row=>!row.duplicate).length,1,'Exactly once for concurrent retries of one scan')
assert.equal(qty(),1)
assert.equal(fresh.scanType,'sku')
assert.equal(fresh.itemId,77)
assert.equal((await scanStocktakeSku(db,'REV-FAST',code,id(1),'admin')).duplicate,true)
assert.equal(qty(),1,'Retry of the exact event does not add 1')

const next=await scanStocktakeBarcode(db,'REV-FAST',code,id(2),'admin')
assert.equal(next.countedQuantity,2,'New physical trigger of the SAME SKU adds 1')
assert.equal(next.duplicate,false)
assert.equal(qty(),2)
assert.deepEqual(stock(),initialStock,'Physical stock and reservations never change during scanning')
const total=await listStocktakeUnitScans(db,'REV-FAST')
assert.equal(total.skuTotal,2)
assert.equal(total.unitTotal,0)
assert.equal(total.total,2)

const manual=await saveInventoryStocktakeCount(db,'REV-FAST',77,{countedQuantity:7})
assert.equal(manual.ok,true,'Manual override of previously scanned variant remains permitted')
assert.equal(qty(),7)
const afterManual=await scanStocktakeSku(db,'REV-FAST',code,id(3),'admin')
assert.equal(afterManual.countedQuantity,8,'Next scan adds one to the manually corrected fact')
assert.equal(qty(),8)
assert.deepEqual(stock(),initialStock,'Neither scan nor manual draft edit applies stock before completing stocktake')

await assert.rejects(scanStocktakeSku(db,'REV-FAST','OCS1-DAMAGED-ZZ',id(4),'admin'),/повреждён/)
await assert.rejects(scanStocktakeSku(db,'REV-FAST',code,'bad-request','admin'),/событие/)
await assert.rejects(scanStocktakeSku(db,'REV-FAST',skuBarcodeForVariantId(102),id(5),'admin'),/не входит/)
await assert.rejects(scanStocktakeSku(db,'REV-FAST',skuBarcodeForVariantId(103),id(6),'admin'),/неактивен/)
await assert.rejects(scanStocktakeSku(db,'REV-FAST',skuBarcodeForVariantId(102),id(1),'admin'),/Идентификатор скана/)
assert.equal(qty(),8)

sql.exec('UPDATE inventory_stock SET quantity=10 WHERE id=1')
await assert.rejects(scanStocktakeSku(db,'REV-FAST',code,id(7),'admin'),/изменились/)
assert.equal(qty(),8,'Movement conflict rejects SKU count without changing it')
sql.exec('UPDATE inventory_stock SET quantity=3 WHERE id=1')
sql.exec("UPDATE inventory_stocktake_items SET status='recount_required' WHERE id=77")
await assert.rejects(scanStocktakeSku(db,'REV-FAST',code,id(8),'admin'),/пересчитайте/)
sql.exec("UPDATE inventory_stocktake_items SET status='counted' WHERE id=77")
assert.equal((await scanStocktakeSku(db,'REV-FAST',code,id(9),'admin')).countedQuantity,9)
sql.exec("UPDATE inventory_stocktake_sessions SET status='completed' WHERE id='REV-FAST'")
await assert.rejects(scanStocktakeSku(db,'REV-FAST',code,id(10),'admin'),/завершена/)
assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(),[])

const gate=new StocktakeCameraScanGate(1900,8)
assert.equal(gate.detected(code,1000),true)
assert.equal(gate.detected(code,1150),false,'Stationary visible label must not loop')
gate.missing(1200)
assert.equal(gate.detected(code,1550),false,'Intermittent frame failures cannot count twice')
for (let moment=1700;moment<=3300;moment+=200) gate.missing(moment)
assert.equal(gate.detected(code,3400),true,'Sustained disappearance with many absent frames permits a physically new piece')
assert.equal(gate.detected(code,3500),false,'Visible same label cannot count again')
assert.equal(gate.detected(skuBarcodeForVariantId(102),3530),true,'Different SKU can be read immediately')
gate.nextPhysicalItem()
assert.equal(gate.detected(code,3600),true,'Operator may explicitly rearm for another piece of the same shared SKU')
gate.reset()
assert.equal(gate.detected(code,3700),true)

const scanner=readFileSync('src/features/inventory/views/StocktakeBarcodeScanner.tsx','utf8')
const panel=readFileSync('src/features/inventory/views/renderInventoryStocktakePanel.tsx','utf8')
const section=readFileSync('src/features/sections/InventorySection.tsx','utf8')
const route=readFileSync('worker/index.ts','utf8')
assert(route.includes('scanStocktakeBarcode(env.DB, sessionId, input.code, input.requestId, actor)'))
assert(scanner.includes("requestId: crypto.randomUUID()") && scanner.includes('onKeyDown={event =>') &&
  scanner.includes('event.key === \'Enter\'') && scanner.includes('event.key === \'Tab\''))
assert(scanner.includes('gateRef.current.detected(found, now)') && scanner.includes('processRef.current(found, \'camera\')'))
assert(scanner.includes('onScannedRef.current(result)') && scanner.includes("while (queueRef.current.length"),
  'Continuous camera and USB must process without leaving the scan screen')
assert(!scanner.includes('onSkuFound(') && !scanner.includes("setCameraOpen(false)\n    setBusy"),
  'A successful camera scan cannot close camera or jump to a product')
assert(panel.includes('onScanned={onStocktakeBarcodeScan}') && !panel.includes('onSkuFound={'),
  'Single server-authoritative scan path, no jump to individual card')
assert(section.includes('setStocktakeFacts((current) => ({ ...current, [String(itemId)]: String(counted) }))') &&
  section.includes('stocktakeLastPersistedValues.current.set(itemId, String(counted))'))
assert(panel.includes('onChange={(value) => setStocktakeFact(Number(row.id), value)}'),
  'Manual total always stays editable, including after a scan')
console.log('STOCKTAKE_FAST_SCAN_PASS: same shared SKU +1 each event, retry idempotent, SQLite trigger, editable manual overrides, continuous camera USB gate, no stock writes')
sql.close()
