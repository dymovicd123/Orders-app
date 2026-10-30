import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {
 beginCriticalOperation,advanceCriticalOperation,updateCriticalOperationTargetFromLastInsert,
 insertCriticalMappedEntity,criticalOperationEntityId,failCriticalOperation,
 completeCriticalOperation,CriticalOperationConflictError,
} from '../worker/domains/critical.ts'
import {admitOrderReservationAtomically} from '../worker/domains/reservation-admission.ts'

const sql=new DatabaseSync(':memory:')
sql.exec('PRAGMA foreign_keys=ON;')
sql.exec(readFileSync('migrations/0059_v72_critical_operation_idempotency.sql','utf8'))
sql.exec([
 'CREATE TABLE orders(id INTEGER PRIMARY KEY,external_id TEXT,shipping_status TEXT)',
 'CREATE TABLE order_items(id INTEGER PRIMARY KEY,order_id INTEGER,stock_writeoff_status TEXT,stock_quantity_before INTEGER,stock_quantity_after INTEGER)',
 'CREATE TABLE inventory_stock(id INTEGER PRIMARY KEY,inventory_source TEXT,variant_id INTEGER,quantity INTEGER,reserved_quantity INTEGER,product_id INTEGER,product_name_snapshot TEXT,gender_snapshot TEXT,color_snapshot TEXT,material_snapshot TEXT,length_snapshot TEXT,size_snapshot TEXT,last_action TEXT,last_source_ref TEXT,updated_at TEXT)',
 'CREATE TABLE inventory_reservations(id INTEGER PRIMARY KEY,order_id INTEGER,order_item_id INTEGER UNIQUE,inventory_source TEXT,product_id INTEGER,variant_id INTEGER,quantity INTEGER,status TEXT,reference_type TEXT,reference_id TEXT,unresolved_reason TEXT,created_at TEXT,updated_at TEXT)',
 "INSERT INTO inventory_stock(id,inventory_source,variant_id,quantity,reserved_quantity) VALUES (1,'warehouse',7,1,0)",
].join(';\n')+';')
function prepared(query,params=[]){
 return {
  bind(...args){return prepared(query,args)},
  async first(){return sql.prepare(query).get(...params)||null},
  async all(){return {results:sql.prepare(query).all(...params)}},
  async run(){const r=sql.prepare(query).run(...params);return {meta:{changes:Number(r.changes),last_row_id:Number(r.lastInsertRowid)}}},
 }
}
const db={
 prepare:query=>prepared(query),
 async batch(stmts){
  sql.exec('BEGIN IMMEDIATE')
  try{
   const items=[]
   for(const stmt of stmts)items.push(await stmt.run())
   sql.exec('COMMIT');return items
  }catch(e){sql.exec('ROLLBACK');throw e}
 }
}
const values=()=>({
 orders:sql.prepare('SELECT COUNT(*) AS n FROM orders').get().n,
 items:sql.prepare('SELECT COUNT(*) AS n FROM order_items').get().n,
 reservations:sql.prepare('SELECT COUNT(*) AS n FROM inventory_reservations').get().n,
 stock:sql.prepare('SELECT quantity,reserved_quantity FROM inventory_stock WHERE id=1').get(),
})
const payload={externalId:'TEST-RETRY',items:[{variantId:7,quantity:1}]}
let operation=await beginCriticalOperation(db,'order_create','safe-create-retry-1',payload)
await advanceCriticalOperation(db,operation,'validated',{context:{plan:payload}})
const target=await updateCriticalOperationTargetFromLastInsert(db,operation,'order','TEST-RETRY',
 db.prepare("INSERT INTO orders(external_id,shipping_status) VALUES('TEST-RETRY','not_sent')"),'order_created')
const orderId=Number(target)
assert(orderId>0)
const savedItem=await insertCriticalMappedEntity(db,operation,'order_item','item:0',
 db.prepare('INSERT INTO order_items(order_id,stock_writeoff_status) VALUES(?,?)').bind(orderId,'pending_reservation'))
assert(savedItem.id>0)
// Server crashes after order and item were inserted but BEFORE reserve admission.
await failCriticalOperation(db,operation,new Error('simulated dropped connection after item insert'))
operation=await beginCriticalOperation(db,'order_create','safe-create-retry-1',payload)
assert.equal(operation.row.step,'order_created')
const recoveredId=await criticalOperationEntityId(db,operation.requestId,'order_item','item:0')
assert.equal(recoveredId,savedItem.id)
const mappedAgain=await insertCriticalMappedEntity(db,operation,'order_item','item:0',
 db.prepare('INSERT INTO order_items(order_id,stock_writeoff_status) VALUES(?,?)').bind(orderId,'pending_reservation'))
assert.equal(mappedAgain.id,recoveredId)
assert.equal(mappedAgain.created,false)
const result=await admitOrderReservationAtomically(db,{
 orderId,orderItemId:recoveredId,source:'warehouse',stockId:1,productId:1,variantId:7,
 quantity:1,productName:'КЕБЕК',gender:'МУЖ',color:'БЕЖ',material:'СТАНДАРТ',length:'СТАНДАРТ',size:'50',
 referenceType:'order',referenceId:'TEST-RETRY',timestamp:new Date().toISOString(),
 shortageAcknowledged:false,shortageDecision:null,
})
assert.equal(result.status,'active')
assert.equal(values().stock.reserved_quantity,1)
// Another interruption after successful atomic reservation, before operation completed.
await failCriticalOperation(db,operation,new Error('simulated network loss after reservation batch'))
operation=await beginCriticalOperation(db,'order_create','safe-create-retry-1',payload)
assert.equal(operation.row.step,'order_created')
assert.equal(sql.prepare('SELECT status FROM inventory_reservations WHERE order_item_id=?').get(recoveredId).status,'active')
// Production resume consults the mapped entity and existing reservation; no new
// insert or reserve call is allowed for that id on a retry.
const snap=values()
await advanceCriticalOperation(db,operation,'content_written',{context:{plan:payload}})
await completeCriticalOperation(db,operation,{ok:true,orderId,externalId:'TEST-RETRY'})
const replay=await beginCriticalOperation(db,'order_create','safe-create-retry-1',payload)
assert.deepEqual(replay.cachedResponse,{ok:true,orderId,externalId:'TEST-RETRY'})
assert.deepEqual({...values().stock},{...snap.stock})
assert.equal(values().orders,1)
assert.equal(values().items,1)
assert.equal(values().reservations,1)
await assert.rejects(()=>beginCriticalOperation(db,'order_create','safe-create-retry-1',{
 ...payload,items:[{variantId:7,quantity:2}]
}),e=>e instanceof CriticalOperationConflictError)
const worker=readFileSync('worker/domains/orders-write.ts','utf8')
assert.match(worker,/criticalOperation\.row\.step === 'order_created'/)
assert.match(worker,/await insertOrderContent\(/)
assert.match(worker,/await completeCriticalOperation\(db, criticalOperation, response\)/)
console.log('P0_CRITICAL_RETRY_PASSED: partial create and mapped item resume, crash after reserve, one physical-neutral reserve, cached replay, fingerprint mismatch')
