import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {
 beginCriticalOperation, advanceCriticalOperation,
 updateCriticalOperationTargetFromLastInsert, insertCriticalMappedEntity, CriticalOperationBusyError
} from '../worker/domains/critical.ts'

// Real SQLite statements, with D1's trigger-inclusive reported changes count.
// Important: the SQL changes() function still counts the direct INSERT only.
const sql=new DatabaseSync(':memory:')
sql.exec(`
 CREATE TABLE critical_operations(
 request_id TEXT PRIMARY KEY,operation_type TEXT,request_fingerprint TEXT,
 status TEXT,step TEXT,target_type TEXT,target_id INTEGER,target_ref TEXT,
 context_json TEXT,response_json TEXT,lease_token TEXT,lease_until_ms INTEGER,
 last_error TEXT,created_at TEXT,updated_at TEXT,completed_at TEXT);
 CREATE TABLE orders(id INTEGER PRIMARY KEY,external_id TEXT);
 CREATE TABLE order_items(id INTEGER PRIMARY KEY,order_id INTEGER);
 CREATE TABLE critical_operation_entities(request_id TEXT,entity_type TEXT,entity_key TEXT,entity_id INTEGER,created_at TEXT,PRIMARY KEY(request_id,entity_type,entity_key));
`)
function statement(query,args=[]){
 return {
  sql: query,
  bind(...values){return statement(query,values)},
  async first(){return sql.prepare(query).get(...args)||null},
  async run(){const result=sql.prepare(query).run(...args);return {meta:{changes:Number(result.changes),last_row_id:Number(result.lastInsertRowid)}}}
 }
}
const db={
 prepare:query=>statement(query),
 async batch(statements){
  sql.exec('BEGIN IMMEDIATE')
  try{
   const results=[]
   for(const s of statements)results.push(await s.run())
   // Emulate native local D1: the reported INSERT meta.changes is 4 when
   // one direct order row and three auxiliary trigger rows are affected.
   if(results[0]?.meta?.changes===1)results[0].meta.changes=4
   if(statements[1]?.sql?.includes('INSERT INTO critical_operation_entities') && results[1]?.meta?.changes===1)results[1].meta.changes=3
   sql.exec('COMMIT')
   return results
  }catch(error){sql.exec('ROLLBACK');throw error}
 }
}
async function op(key){
 const handle=await beginCriticalOperation(db,'order_create',key,{total:1})
 await advanceCriticalOperation(db,handle,'validated')
 return handle
}
const first=await op('native-meta-success')
const id=await updateCriticalOperationTargetFromLastInsert(
 db,first,'order','META-OK',
 db.prepare('INSERT INTO orders(external_id) SELECT ? FROM critical_operations WHERE request_id=? AND status=? AND step=? AND lease_token=?')
  .bind('META-OK',first.requestId,'started','validated',first.leaseToken),
 'order_created'
)
assert.equal(id,1)
assert.equal(first.row.target_id,1)
assert.equal(sql.prepare("SELECT external_id FROM orders WHERE id=1").get().external_id,'META-OK')
const createdItem=await insertCriticalMappedEntity(
 db,first,'order_item','item:0',
 db.prepare('INSERT INTO order_items(order_id) VALUES(?)').bind(id)
)
assert.equal(createdItem.created,true)
assert.equal(createdItem.id,1)
assert.equal(sql.prepare("SELECT entity_id FROM critical_operation_entities WHERE request_id='native-meta-success' AND entity_key='item:0'").get().entity_id,1)
const itemReplay=await insertCriticalMappedEntity(
 db,first,'order_item','item:0',
 db.prepare('INSERT INTO order_items(order_id) VALUES(?)').bind(id)
)
assert.equal(itemReplay.created,false)
assert.equal(itemReplay.id,1)
assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM order_items').get().n,1)

// Even with an active lease, a skipped insert cannot advance that lease.
const skipped=await op('native-meta-zero')
await assert.rejects(
 ()=>updateCriticalOperationTargetFromLastInsert(
  db,skipped,'order','NO-ROW',db.prepare("INSERT INTO orders(external_id) SELECT 'NO-ROW' WHERE 0"),'order_created'),
 e=>e instanceof CriticalOperationBusyError
)
assert.equal(sql.prepare("SELECT step FROM critical_operations WHERE request_id='native-meta-zero'").get().step,'validated')
assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM orders').get().n,1)
// A stale actor cannot insert an order, and the previous last_insert_rowid()
// must not be wrongly mapped to this operation.
const stale=await op('native-meta-stale')
sql.prepare("UPDATE critical_operations SET lease_token='other-owner' WHERE request_id=?").run(stale.requestId)
await assert.rejects(
 ()=>updateCriticalOperationTargetFromLastInsert(db,stale,'order','STALE',
  db.prepare('INSERT INTO orders(external_id) SELECT ? FROM critical_operations WHERE request_id=? AND step=? AND lease_token=?')
    .bind('STALE',stale.requestId,'validated',stale.leaseToken),'order_created'),
 e=>e instanceof CriticalOperationBusyError
)
assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM orders').get().n,1)
assert.equal(sql.prepare("SELECT target_id FROM critical_operations WHERE request_id='native-meta-stale'").get().target_id,null)
console.log('CRITICAL_NATIVE_D1_TRIGGER_INCLUSIVE_META_ACCEPTANCE_PASS: direct INSERT 1/meta 4 allowed for order and item mapping; zero/stale INSERT rejected with no phantom orders')
sql.close()
