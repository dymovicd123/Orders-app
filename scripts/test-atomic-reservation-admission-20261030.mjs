import assert from 'node:assert/strict'
import fs from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { admitOrderReservationAtomically } from '../worker/domains/reservation-admission.ts'

const sql=new DatabaseSync(':memory:')
sql.exec([
  'CREATE TABLE inventory_stock(id INTEGER PRIMARY KEY,inventory_source TEXT,variant_id INTEGER,quantity INTEGER,reserved_quantity INTEGER,product_id INTEGER,product_name_snapshot TEXT,gender_snapshot TEXT,color_snapshot TEXT,material_snapshot TEXT,length_snapshot TEXT,size_snapshot TEXT,last_action TEXT,last_source_ref TEXT,updated_at TEXT)',
  'CREATE TABLE order_items(id INTEGER PRIMARY KEY,order_id INTEGER,stock_writeoff_status TEXT,stock_quantity_before INTEGER,stock_quantity_after INTEGER)',
  'CREATE TABLE inventory_reservations(id INTEGER PRIMARY KEY,order_id INTEGER,order_item_id INTEGER UNIQUE,inventory_source TEXT,product_id INTEGER,variant_id INTEGER,quantity INTEGER,status TEXT,reference_type TEXT,reference_id TEXT,unresolved_reason TEXT,created_at TEXT,updated_at TEXT)',
  "INSERT INTO inventory_stock(id,inventory_source,variant_id,quantity,reserved_quantity) VALUES(1,'warehouse',101,1,0),(2,'boutique',101,1,0),(3,'warehouse',102,0,0)",
].join(';')+';')
const adapter={
  prepare(query) {return {
    bind(...args) {return {
      run:()=>sql.prepare(query).run(...args),
      first: async()=>sql.prepare(query).get(...args)??null,
      all:async()=>({results:sql.prepare(query).all(...args)}),
    }},
  }},
  async batch(statements){
    sql.exec('BEGIN IMMEDIATE')
    try {
      const results=statements.map(s=>s.run())
      sql.exec('COMMIT')
      return results.map(meta=>({meta}))
    }catch(error){sql.exec('ROLLBACK');throw error}
  },
}
const now='2026-10-30T10:00:00.000Z'
function item(id,orderId=100,options={}){
  sql.prepare('INSERT OR IGNORE INTO order_items(id,order_id) VALUES(?,?)').run(id,orderId)
  return {orderId,orderItemId:id,source:'warehouse',stockId:1,productId:7,
    variantId:101,quantity:1,productName:'КЕБЕК',gender:'МУЖ',color:'БЕЖ',
    material:'СТАНДАРТ',length:'СТАНДАРТ',size:'50',
    referenceType:'order',referenceId:'T-'+orderId,timestamp:now,
    shortageAcknowledged:false,shortageDecision:null,...options}
}
const stock=(id=1)=>sql.prepare('SELECT quantity,reserved_quantity FROM inventory_stock WHERE id=?').get(id)
const booking=(id)=>sql.prepare('SELECT status,unresolved_reason,quantity FROM inventory_reservations WHERE order_item_id=?').get(id)
const mark=(id)=>sql.prepare('SELECT stock_writeoff_status FROM order_items WHERE id=?').get(id)?.stock_writeoff_status
// Two managers both saw physical=1/reserved=0; first succeeds, second is
// recorded as an explicit pending obligation. No double-active-reservation.
const first=await admitOrderReservationAtomically(adapter,item(1,100))
assert.equal(first.status,'active')
const second=await admitOrderReservationAtomically(adapter,item(2,200))
assert.deepEqual(second,{status:'unresolved',reason:'concurrent_shortage'})
assert.equal(stock().reserved_quantity,1)
assert.equal(stock().quantity,1)
assert.equal(mark(1),'reserved')
assert.equal(mark(2),'pending_reservation')
assert.deepEqual({...booking(2)},{status:'unresolved',unresolved_reason:'concurrent_shortage',quantity:1})
assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM inventory_reservations WHERE status='active' AND variant_id=101").get().n,1)
// Only a fresh per-SKU decision can intentionally create an over-reservation.
const stale=await admitOrderReservationAtomically(adapter,item(3,300,{
  shortageAcknowledged:true,shortageDecision:{
    inventorySource:'warehouse',variantId:101,requestedQuantity:1,physicalQuantity:1,reservedQuantity:0
  },
}))
assert.equal(stale.status,'unresolved')
assert.equal(stock().reserved_quantity,1)
const accepted=await admitOrderReservationAtomically(adapter,item(4,400,{
  shortageAcknowledged:true,shortageDecision:{
    inventorySource:'warehouse',variantId:101,requestedQuantity:1,physicalQuantity:1,reservedQuantity:1
  },
}))
assert.equal(accepted.status,'active')
assert.equal(stock().reserved_quantity,2)
assert.equal(stock().quantity,1,'Reservation must not alter physical quantity')
// Another source is independent.
assert.equal((await admitOrderReservationAtomically(adapter,item(5,500,{source:'boutique',stockId:2}))).status,'active')
assert.equal(stock(2).reserved_quantity,1)
// Zero-stock known SKU must not gain an active reservation without decision.
assert.equal((await admitOrderReservationAtomically(adapter,item(6,600,{stockId:3,variantId:102}))).status,'unresolved')
assert.equal(stock(3).reserved_quantity,0)
// Deliberate GROUP consent across two lines uses approved old reserved count,
// subtracting this same order's earlier admitted line, not other orders.
const snapshot={inventorySource:'warehouse',variantId:102,requestedQuantity:2,physicalQuantity:0,reservedQuantity:0}
assert.equal((await admitOrderReservationAtomically(adapter,item(7,700,{
  stockId:3,variantId:102,shortageAcknowledged:true,shortageDecision:snapshot,
}))).status,'active')
assert.equal((await admitOrderReservationAtomically(adapter,item(8,700,{
  stockId:3,variantId:102,shortageAcknowledged:true,shortageDecision:snapshot,
}))).status,'active')
assert.equal(stock(3).reserved_quantity,2)
assert.equal(stock(3).quantity,0)
// A rejected SQL insert must roll back the guarded stock update as well.
const before=stock(2).reserved_quantity
const duplicate=item(5,500,{source:'boutique',stockId:2,quantity:1})
await assert.rejects(()=>admitOrderReservationAtomically(adapter,duplicate),/UNIQUE/)
assert.equal(stock(2).reserved_quantity,before,'No ghost reserve after failed batch')
assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM inventory_reservations WHERE order_item_id=5').get().n,1)
const res=fs.readFileSync('worker/domains/order-reservations.ts','utf8')
const write=fs.readFileSync('worker/domains/orders-write.ts','utf8')
assert.match(res,/admitOrderReservationAtomically\(db/, 'Actual worker must use the atomic helper')
assert.match(res,/if \(existingReservation\?\.id\)/, 'Idempotent retry must reuse the existing reservation')
assert.match(write,/await insertOrderContent\(/, 'Partial-order resume must remain in the critical-operation flow')
console.log('ATOMIC_RESERVATION_ADMISSION_PASSED: last-piece serial race, stale consent, explicit overbook, duplicate lines, source isolation, SQLite rollback and retry guard')
