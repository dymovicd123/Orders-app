// This isolated read-only test protects the narrow admin-delete explanation.
// It never writes an order and never connects to any client database.
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {readFileSync} from 'node:fs'
import {readStandaloneItemReturnBlocker} from '../worker/domains/order-delete-return-blocker.ts'

const sql=new DatabaseSync(':memory:')
sql.exec(`
 CREATE TABLE returns(id INTEGER PRIMARY KEY,order_id INTEGER,status TEXT,amount INTEGER);
 CREATE TABLE return_items(id INTEGER PRIMARY KEY,return_id INTEGER,product_name_snapshot TEXT,
  quantity INTEGER,physical_tracking INTEGER,physical_received_at TEXT);
 CREATE TABLE exchanges(id INTEGER PRIMARY KEY,refund_return_id INTEGER,status TEXT);
`)
const db={
 prepare(query){
   return {
     bind(...values){
       return {
         async first(){return sql.prepare(query).get(...values)||null}
       }
     }
   }
 }
}
const blocker=()=>readStandaloneItemReturnBlocker(db,13)
assert.equal(await blocker(),null,'Empty order is not blocked')
sql.prepare("INSERT INTO returns VALUES (1,13,'completed',1000)").run()
assert.equal(await blocker(),null,'Money-only Return is never treated as physical intake')
sql.prepare("INSERT INTO return_items VALUES (1,1,'БАЯН СҰЛУ ШАПАН',1,1,NULL)").run()
let result=await blocker()
assert.equal(result?.returnId,1)
assert.equal(result?.awaitingIntake,true)
assert.match(result.message,/возврат #1/i)
assert.match(result.message,/ожидает приёмки/)
assert.match(result.message,/Отменить возврат/)
sql.prepare("UPDATE return_items SET physical_received_at='2026-10-21' WHERE id=1").run()
result=await blocker()
assert.equal(result?.awaitingIntake,false)
assert.match(result.message,/физическую историю/)
sql.prepare("INSERT INTO exchanges VALUES (7,1,'completed')").run()
assert.equal(await blocker(),null,'Exchange-owned refund is reversed by its parent Exchange')
sql.prepare("UPDATE exchanges SET status='cancelled' WHERE id=7").run()
assert.equal((await blocker())?.returnId,1,'Formerly linked but still active Return cannot disappear')
sql.prepare("UPDATE returns SET status='cancelled' WHERE id=1").run()
assert.equal(await blocker(),null,'Cancelled Return has no delete blocker')
const code=readFileSync('worker/domains/returns-exchanges.ts','utf8')
const preview=readFileSync('worker/domains/order-delete-preview.ts','utf8')
assert.match(code,/throw new CriticalOperationConflictError\(standaloneItemReturn\.message\)/,
  'HTTP conflict should retain the exact Return ID and human-readable reason')
assert.match(preview,/if\(itemReturn\)reasons\.push\(itemReturn\.message\)/,
  'Read-only preflight should surface the exact Return before submit')
console.log('ADMIN_DELETE_STANDALONE_ITEM_RETURN_REASON_PASSED')
