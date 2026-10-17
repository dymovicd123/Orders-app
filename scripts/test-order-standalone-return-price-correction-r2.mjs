import assert from 'node:assert/strict'
import fs from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

const source=fs.readFileSync('worker/domains/orders-write.ts','utf8')
const returns=fs.readFileSync('worker/domains/returns-exchanges.ts','utf8')
const ui=fs.readFileSync('src/features/sections/OrdersTableSection.tsx','utf8')
assert(source.includes("if (toInt(dependency?.exchange_link, 0))"),'Exchange-linked price must be blocked')
assert(!source.includes("if (toInt(dependency?.exchange_link, 0) || toInt(dependency?.return_link, 0))"),'Standalone returns must no longer globally block their item')
assert(source.includes("const correctionCas = p.recordedPriceOnlyRequest"),'Atomic CAS absent')
assert(source.includes("ORDER_RECORDED_PRICE_STALE"),'Atomic CAS failure marker missing')
assert(source.includes("o.return_amount"),'Refund consistency snapshot missing')
assert(source.includes("priceAudit: recordedPriceOnlyRequest"),'Before/after prices must be audited')
assert(source.includes("stockReversals = (p.rewriteItems || p.deletingOrder)"),'No physical stock reverse during price-only change')
assert(source.includes("totals.receivedAmount > totals.totalAmount"),'No overpaid orders can be silently accepted')
const cStart=returns.indexOf('export async function cancelReturn(')
const cEnd=returns.indexOf('export async function cancelExchange(',cStart)
assert(cStart>=0 && cEnd>cStart,'Return cancellation function moved, re-evaluate price independence')
const cancel=returns.slice(cStart,cEnd)
assert(!cancel.includes('unit_price')&&!cancel.includes('line_total'), 'Return cancellation has become price-dependent: stop rollout')
assert(ui.includes('Исправить записанную цену'),'Manager action not present')

const dependency=source.match(/const dependency = await db\.prepare\(\s*\`([\s\S]*?)\`\s*\)\.bind\(id, correction\.orderItemId, correction\.orderItemId, correction\.orderItemId,\s*id, correction\.orderItemId,\s*id, correction\.orderItemId\)/)
assert(dependency,'Production dependency query not found')
const cas=source.match(/const correctionCas = p\.recordedPriceOnlyRequest[\s\S]*?db\.prepare\(\s*\`([\s\S]*?)\`\s*\)\.bind\(\s*toInt\(audit\.itemId/)
assert(cas,'Production order/item/refund CAS SQL not found')

const db=new DatabaseSync(':memory:')
db.exec([
  "CREATE TABLE orders(id INTEGER PRIMARY KEY,order_status TEXT,total_amount INTEGER,received_amount INTEGER,return_amount INTEGER)",
  "CREATE TABLE order_items(id INTEGER PRIMARY KEY,order_id INTEGER,quantity INTEGER,unit_price INTEGER,line_total INTEGER,catalog_price_snapshot INTEGER)",
  "CREATE TABLE exchanges(id INTEGER PRIMARY KEY,order_id INTEGER,status TEXT,old_order_item_id INTEGER,new_order_item_id INTEGER,refund_return_id INTEGER)",
  "CREATE TABLE critical_operations(id INTEGER PRIMARY KEY,operation_type TEXT,target_type TEXT,target_id INTEGER,status TEXT,context_json TEXT)",
  "CREATE TABLE exchange_items(id INTEGER PRIMARY KEY,exchange_id INTEGER,order_item_id INTEGER,role TEXT)",
  "CREATE TABLE returns(id INTEGER PRIMARY KEY,order_id INTEGER,status TEXT,amount INTEGER)",
  "CREATE TABLE return_items(id INTEGER PRIMARY KEY,return_id INTEGER,order_item_id INTEGER)",
  "CREATE TABLE payments(id INTEGER PRIMARY KEY,order_id INTEGER,amount INTEGER)",
  "CREATE TABLE inventory_stock(id INTEGER PRIMARY KEY,variant_id INTEGER,quantity INTEGER,reserved_quantity INTEGER)",
].join(';')+';')
db.exec([
 "INSERT INTO orders VALUES(42,'active',30000,25000,5000)",
 "INSERT INTO order_items VALUES(14,42,1,12000,NULLIF(12000,0),12000)",
 "INSERT INTO order_items VALUES(10,42,1,18000,18000,18000)",
 "INSERT INTO returns VALUES(300,42,'completed',5000)",
 "INSERT INTO return_items VALUES(400,300,14)",
 "INSERT INTO payments VALUES(20,42,25000)",
 "INSERT INTO inventory_stock VALUES(7,240,4,2)",
].join(';')+';')
const dep=item=>({...db.prepare(dependency[1]).get(42,item,item,item,42,item,42,item)})
const args=[14,42,1,12000,12000,12000,12000,30000,25000,5000,null,null,null,'new','new']
function apply({nextPrice=14000,old=30000}={}){
  db.exec('BEGIN')
  try{
    db.prepare(cas[1]).all(...args)
    db.prepare('UPDATE orders SET total_amount=? WHERE id=?').run(old+(nextPrice-12000),42)
    db.prepare('UPDATE order_items SET unit_price=?,line_total=? WHERE id=14').run(nextPrice,nextPrice)
    db.exec('COMMIT')
    return true
  }catch(err){
    db.exec('ROLLBACK')
    return String(err)
  }
}
assert.deepEqual(dep(14),{exchange_link:0,return_link:1},'Active standalone Return must be classified independently')
assert.equal(apply(),true,'Price correction with independent Return must pass atomic gate')
assert.equal(db.prepare('SELECT unit_price FROM order_items WHERE id=14').get().unit_price,14000)
assert.equal(db.prepare('SELECT total_amount FROM orders WHERE id=42').get().total_amount,32000)
assert.equal(db.prepare('SELECT amount FROM returns WHERE id=300').get().amount,5000,'Return must stay immutable')
assert.equal(db.prepare('SELECT amount FROM payments WHERE id=20').get().amount,25000,'Payment must stay immutable')
assert.deepEqual({...db.prepare('SELECT quantity,reserved_quantity FROM inventory_stock WHERE id=7').get()},{quantity:4,reserved_quantity:2},'Physical/reserved stock unchanged')
assert.match(apply(),/malformed JSON|ORDER_RECORDED_PRICE_STALE/i,'Stale price must rollback atomically')
assert.equal(db.prepare('SELECT total_amount FROM orders WHERE id=42').get().total_amount,32000)
assert.equal(db.prepare('SELECT unit_price FROM order_items WHERE id=14').get().unit_price,14000)

// Rebuild fixture and simulate an active exchange linked to a returned item's
// auto-refund. Directly or indirectly exchanged lines are not safe to overwrite.
db.exec("UPDATE order_items SET unit_price=12000,line_total=12000 WHERE id=14")
db.exec("UPDATE orders SET total_amount=30000 WHERE id=42")
db.exec("INSERT INTO exchanges VALUES(501,42,'completed',10,999,300)")
assert.equal(dep(14).exchange_link,1,'Exchange refund link must block editing')
assert.match(apply(),/malformed JSON|ORDER_RECORDED_PRICE_STALE/i,'CAS must rollback exchange refund link')
db.exec("UPDATE exchanges SET status='cancelled' WHERE id=501")
assert.equal(dep(14).exchange_link,0,'Cancelled exchange should not block standalone Return')
db.exec("INSERT INTO exchanges VALUES(502,42,'completed',14,999,NULL)")
assert.equal(dep(14).exchange_link,1,'Direct old exchange item blocked')
assert.match(apply(),/malformed JSON|ORDER_RECORDED_PRICE_STALE/i,'Active direct exchange blocks atomic write')
db.exec("UPDATE exchanges SET status='cancelled' WHERE id=502")
db.exec("INSERT INTO exchanges VALUES(503,42,'completed',10,999,NULL)")
db.exec("INSERT INTO exchange_items VALUES(600,503,14,'new')")
assert.equal(dep(14).exchange_link,1,'Exchange-set row linked by exchange_items must block')
assert.match(apply(),/malformed JSON|ORDER_RECORDED_PRICE_STALE/i,'Exchange set blocks price correction')
db.exec("UPDATE exchanges SET status='cancelled' WHERE id=503")
db.exec("UPDATE orders SET received_amount=23000 WHERE id=42")
assert.match(apply(),/malformed JSON|ORDER_RECORDED_PRICE_STALE/i,'New payment amount invalidates old price calculation')
db.exec("UPDATE orders SET received_amount=25000,return_amount=4000 WHERE id=42")
assert.match(apply(),/malformed JSON|ORDER_RECORDED_PRICE_STALE/i,'New refund invalidates old price calculation')
db.exec("UPDATE orders SET return_amount=5000 WHERE id=42")
db.exec("UPDATE order_items SET quantity=2 WHERE id=14")
assert.match(apply(),/malformed JSON|ORDER_RECORDED_PRICE_STALE/i,'Quantity drift invalidates correction')
db.close()
console.log('LINKED_STANDALONE_RETURN_PRICE_AND_ATOMIC_STALE_GUARDS_PASSED')
