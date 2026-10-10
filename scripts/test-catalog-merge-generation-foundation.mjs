import assert from 'node:assert/strict'
import fs from 'node:fs'
import {DatabaseSync} from 'node:sqlite'

const db=new DatabaseSync(':memory:')
db.exec(`
 PRAGMA foreign_keys=ON;
 CREATE TABLE catalog_products(id INTEGER PRIMARY KEY);
 CREATE TABLE catalog_variants(id INTEGER PRIMARY KEY,product_id INTEGER REFERENCES catalog_products(id),is_active INTEGER);
 INSERT INTO catalog_products VALUES(1),(2);
 INSERT INTO catalog_variants VALUES(7,1,0),(8,1,1),(9,1,1),(10,2,1),(11,1,0);
`)
db.exec(fs.readFileSync('migrations/0090_v72_catalog_variant_consolidations.sql','utf8'))
db.exec(`INSERT INTO catalog_variant_consolidations
 (id,source_variant_id,target_variant_id,product_id,created_at)
 VALUES (1,7,8,1,'2026-10-10T07:30:00Z'),
        (2,11,8,1,'2026-10-10T07:30:01Z');`)
db.exec(fs.readFileSync('migrations/0099_v72_catalog_merge_generation_events.sql','utf8'))
const mappings=()=>db.prepare('SELECT source_variant_id AS source,target_variant_id AS keeper,generation FROM catalog_variant_effective_merge_lineage ORDER BY source_variant_id').all().map(row=>({...row}))
assert.deepEqual(mappings(),[
 {source:7,keeper:8,generation:1},{source:11,keeper:8,generation:1}
], 'Legacy receipts must retain current canonical meaning without any data backfill')
const stamp='2026-10-10T10:00:00Z'
const append=(root,source,target,gen,kind,why='Проверено администратором при исправлении')=>
 db.prepare(`INSERT INTO catalog_variant_merge_generation_events
 (root_consolidation_id,source_variant_id,target_variant_id,generation,event_kind,reason,created_by,created_at)
 VALUES(?,?,?,?,?,?,?,?)`).run(root,source,target,gen,kind,why,'admin',stamp)
assert.throws(()=>append(1,7,8,3,'undo'),/must follow previous/)
assert.throws(()=>append(2,7,8,2,'undo'),/original product and source/)
assert.throws(()=>append(1,7,10,2,'undo'),/original product and source/)
assert.throws(()=>append(1,7,8,2,'merge'),/must alternate/)
assert.throws(()=>append(1,7,8,2,'undo','коротко'),/CHECK constraint/)
append(1,7,8,2,'undo')
db.exec('UPDATE catalog_variants SET is_active=1 WHERE id=7')
assert.deepEqual(mappings(),[{source:11,keeper:8,generation:1}],
 'Compensated old source must no longer resolve through obsolete keeper')
assert.throws(()=>append(1,7,9,4,'merge'),/must follow previous/)
assert.throws(()=>append(1,7,9,3,'undo'),/must alternate/)
assert.throws(()=>append(1,7,10,3,'merge'),/original product and source/)
db.exec('UPDATE catalog_variants SET is_active=0 WHERE id=7')
append(1,7,9,3,'merge')
assert.deepEqual(mappings(),[
 {source:7,keeper:9,generation:3},{source:11,keeper:8,generation:1}
], 'Reremerge can choose a different keeper while original root receipt remains immutable')
assert.throws(()=>db.exec('UPDATE catalog_variant_merge_generation_events SET reason="tamper" WHERE id=1'),/cannot be modified/)
assert.throws(()=>db.exec('DELETE FROM catalog_variant_merge_generation_events WHERE id=1'),/cannot be deleted/)
assert.throws(()=>append(1,7,9,3,'merge'),/UNIQUE constraint|must follow/)
const original={...db.prepare('SELECT source_variant_id,target_variant_id FROM catalog_variant_consolidations WHERE id=1').get()}
assert.deepEqual(original,{source_variant_id:7,target_variant_id:8})
const events=db.prepare('SELECT generation,event_kind,target_variant_id FROM catalog_variant_merge_generation_events WHERE source_variant_id=7 ORDER BY generation').all().map(row=>({...row}))
assert.deepEqual(events,[{generation:2,event_kind:'undo',target_variant_id:8},{generation:3,event_kind:'merge',target_variant_id:9}])
assert.equal(db.prepare('SELECT COUNT(*) AS n FROM catalog_variant_merge_generation_events WHERE source_variant_id=11').get().n,0)
console.log('CATALOG MERGE GENERATIONS PASSED — immutable root, append-only undo/remerge alternation, same-product checks, current effective lineage and legacy compatibility')
