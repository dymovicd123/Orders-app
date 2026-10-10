import assert from 'node:assert/strict'
import fs from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { listRecentReferenceValueMerges } from '../worker/domains/reference-merge-history.ts'
const sqlite=new DatabaseSync(':memory:')
sqlite.exec(`
CREATE TABLE reference_values(id INTEGER PRIMARY KEY,kind TEXT,value TEXT,is_active INTEGER);
CREATE TABLE orders(id INTEGER PRIMARY KEY);
`)
sqlite.exec(fs.readFileSync('migrations/0093_v72_reference_value_choice_merges.sql','utf8'))
sqlite.exec(fs.readFileSync('migrations/0094_v72_reference_payment_method_merges.sql','utf8'))
sqlite.exec(fs.readFileSync('migrations/0105_v72_reference_reason_choice_merges.sql','utf8'))
sqlite.exec(`
 INSERT INTO reference_values VALUES
  (1,'city','АЛМАТЫ',0),(2,'city','АСТАНА',1),
  (3,'payment_method','ТЕРМИНАЛ',0),(4,'payment_method','KASPI PAY',1),
  (5,'return_reason','РАЗМЕР',0),(6,'return_reason','НЕ ПОДОШЁЛ РАЗМЕР',1);
 INSERT INTO reference_value_merges(kind,source_reference_id,target_reference_id,source_value,target_value,
 month_start,month_next,expected_orders,created_by,created_at)
 VALUES('city',1,2,'АЛМАТЫ','АСТАНА','2026-10-01','2026-11-01',2,'admin','2026-10-09T10:00:00Z');
 INSERT INTO reference_payment_method_merges(source_reference_id,target_reference_id,source_value,target_value,
 month_start,month_next,expected_rows,source_fingerprint,created_by,created_at)
 VALUES(3,4,'ТЕРМИНАЛ','KASPI PAY','2026-10-01','2026-11-01',7,'abc','staff','2026-10-09T11:00:00Z');
 INSERT INTO reference_reason_choice_merges(kind,source_reference_id,target_reference_id,source_value,target_value,created_by,created_at)
 VALUES('return_reason',5,6,'РАЗМЕР','НЕ ПОДОШЁЛ РАЗМЕР','admin','2026-10-09T12:00:00Z');
`)
const db={prepare(query){return {async all(){return {results:sqlite.prepare(query).all()}}}}}
const history=await listRecentReferenceValueMerges(db)
assert.equal(history.ok,true)
assert.equal(history.items.length,3)
assert.equal(history.items[0].kind,'return_reason')
assert.equal(history.items[0].source,'РАЗМЕР')
assert.equal(history.items[0].target,'НЕ ПОДОШЁЛ РАЗМЕР')
assert.equal(history.items[0].affected,0)
assert.equal(history.items[1].kind,'payment_method')
assert.equal(history.items[1].source,'ТЕРМИНАЛ')
assert.equal(history.items[1].target,'KASPI PAY')
assert.equal(history.items[1].affected,7)
assert.equal(history.items[1].actor,'staff')
assert.equal(history.items[2].kind,'city')
assert.equal(history.items[2].affected,2)
const panel=fs.readFileSync('src/features/sections/ReferenceMergeWorkspace.tsx','utf8')
const worker=fs.readFileSync('worker/index.ts','utf8')
assert.match(panel,/Посмотреть историю объединений/)
assert.match(panel,/item\.source/)
assert.match(panel,/item\.target/)
assert.match(worker,/\/api\/reference-values\/merge-history/)
console.log('REFERENCE MERGE HISTORY PASSED — past value and chosen keeper, actor, audit count, chronological list')
