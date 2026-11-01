import assert from 'node:assert/strict'
import fs from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {inspectPendingReservation,resolvePendingReservation,PendingReservationError} from '../worker/domains/pending-reservation.ts'

const dbSql=new DatabaseSync(':memory:')
dbSql.exec([
  "CREATE TABLE orders(id INTEGER PRIMARY KEY,external_id TEXT,order_status TEXT,archived_at TEXT,shipping_status TEXT)",
  "CREATE TABLE order_items(id INTEGER PRIMARY KEY,order_id INTEGER,stock_writeoff_status TEXT,is_workshop INTEGER,quantity INTEGER,source_type TEXT,variant_id INTEGER,product_name_snapshot TEXT,stock_quantity_before INTEGER,stock_quantity_after INTEGER)",
  "CREATE TABLE inventory_stock(id INTEGER PRIMARY KEY,inventory_source TEXT,variant_id INTEGER,quantity INTEGER,reserved_quantity INTEGER,updated_at TEXT,last_action TEXT,last_source_ref TEXT)",
  "CREATE TABLE inventory_reservations(id INTEGER PRIMARY KEY,order_id INTEGER,order_item_id INTEGER,inventory_source TEXT,variant_id INTEGER,status TEXT,unresolved_reason TEXT,reference_type TEXT,reference_id TEXT,quantity INTEGER,updated_at TEXT)",
  "CREATE TABLE returns(id INTEGER PRIMARY KEY,status TEXT)",
  "CREATE TABLE return_items(id INTEGER PRIMARY KEY,order_item_id INTEGER,return_id INTEGER,quantity INTEGER)",
  "CREATE TABLE activity_log(id INTEGER PRIMARY KEY,event_type TEXT,entity_type TEXT,entity_id INTEGER,order_id INTEGER,external_order_id TEXT,title TEXT,details TEXT,amount INTEGER,created_at TEXT)",
  "INSERT INTO orders VALUES (10,'ORDER-A','active',NULL,'not_sent')",
  "INSERT INTO order_items(id,order_id,stock_writeoff_status,is_workshop,quantity,source_type,variant_id,product_name_snapshot) VALUES(101,10,'pending_reservation',0,1,'warehouse',7,'КЕБЕК')",
  "INSERT INTO inventory_stock(id,inventory_source,variant_id,quantity,reserved_quantity) VALUES(1,'warehouse',7,1,1)",
  "INSERT INTO inventory_reservations(id,order_id,order_item_id,inventory_source,variant_id,status,unresolved_reason,reference_type,quantity) VALUES(11,10,101,'warehouse',7,'unresolved','concurrent_shortage','order',1)",
].join(';\n')+';')
const adapter={
  prepare(sql){return {bind(...args){return {
    first:async()=>dbSql.prepare(sql).get(...args)||null,
    run:()=>dbSql.prepare(sql).run(...args),
    all:async()=>({results:dbSql.prepare(sql).all(...args)})
  }}}},
  async batch(statements){
    dbSql.exec('BEGIN IMMEDIATE')
    try{const r=statements.map(s=>s.run());dbSql.exec('COMMIT');return r.map(meta=>({meta}))}
    catch(e){dbSql.exec('ROLLBACK');throw e}
  }
}
const actor={id:27,displayName:'Менеджер'}
const stat=()=>dbSql.prepare('SELECT quantity,reserved_quantity FROM inventory_stock WHERE id=1').get()
const status=(id=11)=>dbSql.prepare('SELECT status,unresolved_reason FROM inventory_reservations WHERE id=?').get(id)
const logs=()=>dbSql.prepare("SELECT COUNT(*) AS n FROM activity_log WHERE event_type='order_pending_reservation_resolved'").get().n
const expectedError=async(fn)=>{await assert.rejects(fn,e=>e instanceof PendingReservationError)}
const preview=await inspectPendingReservation(adapter,10,101)
assert.equal(preview.pending,true)
assert.equal(preview.freeQuantity,0)
assert.equal(preview.shortage,1)
await expectedError(()=>resolvePendingReservation(adapter,10,101,{snapshot:preview.snapshot,allowShortage:false},actor))
assert.equal(stat().reserved_quantity,1,'Explicit consent absent: no stock mutation')
await expectedError(()=>resolvePendingReservation(adapter,10,101,{snapshot:{...preview.snapshot,reservedQuantity:0},allowShortage:true},actor))
assert.equal(stat().reserved_quantity,1,'Stale snapshot must not be accepted')
// Another employee modifies the stock between preview and confirmation.
dbSql.prepare('UPDATE inventory_stock SET reserved_quantity=2 WHERE id=1').run()
await expectedError(()=>resolvePendingReservation(adapter,10,101,{snapshot:preview.snapshot,allowShortage:true},actor))
assert.equal(status().status,'unresolved')
dbSql.prepare('UPDATE inventory_stock SET reserved_quantity=1 WHERE id=1').run()
const result=await resolvePendingReservation(adapter,10,101,{snapshot:preview.snapshot,allowShortage:true},actor)
assert.equal(result.resolved,true)
assert.equal(status().status,'active')
assert.equal(stat().quantity,1,'Explicit shortage acknowledgement must not create physical units')
assert.equal(stat().reserved_quantity,2)
assert.equal(logs(),1)
const evidence=dbSql.prepare('SELECT details FROM activity_log LIMIT 1').get()
assert.equal(JSON.parse(evidence.details).actorId,27)
assert.equal(JSON.parse(evidence.details).decision,'confirmed_shortage')
const replay=await resolvePendingReservation(adapter,10,101,{snapshot:preview.snapshot,allowShortage:true},actor)
assert.equal(replay.alreadyResolved,true)
assert.equal(stat().reserved_quantity,2,'Retry cannot double-reserve')
assert.equal(logs(),1,'Retry cannot duplicate consent evidence')
// Fresh available stock can be committed without deliberate overbooking.
dbSql.exec([
  "INSERT INTO orders VALUES(20,'ORDER-B','active',NULL,'not_sent')",
  "INSERT INTO order_items(id,order_id,stock_writeoff_status,is_workshop,quantity,source_type,variant_id,product_name_snapshot) VALUES(201,20,'pending_reservation',0,1,'warehouse',7,'КЕБЕК')",
  "INSERT INTO inventory_reservations(id,order_id,order_item_id,inventory_source,variant_id,status,unresolved_reason,reference_type,quantity) VALUES(21,20,201,'warehouse',7,'unresolved','concurrent_shortage','order',1)",
  "UPDATE inventory_stock SET quantity=4 WHERE id=1"
].join(';\n')+';')
const available=await inspectPendingReservation(adapter,20,201)
assert.equal(available.shortage,0)
await resolvePendingReservation(adapter,20,201,{snapshot:available.snapshot,allowShortage:false},actor)
assert.equal(status(21).status,'active')
assert.equal(stat().reserved_quantity,3)
// Returned, sent, archived and mismatched-source items may not be confirmed.
const forbid=async(sql)=>{
  dbSql.exec('SAVEPOINT invalid_case')
  try{dbSql.exec(sql);await expectedError(()=>inspectPendingReservation(adapter,20,201))}
  finally{dbSql.exec('ROLLBACK TO invalid_case; RELEASE invalid_case')}
}
await forbid("UPDATE inventory_reservations SET status='unresolved',unresolved_reason='concurrent_shortage' WHERE id=21; UPDATE orders SET shipping_status='sent' WHERE id=20")
await forbid("UPDATE inventory_reservations SET status='unresolved',unresolved_reason='concurrent_shortage' WHERE id=21; UPDATE orders SET archived_at='2026-10-30' WHERE id=20")
await forbid("UPDATE inventory_reservations SET status='unresolved',unresolved_reason='concurrent_shortage' WHERE id=21; UPDATE order_items SET source_type='boutique' WHERE id=201")
await forbid("UPDATE inventory_reservations SET status='unresolved',unresolved_reason='concurrent_shortage' WHERE id=21; INSERT INTO returns VALUES(1,'completed'); INSERT INTO return_items VALUES(1,201,1,1)")
// The real API is session-authenticated and exposes an explicit GET preview/POST.
const worker=fs.readFileSync('worker/index.ts','utf8')
const view=fs.readFileSync('src/features/sections/OrdersTableSection.tsx','utf8')
assert(worker.includes('pendingReservationMatch') && worker.includes('pending-reservation'), 'Pending route must exist')
assert.match(worker,/inspectPendingReservation\(env\.DB,orderId,orderItemId\)/)
assert.match(worker,/resolvePendingReservation\(env\.DB,orderId,orderItemId,input/)
assert.match(view,/Подтвердить резерв при нехватке/)
assert.match(view,/Закрепить доступный резерв/)
assert.match(view,/item\.stockWriteoffStatus==='pending_reservation'/)
assert.match(worker,/authUser!\.employeeRole === 'Упаковщик'/, 'Packing-only account must not approve a shortage')
assert.match(view,/canResolvePendingReservation&&/, 'Hide action for packing-only accounts')
assert.match(view,/Обновить данные/)
assert.match(view,/pendingReservationDraft\.preview\.snapshot/)
console.log('PENDING_RESERVATION_RESOLUTION_PASSED: explicit snapshot, no auto-overbook, stale race, idempotency, durable evidence, current stock, sent/return/source blocks and manager UI')
