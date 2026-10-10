import assert from 'node:assert/strict'
import fs from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { previewCatalogConsolidationUndo } from '../worker/domains/catalog-consolidation-undo-preview.ts'
import { previewCorrectedCatalogConsolidationUndo } from '../worker/domains/catalog-corrected-undo-review.ts'
import { previewCountedCatalogUndo, undoCountedCatalogConsolidation } from '../worker/domains/catalog-counted-stock-undo.ts'
import { previewPositiveStockConsolidationUndo, undoPositiveStockCatalogConsolidation } from '../worker/domains/catalog-positive-stock-undo.ts'
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
sqlite.exec(fs.readFileSync('migrations/0102_v72_catalog_positive_stock_undo_validation.sql','utf8'))
sqlite.exec(fs.readFileSync('migrations/0103_v72_catalog_counted_undo_validation.sql','utf8'))


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


const stamp='2026-10-10T07:00:00Z',later='2026-10-10T08:00:00Z'
const reason='Подтверждена физическая сверка двух вариантов в обеих точках'
sqlite.exec(`
 UPDATE catalog_variants SET is_active=0,updated_at='2026-10-10T07:00:00Z' WHERE id=7;
 UPDATE inventory_stock SET quantity=0,reserved_quantity=0,
  last_source_ref='catalog-consolidation:7->8',updated_at='2026-10-10T07:00:00Z'
  WHERE id=10;
 UPDATE inventory_stock SET quantity=6,reserved_quantity=0,
  last_source_ref='catalog-consolidation:7->8',updated_at='2026-10-10T07:00:00Z'
  WHERE id=11;
 INSERT INTO inventory_stock(id,variant_id,inventory_source,quantity,reserved_quantity,updated_at,last_source_ref)
 VALUES(12,7,'boutique',0,0,'2026-10-10T07:00:00Z','catalog-consolidation:7->8'),
       (13,8,'boutique',3,0,'2026-10-10T07:00:00Z','catalog-consolidation:7->8');
 INSERT INTO catalog_variant_consolidations(id,source_variant_id,target_variant_id,product_id,
   source_physical_quantity,source_reserved_quantity,created_by,created_at)
 VALUES(1,7,8,100,6,0,'admin','2026-10-10T07:00:00Z');
 INSERT INTO catalog_variant_consolidation_stock_rows
  (consolidation_id,inventory_source,source_stock_id,target_stock_id_before,
   source_quantity_before,target_quantity_before,target_reserved_before,
   combined_quantity_after,source_reserved_before)
 VALUES(1,'warehouse',10,11,4,3,0,6,0),(1,'boutique',12,13,2,1,0,3,0);
 INSERT INTO catalog_variant_consolidation_stock_decisions
  (consolidation_id,inventory_source,source_stock_id,keeper_stock_id_before,
   decision_method,source_quantity_before,keeper_quantity_before,final_quantity,
   adjustment_quantity,reason,created_by,created_at)
 VALUES(1,'warehouse',10,11,'physical_count',4,3,6,-1,
      'Подтверждён пересчёт количества', 'admin','2026-10-10T07:00:00Z'),
       (1,'boutique',12,13,'sum',2,1,3,0,'','admin','2026-10-10T07:00:00Z');
 INSERT INTO catalog_variant_consolidation_validations VALUES(1,1,'2026-10-10T07:00:00Z');
 INSERT INTO catalog_variant_consolidation_reservation_validations VALUES(1,1,'2026-10-10T07:00:00Z');
 INSERT INTO inventory_movements(id,inventory_source,variant_id,quantity_delta,
  quantity_after,reference_type,reference_id,created_at)
 VALUES(111,'warehouse',8,-1,6,'catalog_stock_finalization','1','2026-10-10T07:00:00Z');
`)
const sku=id=>sqlite.prepare('SELECT is_active FROM catalog_variants WHERE id=?').get(id).is_active
const n=t=>sqlite.prepare('SELECT COUNT(*) AS n FROM '+t).get().n
const stocks=()=>sqlite.prepare('SELECT id,variant_id,inventory_source,quantity,reserved_quantity FROM inventory_stock ORDER BY id').all()
const originalOrders=JSON.stringify(sqlite.prepare('SELECT * FROM order_items ORDER BY id').all())
const originalMovement=JSON.stringify(sqlite.prepare('SELECT * FROM inventory_movements ORDER BY id').all())
const total=()=>sqlite.prepare('SELECT SUM(quantity) AS n FROM inventory_stock').get().n
const baseline=await previewCorrectedCatalogConsolidationUndo(db,1)
assert.equal(baseline.canPrepareCountedSplit,true,JSON.stringify(baseline.blockers))
assert.equal(total(),9)
const choices=[
 {location:'warehouse',sourceQuantity:2,keeperQuantity:4,physicallyVerified:true},
 {location:'boutique',sourceQuantity:2,keeperQuantity:1,physicallyVerified:true}
]
assert.equal((await previewCountedCatalogUndo(db,1,choices)).canUndoCounted,true)
assert.equal((await previewCountedCatalogUndo(db,1,choices.slice(0,1))).canUndoCounted,false)
assert.equal((await previewCountedCatalogUndo(db,1,[choices[0],choices[0]])).canUndoCounted,false)
assert.equal((await previewCountedCatalogUndo(db,1,[{...choices[0],keeperQuantity:9},choices[1]])).canUndoCounted,false)
assert.equal((await previewCountedCatalogUndo(db,1,[{...choices[0],sourceQuantity:2.5},choices[1]])).canUndoCounted,false)
assert.equal((await previewCountedCatalogUndo(db,1,[{...choices[0],physicallyVerified:false},choices[1]])).canUndoCounted,false)
await assert.rejects(()=>undoCountedCatalogConsolidation(db,1,'admin','нет',baseline.stateToken,choices),/причина/)
await assert.rejects(()=>undoCountedCatalogConsolidation(db,1,'admin',reason,'old',choices),/изменилось/)
sqlite.exec("INSERT INTO inventory_reservations(id,variant_id,status,updated_at) VALUES(44,8,'active','2026-10-10T08:00:00Z')")
assert.equal((await previewCountedCatalogUndo(db,1,choices)).canUndoCounted,false)
sqlite.exec('DELETE FROM inventory_reservations WHERE id=44')
const stable=await previewCountedCatalogUndo(db,1,choices)
assert.equal(stable.canUndoCounted,true)
beforeBatch=()=>sqlite.exec(`
 INSERT INTO orders(id,order_status,shipping_status,updated_at)
 VALUES(99,'active','sent','2026-10-10T08:00:00Z');
 INSERT INTO order_items(id,order_id,variant_id,product_id,quantity,created_at)
 VALUES(99,99,8,100,1,'2026-10-10T08:00:00Z');
`)
await assert.rejects(()=>undoCountedCatalogConsolidation(db,1,'admin',reason,stable.stateToken,choices),/не проведена/,
 'A new staff order must beat stale admin undo')
assert.equal(sku(7),0)
assert.equal(n('catalog_variant_merge_generation_events'),0)
sqlite.exec('DELETE FROM order_items WHERE id=99; DELETE FROM orders WHERE id=99')
const refreshed=await previewCountedCatalogUndo(db,1,choices)
assert.equal(refreshed.canUndoCounted,true,JSON.stringify(refreshed.errors))
onStatement=i=>{if(i===5){onStatement=null;sqlite.exec('UPDATE inventory_stock SET quantity=99 WHERE id=11')}}
await assert.rejects(()=>undoCountedCatalogConsolidation(db,1,'admin',reason,refreshed.stateToken,choices),/не проведена/,
 'Changed stock after allocation and before proof must abort entire D1 transaction')
assert.equal(sku(7),0)
assert.equal(n('catalog_variant_merge_generation_events'),0)
assert.equal(n('catalog_variant_counted_undo_locations'),0)
assert.equal(stocks().find(x=>x.id===11).quantity,6)
const result=await undoCountedCatalogConsolidation(db,1,'admin',reason,refreshed.stateToken,choices)
assert.equal(result.undone,true)
assert.equal(result.totalPhysicalDelta,0)
assert.deepEqual(stocks().map(x=>x.quantity),[2,4,2,1])
assert.equal(total(),9)
assert.equal(sku(7),1)
assert.equal(n('catalog_variant_merge_generation_events'),1)
assert.equal(n('catalog_variant_counted_undo_locations'),2)
assert.equal(n('catalog_variant_counted_undo_validations'),1)
assert.equal(n('catalog_variant_consolidations'),1)
assert.equal(JSON.stringify(sqlite.prepare('SELECT * FROM inventory_movements ORDER BY id').all()),originalMovement)
assert.equal(JSON.stringify(sqlite.prepare('SELECT * FROM order_items ORDER BY id').all()),originalOrders)
assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM catalog_variant_effective_merge_lineage WHERE source_variant_id=7').get().n,0)
await assert.rejects(()=>undoCountedCatalogConsolidation(db,1,'admin',reason,refreshed.stateToken,choices),/Нельзя|не проведена/,
 'Replay of a generation-2 undo must be refused')
assert.equal(n('catalog_variant_merge_generation_events'),1)
const router=fs.readFileSync('worker/index.ts','utf8')
assert.ok(router.includes('/api/catalog/variants/consolidation-undo-counted'))
assert.ok(router.includes('undoCountedCatalogConsolidation('))
console.log('COUNTED STOCK UNDO PASSED — two-location verified conservation, correction movement and historic order preserved, race rollback, no duplicate generation')
