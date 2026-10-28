// Focused P0 SQL preflight on a disposable in-memory SQLite database.
// Extracts the actual query literals from Worker code, never connects to D1.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
const returns=readFileSync('worker/domains/returns-exchanges.ts','utf8')
const shipping=readFileSync('worker/domains/order-reservations.ts','utf8')
const capture=(source,variable)=>{
  const i=source.indexOf('const '+variable+' = await db.prepare(')
  assert(i>=0,'Missing actual preflight query: '+variable)
  const start=source.indexOf('`',i),end=source.indexOf('`',start+1)
  assert(start>=0&&end>start,'Unterminated query: '+variable)
  return source.slice(start+1,end)
}
const creation=capture(returns,'dangling')
const intake=capture(returns,'activeReservation')
const pendingHelperStart=shipping.indexOf('const pendingExchangeReplacementExclusionSql = ')
assert(pendingHelperStart>=0)
const pendingTickOpen=shipping.indexOf('`',pendingHelperStart)
const pendingTickClose=shipping.indexOf('`',pendingTickOpen+1)
assert(pendingTickOpen>=0&&pendingTickClose>pendingTickOpen)
const pendingExclusion=shipping.slice(pendingTickOpen+1,pendingTickClose).replaceAll('${orderItemReference}','r.order_item_id')
const shipment=capture(shipping,'conflictingReturn').replaceAll("${pendingExchangeReplacementExclusionSql('r.order_item_id')}",pendingExclusion)
assert.match(creation,/inventory_reservations/)
assert.match(creation,/status IN \('active', 'unresolved'\)/)
assert.match(intake,/status IN \('active', 'unresolved'\)/)
assert.match(shipment,/AND ret\.order_id = r\.order_id/)
assert.match(shipment,/NOT EXISTS \(/)
assert.match(shipment,/e\.refund_return_id = ret\.id/)
assert.match(shipment,/COALESCE\(oi\.is_workshop, 0\) = 0/)
const createFn=returns.indexOf('export async function createReturn(')
const guard=returns.indexOf('const dangling = await db.prepare(',createFn)
const issued=returns.indexOf('const issuedToClient =',createFn)
const physicalState=returns.indexOf('const physicalState = selected.physicalState;',createFn)
assert(createFn>=0&&issued<guard&&guard<physicalState,
  'Guard must occur after exact issue validation and before physical return actions')
const receiveFn=returns.indexOf('export async function receiveReturnedItem(')
const receiveGuard=returns.indexOf('const activeReservation = await db.prepare(',receiveFn)
const receiveMutation=returns.indexOf('SET physical_received_at = ?',receiveFn)
assert(receiveFn>=0&&receiveGuard>receiveFn&&receiveGuard<receiveMutation,
  'Late intake must reject contradictory active reserve before receipt is marked')
const shipFn=shipping.indexOf('export async function fulfillOrderReservationsV2(')
const shipGuard=shipping.indexOf('const conflictingReturn = await db.prepare(',shipFn)
const shipMutate=shipping.indexOf('UPDATE orders SET shipping_status',shipFn)
assert(shipFn>=0&&shipGuard>shipFn&&shipGuard<shipMutate,
  'Shipping and per-line handover must preflight before shipment mutation')
assert.match(shipping.slice(shipGuard,shipMutate),/error\.code = 'return_reservation_conflict'/)

const db=new DatabaseSync(':memory:')
db.exec(`
 CREATE TABLE inventory_reservations(id INTEGER PRIMARY KEY,order_id INTEGER,order_item_id INTEGER,status TEXT,quantity INTEGER);
 CREATE TABLE order_items(id INTEGER PRIMARY KEY,order_id INTEGER,product_name_snapshot TEXT,is_workshop INTEGER,quantity INTEGER);
 CREATE TABLE returns(id INTEGER PRIMARY KEY,order_id INTEGER,status TEXT);
 CREATE TABLE return_items(id INTEGER PRIMARY KEY,return_id INTEGER,order_item_id INTEGER,quantity INTEGER);
 CREATE TABLE exchanges(id INTEGER PRIMARY KEY,refund_return_id INTEGER,status TEXT);
 CREATE TABLE inventory_lifecycle_events(id INTEGER PRIMARY KEY,order_item_id INTEGER,operation_type TEXT,operation_id INTEGER,event_type TEXT,status TEXT,pending_reason TEXT);
 INSERT INTO order_items VALUES(5,42,'ШАПАН',0,1);
 INSERT INTO inventory_reservations VALUES(7,42,5,'active',1);
 INSERT INTO returns VALUES(10,42,'completed');
 INSERT INTO return_items VALUES(11,10,5,1);
`)
const read=(q,...args)=>db.prepare(q).get(...args)??null
assert.equal(read(creation,5)?.id,7,'Create: active reserve must block physical Return')
assert.equal(read(intake,5)?.id,7,'Late intake: active reserve must block stock +1')
assert.equal(read(shipment.replaceAll('${scopeSql}',''),42)?.return_id,10,
  'Normal shipment cannot fulfill a returned still-active line')
assert.equal(read(shipment.replaceAll('${scopeSql}',' AND r.order_item_id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))'),42,'[5]')?.return_id,10,
  'Per-item early issue must enforce same guard')
assert.equal(read(shipment.replaceAll('${scopeSql}',' AND r.order_item_id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))'),42,'[500]'),null,
  'Scoped guard cannot block unrelated order item')
db.exec("UPDATE inventory_reservations SET status='unresolved' WHERE id=7")
assert.equal(read(creation,5)?.id,7,'Physical Return must reject unresolved stock obligation')
assert.equal(read(intake,5)?.id,7,'Late receipt must reject unresolved stock obligation')
db.exec("UPDATE inventory_reservations SET status='fulfilled' WHERE id=7")
assert.equal(read(creation,5),null,'Legitimately fulfilled SKU must remain returnable')
assert.equal(read(intake,5),null,'Legitimately fulfilled SKU can be received')
assert.equal(read(shipment.replaceAll('${scopeSql}',''),42),null,'Fulfilled item is not a double-shipment candidate')
db.exec("UPDATE inventory_reservations SET status='active' WHERE id=7")
db.exec("DELETE FROM return_items")
assert.equal(read(shipment.replaceAll('${scopeSql}',''),42),null,'Money-only refund does not block shipping')
db.exec("INSERT INTO return_items VALUES(11,10,5,1); INSERT INTO exchanges VALUES(20,10,'completed')")
assert.equal(read(shipment.replaceAll('${scopeSql}',''),42),null,'Exchange-owned money return excluded')
db.exec("UPDATE exchanges SET status='cancelled'; UPDATE returns SET status='cancelled'")
assert.equal(read(shipment.replaceAll('${scopeSql}',''),42),null,'Cancelled return excluded')
db.exec("UPDATE returns SET status='completed'; UPDATE order_items SET is_workshop=1 WHERE id=5")
assert.equal(read(shipment.replaceAll('${scopeSql}',''),42),null,'Workshop obligations are independent of warehouse reservations')
console.log('RETURN_ACTIVE_RESERVE_P0_SQL_GUARDS_PASSED: 3 production queries; active, unresolved, fulfilled, money-only, exchange-linked, cancelled, scoped, workshop')
