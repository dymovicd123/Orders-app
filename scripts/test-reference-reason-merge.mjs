import assert from 'node:assert/strict'
import fs from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {previewUserSelectedReferenceMerge} from '../worker/domains/reference-merge-preview.ts'
import {applyReasonChoiceMerge} from '../worker/domains/reference-reason-merge.ts'
import {listRecentReferenceValueMerges} from '../worker/domains/reference-merge-history.ts'
import {publicApiError} from '../worker/core/http.ts'

const sql=new DatabaseSync(':memory:')
sql.exec(`
 PRAGMA foreign_keys=ON;
 CREATE TABLE reference_values(id INTEGER PRIMARY KEY,kind TEXT,value TEXT,is_active INTEGER NOT NULL DEFAULT 1,updated_at TEXT DEFAULT 'seed');
 CREATE TABLE returns(id INTEGER PRIMARY KEY,comment TEXT);
 CREATE TABLE inventory_movements(id INTEGER PRIMARY KEY,comment TEXT,quantity_delta INTEGER);
 CREATE TABLE orders(id INTEGER PRIMARY KEY,comment TEXT);
 INSERT INTO reference_values(id,kind,value) VALUES
  (1,'return_reason','НЕ ПОДОШЕЛ РАЗМЕР'),(2,'return_reason','НЕ ПОДОШЁЛ РАЗМЕР'),
  (3,'writeoff_reason','ИСПОРЧЕНО'),(4,'writeoff_reason','ПОРЧА'),
  (5,'payment_method','ТЕРМИНАЛ');
 INSERT INTO returns VALUES (10,'НЕ ПОДОШЕЛ РАЗМЕР — клиент отказался');
 INSERT INTO inventory_movements VALUES (20,'ИСПОРЧЕНО — списано с бутика',-3);
 INSERT INTO orders VALUES (30,'Архивный заказ, НЕ ПОДОШЕЛ РАЗМЕР');
 CREATE TABLE reference_value_merges(id INTEGER PRIMARY KEY,kind TEXT,source_value TEXT,target_value TEXT,
    expected_orders INTEGER,created_by TEXT,created_at TEXT,source_reference_id INTEGER,target_reference_id INTEGER);
 CREATE TABLE reference_payment_method_merges(id INTEGER PRIMARY KEY,source_value TEXT,target_value TEXT,
    expected_rows INTEGER,created_by TEXT,created_at TEXT,source_reference_id INTEGER,target_reference_id INTEGER);
`)
sql.exec(fs.readFileSync('migrations/0105_v72_reference_reason_choice_merges.sql','utf8'))
let beforeFinal=()=>{}
const db={
 prepare(query){
  return {
   async all(){return {results:sql.prepare(query).all()}},
   bind(...args){
   const st=sql.prepare(query)
   return {
    async first(){return st.get(...args)||null},
    async all(){return {results:st.all(...args)}},
    async run(){
     if(query.startsWith('INSERT INTO reference_reason_choice_validations'))beforeFinal()
     return {meta:{changes:Number(st.run(...args).changes)}}
    },
   }
  }}
 },
 async batch(statements){
  sql.exec('BEGIN IMMEDIATE')
  try{
   const result=[]
   for(const statement of statements) result.push(await statement.run())
   sql.exec('COMMIT')
   return result
  }catch(e){sql.exec('ROLLBACK');throw e}
 },
}
const ref=id=>sql.prepare('SELECT is_active FROM reference_values WHERE id=?').get(id).is_active
const history=()=>JSON.stringify([
 sql.prepare('SELECT * FROM returns').all(),
 sql.prepare('SELECT * FROM inventory_movements').all(),
 sql.prepare('SELECT * FROM orders').all(),
])
const historical=history()
const now=new Date('2026-10-10T12:00:00Z')
let preview=await previewUserSelectedReferenceMerge(db,1,2,now)
assert.equal(preview.canApply,true)
assert.equal(preview.reasonSafety?.historicalRecordsPreserved,true)
assert.equal(preview.ordersCovered,false)
assert.equal(preview.orders.current,0)
assert.ok(preview.stateToken.length===64)
await assert.rejects(()=>applyReasonChoiceMerge(db,1,2,'bad','admin',now),
 error=>publicApiError(error).status===409)
assert.equal(ref(1),1)

// SQL postcondition must abort the whole batch if source/keeper state changes in between.
beforeFinal=()=>{
 beforeFinal=()=>{}
 sql.prepare('UPDATE reference_values SET is_active=1 WHERE id=?').run(1)
}
await assert.rejects(()=>applyReasonChoiceMerge(db,1,2,preview.stateToken,'admin',now),/CHECK constraint/)
assert.equal(ref(1),1,'Validation failure must roll back source retirement')
assert.equal(sql.prepare('SELECT COUNT(*) n FROM reference_reason_choice_merges').get().n,0)
assert.equal(history(),historical)

preview=await previewUserSelectedReferenceMerge(db,1,2,now)
const result=await applyReasonChoiceMerge(db,1,2,preview.stateToken,'admin',now)
assert.equal(result.ok,true)
assert.equal(result.ordersUpdated,0)
assert.equal(result.historicalRecordsPreserved,true)
assert.equal(ref(1),0)
assert.equal(ref(2),1)
assert.equal(history(),historical,'Historical comments, orders and stock movements must not be edited')
assert.equal(sql.prepare('SELECT COUNT(*) n FROM reference_reason_choice_validations').get().n,1)
assert.equal(sql.prepare('SELECT kind FROM reference_reason_choice_merges').get().kind,'return_reason')
assert.equal((await applyReasonChoiceMerge(db,1,2,preview.stateToken,'admin',now)).alreadyMerged,true)
await assert.rejects(()=>applyReasonChoiceMerge(db,1,4,preview.stateToken,'admin',now))
const recorded=await listRecentReferenceValueMerges(db)
assert.equal(recorded.items[0].kind,'return_reason')
assert.equal(recorded.items[0].source,'НЕ ПОДОШЕЛ РАЗМЕР')
assert.equal(recorded.items[0].target,'НЕ ПОДОШЁЛ РАЗМЕР')

const prevWriteoff=await previewUserSelectedReferenceMerge(db,3,4,now)
assert.equal(prevWriteoff.canApply,true)
sql.prepare("UPDATE reference_values SET updated_at='edited' WHERE id=4").run()
await assert.rejects(()=>applyReasonChoiceMerge(db,3,4,prevWriteoff.stateToken,'admin',now),
 error=>publicApiError(error).status===409)
assert.equal(ref(3),1)
const currentWriteoff=await previewUserSelectedReferenceMerge(db,3,4,now)
assert.equal((await applyReasonChoiceMerge(db,3,4,currentWriteoff.stateToken,'admin',now)).merged,true)
assert.equal(ref(3),0)
assert.equal(ref(4),1)
assert.equal(history(),historical)
assert.equal((await listRecentReferenceValueMerges(db)).items.length,2)
await assert.rejects(()=>previewUserSelectedReferenceMerge(db,5,2,now),/одного справочника/)
assert.equal(sql.prepare('SELECT COUNT(*) n FROM reference_reason_choice_merges').get().n,2)

const router=fs.readFileSync('worker/index.ts','utf8')
const ui=fs.readFileSync('src/features/sections/ReferenceMergeWorkspace.tsx','utf8')
assert.match(router,/applyReasonChoiceMerge\(/)
assert.match(router,/choice\?\.kind==='return_reason'\|\|choice\?\.kind==='writeoff_reason'/)
assert.match(ui,/impact\.reasonSafety/)
assert.match(ui,/Старые возвраты, списания и комментарии не изменятся/)
console.log('REASON CHOICE MERGE PASSED — admin only, SQL atomic rollback, stale guard, two categories, history, no historical mutations')
sql.close()
