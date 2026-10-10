import assert from 'node:assert/strict'
import fs from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { previewCatalogConsolidationUndo } from '../worker/domains/catalog-consolidation-undo-preview.ts'
import { undoUnusedCatalogConsolidation } from '../worker/domains/catalog-zero-stock-undo.ts'
import { previewZeroStockReMerge, reMergeZeroStockCatalogVariant } from '../worker/domains/catalog-zero-stock-remerge.ts'

const sqlite = new DatabaseSync(':memory:')
sqlite.exec(`
 PRAGMA foreign_keys=ON;
 CREATE TABLE catalog_products(id INTEGER PRIMARY KEY,name TEXT,is_active INTEGER,external_id TEXT);
 CREATE TABLE catalog_stock_positions(id INTEGER PRIMARY KEY,product_id INTEGER,material TEXT,length TEXT,is_active INTEGER);
 CREATE TABLE catalog_variants(
   id INTEGER PRIMARY KEY,product_id INTEGER,stock_position_id INTEGER,
   category TEXT,gender TEXT,color TEXT,size_label TEXT,material TEXT,length TEXT,
   is_active INTEGER,updated_at TEXT,external_id TEXT
 );
 CREATE TABLE inventory_stock(
   id INTEGER PRIMARY KEY, variant_id INTEGER, inventory_source TEXT NOT NULL DEFAULT 'warehouse',
   product_id INTEGER,product_name_snapshot TEXT,gender_snapshot TEXT,color_snapshot TEXT,
   material_snapshot TEXT,length_snapshot TEXT,size_snapshot TEXT,
   quantity INTEGER,reserved_quantity INTEGER,
   last_action TEXT,last_source_ref TEXT, created_at TEXT,updated_at TEXT,
   external_product_id TEXT,external_variant_id TEXT
 );
 CREATE UNIQUE INDEX idx_inventory_stock_variant_unique ON inventory_stock(inventory_source,variant_id) WHERE variant_id IS NOT NULL;
 CREATE TABLE inventory_transfer_documents(id INTEGER PRIMARY KEY,status TEXT);
 CREATE TABLE inventory_transfer_items(id INTEGER PRIMARY KEY,transfer_id INTEGER,variant_id INTEGER);
 CREATE TABLE inventory_movements(
 id INTEGER PRIMARY KEY,inventory_source TEXT,movement_type TEXT,product_id INTEGER,variant_id INTEGER,
 product_name_snapshot TEXT,gender_snapshot TEXT,color_snapshot TEXT,
 material_snapshot TEXT,length_snapshot TEXT,size_snapshot TEXT,
 quantity_delta INTEGER,quantity_after INTEGER,reference_type TEXT,
 reference_id TEXT,comment TEXT,created_at TEXT);
 CREATE TABLE inventory_movement_reversals(original_movement_id INTEGER PRIMARY KEY);
 CREATE TABLE inventory_stock_checks(
  id INTEGER PRIMARY KEY,variant_id INTEGER,inventory_source TEXT,
  counted_quantity INTEGER,checked_at TEXT,check_type TEXT,checked_by TEXT
 );
 CREATE TABLE inventory_reservations(
    id INTEGER PRIMARY KEY,order_id INTEGER,order_item_id INTEGER,
    inventory_source TEXT,product_id INTEGER,variant_id INTEGER,quantity INTEGER,
    status TEXT,updated_at TEXT);
 CREATE TABLE return_items(id INTEGER PRIMARY KEY,order_item_id INTEGER);
 CREATE TABLE exchanges(id INTEGER PRIMARY KEY,old_order_item_id INTEGER,new_order_item_id INTEGER);
 CREATE TABLE exchange_items(id INTEGER PRIMARY KEY,order_item_id INTEGER);
 CREATE TABLE orders(id INTEGER PRIMARY KEY,order_status TEXT,shipping_status TEXT,order_date TEXT NOT NULL DEFAULT (date('now','+5 hours')), updated_at TEXT NOT NULL DEFAULT '2026-10-09 07:00:00');
 CREATE TABLE order_items(
   id INTEGER PRIMARY KEY,order_id INTEGER,variant_id INTEGER,product_id INTEGER,
   quantity INTEGER,is_workshop INTEGER DEFAULT 0, source_type TEXT DEFAULT 'warehouse',
   stock_writeoff_status TEXT DEFAULT 'reserved',product_name_snapshot TEXT DEFAULT 'Снимок товара',
   unit_price INTEGER DEFAULT 1000,created_at TEXT NOT NULL DEFAULT '2026-10-09 07:00:00');
 CREATE TABLE workshop_tasks(id INTEGER PRIMARY KEY,variant_id INTEGER,status TEXT);
 CREATE TABLE inventory_lifecycle_events(id INTEGER PRIMARY KEY,variant_id INTEGER,status TEXT);
 CREATE TABLE inventory_stocktake_sessions(id TEXT PRIMARY KEY,status TEXT);
 CREATE TABLE inventory_stocktake_items(id INTEGER PRIMARY KEY,session_id TEXT,variant_id INTEGER);
 INSERT INTO catalog_products(id,name,is_active) VALUES(100,'ЭТНО КАРДИГАН',1);
 INSERT INTO catalog_stock_positions VALUES(30,100,'ДРАП','СТАНДАРТ',1),(31,100,'ШЕРСТЬ','СТАНДАРТ',1);
 INSERT INTO catalog_variants(id,product_id,stock_position_id,category,gender,color,size_label,material,length,is_active,updated_at) VALUES
  (7,100,30,'adult','ЖЕН','СВЕТЛО-СЕРЫЙ','52','ДРАП','СТАНДАРТ',1,'before'),
  (8,100,30,'adult','ЖЕН','СВЕТЛО СЕРЫЙ','52','ДРАП','СТАНДАРТ',1,'before'),
  (9,100,31,'adult','ЖЕН','СВЕТЛО СЕРЫЙ','52','ШЕРСТЬ','СТАНДАРТ',1,'before'),
  (10,100,30,'adult','ЖЕН','СВЕТЛО СЕРЫЙ','54','ДРАП','СТАНДАРТ',1,'before');
 INSERT INTO inventory_stock(id,variant_id,quantity,reserved_quantity) VALUES (10,7,0,0),(11,8,2,0);
 INSERT INTO orders(id,order_status,shipping_status) VALUES(1,'active','sent');
 INSERT INTO order_items(id,order_id,variant_id,quantity) VALUES(21,1,7,1);
`)
sqlite.exec(fs.readFileSync('migrations/0090_v72_catalog_variant_consolidations.sql','utf8'))
sqlite.exec(fs.readFileSync('migrations/0091_v72_catalog_variant_stock_consolidation.sql','utf8'))
sqlite.exec(fs.readFileSync('migrations/0092_v72_catalog_variant_reservation_consolidation.sql','utf8'))
sqlite.exec(fs.readFileSync('migrations/0096_v72_catalog_atomic_stock_finalization.sql','utf8'))
sqlite.exec(fs.readFileSync('migrations/0099_v72_catalog_merge_generation_events.sql','utf8'))
sqlite.exec(fs.readFileSync('migrations/0100_v72_catalog_zero_stock_undo_validation.sql','utf8'))
sqlite.exec(fs.readFileSync('migrations/0101_v72_catalog_zero_stock_remerge_validation.sql','utf8'))


let beforeBatch=null
let onStatement=null
const db={
 prepare(sql){return {bind(...params){return {
   async first(){return sqlite.prepare(sql).get(...params)||null},
   async all(){return {results:sqlite.prepare(sql).all(...params)}},
   async run(){const m=sqlite.prepare(sql).run(...params);return {meta:{changes:m.changes}}},
 }}}},
 async batch(statements){
   if(beforeBatch){const once=beforeBatch;beforeBatch=null;once()}
   sqlite.exec('BEGIN IMMEDIATE')
   try{
     const results=[]
     for(let i=0;i<statements.length;i++){
       if(onStatement)onStatement(i)
       results.push(await statements[i].run())
     }
     sqlite.exec('COMMIT')
     return results
   }catch(e){sqlite.exec('ROLLBACK');throw e}
 },
}
const stamp='2026-10-10T07:00:00Z'
sqlite.exec(`
 UPDATE catalog_variants SET is_active=0,updated_at='2026-10-10T07:00:00Z' WHERE id=7;
 UPDATE inventory_stock SET quantity=0,reserved_quantity=0,
  last_source_ref='catalog-consolidation:7->8',updated_at='2026-10-10T07:00:00Z' WHERE id=10;
 INSERT INTO catalog_variant_consolidations(
 id,source_variant_id,target_variant_id,product_id,source_color,target_color,
 material,length,category,gender,size_label,source_physical_quantity,source_reserved_quantity,
 created_by,created_at)
 VALUES(1,7,8,100,'СВЕТЛО-СЕРЫЙ','СВЕТЛО СЕРЫЙ','ДРАП','СТАНДАРТ',
 'adult','ЖЕН','52',0,0,'admin','2026-10-10T07:00:00Z');
 INSERT INTO catalog_variant_consolidation_stock_rows
 (consolidation_id,inventory_source,source_stock_id,target_stock_id_before,
 source_quantity_before,target_quantity_before,target_reserved_before,
 combined_quantity_after,source_reserved_before)
 VALUES(1,'warehouse',10,11,0,2,0,2,0);
 INSERT INTO catalog_variant_consolidation_stock_decisions
 (consolidation_id,inventory_source,source_stock_id,keeper_stock_id_before,
 decision_method,source_quantity_before,keeper_quantity_before,final_quantity,
 adjustment_quantity,reason,created_by,created_at)
 VALUES(1,'warehouse',10,11,'sum',0,2,2,0,'','admin','2026-10-10T07:00:00Z');
 INSERT INTO catalog_variant_consolidation_validations VALUES(1,1,'2026-10-10T07:00:00Z');
 INSERT INTO catalog_variant_consolidation_reservation_validations VALUES(1,1,'2026-10-10T07:00:00Z');
`)

const check=()=>previewCatalogConsolidationUndo(db,1)
const reason='Подтверждено отсутствие остатков и складских обязательств'
const sku=(id)=>sqlite.prepare('SELECT is_active FROM catalog_variants WHERE id=?').get(id).is_active
const cnt=(table)=>sqlite.prepare('SELECT COUNT(*) AS n FROM '+table).get().n
const baseline=await check()
assert.equal(baseline.canUndoZeroStockIdentity,true,JSON.stringify(baseline.blockers))
assert.equal(baseline.zeroStockIdentityEligible,true)
assert.equal(baseline.locations[0].before.source,0)
await assert.rejects(()=>undoUnusedCatalogConsolidation(db,1,'admin','коротко',baseline.undoStateToken),/причину/)
await assert.rejects(()=>undoUnusedCatalogConsolidation(db,1,'admin',reason,'stale'),/Обновите проверку/)
assert.equal(sku(7),0)
assert.equal(cnt('catalog_variant_merge_generation_events'),0)
const result=await undoUnusedCatalogConsolidation(db,1,'admin',reason,baseline.undoStateToken)
assert.equal(result.undone,true)
assert.equal(result.generation,2)
assert.equal(result.restoredPhysicalQuantity,0)
assert.equal(sku(7),1)
assert.equal(sku(8),1)
assert.equal(cnt('catalog_variant_merge_generation_events'),1)
assert.equal(cnt('catalog_variant_zero_stock_undo_validations'),1)
assert.equal(sqlite.prepare('SELECT quantity FROM inventory_stock WHERE id=10').get().quantity,0)
assert.equal(sqlite.prepare('SELECT quantity FROM inventory_stock WHERE id=11').get().quantity,2)
assert.equal(sqlite.prepare('SELECT variant_id FROM order_items WHERE id=21').get().variant_id,7)
assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM catalog_variant_effective_merge_lineage WHERE source_variant_id=7').get().n,0)
assert.equal(sqlite.prepare('SELECT event_kind FROM catalog_variant_merge_generation_events').get().event_kind,'undo')
// Same token cannot accidentally apply again.
await assert.rejects(()=>undoUnusedCatalogConsolidation(db,1,'admin',reason,baseline.undoStateToken),/Нельзя автоматически/)
assert.equal(cnt('catalog_variant_merge_generation_events'),1)

// Reset the fixture to a merged source for testing raced writes, leaving the
// original event in place as immutable evidence, but use a second fresh receipt.
sqlite.exec(`
 INSERT INTO catalog_variants(id,product_id,stock_position_id,category,gender,color,size_label,
 material,length,is_active,updated_at) VALUES
 (17,100,30,'adult','ЖЕН','ПЕПЕЛЬНЫЙ','50','ДРАП','СТАНДАРТ',0,'before'),
 (18,100,30,'adult','ЖЕН','ПЕПЕЛЬНЫЙ','50','ДРАП','СТАНДАРТ',1,'before');
 INSERT INTO inventory_stock(id,variant_id,quantity,reserved_quantity,inventory_source,last_source_ref)
 VALUES (117,17,0,0,'warehouse','catalog-consolidation:17->18'),
        (118,18,3,0,'warehouse',NULL);
 INSERT INTO catalog_variant_consolidations(
 id,source_variant_id,target_variant_id,product_id,source_physical_quantity,source_reserved_quantity,
 created_by,created_at)
 VALUES (2,17,18,100,0,0,'admin','2026-10-10T07:00:00Z');
 INSERT INTO catalog_variant_consolidation_stock_rows (
 consolidation_id,inventory_source,source_stock_id,target_stock_id_before,source_quantity_before,
 target_quantity_before,target_reserved_before,combined_quantity_after,source_reserved_before)
 VALUES (2,'warehouse',117,118,0,3,0,3,0);
 INSERT INTO catalog_variant_consolidation_stock_decisions (
 consolidation_id,inventory_source,source_stock_id,keeper_stock_id_before,decision_method,
 source_quantity_before,keeper_quantity_before,final_quantity,adjustment_quantity,
 reason,created_by,created_at)
 VALUES(2,'warehouse',117,118,'sum',0,3,3,0,'','admin','2026-10-10T07:00:00Z');
 INSERT INTO catalog_variant_consolidation_validations VALUES(2,1,'2026-10-10T07:00:00Z');
 INSERT INTO catalog_variant_consolidation_reservation_validations VALUES(2,1,'2026-10-10T07:00:00Z');
`)
const p2=await previewCatalogConsolidationUndo(db,2)
assert.equal(p2.canUndoZeroStockIdentity,true,JSON.stringify(p2.blockers))
// Concurrent live order wins: stale administrative undo must not restore SKU.
beforeBatch=()=>sqlite.exec(`
 INSERT INTO orders(id,order_status,shipping_status,updated_at)
 VALUES(99,'active','sent','2026-10-10 08:00:00');
 INSERT INTO order_items(id,order_id,variant_id,quantity,created_at)
 VALUES(99,99,18,1,'2026-10-10 08:00:00');
`)
await assert.rejects(()=>undoUnusedCatalogConsolidation(db,2,'admin',reason,p2.undoStateToken),/Условия|устарели/)
assert.equal(sku(17),0)
assert.equal(cnt('catalog_variant_merge_generation_events'),1)
sqlite.exec('DELETE FROM order_items WHERE id=99; DELETE FROM orders WHERE id=99')
// Failed final proof must rollback the journal and attempted source activation.
const p3=await previewCatalogConsolidationUndo(db,2)
assert.equal(p3.canUndoZeroStockIdentity,true)
onStatement=(i)=>{if(i===1){onStatement=null;sqlite.exec("UPDATE catalog_variants SET updated_at='changed' WHERE id=17")}}
await assert.rejects(()=>undoUnusedCatalogConsolidation(db,2,'admin',reason,p3.undoStateToken),/Отмена не применена/)
assert.equal(sku(17),0)
assert.equal(sqlite.prepare('SELECT updated_at FROM catalog_variants WHERE id=17').get().updated_at,'before')
assert.equal(cnt('catalog_variant_merge_generation_events'),1)
assert.equal(cnt('catalog_variant_zero_stock_undo_validations'),1)
// A previously nonzero source must not be silently reconstructed even if the
// two stock rows now happen to resemble the zero source fixture.
sqlite.exec("UPDATE catalog_variant_consolidation_stock_rows SET source_quantity_before=2 WHERE consolidation_id=2")
const unsafe=await previewCatalogConsolidationUndo(db,2)
assert.equal(unsafe.canUndoZeroStockIdentity,false)
assert.ok(unsafe.blockers.some(x=>x.code==='physical_undo_requires_accounting'))
await assert.rejects(()=>undoUnusedCatalogConsolidation(db,2,'admin',reason,unsafe.undoStateToken),/Нельзя автоматически/)
// Generation 3: after confirmed zero-stock undo, restore an immutable
// source->NEW keeper mapping without touching stock, shipped history or money.
sqlite.exec(`
 INSERT INTO catalog_variants(id,product_id,stock_position_id,category,gender,color,
   size_label,material,length,is_active,updated_at)
 SELECT 99,product_id,stock_position_id,category,gender,color,
   size_label,material,length,1,'new-keeper'
 FROM catalog_variants WHERE id=8;
 INSERT INTO inventory_stock(id,variant_id,inventory_source,quantity,reserved_quantity,
   updated_at,last_source_ref) VALUES(199,99,'warehouse',6,0,'new-keeper',NULL);
`)
await assert.rejects(()=>previewZeroStockReMerge(db,7,9),/отличаются/,'Different materials must remain separate SKUs')
sqlite.exec('UPDATE inventory_stock SET quantity=1 WHERE id=10')
const unsafePositive=await previewZeroStockReMerge(db,7,99)
assert.equal(unsafePositive.canReMerge,false,'Positive source stock cannot be remerged by zero-stock writer')
sqlite.exec('UPDATE inventory_stock SET quantity=0 WHERE id=10')
const recheck=await previewZeroStockReMerge(db,7,99)
assert.equal(recheck.canReMerge,true,JSON.stringify(recheck.blockers))
await assert.rejects(()=>reMergeZeroStockCatalogVariant(db,7,99,'admin',reason,'stale'),/изменились/)
// Execution metadata must be locked to the confirmed preview even if a
// concurrent administrator edits the shared catalog position.
beforeBatch=()=>sqlite.exec("UPDATE catalog_stock_positions SET material='ПРОВЕРКА ГОНКИ' WHERE id=30")
await assert.rejects(
 ()=>reMergeZeroStockCatalogVariant(db,7,99,'admin',reason,recheck.stateToken),
 /не применено|изменились/
)
assert.equal(sku(7),1)
assert.equal(cnt('catalog_variant_merge_generation_events'),1)
sqlite.exec("UPDATE catalog_stock_positions SET material='ДРАП' WHERE id=30")
const stockBeforeRemerge=JSON.stringify(sqlite.prepare('SELECT id,variant_id,quantity,reserved_quantity FROM inventory_stock ORDER BY id').all())
beforeBatch=()=>{
  const later=new Date(Date.now()+60000).toISOString()
  sqlite.prepare("INSERT INTO orders(id,order_status,shipping_status,updated_at) VALUES(901,'active','sent',?)").run(later)
  sqlite.prepare('INSERT INTO order_items(id,order_id,variant_id,quantity,created_at) VALUES(901,901,7,1,?)').run(later)
}
await assert.rejects(
 ()=>reMergeZeroStockCatalogVariant(db,7,99,'admin',reason,recheck.stateToken),
 /не применено|изменились/,
 'Concurrent customer order must win over stale administration'
)
assert.equal(sku(7),1)
assert.equal(cnt('catalog_variant_merge_generation_events'),1)
assert.equal(sqlite.prepare('SELECT variant_id FROM order_items WHERE id=901').get().variant_id,7)
sqlite.exec('DELETE FROM order_items WHERE id=901; DELETE FROM orders WHERE id=901')
const previewReMerge=await previewZeroStockReMerge(db,7,99)
assert.equal(previewReMerge.canReMerge,true,JSON.stringify(previewReMerge.blockers))
const reMerged=await reMergeZeroStockCatalogVariant(db,7,99,'admin',reason,previewReMerge.stateToken)
assert.equal(reMerged.reMerged,true)
assert.equal(reMerged.generation,3)
assert.equal(reMerged.physicalDelta,0)
assert.equal(sku(7),0)
assert.equal(cnt('catalog_variant_merge_generation_events'),2)
assert.equal(cnt('catalog_variant_zero_stock_remerge_validations'),1)
assert.equal(JSON.stringify(sqlite.prepare('SELECT id,variant_id,quantity,reserved_quantity FROM inventory_stock ORDER BY id').all()),stockBeforeRemerge)
assert.equal(sqlite.prepare('SELECT target_variant_id FROM catalog_variant_effective_merge_lineage WHERE source_variant_id=7').get().target_variant_id,99)
assert.equal(sqlite.prepare('SELECT target_variant_id FROM catalog_variant_consolidations WHERE id=1').get().target_variant_id,8)
assert.equal(sqlite.prepare('SELECT variant_id FROM order_items WHERE id=21').get().variant_id,7)
await assert.rejects(
 ()=>reMergeZeroStockCatalogVariant(db,7,99,'admin',reason,previewReMerge.stateToken),
 /недоступно|подтверждённой отмены|не имеет/,
 'A replay must never duplicate generation 3'
)
assert.equal(cnt('catalog_variant_merge_generation_events'),2)

const api=fs.readFileSync('worker/index.ts','utf8')
assert.ok(api.includes('/api/catalog/variants/consolidation-undo-zero-stock'))
assert.ok(api.includes('requireAdminUser(authUser'))
console.log('ZERO-STOCK UNDO + GENERATION-3 RE-MERGE PASSED — atomic generation + activation, zero inventory delta, shipped history, order race, stale state, proof rollback, nonzero stock rejected')
