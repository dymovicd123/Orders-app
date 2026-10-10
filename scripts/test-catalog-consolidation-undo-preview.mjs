import assert from 'node:assert/strict'
import fs from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { previewCatalogConsolidationUndo } from '../worker/domains/catalog-consolidation-undo-preview.ts'

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
 CREATE TABLE orders(id INTEGER PRIMARY KEY,order_status TEXT,shipping_status TEXT,order_date TEXT NOT NULL DEFAULT (date('now','+5 hours')));
 CREATE TABLE order_items(
   id INTEGER PRIMARY KEY,order_id INTEGER,variant_id INTEGER,product_id INTEGER,
   quantity INTEGER,is_workshop INTEGER DEFAULT 0, source_type TEXT DEFAULT 'warehouse',
   stock_writeoff_status TEXT DEFAULT 'reserved',product_name_snapshot TEXT DEFAULT 'Снимок товара',
   unit_price INTEGER DEFAULT 1000,created_at TEXT);
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


const db={
 prepare(sql){return{
  bind(...params){return{
    async first(){return sqlite.prepare(sql).get(...params)||null},
    async all(){return{results:sqlite.prepare(sql).all(...params)}},
  }},
 }}
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
const diag=()=>previewCatalogConsolidationUndo(db,1)
await assert.rejects(()=>previewCatalogConsolidationUndo(db,0),/корректный номер/)
await assert.rejects(()=>previewCatalogConsolidationUndo(db,999),/не найдено/)
let result=await diag()
assert.equal(result.ok,true)
assert.equal(result.canUndoNow,false,'Preview never makes a stock mutation available')
assert.equal(result.potentialCompensationCandidate,true,JSON.stringify(result.blockers))
assert.equal(result.locations[0].before.source,0)
assert.equal(result.locations[0].before.keeper,2)
assert.equal(result.locations[0].after.keeper,2)
assert.equal(result.locations[0].decision,'sum')
assert.deepEqual(result.blockers,[])
assert.equal(sqlite.prepare('SELECT is_active FROM catalog_variants WHERE id=7').get().is_active,0,
 'Preflight must not activate old SKU')
sqlite.exec(`INSERT INTO inventory_movements
 (id,variant_id,created_at,reference_type,reference_id)
 VALUES(1,8,'2026-10-10T08:00:00Z','sale','sale-1')`)
result=await diag()
assert.equal(result.potentialCompensationCandidate,false)
assert.ok(result.blockers.some(b=>b.code==='later_inventory_activity'))
assert.equal(result.impact.postMergeMovements,1)
sqlite.exec('DELETE FROM inventory_movements')
sqlite.exec(`INSERT INTO order_items(id,order_id,variant_id,quantity,created_at)
 VALUES(90,1,8,1,'2026-10-10T08:00:00Z')`)
result=await diag()
assert.ok(result.blockers.some(b=>b.code==='later_order_activity'))
sqlite.exec('DELETE FROM order_items WHERE id=90')
sqlite.exec(`INSERT INTO inventory_stock_checks(id,variant_id,inventory_source,
 counted_quantity,checked_at,check_type)
 VALUES(44,8,'warehouse',2,'2026-10-10T08:00:00Z','full_stocktake')`)
assert.ok((await diag()).blockers.some(b=>b.code==='later_inventory_activity'))
sqlite.exec('DELETE FROM inventory_stock_checks')
sqlite.exec('UPDATE inventory_stock SET quantity=3 WHERE id=11')
assert.ok((await diag()).blockers.some(b=>b.code==='location_mismatch_warehouse'))
sqlite.exec('UPDATE inventory_stock SET quantity=2 WHERE id=11')
sqlite.exec(`INSERT INTO inventory_reservations
 (id,variant_id,status,updated_at)
 VALUES(90,8,'active','2026-10-10T09:00:00Z')`)
assert.ok((await diag()).blockers.some(b=>b.code==='active_customer_obligations'))
sqlite.exec('DELETE FROM inventory_reservations')
sqlite.exec(`INSERT INTO catalog_variant_consolidations
 (id,source_variant_id,target_variant_id,product_id,created_at)
 VALUES(2,10,8,100,'2026-10-10T09:00:00Z')`)
assert.ok((await diag()).blockers.some(b=>b.code==='merge_chain'))
sqlite.exec('DELETE FROM catalog_variant_consolidations WHERE id=2')
sqlite.exec(`UPDATE catalog_variant_consolidation_stock_rows
 SET target_stock_id_before=NULL WHERE consolidation_id=1`)
assert.ok((await diag()).blockers.some(b=>b.code==='location_mismatch_warehouse'))
sqlite.exec('UPDATE catalog_variant_consolidation_stock_rows SET target_stock_id_before=11 WHERE consolidation_id=1')
sqlite.exec('DELETE FROM catalog_variant_consolidation_reservation_validations')
assert.ok((await diag()).blockers.some(b=>b.code==='audit_incomplete'))
assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM catalog_variant_consolidations').get().n,1,
 'Undo preflight must preserve original receipt and history')
const index=fs.readFileSync('worker/index.ts','utf8')
assert.ok(index.includes("'/api/catalog/variants/consolidation-undo-preview'"))
assert.ok(index.includes('previewCatalogConsolidationUndo(env.DB'))
console.log('CATALOG MERGE UNDO PREFLIGHT PASSED — ledger/identity/evidence, active obligations, postmerge sale/count, topology, nested merges, incomplete audit and no writes')
