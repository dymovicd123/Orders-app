// Orders are allowed even with a stock shortage; only the reserve is pending.
// No UI confirmation, silent shelf count, or forced over-reservation.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { admitOrderReservationAtomically } from '../worker/domains/reservation-admission.ts'
const write=fs.readFileSync('worker/domains/orders-write.ts','utf8')
const app=fs.readFileSync('src/App.tsx','utf8')
const view=fs.readFileSync('src/app/controllers/useWorkspaceViewModel.tsx','utf8')
const gate=fs.readFileSync('scripts/branch2-current-semantic-release-check.mjs','utf8')
assert.doesNotMatch(write,/await assertCreateOrderShortageDecisions\(/)
assert.doesNotMatch(write,/retiredFreshShortages/)
assert.match(write,/shortageAcknowledged: false, shortageDecision: null/)
assert.match(write,/item\.shortageAcknowledged = false/)
assert.doesNotMatch(app,/result\.code === 'order_stock_shortage'/)
assert.doesNotMatch(app,/shortageDecision: item\.sourceType !== 'workshop'/)
assert.doesNotMatch(view,/order-source-shortage-decision/)
assert.doesNotMatch(view,/Подтвердить резерв при нехватке/)
assert.match(view,/Заказ можно сохранить без подтверждения физического наличия/)
assert.doesNotMatch(gate,/test-order-shortage-explicit-decision-20261030/)
const sql=new DatabaseSync(':memory:')
sql.exec([
 'CREATE TABLE inventory_stock(id INTEGER PRIMARY KEY,inventory_source TEXT,variant_id INTEGER,quantity INTEGER,reserved_quantity INTEGER,product_id INTEGER,product_name_snapshot TEXT,gender_snapshot TEXT,color_snapshot TEXT,material_snapshot TEXT,length_snapshot TEXT,size_snapshot TEXT,last_action TEXT,last_source_ref TEXT,updated_at TEXT)',
 'CREATE TABLE order_items(id INTEGER PRIMARY KEY,order_id INTEGER,stock_writeoff_status TEXT,stock_quantity_before INTEGER,stock_quantity_after INTEGER)',
 'CREATE TABLE inventory_reservations(id INTEGER PRIMARY KEY,order_id INTEGER,order_item_id INTEGER UNIQUE,inventory_source TEXT,product_id INTEGER,variant_id INTEGER,quantity INTEGER,status TEXT,reference_type TEXT,reference_id TEXT,unresolved_reason TEXT,created_at TEXT,updated_at TEXT)',
 "INSERT INTO inventory_stock(id,inventory_source,variant_id,quantity,reserved_quantity) VALUES(1,'warehouse',101,0,0),(2,'warehouse',102,2,0)"
].join(';')+';')
const db={
 prepare(query){return {bind(...args){return {
  run:()=>sql.prepare(query).run(...args),
  first:async()=>sql.prepare(query).get(...args)??null,
  all:async()=>({results:sql.prepare(query).all(...args)}),
 }}}},
 async batch(stmts){sql.exec('BEGIN IMMEDIATE');try{
  const r=stmts.map(s=>s.run());sql.exec('COMMIT');return r.map(meta=>({meta}))
 }catch(e){sql.exec('ROLLBACK');throw e}}
}
async function book(id,variant,stockId){
 sql.prepare('INSERT INTO order_items(id,order_id) VALUES(?,?)').run(id,id+100)
 return admitOrderReservationAtomically(db,{
  orderId:id+100,orderItemId:id,source:'warehouse',stockId,productId:7,
  variantId:variant,quantity:1,productName:'АБАЙКА',gender:'ЖЕН',color:'БЕЖ',
  material:'СТАНДАРТ',length:'СТАНДАРТ',size:'46',
  referenceType:'order',referenceId:'T-'+id,timestamp:'2026-10-31T00:00:00Z',
  shortageAcknowledged:false,shortageDecision:null,
 })
}
assert.equal((await book(1,101,1)).status,'unresolved')
assert.equal((await book(2,101,1)).status,'unresolved')
assert.equal((await book(3,102,2)).status,'active')
assert.deepEqual(sql.prepare('SELECT quantity,reserved_quantity FROM inventory_stock WHERE id=1').get(),{quantity:0,reserved_quantity:0})
assert.equal(sql.prepare("SELECT count(*) AS n FROM inventory_reservations WHERE status='unresolved' AND unresolved_reason='concurrent_shortage'").get().n,2)
assert.equal(sql.prepare("SELECT count(*) AS n FROM inventory_reservations WHERE status='active'").get().n,1)
console.log('ORDER_SHORTAGE_NONBLOCKING_PASSED')
