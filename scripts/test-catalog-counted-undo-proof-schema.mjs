import assert from 'node:assert/strict'
import fs from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
const db=new DatabaseSync(':memory:')
db.exec(`
PRAGMA foreign_keys=ON;
CREATE TABLE catalog_products(id INTEGER PRIMARY KEY);
CREATE TABLE catalog_variants(id INTEGER PRIMARY KEY,product_id INTEGER,is_active INTEGER);
CREATE TABLE inventory_stock(id INTEGER PRIMARY KEY,variant_id INTEGER,inventory_source TEXT,
 quantity INTEGER,reserved_quantity INTEGER,updated_at TEXT,last_source_ref TEXT);
CREATE TABLE inventory_reservations(id INTEGER PRIMARY KEY,variant_id INTEGER,status TEXT);
INSERT INTO catalog_products VALUES(1);
INSERT INTO catalog_variants VALUES(7,1,0),(8,1,1);
INSERT INTO inventory_stock VALUES
 (10,7,'warehouse',0,0,'2026-10-10T07:00:00Z','catalog-consolidation:7->8'),
 (11,8,'warehouse',6,0,'2026-10-10T07:00:00Z','catalog-consolidation:7->8'),
 (12,7,'boutique',0,0,'2026-10-10T07:00:00Z','catalog-consolidation:7->8'),
 (13,8,'boutique',3,0,'2026-10-10T07:00:00Z','catalog-consolidation:7->8');
`)
for(const path of [
 'migrations/0090_v72_catalog_variant_consolidations.sql',
 'migrations/0091_v72_catalog_variant_stock_consolidation.sql',
 'migrations/0092_v72_catalog_variant_reservation_consolidation.sql',
 'migrations/0096_v72_catalog_atomic_stock_finalization.sql',
 'migrations/0099_v72_catalog_merge_generation_events.sql',
 'migrations/0103_v72_catalog_counted_undo_validation.sql'
])db.exec(fs.readFileSync(path,'utf8'))
db.exec(`
INSERT INTO catalog_variant_consolidations
 (id,source_variant_id,target_variant_id,product_id,
  source_physical_quantity,source_reserved_quantity,created_at)
 VALUES(1,7,8,1,6,0,'2026-10-10T07:00:00Z');
INSERT INTO catalog_variant_consolidation_stock_rows
 (consolidation_id,inventory_source,source_stock_id,target_stock_id_before,
  source_quantity_before,target_quantity_before,target_reserved_before,
  combined_quantity_after,source_reserved_before)
 VALUES(1,'warehouse',10,11,4,3,0,6,0),(1,'boutique',12,13,2,1,0,3,0);
INSERT INTO catalog_variant_consolidation_stock_decisions
 (consolidation_id,inventory_source,source_stock_id,keeper_stock_id_before,
  decision_method,source_quantity_before,keeper_quantity_before,final_quantity,
  adjustment_quantity,reason,created_by,created_at)
 VALUES (1,'warehouse',10,11,'physical_count',4,3,6,-1,
    'Проверенный ручной пересчёт','admin','2026-10-10T07:00:00Z'),
        (1,'boutique',12,13,'sum',2,1,3,0,'','admin','2026-10-10T07:00:00Z');
INSERT INTO catalog_variant_consolidation_validations VALUES(1,1,'2026-10-10T07:00:00Z');
INSERT INTO catalog_variant_consolidation_reservation_validations VALUES(1,1,'2026-10-10T07:00:00Z');
`)
const startTotal=db.prepare('SELECT SUM(quantity) AS total FROM inventory_stock').get().total
assert.equal(startTotal,9)
const stamp='2026-10-10T08:00:00Z'
const generation=db.prepare(`INSERT INTO catalog_variant_merge_generation_events
 (root_consolidation_id,source_variant_id,target_variant_id,generation,event_kind,reason,created_by,created_at)
 VALUES(1,7,8,2,'undo','Физический пересчёт двух мест','admin',?)`)
const addLocation=db.prepare(`INSERT INTO catalog_variant_counted_undo_locations
 (generation_event_id,inventory_source,source_stock_id,keeper_stock_id,
  source_quantity_before,keeper_quantity_before,confirmed_source_quantity,
  confirmed_keeper_quantity,physical_count_confirmed)
 VALUES(1,?,?,?,0,?,?,?,1)`)
const proof=db.prepare(`INSERT INTO catalog_variant_counted_undo_validations
 (generation_event_id,root_consolidation_id,source_variant_id,keeper_variant_id,
  validated_locations,confirmed_total,passed,checked_by,checked_at)
 VALUES(1,1,7,8,2,9,1,'admin',?)`)
db.exec('BEGIN IMMEDIATE')
generation.run(stamp)
addLocation.run('warehouse',10,11,6,2,4)
addLocation.run('boutique',12,13,3,2,1)
assert.throws(()=>addLocation.run('warehouse',10,11,6,3,4),/constraint/i,'Unique location and physical conservation')
assert.throws(()=>proof.run(stamp),/Counted SKU undo proof failed/,'Inactive source must be rejected')
db.exec('UPDATE catalog_variants SET is_active=1 WHERE id=7')
db.exec('UPDATE inventory_stock SET quantity=2 WHERE id=10')
db.exec('UPDATE inventory_stock SET quantity=4 WHERE id=11')
db.exec('UPDATE inventory_stock SET quantity=2 WHERE id=12')
db.exec('UPDATE inventory_stock SET quantity=1 WHERE id=13')
db.exec("INSERT INTO inventory_reservations VALUES(44,8,'active')")
assert.throws(()=>proof.run(stamp),/Counted SKU undo proof failed/,'Active reservations fail')
db.exec('DELETE FROM inventory_reservations WHERE id=44')
db.exec('UPDATE inventory_stock SET quantity=5 WHERE id=11')
assert.throws(()=>proof.run(stamp),/Counted SKU undo proof failed/,'Changed keeper balance fails')
db.exec('UPDATE inventory_stock SET quantity=4 WHERE id=11')
proof.run(stamp)
db.exec('COMMIT')
assert.equal(db.prepare('SELECT SUM(quantity) AS total FROM inventory_stock').get().total,startTotal)
assert.equal(db.prepare('SELECT COUNT(*) AS n FROM catalog_variant_counted_undo_locations').get().n,2)
assert.equal(db.prepare('SELECT COUNT(*) AS n FROM catalog_variant_counted_undo_validations').get().n,1)
assert.equal(db.prepare('SELECT COUNT(*) AS n FROM catalog_variant_effective_merge_lineage WHERE source_variant_id=7').get().n,0)
assert.throws(()=>db.exec('DELETE FROM catalog_variant_counted_undo_locations'),/immutable/)
assert.throws(()=>db.exec("UPDATE catalog_variant_counted_undo_validations SET checked_by='x'"),/immutable/)
assert.throws(()=>generation.run(stamp),/UNIQUE constraint|follow previous/)
db.close()
console.log('CATALOG COUNTED UNDO 0103 PROOF PASSED — corrected count conservation, manual split, both locations, no reservation, rollback guards and immutable history')
