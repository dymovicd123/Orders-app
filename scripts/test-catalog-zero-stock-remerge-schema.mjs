import assert from 'node:assert/strict'
import fs from 'node:fs'
import {DatabaseSync} from 'node:sqlite'

const sql=new DatabaseSync(':memory:')
sql.exec(`
  PRAGMA foreign_keys=ON;
  CREATE TABLE catalog_products(id INTEGER PRIMARY KEY);
  CREATE TABLE catalog_variants(id INTEGER PRIMARY KEY,product_id INTEGER,is_active INTEGER);
  CREATE TABLE inventory_stock(
    id INTEGER PRIMARY KEY,variant_id INTEGER,inventory_source TEXT,quantity INTEGER,
    reserved_quantity INTEGER,updated_at TEXT,last_source_ref TEXT
  );
  CREATE TABLE inventory_reservations(id INTEGER PRIMARY KEY,variant_id INTEGER,status TEXT);
  INSERT INTO catalog_products VALUES(1);
  INSERT INTO catalog_variants VALUES(7,1,0),(8,1,1),(9,1,1),(17,1,0),(18,1,1);
  INSERT INTO inventory_stock VALUES
   (10,7,'warehouse',0,0,'old','catalog-consolidation:7->8'),
   (11,8,'warehouse',4,0,'keeper',NULL),
   (12,9,'warehouse',2,0,'new',NULL),
   (20,17,'warehouse',0,0,'old',NULL),
   (21,18,'warehouse',1,0,'old',NULL);
`)
for(const path of [
  'migrations/0090_v72_catalog_variant_consolidations.sql',
  'migrations/0099_v72_catalog_merge_generation_events.sql',
  'migrations/0100_v72_catalog_zero_stock_undo_validation.sql',
  'migrations/0101_v72_catalog_zero_stock_remerge_validation.sql',
]) sql.exec(fs.readFileSync(path,'utf8'))
sql.exec(`
  INSERT INTO catalog_variant_consolidations
    (id,source_variant_id,target_variant_id,product_id,created_at)
  VALUES(1,7,8,1,'2026-10-10T07:00:00Z'),(2,17,18,1,'2026-10-10T07:00:00Z');
  INSERT INTO catalog_variant_merge_generation_events
    (id,root_consolidation_id,source_variant_id,target_variant_id,generation,
      event_kind,reason,created_by,created_at)
  VALUES (1,1,7,8,2,'undo','Проверенный корректный возврат','admin','2026-10-10T08:00:00Z'),
         (3,2,17,18,2,'undo','Проверенный корректный возврат','admin','2026-10-10T08:00:00Z');
  INSERT INTO catalog_variant_zero_stock_undo_validations
    (generation_event_id,root_consolidation_id,source_variant_id,original_stock_rows,passed,created_by,checked_at)
  VALUES(1,1,7,1,1,'admin','2026-10-10T08:00:00Z');
`)
sql.exec(`UPDATE catalog_variants SET is_active=1 WHERE id=7; UPDATE catalog_variants SET is_active=0 WHERE id=7;`)
const reason='Повторная проверка нулевого остатка'
const insert=sql.prepare(`INSERT INTO catalog_variant_merge_generation_events
  (id,root_consolidation_id,source_variant_id,target_variant_id,generation,event_kind,reason,created_by,created_at)
  VALUES(2,1,7,9,3,'merge',?,?,?)`)
insert.run(reason,'admin','2026-10-10T09:00:00Z')
const fp=sql.prepare(`SELECT COALESCE(json_group_array(json_array(
  id,inventory_source,variant_id,quantity,reserved_quantity,updated_at,last_source_ref
)),'[]') AS value
FROM (SELECT id,inventory_source,variant_id,quantity,reserved_quantity,updated_at,last_source_ref
  FROM inventory_stock WHERE variant_id IN (?,?) ORDER BY id)`)
const snapshot=fp.get(7,9).value
const proof=sql.prepare(`INSERT INTO catalog_variant_zero_stock_remerge_validations
  (generation_event_id,root_consolidation_id,source_variant_id,target_variant_id,
   source_stock_rows,stock_fingerprint,passed,created_by,checked_at)
  VALUES(?,?,?,?,?,?,?,?,?)`)
assert.throws(()=>proof.run(2,1,7,9,1,'[]',1,'admin','2026-10-10T09:00:00Z'),/proof failed/)
proof.run(2,1,7,9,1,snapshot,1,'admin','2026-10-10T09:00:00Z')
assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM catalog_variant_zero_stock_remerge_validations').get().n,1)
assert.throws(()=>sql.exec("UPDATE catalog_variant_zero_stock_remerge_validations SET created_by='tamper'"),/immutable/)
assert.throws(()=>sql.exec('DELETE FROM catalog_variant_zero_stock_remerge_validations'),/immutable/)
assert.equal(sql.prepare('SELECT target_variant_id FROM catalog_variant_effective_merge_lineage WHERE source_variant_id=7').get().target_variant_id,9)
assert.equal(sql.prepare('SELECT target_variant_id FROM catalog_variant_consolidations WHERE id=1').get().target_variant_id,8)
sql.exec(`
  INSERT INTO catalog_variant_merge_generation_events
    (id,root_consolidation_id,source_variant_id,target_variant_id,generation,event_kind,reason,created_by,created_at)
  VALUES(4,2,17,18,3,'merge','Повторная проверка нулевого остатка','admin','2026-10-10T09:00:00Z');
`)
assert.throws(()=>proof.run(4,2,17,18,1,fp.get(17,18).value,1,'admin','2026-10-10T09:00:00Z'),/proof failed/,'Missing validated undo must abort')
sql.exec("INSERT INTO inventory_reservations VALUES(1,7,'active')")
assert.throws(()=>proof.run(2,1,7,9,1,snapshot,1,'admin','2026-10-10T09:00:00Z'),/UNIQUE constraint|proof failed/)
sql.close()
console.log('ZERO-STOCK RE-MERGE PROOF 0101 PASSED — generation 3, verified undo, exact stock fingerprint, immutable audit')
