import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {correctMistakenOrderHandover} from '../worker/domains/order-reservations.ts'

const sql=new DatabaseSync(':memory:')
sql.exec([
"CREATE TABLE inventory_model_meta(key TEXT PRIMARY KEY,value TEXT)",
"CREATE TABLE activity_log(id INTEGER PRIMARY KEY,event_type TEXT,entity_type TEXT,entity_id INTEGER,order_id INTEGER,external_order_id TEXT,title TEXT,details TEXT,amount INTEGER,created_at TEXT)",
"INSERT INTO inventory_model_meta VALUES('human_inventory_v2','active')",
"CREATE TABLE orders(id INTEGER PRIMARY KEY,external_id TEXT,order_status TEXT,archived_at TEXT,shipping_status TEXT,shipping_date TEXT,updated_at TEXT)",
"CREATE TABLE order_items(id INTEGER PRIMARY KEY,order_id INTEGER,quantity INTEGER,stock_quantity_before INTEGER,stock_quantity_after INTEGER,stock_writeoff_status TEXT)",
"CREATE TABLE inventory_reservations(id INTEGER PRIMARY KEY,order_id INTEGER,order_item_id INTEGER,inventory_source TEXT,variant_id INTEGER,quantity INTEGER,status TEXT,fulfilled_at TEXT,released_at TEXT,updated_at TEXT)",
"CREATE TABLE catalog_products(id INTEGER PRIMARY KEY,is_active INTEGER)",
"CREATE TABLE catalog_variants(id INTEGER PRIMARY KEY,product_id INTEGER,is_active INTEGER)",
"CREATE TABLE inventory_stock(id INTEGER PRIMARY KEY,inventory_source TEXT,variant_id INTEGER,product_id INTEGER,product_name_snapshot TEXT,gender_snapshot TEXT,color_snapshot TEXT,material_snapshot TEXT,length_snapshot TEXT,size_snapshot TEXT,quantity INTEGER,reserved_quantity INTEGER,last_action TEXT,last_source_ref TEXT,updated_at TEXT)",
"CREATE TABLE inventory_stock_checks(id INTEGER PRIMARY KEY,inventory_source TEXT,variant_id INTEGER,checked_at TEXT)",
"CREATE TABLE inventory_stocktake_sessions(id TEXT PRIMARY KEY,inventory_source TEXT,status TEXT,completed_at TEXT)",
"CREATE TABLE returns(id INTEGER PRIMARY KEY,order_id INTEGER,status TEXT)",
"CREATE TABLE return_items(id INTEGER PRIMARY KEY,return_id INTEGER,quantity INTEGER)",
"CREATE TABLE exchanges(id INTEGER PRIMARY KEY,order_id INTEGER,refund_return_id INTEGER,status TEXT)",
"CREATE TABLE inventory_movements(id INTEGER PRIMARY KEY,inventory_source TEXT,movement_type TEXT,product_id INTEGER,variant_id INTEGER,product_name_snapshot TEXT,gender_snapshot TEXT,color_snapshot TEXT,material_snapshot TEXT,length_snapshot TEXT,size_snapshot TEXT,quantity_delta INTEGER,quantity_after INTEGER,reference_type TEXT,reference_id TEXT,comment TEXT,created_at TEXT)",
].join(';')+';')
const db={
  prepare(q){let args=[];return {bind(...x){args=x;return this},async first(){return sql.prepare(q).get(...args)??null},async all(){return {results:sql.prepare(q).all(...args)}},async run(){return sql.prepare(q).run(...args)},_execute(){return sql.prepare(q).run(...args)}}},
  async batch(statements){
    sql.exec('BEGIN')
    try{
      const result=statements.map(s=>s._execute())
      sql.exec('COMMIT')
      return result
    }catch(e){sql.exec('ROLLBACK');throw e}
  }
}
function reset({before=3,after=2,check=false,full=false,itemReturn=false}={}){
  for(const table of ['activity_log','orders','order_items','inventory_reservations','catalog_products','catalog_variants','inventory_stock','inventory_stock_checks','inventory_stocktake_sessions','returns','return_items','exchanges','inventory_movements'])sql.exec('DELETE FROM '+table)
  sql.exec([
    "INSERT INTO orders VALUES(1,'ORD-1','active',NULL,'sent','2026-10-20','2026-10-20')",
    "INSERT INTO catalog_products VALUES(3,1)",
    "INSERT INTO catalog_variants VALUES(4,3,1)",
  ].join(';')+';')
  sql.prepare("INSERT INTO order_items VALUES(5,1,1,?,?, 'fulfilled')").run(before,after)
  sql.prepare("INSERT INTO inventory_stock VALUES(6,'warehouse',4,3,'Product',NULL,NULL,NULL,NULL,NULL,?,0,'sent','ORD-1','2026-10-20')").run(after)
  sql.prepare("INSERT INTO inventory_reservations VALUES(7,1,5,'warehouse',4,1,'fulfilled','2026-10-20T08:00:00Z',NULL,'2026-10-20')").run()
  if(check)sql.exec("INSERT INTO inventory_stock_checks VALUES(8,'warehouse',4,'2026-10-21T09:00:00Z')")
  if(full)sql.exec("INSERT INTO inventory_stocktake_sessions VALUES('REV-W-F-10','warehouse','completed','2026-10-21T09:00:00Z')")
  if(itemReturn)sql.exec("INSERT INTO returns VALUES(10,1,'completed'); INSERT INTO return_items VALUES(11,10,1)")
}
const outcome=()=>({
  order:sql.prepare('SELECT shipping_status,shipping_date FROM orders WHERE id=1').get(),
  item:sql.prepare('SELECT stock_writeoff_status,stock_quantity_before,stock_quantity_after FROM order_items WHERE id=5').get(),
  stock:sql.prepare('SELECT quantity,reserved_quantity FROM inventory_stock WHERE id=6').get(),
  reservation:sql.prepare('SELECT status,fulfilled_at FROM inventory_reservations WHERE id=7').get(),
  movements:sql.prepare('SELECT quantity_delta FROM inventory_movements ORDER BY id').all(),
})
async function correction(){return correctMistakenOrderHandover(db,1,{physicalOutcome:'not_issued'})}
reset()
let result=await correction()
assert.equal(result.restoredPhysicalQuantity,1,'Restore only proven physical delta')
assert.equal(result.freshnessProtectedQuantity,0)
let state=outcome()
assert.equal(state.stock.quantity,3)
assert.equal(state.stock.reserved_quantity,1)
assert.equal(state.reservation.status,'active')
assert.equal(state.order.shipping_status,'not_sent')
assert.equal(state.order.shipping_date,null)
assert.equal(state.item.stock_writeoff_status,'reserved')
assert.equal(state.movements.length,1)
assert.equal(state.movements[0].quantity_delta,1)
assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM activity_log WHERE event_type='order_false_handover_corrected' AND order_id=1").get().n,1,'Physical correction must retain an activity record')
result=await correction()
assert.equal(result.alreadyCorrected,true)
assert.equal(outcome().stock.quantity,3,'Never double restore on repeat')
reset({before:3,after:2,check:true})
result=await correction()
assert.equal(result.restoredPhysicalQuantity,0)
assert.equal(result.freshnessProtectedQuantity,1)
state=outcome()
assert.equal(state.stock.quantity,2,'New exact physical check must not be overwritten')
assert.equal(state.stock.reserved_quantity,1)
assert.equal(state.movements.length,0)
reset({before:3,after:2,full:true})
result=await correction()
assert.equal(result.restoredPhysicalQuantity,0)
assert.equal(result.freshnessProtectedQuantity,1)
assert.equal(outcome().stock.quantity,2,'New full revision must not be counted twice')
// Checkpoint order within the SAME second must respect milliseconds.
// No additional quantity when a later physical count already superseded
// the shipment delta. A prior count must NOT suppress the needed restoration.
reset({check:true})
sql.exec("UPDATE inventory_reservations SET fulfilled_at='2026-10-21T09:00:00.100Z' WHERE id=7; UPDATE inventory_stock_checks SET checked_at='2026-10-21T09:00:00.450Z' WHERE id=8")
result=await correction()
assert.equal(result.restoredPhysicalQuantity,0,'Later same-second selective check supersedes shipment')
assert.equal(result.freshnessProtectedQuantity,1)
assert.equal(outcome().stock.quantity,2,'No phantom +1 after millisecond-later physical check')
reset({check:true})
sql.exec("UPDATE inventory_reservations SET fulfilled_at='2026-10-21T09:00:00.900Z' WHERE id=7; UPDATE inventory_stock_checks SET checked_at='2026-10-21T09:00:00.450Z' WHERE id=8")
result=await correction()
assert.equal(result.restoredPhysicalQuantity,1,'Earlier same-second check cannot suppress rightful restore')
assert.equal(result.freshnessProtectedQuantity,0)
assert.equal(outcome().stock.quantity,3)
reset({full:true})
sql.exec("UPDATE inventory_reservations SET fulfilled_at='2026-10-21T09:00:00.100Z' WHERE id=7; UPDATE inventory_stocktake_sessions SET completed_at='2026-10-21T09:00:00.450Z'")
result=await correction()
assert.equal(result.restoredPhysicalQuantity,0,'Later same-second full revision is authoritative')
assert.equal(outcome().stock.quantity,2)
reset({full:true})
sql.exec("UPDATE inventory_reservations SET fulfilled_at='2026-10-21T09:00:00.900Z' WHERE id=7; UPDATE inventory_stocktake_sessions SET completed_at='2026-10-21T09:00:00.450Z'")
result=await correction()
assert.equal(result.restoredPhysicalQuantity,1,'Earlier same-second full revision predates shipping and must not suppress undo')
assert.equal(outcome().stock.quantity,3)
console.log('STAGE3_SHIPPING_FRACTIONAL_CHECKPOINT_PASS: same-second full/quick checks both before/after, precise physical restore')

reset({before:2,after:2})
result=await correction()
assert.equal(result.restoredPhysicalQuantity,0)
assert.equal(outcome().stock.quantity,2,'Zero documented physical decrement must restore zero')
reset({itemReturn:true})
await assert.rejects(correction(),/возврат товара/)
assert.equal(outcome().order.shipping_status,'sent','Recorded goods return must block false shipping undo')
assert.equal(outcome().stock.quantity,2)
await assert.rejects(()=>correctMistakenOrderHandover(db,1,{physicalOutcome:'received'}),/НЕ передавался/)
sql.close()
console.log('PASS mistaken shipping: proven delta, no double restore, later check/full revision, active reserve, goods return blocker, explicit non-issue')
