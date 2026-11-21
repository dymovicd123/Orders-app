import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {readFileSync} from 'node:fs'
import {skuBarcodeForVariantId} from '../shared/barcode-sku.ts'
import {scanStocktakeSku} from '../worker/domains/stocktake-barcode-scan.ts'
import {serializeInventoryStocktakeSession} from '../worker/domains/inventory-stocktake.ts'

const sql=new DatabaseSync(':memory:')
sql.exec('PRAGMA foreign_keys=ON')
sql.exec(`
CREATE TABLE catalog_products(id INTEGER PRIMARY KEY,name TEXT,is_active INTEGER NOT NULL);
CREATE TABLE catalog_stock_positions(id INTEGER PRIMARY KEY,product_id INTEGER,is_active INTEGER NOT NULL);
CREATE TABLE catalog_variants(id INTEGER PRIMARY KEY,product_id INTEGER,stock_position_id INTEGER,
 category TEXT,gender TEXT,color TEXT,material TEXT,length TEXT,size_label TEXT,is_active INTEGER NOT NULL);
CREATE TABLE inventory_stock(id INTEGER PRIMARY KEY,variant_id INTEGER,inventory_source TEXT,
 quantity INTEGER NOT NULL,reserved_quantity INTEGER NOT NULL DEFAULT 0);
INSERT INTO catalog_products VALUES(1,'ШАПАН',1);
INSERT INTO catalog_stock_positions VALUES(10,1,1);
INSERT INTO catalog_variants VALUES
 (101,1,10,'adult','ЖЕН','СИНИЙ','ШЕЛК','СТАНДАРТ','M',1),
 (102,1,10,'adult','ЖЕН','КРАСНЫЙ','ШЕЛК','СТАНДАРТ','M',1),
 (103,1,10,'adult','ЖЕН','ЗЕЛЁНЫЙ','ШЕЛК','СТАНДАРТ','S',1),
 (104,1,10,'adult','ЖЕН','ЧЁРНЫЙ','ШЕЛК','СТАНДАРТ','L',0);
INSERT INTO inventory_stock VALUES
 (1,101,'warehouse',3,1),(2,102,'boutique',2,0);
`)
for(const path of [
 'migrations/0049_v72_inventory_stocktake_sessions.sql',
 'migrations/0136_barcode_physical_units_foundation.sql',
 'migrations/0137_barcode_unit_catalog_integrity.sql',
 'migrations/0138_barcode_unit_preparation_capacity.sql',
 'migrations/0140_barcode_stocktake_unit_scans.sql',
 'migrations/0142_barcode_stocktake_sku_scans.sql',
])sql.exec(readFileSync(path,'utf8'))
sql.exec(`
INSERT INTO inventory_stocktake_sessions(id,inventory_source,status,created_by,started_at,updated_at)
VALUES('REV-S-P-20261121000000-ABCDEF12','warehouse','active','admin','now','now');
INSERT INTO inventory_stocktake_items
(id,session_id,inventory_source,stock_id,product_id,variant_id,
 product_name_snapshot,opening_quantity,opening_reserved_quantity,baseline_quantity,
 counted_quantity,status,created_at,updated_at)
VALUES(77,'REV-S-P-20261121000000-ABCDEF12','warehouse',1,1,101,
 'ШАПАН',3,1,3,0,'counted','now','now');
`)
const statement=(query,args)=>({
  async first(){return sql.prepare(query).get(...args)||null},
  async all(){return {results:sql.prepare(query).all(...args)}},
  async run(){const r=sql.prepare(query).run(...args);return {meta:{changes:Number(r.changes)}}}
})
const db={
  prepare(query){return {...statement(query,[]),bind(...args){return statement(query,args)}}},
  async batch(stmts){
    sql.exec('BEGIN IMMEDIATE')
    try{const out=[];for(const stmt of stmts)out.push(await stmt.run());sql.exec('COMMIT');return out}
    catch(error){sql.exec('ROLLBACK');throw error}
  }
}
const session='REV-S-P-20261121000000-ABCDEF12'
const requestId=n=>'99999999-9999-4999-8999-'+String(n).padStart(12,'0')
const count=variantId=>sql.prepare('SELECT COUNT(*) n FROM inventory_stocktake_items WHERE session_id=? AND variant_id=?').get(session,variantId).n
const stockBefore=sql.prepare('SELECT id,inventory_source,variant_id,quantity,reserved_quantity FROM inventory_stock ORDER BY id').all()

const newCode=skuBarcodeForVariantId(103)
const [fresh,replayed]=await Promise.all([
  scanStocktakeSku(db,session,newCode,requestId(1),'supervisor'),
  scanStocktakeSku(db,session,newCode,requestId(1),'supervisor'),
])
assert.equal([fresh,replayed].filter(x=>x.duplicate===false).length,1)
assert.equal(count(103),1,'One found SKU gets one review row')
const found=await serializeInventoryStocktakeSession(db,session)
assert.equal(found.scope,'selective','Existing selective review mode must not change')
const item=found.items.find(x=>x.variantId===103)
assert(item,'New active SKU must be present in same review')
assert.equal(item.openingQuantity,0)
assert.equal(item.baselineQuantity,0)
assert.equal(item.countedQuantity,1)
assert.equal(item.currentQuantity,0)
assert.equal(item.status,'counted')
assert.equal(fresh.addedItem?.id,item.id,'First scan must send new row to UI')
assert.equal(replayed.addedItem?.id,item.id,'Lost-response retry can reconcile the same row')
assert.equal(found.items.find(x=>x.variantId===101)?.countedQuantity,0,
 'Previously explicitly confirmed missing zero must not change')
assert.equal((await scanStocktakeSku(db,session,newCode,requestId(1),'supervisor')).duplicate,true)
assert.equal(count(103),1)
assert.equal(sql.prepare('SELECT counted_quantity n FROM inventory_stocktake_items WHERE id=?').get(item.id).n,1)

const otherSource=await scanStocktakeSku(db,session,skuBarcodeForVariantId(102),requestId(2),'supervisor')
assert.equal(otherSource.addedItem?.baselineQuantity,0,
 'Stock held only by the other location is not counted as this source opening stock')
assert.equal(otherSource.addedItem?.countedQuantity,1)
assert.equal(count(102),1)
assert.deepEqual(
 sql.prepare('SELECT id,inventory_source,variant_id,quantity,reserved_quantity FROM inventory_stock ORDER BY id').all(),
 stockBefore,'Scanning and auto-including variants must never transfer/write off real inventory')
await assert.rejects(
 scanStocktakeSku(db,session,skuBarcodeForVariantId(104),requestId(3),'supervisor'),
 /неактивен/)
assert.equal(count(104),0,'Retired SKU cannot create a review item')
await assert.rejects(
 scanStocktakeSku(db,session,skuBarcodeForVariantId(101),requestId(1),'supervisor'),
 /Идентификатор скана/)
assert.equal(found.items.find(x=>x.variantId===101)?.countedQuantity,0)
assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(),[])

const domain=readFileSync('worker/domains/stocktake-barcode-scan.ts','utf8')
const controller=readFileSync('src/features/sections/InventorySection.tsx','utf8')
const scanner=readFileSync('src/features/inventory/views/StocktakeBarcodeScanner.tsx','utf8')
assert(domain.includes('prepareNewStocktakeVariant')&&domain.includes('await db.batch(['))
assert(domain.includes("COUNT(*)")||domain.includes('baseline_quantity'))
assert(domain.includes('addedItem:item ? undefined : await newlyFoundStocktakeItem'))
assert(controller.includes('!exists && result.addedItem')&&
  controller.includes('setStocktakeFacts((current) => ({ ...current, [String(itemId)]: String(counted) }))'),
 'Only scanned position joins active UI; unverified/manual counts untouched')
assert(scanner.includes('if (result.addedItem) await onScannedRef.current(result)'),
 'Lost-response duplicate should sync the UI without counting twice')
console.log('STOCKTAKE_SCAN_AUTO_INCLUDE_PASS: selective review, missing live SKU+1, zero baseline, other-source isolation, immutable existing zero, lost-response, retired SKU, no inventory write')
sql.close()
