import assert from 'node:assert/strict'
import fs from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { resolveConsolidatedOrderWriteVariant } from '../worker/domains/catalog-merged-identity.ts'

const sqlite=new DatabaseSync(':memory:')
sqlite.exec(`
PRAGMA foreign_keys=ON;
CREATE TABLE catalog_products(id INTEGER PRIMARY KEY,name TEXT);
CREATE TABLE catalog_variants(id INTEGER PRIMARY KEY,product_id INTEGER,is_active INTEGER);
CREATE TABLE inventory_stock(
 id INTEGER PRIMARY KEY,variant_id INTEGER,inventory_source TEXT,quantity INTEGER,reserved_quantity INTEGER
);
INSERT INTO catalog_products VALUES(100,'ШАПАН'),(200,'ЖИЛЕТ');
INSERT INTO catalog_variants VALUES(7,100,0),(8,100,1),(9,100,1),(10,200,0);
INSERT INTO inventory_stock VALUES(1,7,'warehouse',0,0),(2,8,'warehouse',5,0),
 (3,9,'warehouse',2,0),(4,10,'boutique',2,0);
`)
sqlite.exec(fs.readFileSync('migrations/0090_v72_catalog_variant_consolidations.sql','utf8'))
sqlite.exec(`
INSERT INTO catalog_variant_consolidations(source_variant_id,target_variant_id,product_id,created_at)
VALUES(7,8,100,'2026-10-10T12:00:00Z');
`)
sqlite.exec(fs.readFileSync('migrations/0098_v72_consolidated_sku_stock_guard.sql','utf8'))
const db={prepare(text){return{bind(...values){return{async first(){return sqlite.prepare(text).get(...values)||null}}}}}}
const mapped=await resolveConsolidatedOrderWriteVariant(db,100,7)
assert.equal(mapped.variantId,8)
assert.equal(mapped.redirected,true)
assert.equal(sqlite.prepare('SELECT quantity FROM inventory_stock WHERE variant_id=8').get().quantity,5)
sqlite.exec('UPDATE inventory_stock SET quantity=6 WHERE variant_id=8')
sqlite.exec("INSERT INTO inventory_stock VALUES(5,8,'boutique',1,0)")
// No long lock on either active SKU — normal arrivals keep moving.
sqlite.exec('UPDATE inventory_stock SET quantity=3 WHERE variant_id=9')
assert.throws(()=>sqlite.exec('UPDATE inventory_stock SET quantity=1 WHERE variant_id=7'),/объединённого варианта/)
assert.throws(()=>sqlite.exec("INSERT INTO inventory_stock VALUES(6,7,'boutique',3,0)"),/объединён/)
assert.throws(()=>sqlite.exec('UPDATE inventory_stock SET variant_id=7 WHERE id=3'),/объединённому/)
assert.equal(sqlite.prepare('SELECT quantity FROM inventory_stock WHERE variant_id=7').get().quantity,0)
assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM inventory_stock WHERE variant_id=7').get().n,1)
// A distinct retired product with NO merge remains handled by the existing
// explicit Arrival recovery; these triggers must not interfere with it.
sqlite.exec('UPDATE inventory_stock SET quantity=4 WHERE variant_id=10')
assert.equal(sqlite.prepare('SELECT quantity FROM inventory_stock WHERE variant_id=10').get().quantity,4)
const source=fs.readFileSync('worker/domains/inventory-movement.ts','utf8')
const canonicalStart=source.indexOf('const canonicalById = new Map<number, InventoryResolvedItem>()')
const mapPos=source.indexOf('canonicalById.set(oldId',canonicalStart)
const pickerPos=source.indexOf('const canonical = canonicalById.get(raw.variantId)',canonicalStart)
assert.ok(canonicalStart>=0&&mapPos>canonicalStart&&pickerPos>mapPos,
 'Receipt-only canonicalization of stale SKU must run before arrival item selection')
assert.match(source,/resolveConsolidatedOrderWriteVariant\(db,stale.productId,oldId\)/)
assert.match(source,/c\.source_variant_id IN \(SELECT CAST\(value AS INTEGER\) FROM json_each\(\?\)\)/)
assert.match(source,/if \(!stale\?\.productActive \|\| !stale\.productId\) continue/)
assert.ok(source.includes("code: 'arrival_stale_variant'"),
 'Non-merged stale arrival still uses explicit recovery')
console.log('MERGED SKU ARRIVAL SAFETY PASSED — audited keeper selection, zero duplicate materialization, live active stock writes, stale stock blocked, historic recovery')
