import assert from 'node:assert/strict'
import fs from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { admitOrderReservationAtomically } from '../worker/domains/reservation-admission.ts'

// In-memory SQLite, not remote D1. Exercise the exact candidate SQL and triggers.
const sql=new DatabaseSync(':memory:')
sql.exec([
'CREATE TABLE inventory_stock(id INTEGER PRIMARY KEY, inventory_source TEXT, variant_id INTEGER, quantity INTEGER, reserved_quantity INTEGER, product_id INTEGER, product_name_snapshot TEXT, gender_snapshot TEXT, color_snapshot TEXT, material_snapshot TEXT, length_snapshot TEXT, size_snapshot TEXT, last_action TEXT, last_source_ref TEXT, updated_at TEXT);',
'CREATE TABLE inventory_reservations(id INTEGER PRIMARY KEY, order_id INTEGER, order_item_id INTEGER UNIQUE, inventory_source TEXT, product_id INTEGER, variant_id INTEGER, quantity INTEGER, status TEXT, reference_type TEXT, reference_id TEXT, unresolved_reason TEXT, created_at TEXT, updated_at TEXT);',
'CREATE TABLE order_items(id INTEGER PRIMARY KEY,order_id INTEGER,stock_writeoff_status TEXT,stock_quantity_before INTEGER,stock_quantity_after INTEGER);',
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
 sql.prepare('INSERT INTO order_items(id,order_id) VALUES (?,?)').run(orderItemId,orderId)
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
sql.close()
console.log('MAIN_STAGE16_ATOMIC_ADMISSION_SQLITE_PASS: last-piece, stale approval, sources, wrong SKU, trigger, pending status and no phantom stock')
