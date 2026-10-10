import assert from 'node:assert/strict'
import fs from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { previewCatalogConsolidationUndo } from '../worker/domains/catalog-consolidation-undo-preview.ts'
import { previewComplexCatalogUndoCase } from '../worker/domains/catalog-complex-undo-case.ts'

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

const unchanged=()=>{
 const before=sqlite.prepare('SELECT total_changes() AS n').get().n
 return async()=>{
  assert.equal(sqlite.prepare('SELECT total_changes() AS n').get().n,before,
   'Case review must never change database records')
 }
}
const read=()=>previewComplexCatalogUndoCase(db,1)
await assert.rejects(()=>previewComplexCatalogUndoCase(db,0),/корректный номер/)
await assert.rejects(()=>previewComplexCatalogUndoCase(db,999),/не найдено/)
let verify=unchanged()
let p=await read()
await verify()
assert.equal(p.ok,true)
assert.equal(p.canUndoNow,false)
assert.equal(p.automaticCompensationAllowed,false)
assert.equal(p.noChangesApplied,true)
assert.equal(p.caseKind,'standard_undo_may_be_available')
assert.equal(p.summary.originalReservationLinks,0)
assert.deepEqual(p.actions,[])
sqlite.exec(`
 UPDATE catalog_variant_consolidations
 SET source_reserved_quantity=2 WHERE id=1;
 UPDATE catalog_variant_consolidation_stock_rows
 SET source_reserved_before=2 WHERE consolidation_id=1;
 UPDATE inventory_stock SET reserved_quantity=2 WHERE id=11;
 INSERT INTO orders(id,order_status,shipping_status,updated_at)
 VALUES(2,'active','not_sent','2026-10-09T07:00:00Z');
 INSERT INTO order_items(id,order_id,variant_id,product_id,quantity,source_type,created_at)
 VALUES(30,2,8,100,2,'warehouse','2026-10-09T07:00:00Z');
 INSERT INTO inventory_reservations
  (id,order_id,order_item_id,inventory_source,product_id,variant_id,quantity,status,updated_at)
 VALUES(55,2,30,'warehouse',100,8,2,'active','2026-10-10T07:00:00Z');
 INSERT INTO catalog_variant_consolidation_reservation_rows
  (consolidation_id,reservation_id,order_id,order_item_id,inventory_source,
    original_variant_id,keeper_variant_id,quantity)
 VALUES(1,55,2,30,'warehouse',7,8,2);
`)
verify=unchanged()
p=await read()
await verify()
assert.equal(p.caseKind,'requires_operation_reconciliation')
assert.equal(p.summary.originalReservationLinks,1)
assert.equal(p.reservationLinks.rows.length,1)
assert.equal(p.reservationLinks.rows[0].situation.kind,'active_unchanged')
assert.equal(p.reservationLinks.rows[0].reservationId,55)
assert.equal(p.reservationLinks.rows[0].order.itemSkuId,8)
assert.ok(p.actions.some(x=>x.code==='customer_reservations'))
assert.equal(p.automaticCompensationAllowed,false)
sqlite.exec("UPDATE inventory_reservations SET quantity=1 WHERE id=55")
p=await read()
assert.equal(p.reservationLinks.rows[0].situation.kind,'changed_link')
assert.equal(p.caseKind,'requires_data_review')
assert.equal(p.summary.changedOrMissingReservationLinks,1)
sqlite.exec("UPDATE inventory_reservations SET quantity=2,updated_at='2026-10-10T09:00:00Z' WHERE id=55")
p=await read()
assert.equal(p.reservationLinks.rows[0].situation.kind,'edited_after_merge')
sqlite.exec("UPDATE inventory_reservations SET updated_at='2026-10-10T07:00:00Z',status='released' WHERE id=55")
p=await read()
assert.equal(p.reservationLinks.rows[0].situation.kind,'fulfilled_or_released')
sqlite.exec("UPDATE inventory_reservations SET status='active' WHERE id=55")
sqlite.exec("UPDATE orders SET shipping_status='sent' WHERE id=2")
p=await read()
assert.equal(p.reservationLinks.rows[0].situation.kind,'fulfilled_or_released')
sqlite.exec("UPDATE orders SET shipping_status='not_sent' WHERE id=2")
sqlite.exec(`
 INSERT INTO orders(id,order_status,shipping_status,updated_at)
 VALUES(3,'active','sent','2026-10-10T10:00:00Z');
 INSERT INTO order_items(id,order_id,variant_id,product_id,quantity,created_at)
 VALUES(31,3,8,100,1,'2026-10-10T09:00:00Z');
 INSERT INTO inventory_movements(id,variant_id,inventory_source,
   movement_type,quantity_delta,quantity_after,reference_type,reference_id,created_at)
 VALUES(200,8,'warehouse','sale',-1,1,'sale','3','2026-10-10 10:00:00');
 INSERT INTO inventory_stock_checks(id,variant_id,inventory_source,
   counted_quantity,checked_at,check_type)
 VALUES(300,8,'warehouse',1,'2026-10-10T11:00:00Z','full_stocktake');
`)
verify=unchanged()
p=await read()
await verify()
assert.equal(p.summary.postMergeOrderItems,1)
assert.equal(p.summary.postMergeMovements,1)
assert.equal(p.summary.postMergeStockChecks,1)
assert.equal(p.subsequentOrders.rows[0].order_id,3)
assert.equal(p.subsequentMovements.rows[0].quantity_delta,-1)
assert.ok(p.actions.some(x=>x.code==='later_orders'))
assert.ok(p.actions.some(x=>x.code==='later_movements'))
assert.ok(p.actions.some(x=>x.code==='later_counts'))
assert.equal(p.automaticCompensationAllowed,false)
sqlite.exec("UPDATE inventory_movements SET created_at='broken-date' WHERE id=200")
p=await read()
assert.equal(p.subsequentMovements.rows[0].time_state,'unknown')
assert.equal(p.caseKind,'requires_data_review')
sqlite.exec("UPDATE inventory_movements SET created_at='2026-10-10T10:00:00Z' WHERE id=200")
sqlite.exec('DELETE FROM inventory_stock_checks WHERE id=300; DELETE FROM inventory_movements WHERE id=200')
for(let i=0;i<55;i++){
 sqlite.prepare(`INSERT INTO inventory_movements
  (id,variant_id,inventory_source,quantity_delta,reference_type,reference_id,created_at)
  VALUES(?,8,'warehouse',-1,'sale',?,'2026-10-10T10:00:00Z')`)
  .run(500+i,String(500+i))
}
verify=unchanged()
p=await read()
await verify()
assert.equal(p.summary.postMergeMovements,55)
assert.equal(p.subsequentMovements.shownCount,50)
assert.equal(p.subsequentMovements.rows.length,50)
assert.equal(p.subsequentMovements.truncated,true)
assert.equal(p.summary.incompleteEvidence,true)
assert.equal(p.caseKind,'requires_pagination')
assert.ok(p.actions.some(x=>x.code==='missing_evidence'))
assert.equal(p.canUndoNow,false)
const router=fs.readFileSync('worker/index.ts','utf8')
assert.ok(router.includes('/api/catalog/variants/consolidation-undo-case-review'))
assert.ok(router.includes("requireAdminUser(authUser,'Разбор зависимостей"))
assert.ok(router.includes('previewComplexCatalogUndoCase('))
console.log('COMPLEX UNDO CASE REVIEW PASSED — original reservation linkage, changed/shipped reservations, later orders/movements/counts, ambiguous dates, pagination completeness and zero database writes')
