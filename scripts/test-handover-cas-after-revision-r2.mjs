
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { handoverReviewCasGuardStatement, reconcileIssuedBeforeCheckpoint } from '../worker/domains/order-reservations.ts'

// No Cloudflare connection. Test real SQL statements in a transaction.
const sql = new DatabaseSync(':memory:')
sql.exec([
  "CREATE TABLE orders(id INTEGER PRIMARY KEY, order_date TEXT, created_at TEXT)",
  "CREATE TABLE order_items(id INTEGER PRIMARY KEY,order_id INTEGER,quantity INTEGER,is_workshop INTEGER,created_at TEXT,inventory_obligation_origin_at TEXT,stock_writeoff_status TEXT,stock_quantity_before INTEGER,stock_quantity_after INTEGER)",
  "CREATE TABLE inventory_reservations(id INTEGER PRIMARY KEY,order_id INTEGER,order_item_id INTEGER,inventory_source TEXT,variant_id INTEGER,quantity INTEGER,status TEXT,created_at TEXT,fulfilled_at TEXT,released_at TEXT,updated_at TEXT)",
  "CREATE TABLE inventory_stock(id INTEGER PRIMARY KEY,inventory_source TEXT,variant_id INTEGER,quantity INTEGER,reserved_quantity INTEGER,last_action TEXT,last_source_ref TEXT,updated_at TEXT)",
  "CREATE TABLE inventory_stock_checks(id INTEGER PRIMARY KEY,inventory_source TEXT,variant_id INTEGER,checked_at TEXT,check_type TEXT,reference_type TEXT,reference_id TEXT)",
  "CREATE TABLE inventory_stocktake_sessions(id TEXT PRIMARY KEY,inventory_source TEXT,status TEXT,started_at TEXT,completed_at TEXT)",
  "CREATE TABLE inventory_model_meta(key TEXT PRIMARY KEY,value TEXT,updated_at TEXT)",
  "CREATE TABLE inventory_handover_reviews(id INTEGER PRIMARY KEY,order_id INTEGER,order_item_id INTEGER,reservation_id INTEGER,decision TEXT,checkpoint_id INTEGER,checkpoint_type TEXT,checkpoint_at TEXT,reviewed_by TEXT,reviewed_at TEXT,UNIQUE(order_item_id,checkpoint_id))",
  "INSERT INTO inventory_model_meta VALUES('safe_early_handover_v1_guard','keep','2026-01-01')",
].join(';') + ';')
const db = {
  prepare(query) {
    let args=[]
    return {
      bind(...xs) { args=xs; return this },
      run() { return sql.prepare(query).run(...args) },
      async all() { return {results:sql.prepare(query).all(...args)} },
      async first() { return sql.prepare(query).get(...args) ?? null },
    }
  },
  async batch(statements) {
    sql.exec('BEGIN')
    try {
      const data=statements.map(s=>s.run())
      sql.exec('COMMIT')
      return data
    } catch(error) {
      sql.exec('ROLLBACK')
      throw error
    }
  }
}
function clear(){
  for(const table of ['inventory_handover_reviews','inventory_stock_checks','inventory_stocktake_sessions','inventory_reservations','inventory_stock','order_items','orders']){
    sql.exec('DELETE FROM '+table)
  }
}
function fixture({orderDate='2026-09-30',origin='2026-09-30T10:48:04Z'}={}){
  clear()
  sql.prepare('INSERT INTO orders VALUES(1658,?,?)').run(orderDate,origin)
  sql.prepare('INSERT INTO order_items(id,order_id,quantity,is_workshop,created_at,inventory_obligation_origin_at) VALUES(4271,1658,1,0,?,?)').run(origin,origin)
  sql.prepare("INSERT INTO inventory_reservations(id,order_id,order_item_id,inventory_source,variant_id,quantity,status,created_at) VALUES(7001,1658,4271,'warehouse',240,1,'active',?)").run(origin)
  sql.prepare("INSERT INTO inventory_reservations(id,order_id,order_item_id,inventory_source,variant_id,quantity,status,created_at) VALUES(7002,1887,4529,'warehouse',240,2,'active',?)").run('2026-10-10T11:00:00Z')
  sql.exec("INSERT INTO inventory_stock(id,inventory_source,variant_id,quantity,reserved_quantity) VALUES(169,'warehouse',240,4,3)")
}
function check(id,at){
  sql.prepare("INSERT INTO inventory_stock_checks VALUES(?,'warehouse',240,?,'manual_set','manual','check')").run(id,at)
}
function full(id,started,completed){
  sql.prepare("INSERT INTO inventory_stocktake_sessions VALUES(?,'warehouse','completed',?,?)").run(id,started,completed)
  return sql.prepare('SELECT rowid AS rid FROM inventory_stocktake_sessions WHERE id=?').get(id).rid
}
const checkpointAt='2026-10-16T12:32:44Z'
async function allowed(checkpointId,at=checkpointAt){
  try {
    await db.batch([handoverReviewCasGuardStatement(db,{orderId:1658,orderItemId:4271,reservationId:7001,checkpointId,checkpointAt:at,now:'2026-10-16T20:00:00Z'})])
    return true
  } catch(error) {
    assert.match(String(error),/UNIQUE|constraint|CONSTRAINT/i)
    return false
  }
}

// The real September ordinary order must be allowed to confirm October's checkpoint.
fixture()
check(3230,checkpointAt)
assert.equal(await allowed(3230),true,'Post-order exact SKU check must pass CAS without Workshop')
await reconcileIssuedBeforeCheckpoint(db,1658,'ORD-20260930104804-75083DC1',{
  reservationId:7001,reservationStatus:'active',reviewNeeded:true,
  checkpointId:3230,checkpointAt,checkpointKind:'check',checkpointType:'manual_set',
  orderItemId:4271,source:'warehouse',productName:'ЕҢЛІК ШАПАН',
},3230,checkpointAt,'test')
const stock=sql.prepare('SELECT quantity,reserved_quantity FROM inventory_stock WHERE id=169').get()
assert.equal(stock.quantity,4,'Physical stock must not be decremented again')
assert.equal(stock.reserved_quantity,2,'Only the historical reserve must be closed')
assert.equal(sql.prepare('SELECT status FROM inventory_reservations WHERE id=7001').get().status,'fulfilled')
assert.equal(sql.prepare('SELECT status FROM inventory_reservations WHERE id=7002').get().status,'active')
assert.equal(sql.prepare('SELECT decision FROM inventory_handover_reviews WHERE order_item_id=4271').get().decision,'issued_before_checkpoint')
assert.equal(await allowed(3230),false,'Repeated confirmation must fail')

// Invalid or outdated decisions must still reject.
fixture()
check(3230,checkpointAt)
check(3231,'2026-10-17T09:00:00Z')
assert.equal(await allowed(3230),false,'Newer SKU checkpoint makes stale review invalid')
sql.exec('DELETE FROM inventory_stock_checks WHERE id=3231')
assert.equal(await allowed(3230,'2026-10-15T09:00:00Z'),false)
sql.exec("UPDATE inventory_reservations SET status='fulfilled' WHERE id=7001")
assert.equal(await allowed(3230),false,'No active reserve')

// Same-day fresh order after earlier check is NOT a historic late entry.
fixture({orderDate:'2026-10-20',origin:'2026-10-20T11:27:50Z'})
check(4000,'2026-10-20T10:00:00Z')
assert.equal(await allowed(4000,'2026-10-20T10:00:00Z'),false)

// Backdated entry keeps legitimate before-entry physical checks eligible.
fixture({orderDate:'2026-09-30',origin:'2026-10-10T11:27:50Z'})
check(3143,'2026-10-10T10:31:58Z')
assert.equal(await allowed(3143,'2026-10-10T10:31:58Z'),true)

// Full stocktake after creation (without exact SKU check) and stale check safety.
fixture()
const fullAt='2026-10-23T09:45:00Z'
const rowId=full('REV-W-F-2010','2026-10-23T09:00:00Z',fullAt)
assert.equal(await allowed(-rowId,fullAt),true)
check(4001,'2026-10-24T09:00:00Z')
assert.equal(await allowed(-rowId,fullAt),false)
fixture()
check(3230,checkpointAt)
full('REV-W-F-2011','2026-10-17T09:00:00Z','2026-10-17T10:00:00Z')
assert.equal(await allowed(3230),false)
sql.close()
console.log('HANDOVER_CAS_AND_NO_DOUBLE_STOCK_SQLITE_PASSED')
