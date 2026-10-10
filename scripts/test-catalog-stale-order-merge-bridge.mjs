import assert from 'node:assert/strict'
import fs from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { resolveConsolidatedOrderWriteVariant } from '../worker/domains/catalog-merged-identity.ts'

const sql=new DatabaseSync(':memory:')
sql.exec(`
PRAGMA foreign_keys=ON;
CREATE TABLE catalog_products (id INTEGER PRIMARY KEY,name TEXT);
CREATE TABLE catalog_variants (id INTEGER PRIMARY KEY,product_id INTEGER,is_active INTEGER);
CREATE TABLE orders (id INTEGER PRIMARY KEY,order_status TEXT,shipping_status TEXT);
CREATE TABLE order_items (id INTEGER PRIMARY KEY,order_id INTEGER,variant_id INTEGER,quantity INTEGER);
CREATE TABLE inventory_reservations (id INTEGER PRIMARY KEY,variant_id INTEGER,status TEXT);
INSERT INTO catalog_products VALUES(100,'ШАПАН'),(200,'ЖИЛЕТ');
INSERT INTO catalog_variants VALUES (7,100,0),(8,100,1),(9,100,0),(10,100,0),(11,100,0),(12,200,1);
INSERT INTO orders VALUES(1,'active','sent'),(20,'active','not_sent');
INSERT INTO order_items VALUES(1,1,7,1);
`)
sql.exec(fs.readFileSync('migrations/0090_v72_catalog_variant_consolidations.sql','utf8'))
sql.exec(`
INSERT INTO catalog_variant_consolidations
 (source_variant_id,target_variant_id,product_id,created_at)
 VALUES(7,8,100,'2026-10-10T10:00:00Z'),
       (10,11,100,'2026-10-10T11:00:00Z'),
       (11,10,100,'2026-10-10T11:00:00Z');
`)
sql.exec(fs.readFileSync('migrations/0099_v72_catalog_merge_generation_events.sql','utf8'))
sql.exec(fs.readFileSync('migrations/0097_v72_consolidated_sku_active_order_guard.sql','utf8'))
const db={prepare(statement){return {bind(...args){return {
 async first(){return sql.prepare(statement).get(...args)||null},
}},}}}
assert.deepEqual(await resolveConsolidatedOrderWriteVariant(db,100,8),
 {productId:100,variantId:8,redirected:false})
assert.deepEqual(await resolveConsolidatedOrderWriteVariant(db,100,7),
 {productId:100,variantId:8,redirected:true,originalVariantId:7})
assert.deepEqual(await resolveConsolidatedOrderWriteVariant(db,null,null),
 {productId:null,variantId:null,redirected:false})
await assert.rejects(()=>resolveConsolidatedOrderWriteVariant(db,100,9),/безопасного объединения нет/)
await assert.rejects(()=>resolveConsolidatedOrderWriteVariant(db,200,7),/не совпадает/)
await assert.rejects(()=>resolveConsolidatedOrderWriteVariant(db,100,10),/циклическая/)
await assert.rejects(()=>resolveConsolidatedOrderWriteVariant(db,100,-1),/неверную ссылку/)
// Working order is accepted with the keeper; historical order still points to source.
const resolved=await resolveConsolidatedOrderWriteVariant(db,100,7)
sql.prepare('INSERT INTO order_items(id,order_id,variant_id,quantity) VALUES(?,?,?,?)')
 .run(20,20,resolved.variantId,1)
assert.equal(sql.prepare('SELECT variant_id FROM order_items WHERE id=20').get().variant_id,8)
assert.equal(sql.prepare('SELECT variant_id FROM order_items WHERE id=1').get().variant_id,7)
// A browser whose merge is committed after the last read gets a retry error,
// never a new active order item attached to the retired SKU.
assert.throws(()=>sql.exec('INSERT INTO order_items VALUES(21,20,7,1)'),/объединён/)
assert.throws(()=>sql.exec('UPDATE order_items SET variant_id=7 WHERE id=20'),/объединён/)
assert.throws(()=>sql.exec("INSERT INTO inventory_reservations VALUES (1,7,'active')"),/объединён/)
sql.exec("INSERT INTO inventory_reservations VALUES (2,8,'active')")
sql.exec("INSERT INTO inventory_reservations VALUES (3,7,'released')")
assert.throws(()=>sql.exec("UPDATE inventory_reservations SET status='active' WHERE id=3"),/объединён/)
assert.throws(()=>sql.exec("UPDATE orders SET shipping_status='not_sent' WHERE id=1"),/исторический/)
assert.equal(sql.prepare('SELECT shipping_status FROM orders WHERE id=1').get().shipping_status,'sent')
sql.exec("INSERT INTO orders VALUES(3,'active','sent'); INSERT INTO order_items VALUES(3,3,7,1)")
assert.equal(sql.prepare('SELECT variant_id FROM order_items WHERE id=3').get().variant_id,7,
 'Already sent historical rows remain untouched')
// Once a compensated undo exists, the old root must no longer send a draft to the wrong keeper.
sql.exec("INSERT INTO catalog_variants VALUES(13,100,1)")
sql.prepare(`INSERT INTO catalog_variant_merge_generation_events
 (root_consolidation_id,source_variant_id,target_variant_id,generation,
  event_kind,reason,created_by,created_at) VALUES (?,?,?,?,?,?,?,?)`)
 .run(1,7,8,2,'undo','Проверено при обратной складской операции','admin','2026-10-10T12:00:00Z')
sql.exec('UPDATE catalog_variants SET is_active=1 WHERE id=7')
assert.deepEqual(await resolveConsolidatedOrderWriteVariant(db,100,7),
 {productId:100,variantId:7,redirected:false},
 'An actually restored SKU must no longer redirect to obsolete generation 1')
sql.exec('UPDATE catalog_variants SET is_active=0 WHERE id=7')
sql.prepare(`INSERT INTO catalog_variant_merge_generation_events
 (root_consolidation_id,source_variant_id,target_variant_id,generation,
  event_kind,reason,created_by,created_at) VALUES (?,?,?,?,?,?,?,?)`)
 .run(1,7,13,3,'merge','Повторное подтверждённое объединение товаров','admin','2026-10-10T12:10:00Z')
assert.deepEqual(await resolveConsolidatedOrderWriteVariant(db,100,7),
 {productId:100,variantId:13,redirected:true,originalVariantId:7},
 'A stale order/arrival should always use latest effective keeper, not the original root')
assert.equal(sql.prepare('SELECT variant_id FROM order_items WHERE id=1').get().variant_id,7,
 'Existing shipped history stays linked to the original source SKU')
const worker=fs.readFileSync('worker/domains/orders-write.ts','utf8')
assert.match(worker,/resolveConsolidatedOrderWriteVariant\(db, initiallyResolved.productId, initiallyResolved.variantId\)/)
const entry=fs.readFileSync('worker/index.ts','utf8')
assert.match(entry,/stock_reconciliation_requires_atomic_finalization/)
assert.doesNotMatch(entry,/return json\(await applyCatalogStockReconciliation\(/)
assert.equal(sql.prepare('SELECT is_active FROM catalog_variants WHERE id=8').get().is_active,1)
console.log('STALE ORDER SKU MERGE BRIDGE PASSED — audited redirect, active insert/reserve gate, shipped history, loop/cross-product rejection, no long locks')
