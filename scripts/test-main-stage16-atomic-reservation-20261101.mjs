import assert from 'node:assert/strict'
import fs from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { admitOrderReservationAtomically, recoverPendingOrderReservationsBeforeShipping } from '../worker/domains/reservation-admission.ts'

// In-memory SQLite, not remote D1. Exercise the exact candidate SQL and triggers.
const sql=new DatabaseSync(':memory:')
sql.exec([
'CREATE TABLE inventory_stock(id INTEGER PRIMARY KEY, inventory_source TEXT, variant_id INTEGER, quantity INTEGER, reserved_quantity INTEGER, product_id INTEGER, product_name_snapshot TEXT, gender_snapshot TEXT, color_snapshot TEXT, material_snapshot TEXT, length_snapshot TEXT, size_snapshot TEXT, last_action TEXT, last_source_ref TEXT, updated_at TEXT);',
'CREATE TABLE inventory_reservations(id INTEGER PRIMARY KEY, order_id INTEGER, order_item_id INTEGER UNIQUE, inventory_source TEXT, product_id INTEGER, variant_id INTEGER, quantity INTEGER, status TEXT, reference_type TEXT, reference_id TEXT, unresolved_reason TEXT, created_at TEXT, updated_at TEXT);',
'CREATE TABLE order_items(id INTEGER PRIMARY KEY,order_id INTEGER,stock_writeoff_status TEXT,stock_quantity_before INTEGER,stock_quantity_after INTEGER,is_workshop INTEGER DEFAULT 0,quantity INTEGER,product_id INTEGER,variant_id INTEGER);',
'CREATE TABLE orders(id INTEGER PRIMARY KEY,shipping_status TEXT DEFAULT "not_sent",order_status TEXT DEFAULT "active",archived_at TEXT);',
'CREATE TABLE catalog_products(id INTEGER PRIMARY KEY,is_active INTEGER);',
'CREATE TABLE catalog_variants(id INTEGER PRIMARY KEY,product_id INTEGER,is_active INTEGER);',
'CREATE TABLE returns(id INTEGER PRIMARY KEY,status TEXT);',
'CREATE TABLE return_items(id INTEGER PRIMARY KEY,return_id INTEGER,order_item_id INTEGER);',
'INSERT INTO catalog_products VALUES(12,1);',
'INSERT INTO catalog_variants VALUES(7,12,1),(8,12,1);',
'CREATE TABLE inventory_stock_audit(stock_id INTEGER, old_reserved INTEGER, new_reserved INTEGER);',
'CREATE TRIGGER inventory_stock_after_reserve AFTER UPDATE OF reserved_quantity ON inventory_stock BEGIN INSERT INTO inventory_stock_audit VALUES(new.id,old.reserved_quantity,new.reserved_quantity); END;',
"INSERT INTO inventory_stock(id,inventory_source,variant_id,quantity,reserved_quantity) VALUES (1,'warehouse',7,1,0),(2,'boutique',7,3,0),(3,'warehouse',8,0,0);",
].join('\n'))
let batchTail=Promise.resolve()
const db={
 prepare(query){let args=[];return {
  bind(...values){args=values;return this},
  async first(){return sql.prepare(query).get(...args)??null},
  async all(){return {results:sql.prepare(query).all(...args)}},
  async run(){const m=sql.prepare(query).run(...args);return {meta:{changes:m.changes,last_row_id:m.lastInsertRowid}}}
 }},
 async batch(statements){
  // D1 serializes SQLite atomic batches; this adapter queues concurrent callers
  // on one in-memory connection so Promise.all tests contention, not nested BEGIN.
  const prior=batchTail
  let release
  batchTail=new Promise(resolve=>{release=resolve})
  await prior
  try{
    sql.exec('BEGIN IMMEDIATE')
    try{const values=[];for(const stmt of statements)values.push(await stmt.run());sql.exec('COMMIT');return values}
    catch(e){sql.exec('ROLLBACK');throw e}
  }finally{release()}
 }
}
let seq=10
function request(orderId,source='warehouse',variantId=7,quantity=1,options={}){
 const orderItemId=++seq
 sql.prepare('INSERT INTO orders(id) VALUES (?)').run(orderId)
 sql.prepare('INSERT INTO order_items(id,order_id,is_workshop,quantity,product_id,variant_id) VALUES (?,?,?,?,?,?)').run(orderItemId,orderId,0,quantity,12,variantId)
 return {orderId,orderItemId,source,stockId:source==='boutique'?2:variantId===8?3:1,
 productId:12,variantId,quantity,productName:'ПАЛЬТО',gender:'ЖЕН',color:'ЧЕРНЫЙ',
 material:'ДРАП',length:'СТАНДАРТ',size:'46',referenceType:'order',
 referenceId:'TEST-'+orderId,timestamp:'2026-11-01T20:00:00Z',
 shortageAcknowledged:false,shortageDecision:null,...options}
}
const get=(q,...a)=>sql.prepare(q).get(...a)
const first=request(1), second=request(2)
const out=await Promise.all([admitOrderReservationAtomically(db,first),admitOrderReservationAtomically(db,second)])
assert.deepEqual(out.map(x=>x.status),['active','unresolved'])
assert.equal(out[1].reason,'concurrent_shortage')
assert.equal(get('SELECT quantity FROM inventory_stock WHERE id=1').quantity,1)
assert.equal(get('SELECT reserved_quantity AS r FROM inventory_stock WHERE id=1').r,1)
assert.equal(get('SELECT stock_writeoff_status AS s FROM order_items WHERE id=?',second.orderItemId).s,'pending_reservation')
assert.equal(get('SELECT count(*) AS n FROM inventory_stock_audit').n,1)
assert.equal((await admitOrderReservationAtomically(db,request(3,'boutique',7,2))).status,'active')
assert.equal(get('SELECT reserved_quantity AS r FROM inventory_stock WHERE id=2').r,2)
const stale=request(4,'warehouse',7,1,{shortageAcknowledged:true,shortageDecision:{
 inventorySource:'warehouse',variantId:7,physicalQuantity:1,reservedQuantity:0,requestedQuantity:1
}})
assert.equal((await admitOrderReservationAtomically(db,stale)).status,'unresolved')
assert.equal(get('SELECT reserved_quantity AS r FROM inventory_stock WHERE id=1').r,1)
assert.equal((await admitOrderReservationAtomically(db,request(5,'warehouse',8,1))).status,'unresolved')
assert.equal(get('SELECT reserved_quantity AS r FROM inventory_stock WHERE id=3').r,0)
assert.equal((await admitOrderReservationAtomically(db,request(6,'warehouse',8,1,{stockId:1}))).status,'unresolved')
assert.equal(get('SELECT reserved_quantity AS r FROM inventory_stock WHERE id=1').r,1)
const acknowledged=request(7,'warehouse',7,1,{shortageAcknowledged:true,shortageDecision:{
 inventorySource:'warehouse',variantId:7,physicalQuantity:1,reservedQuantity:1,requestedQuantity:1
}})
assert.equal((await admitOrderReservationAtomically(db,acknowledged)).status,'active')
assert.equal(get('SELECT reserved_quantity AS r FROM inventory_stock WHERE id=1').r,2)
assert.equal(get('SELECT quantity AS q FROM inventory_stock WHERE id=1').q,1)
assert.equal(get("SELECT count(*) AS n FROM inventory_reservations WHERE status='unresolved' AND unresolved_reason='concurrent_shortage'").n,4)
assert.equal(get("SELECT count(*) AS n FROM inventory_reservations WHERE status='active'").n,3)
assert.equal(get('SELECT count(*) AS n FROM inventory_stock_audit').n,3)
const module=fs.readFileSync('worker/domains/order-reservations.ts','utf8')
const worker=fs.readFileSync('worker/index.ts','utf8')
assert(module.includes('admitOrderReservationAtomically(db, {'))
assert(module.includes('shortageDecision: null'),'Main has no audited explicit shortage snapshot yet')
assert(module.includes('known_pending_reservation'))
assert(worker.includes("code: 'inventory_reservation_pending'"))

// Recovery is a separate call on an explicit shipping retry, not a catalog resolver.
// It never changes physical quantity, invents reservations or replaces the order item.
const priorSecond=get('SELECT id,order_item_id,status FROM inventory_reservations WHERE order_id=2')
assert.equal(priorSecond.status,'unresolved')
assert.deepEqual(await recoverPendingOrderReservationsBeforeShipping(db,2,'2026-11-01T20:01:00Z'),{attempted:1,activated:0})
assert.equal(get('SELECT reserved_quantity AS r FROM inventory_stock WHERE id=1').r,2)
sql.prepare('UPDATE inventory_stock SET quantity=3 WHERE id=1').run()
const twoAttempts=await Promise.all([
 recoverPendingOrderReservationsBeforeShipping(db,2,'2026-11-01T20:02:00Z'),
 recoverPendingOrderReservationsBeforeShipping(db,2,'2026-11-01T20:02:00Z'),
])
assert.equal(get('SELECT reserved_quantity AS r FROM inventory_stock WHERE id=1').r,3,'race must claim only one free unit')
assert.equal(get('SELECT quantity AS q FROM inventory_stock WHERE id=1').q,3,'recovery must not adjust physical truth')
assert.equal(get('SELECT status AS s FROM inventory_reservations WHERE id=?',priorSecond.id).s,'active')
assert.equal(get('SELECT stock_writeoff_status AS s FROM order_items WHERE id=?',second.orderItemId).s,'reserved')
assert.equal(get('SELECT order_item_id AS id FROM inventory_reservations WHERE id=?',priorSecond.id).id,second.orderItemId)
assert.equal(get('SELECT count(*) AS n FROM inventory_reservations').n,7,'no extra reservation record')
assert.equal((await recoverPendingOrderReservationsBeforeShipping(db,2,'2026-11-01T20:03:00Z')).attempted,0)
assert.equal(get('SELECT reserved_quantity AS r FROM inventory_stock WHERE id=1').r,3)

// Returned items, archived/sent orders, wrong identity, retired SKU are fail-closed.
const returned=request(8,'warehouse',8,1)
assert.equal((await admitOrderReservationAtomically(db,returned)).status,'unresolved')
sql.prepare("INSERT INTO returns(id,status) VALUES (1,'completed')").run()
sql.prepare('INSERT INTO return_items(id,return_id,order_item_id) VALUES (1,1,?)').run(returned.orderItemId)
sql.prepare('UPDATE inventory_stock SET quantity=8 WHERE id=3').run()
assert.equal((await recoverPendingOrderReservationsBeforeShipping(db,8,'2026-11-01T20:04:00Z')).attempted,0)
const sent=request(9,'warehouse',8,1)
assert.equal((await admitOrderReservationAtomically(db,sent)).status,'active')
const archived=request(10,'warehouse',8,1)
assert.equal((await admitOrderReservationAtomically(db,archived)).status,'active')
const future=request(11,'warehouse',8,1)
assert.equal((await admitOrderReservationAtomically(db,future)).status,'active')
// Reproduce pending for each negative case while keeping its original row and ID.
for(const row of [sent,archived,future]){
 sql.prepare("UPDATE inventory_reservations SET status='unresolved',unresolved_reason='concurrent_shortage' WHERE order_item_id=?").run(row.orderItemId)
 sql.prepare("UPDATE order_items SET stock_writeoff_status='pending_reservation' WHERE id=?").run(row.orderItemId)
}
sql.prepare("UPDATE orders SET shipping_status='sent' WHERE id=9").run()
sql.prepare("UPDATE orders SET order_status='archived' WHERE id=10").run()
sql.prepare('UPDATE order_items SET variant_id=7 WHERE id=?').run(future.orderItemId)
const beforeBlocked=get('SELECT reserved_quantity AS r FROM inventory_stock WHERE id=3').r
for(const id of [8,9,10,11])
 assert.equal((await recoverPendingOrderReservationsBeforeShipping(db,id,'2026-11-01T20:05:00Z')).attempted,0)
assert.equal(get('SELECT reserved_quantity AS r FROM inventory_stock WHERE id=3').r,beforeBlocked)
assert.equal(get('SELECT status AS s FROM inventory_reservations WHERE order_item_id=?',future.orderItemId).s,'unresolved')
const available=request(12,'warehouse',8,1)
assert.equal((await admitOrderReservationAtomically(db,available)).status,'active')
sql.prepare("UPDATE inventory_reservations SET status='unresolved',unresolved_reason='concurrent_shortage' WHERE order_item_id=?").run(available.orderItemId)
sql.prepare("UPDATE order_items SET stock_writeoff_status='pending_reservation' WHERE id=?").run(available.orderItemId)
const originalReservation=get('SELECT id FROM inventory_reservations WHERE order_item_id=?',available.orderItemId).id
const pre=get('SELECT reserved_quantity AS r FROM inventory_stock WHERE id=3').r
const healed=await recoverPendingOrderReservationsBeforeShipping(db,12,'2026-11-01T20:06:00Z')
assert.deepEqual(healed,{attempted:1,activated:1})
assert.equal(get('SELECT reserved_quantity AS r FROM inventory_stock WHERE id=3').r,pre+1)
assert.equal(get('SELECT id FROM inventory_reservations WHERE order_item_id=?',available.orderItemId).id,originalReservation)
assert.equal(get('SELECT stock_writeoff_status AS s FROM order_items WHERE id=?',available.orderItemId).s,'reserved')
assert.equal(get('SELECT quantity AS q FROM inventory_stock WHERE id=3').q,8)
assert.equal((await recoverPendingOrderReservationsBeforeShipping(db,12,'2026-11-01T20:07:00Z')).attempted,0)

sql.close()
console.log('MAIN_STAGE16_ATOMIC_ADMISSION_SQLITE_PASS: last-piece, stale approval, sources, wrong SKU, trigger and no phantom stock')
console.log('MAIN_STAGE16_PENDING_RECOVERY_PASS: arrival/second send, concurrent retries, preserved identity, returned/sent/archived/mismatched guards, idempotent')

