import assert from 'node:assert/strict'
import fs from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
const db=new DatabaseSync(':memory:')
db.exec(`
PRAGMA foreign_keys=ON;
CREATE TABLE catalog_products(id INTEGER PRIMARY KEY);
CREATE TABLE catalog_variants(id INTEGER PRIMARY KEY,product_id INTEGER,is_active INTEGER);
CREATE TABLE orders(id INTEGER PRIMARY KEY,order_status TEXT,shipping_status TEXT);
CREATE TABLE order_items(id INTEGER PRIMARY KEY,order_id INTEGER,variant_id INTEGER,
 source_type TEXT,quantity INTEGER);
CREATE TABLE return_items(id INTEGER PRIMARY KEY,order_item_id INTEGER);
CREATE TABLE exchanges(id INTEGER PRIMARY KEY,old_order_item_id INTEGER,new_order_item_id INTEGER);
CREATE TABLE exchange_items(id INTEGER PRIMARY KEY,order_item_id INTEGER);
CREATE TABLE inventory_reservations(id INTEGER PRIMARY KEY,order_id INTEGER,order_item_id INTEGER,
 inventory_source TEXT,variant_id INTEGER,quantity INTEGER,status TEXT,updated_at TEXT);
CREATE TABLE inventory_stock(id INTEGER PRIMARY KEY,variant_id INTEGER,inventory_source TEXT,
 quantity INTEGER,reserved_quantity INTEGER,updated_at TEXT,last_source_ref TEXT);
INSERT INTO catalog_products VALUES(100);
INSERT INTO catalog_variants VALUES(7,100,0),(8,100,1);
INSERT INTO inventory_stock VALUES
 (10,7,'warehouse',0,0,'2026-10-10T07:00:00Z','catalog-consolidation:7->8'),
 (11,8,'warehouse',7,3,'2026-10-10T07:00:00Z','catalog-consolidation:7->8'),
 (12,7,'boutique',0,0,'2026-10-10T07:00:00Z','catalog-consolidation:7->8'),
 (13,8,'boutique',3,1,'2026-10-10T07:00:00Z','catalog-consolidation:7->8');
INSERT INTO orders VALUES(1,'active','not_sent'),(2,'active','not_sent'),(3,'active','not_sent');
INSERT INTO order_items VALUES(21,1,8,'warehouse',2),(22,2,8,'boutique',1),(23,3,8,'warehouse',1);
INSERT INTO inventory_reservations VALUES
 (31,1,21,'warehouse',8,2,'active','2026-10-10T07:00:00Z'),
 (32,2,22,'boutique',8,1,'active','2026-10-10T07:00:00Z'),
 (33,3,23,'warehouse',8,1,'active','2026-10-09T06:00:00Z');
`)
for(const p of [
 'migrations/0090_v72_catalog_variant_consolidations.sql',
 'migrations/0091_v72_catalog_variant_stock_consolidation.sql',
 'migrations/0092_v72_catalog_variant_reservation_consolidation.sql',
 'migrations/0096_v72_catalog_atomic_stock_finalization.sql',
 'migrations/0099_v72_catalog_merge_generation_events.sql',
 'migrations/0104_v72_catalog_reserved_undo_validation.sql'
])db.exec(fs.readFileSync(p,'utf8'))
db.exec(`
INSERT INTO catalog_variant_consolidations
 (id,source_variant_id,target_variant_id,product_id,source_physical_quantity,
 source_reserved_quantity,created_at)
 VALUES(1,7,8,100,6,3,'2026-10-10T07:00:00Z');
INSERT INTO catalog_variant_consolidation_stock_rows
 (consolidation_id,inventory_source,source_stock_id,target_stock_id_before,
 source_quantity_before,target_quantity_before,target_reserved_before,
 combined_quantity_after,source_reserved_before)
 VALUES(1,'warehouse',10,11,4,3,1,7,2),(1,'boutique',12,13,2,1,0,3,1);
INSERT INTO catalog_variant_consolidation_stock_decisions
 (consolidation_id,inventory_source,source_stock_id,keeper_stock_id_before,
 decision_method,source_quantity_before,keeper_quantity_before,final_quantity,
 adjustment_quantity,reason,created_by,created_at)
 VALUES(1,'warehouse',10,11,'sum',4,3,7,0,'','admin','2026-10-10T07:00:00Z'),
       (1,'boutique',12,13,'sum',2,1,3,0,'','admin','2026-10-10T07:00:00Z');
INSERT INTO catalog_variant_consolidation_reservation_rows
 (consolidation_id,reservation_id,order_id,order_item_id,inventory_source,
 original_variant_id,keeper_variant_id,quantity)
 VALUES(1,31,1,21,'warehouse',7,8,2),(1,32,2,22,'boutique',7,8,1);
INSERT INTO catalog_variant_consolidation_validations VALUES(1,1,'2026-10-10T07:00:00Z');
INSERT INTO catalog_variant_consolidation_reservation_validations VALUES(1,1,'2026-10-10T07:00:00Z');
`)
const stamp='2026-10-10T08:00:00Z'
const proof=db.prepare(`INSERT INTO catalog_variant_reserved_undo_validations(
 generation_event_id,root_consolidation_id,source_variant_id,keeper_variant_id,
 validated_locations,validated_reservations,physical_total,reserve_total,passed,
 checked_by,checked_at) VALUES(1,1,7,8,2,2,10,4,1,'admin',?)`)
const summary=t=>db.prepare('SELECT COUNT(*) AS n FROM '+t).get().n
db.exec('BEGIN IMMEDIATE')
db.prepare(`INSERT INTO catalog_variant_merge_generation_events
 (root_consolidation_id,source_variant_id,target_variant_id,generation,event_kind,
 reason,created_by,created_at)
 VALUES(1,7,8,2,'undo','Незатронутые резервы возвращаются','admin',?)`).run(stamp)
const locations=db.prepare(`INSERT INTO catalog_variant_reserved_undo_locations(
 generation_event_id,inventory_source,source_stock_id,keeper_stock_id,
 keeper_quantity_merged,keeper_reserved_merged,source_quantity_restored,
 keeper_quantity_restored,source_reserved_restored,keeper_reserved_restored)
 VALUES(1,?,?,?,?,?,?,?,?,?)`)
locations.run('warehouse',10,11,7,3,4,3,2,1)
locations.run('boutique',12,13,3,1,2,1,1,0)
assert.throws(()=>locations.run('warehouse',10,11,7,3,5,3,2,1),/constraint/i)
const audits=db.prepare(`INSERT INTO catalog_variant_reserved_undo_reservations(
 generation_event_id,reservation_id,order_id,order_item_id,inventory_source,quantity,
 source_variant_id,keeper_variant_id) VALUES(1,?,?,?,?,?,7,8)`)
audits.run(31,1,21,'warehouse',2)
audits.run(32,2,22,'boutique',1)
assert.throws(()=>proof.run(stamp),/Reserved SKU undo proof failed/,'Source inactive not valid')
db.exec('UPDATE catalog_variants SET is_active=1 WHERE id=7')
db.exec(`UPDATE inventory_stock SET quantity=4,reserved_quantity=2 WHERE id=10;
 UPDATE inventory_stock SET quantity=3,reserved_quantity=1 WHERE id=11;
 UPDATE inventory_stock SET quantity=2,reserved_quantity=1 WHERE id=12;
 UPDATE inventory_stock SET quantity=1,reserved_quantity=0 WHERE id=13;
 UPDATE inventory_reservations SET variant_id=7 WHERE id IN (31,32);
 UPDATE order_items SET variant_id=7 WHERE id IN (21,22);`)
db.exec("UPDATE orders SET shipping_status='sent' WHERE id=1")
assert.throws(()=>proof.run(stamp),/Reserved SKU undo proof failed/,'No shipped reservation remap')
db.exec("UPDATE orders SET shipping_status='not_sent' WHERE id=1")
db.exec("UPDATE inventory_reservations SET quantity=1 WHERE id=31")
assert.throws(()=>proof.run(stamp),/Reserved SKU undo proof failed/,'Quantity mismatch aborts')
db.exec("UPDATE inventory_reservations SET quantity=2 WHERE id=31")
db.exec("UPDATE inventory_stock SET reserved_quantity=2 WHERE id=11")
assert.throws(()=>proof.run(stamp),/Reserved SKU undo proof failed/,'Keeper double reservation rejected')
db.exec("UPDATE inventory_stock SET reserved_quantity=1 WHERE id=11")
proof.run(stamp)
db.exec('COMMIT')
assert.equal(summary('catalog_variant_reserved_undo_locations'),2)
assert.equal(summary('catalog_variant_reserved_undo_reservations'),2)
assert.equal(summary('catalog_variant_reserved_undo_validations'),1)
assert.equal(db.prepare('SELECT SUM(quantity) AS n FROM inventory_stock').get().n,10)
assert.equal(db.prepare('SELECT SUM(reserved_quantity) AS n FROM inventory_stock').get().n,4)
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM catalog_variant_effective_merge_lineage WHERE source_variant_id=7").get().n,0)
assert.throws(()=>db.exec("DELETE FROM catalog_variant_reserved_undo_reservations"),/immutable/)
assert.throws(()=>db.exec("UPDATE catalog_variant_reserved_undo_locations SET source_reserved_restored=1"),/immutable/)
assert.throws(()=>db.exec("DELETE FROM catalog_variant_reserved_undo_validations"),/immutable/)
db.close()
console.log('RESERVED SKU UNDO 0104 PASSED — exact per-location physical and reserved conservation, original order link proof, shipped/quantity race, immutable evidence')
