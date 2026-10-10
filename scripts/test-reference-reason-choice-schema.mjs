import assert from 'node:assert/strict'
import fs from 'node:fs'
import {DatabaseSync} from 'node:sqlite'

const db=new DatabaseSync(':memory:')
db.exec("PRAGMA foreign_keys=ON; CREATE TABLE reference_values(id INTEGER PRIMARY KEY,kind TEXT,value TEXT,is_active INTEGER DEFAULT 1,updated_at TEXT DEFAULT 'seed'); INSERT INTO reference_values(id,kind,value) VALUES(1,'return_reason','РАЗМЕР'),(2,'return_reason','НЕ ПОДОШЁЛ РАЗМЕР'),(3,'writeoff_reason','БРАК'),(4,'writeoff_reason','ПОРЧА')")
const migration=fs.readFileSync('migrations/0105_v72_reference_reason_choice_merges.sql','utf8')
assert.doesNotMatch(migration,/^\s*(?:UPDATE|DELETE|REPLACE|DROP|ALTER)\s+/gmi)
db.exec(migration)
db.exec(migration)
assert.equal(db.prepare('SELECT COUNT(*) n FROM reference_reason_choice_merges').get().n,0)
assert.equal(db.prepare('SELECT COUNT(*) n FROM reference_reason_choice_validations').get().n,0)
const write=db.prepare("INSERT INTO reference_reason_choice_merges(kind,source_reference_id,target_reference_id,source_value,target_value,source_updated_at,target_updated_at,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?)")
write.run('return_reason',1,2,'РАЗМЕР','НЕ ПОДОШЁЛ РАЗМЕР','seed','seed','admin','2026-10-10T00:00:00Z')
const id=db.prepare('SELECT id FROM reference_reason_choice_merges').get().id
db.prepare("INSERT INTO reference_reason_choice_validations(merge_id,passed,checked_at) VALUES(?,1,'2026-10-10T00:00:00Z')").run(id)
assert.throws(()=>db.prepare("INSERT INTO reference_reason_choice_validations(merge_id,passed,checked_at) VALUES(?,0,'now')").run(id+1))
assert.throws(()=>write.run('return_reason',1,2,'РАЗМЕР','НЕ ПОДОШЁЛ РАЗМЕР','seed','seed','admin','2026-10-10'))
assert.throws(()=>write.run('payment_method',3,4,'БРАК','ПОРЧА','seed','seed','admin','2026-10-10'))
assert.throws(()=>write.run('writeoff_reason',3,3,'БРАК','БРАК','seed','seed','admin','2026-10-10'))
assert.throws(()=>db.prepare("UPDATE reference_reason_choice_merges SET target_value='X' WHERE id=?").run(id))
assert.throws(()=>db.prepare('DELETE FROM reference_reason_choice_merges WHERE id=?').run(id))
assert.throws(()=>db.prepare('DELETE FROM reference_reason_choice_validations WHERE merge_id=?').run(id))
assert.throws(()=>db.prepare('UPDATE reference_reason_choice_validations SET checked_at=? WHERE merge_id=?').run('now',id))
assert.equal(db.prepare("SELECT is_active FROM reference_values WHERE id=1").get().is_active,1)
console.log('REFERENCE REASON 0105 SCHEMA PASSED: empty audit, idempotent migration, immutable proof, original values untouched')
db.close()
