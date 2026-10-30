// Standalone local SQLite regression: no remote D1, network, or production data.
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import {
  prepareCriticalMappedInsert, insertCriticalMappedEntity, CriticalOperationBusyError,
} from '../worker/domains/critical.ts'

const sql = new DatabaseSync(':memory:')
for(const statement of [
 'CREATE TABLE critical_operations (request_id TEXT PRIMARY KEY, status TEXT NOT NULL, lease_token TEXT)',
 'CREATE TABLE critical_operation_entities (request_id TEXT NOT NULL, entity_type TEXT NOT NULL, entity_key TEXT NOT NULL, entity_id INTEGER NOT NULL, created_at TEXT NOT NULL, UNIQUE(request_id, entity_type, entity_key))',
 'CREATE TABLE order_items (id INTEGER PRIMARY KEY AUTOINCREMENT, description TEXT)',
 'CREATE TABLE order_manager_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, description TEXT)',
 'CREATE TABLE activity_log (id INTEGER PRIMARY KEY AUTOINCREMENT, description TEXT)',
 "INSERT INTO critical_operations VALUES ('r1','started','lease-a')",
]) sql.exec(statement)
let beforeBatch = null
function stmt(query, bindings=[]) {
 return {
   sql:query,
   bind(...values) { return stmt(query,values) },
   async first(){ return sql.prepare(query).get(...bindings)??null },
   async run(){
     const r=sql.prepare(query).run(...bindings)
     return {success:true,meta:{changes:Number(r.changes),last_row_id:Number(r.lastInsertRowid)}}
   }
 }
}
const db={
 prepare:stmt,
 async batch(statements) {
   if(beforeBatch){const callback=beforeBatch;beforeBatch=null;callback()}
   sql.exec('BEGIN IMMEDIATE')
   try {
     const values=[]
     for(const statement of statements)values.push(await statement.run())
     sql.exec('COMMIT')
     return values
   } catch(error) {
     sql.exec('ROLLBACK')
     throw error
   }
 }
}
const handle=(lease='lease-a')=>({requestId:'r1',operationType:'order_create',leaseToken:lease,
 fingerprint:'',row:{status:'started'},cachedResponse:null})
const count=table=>sql.prepare('SELECT COUNT(*) AS n FROM '+table).get().n
const insert=async (table,type,key,description,operation=handle())=>{
 const prepared=prepareCriticalMappedInsert(db,
  'INSERT INTO '+table+' (description) VALUES (?)',[description],operation,type,key)
 return insertCriticalMappedEntity(db,operation,type,key,prepared)
}
// Normal creation: entity key and row are committed together.
const first=await insert('order_items','order_item','item-1','created')
assert.equal(first.created,true)
assert.equal(first.id,1)
assert.equal(count('order_items'),1)
assert.equal(count('critical_operation_entities'),1)
// Retry after success: existing entity mapping wins; no duplicate row.
const repeated=await insert('order_items','order_item','item-1','duplicate')
assert.deepEqual(repeated,{id:1,created:false})
assert.equal(count('order_items'),1)
// Stale lease immediately before db.batch: no order item or mapping.
beforeBatch=()=>sql.prepare("UPDATE critical_operations SET lease_token='lease-b' WHERE request_id='r1'").run()
await assert.rejects(
 insert('order_items','order_item','item-2','stale'),
 error=>error instanceof CriticalOperationBusyError
)
assert.equal(count('order_items'),1)
assert.equal(count('critical_operation_entities'),1)
// New current owner retries with same key; exactly one item.
const owner=handle('lease-b')
assert.equal((await insert('order_items','order_item','item-2','new owner',owner)).created,true)
assert.equal(count('order_items'),2)
// A concurrent replay completes the same key after the initial pre-read
// but before the caller's batch. Conditional business INSERT must skip it.
beforeBatch=()=>{
 const row=sql.prepare("INSERT INTO order_manager_audit(description) VALUES ('other owner')").run()
 sql.prepare('INSERT INTO critical_operation_entities VALUES (?, ?, ?, ?, ?)')
  .run('r1','order_manager_audit','manager_changed',Number(row.lastInsertRowid),'2026-10-30')
}
const raced=await insert('order_manager_audit','order_manager_audit','manager_changed','duplicate audit',owner)
assert.deepEqual(raced,{id:1,created:false})
assert.equal(count('order_manager_audit'),1)
// Separate activity key must insert once, including retry.
const act=await insert('activity_log','activity_log','order_updated','edit',owner)
assert.equal(act.created,true)
assert.equal((await insert('activity_log','activity_log','order_updated','edit again',owner)).created,false)
assert.equal(count('activity_log'),1)
assert.equal(count('critical_operation_entities'),4)
console.log('P0_MAPPED_ENTITY_LEASE_SQL_PASSED — stale owner cannot create orphan; concurrent replay, item/audit/activity map exactly once')
