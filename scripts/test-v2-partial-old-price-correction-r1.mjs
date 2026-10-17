import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { findPartialV2OldPriceLink,isApprovedExchangePriceLineage } from '../worker/domains/exchange-price-history.ts'

// Run exact production SQL in an isolated SQLite database. No D1 connections.
const source=readFileSync('worker/domains/orders-write.ts','utf8')
const cancelSource=readFileSync('worker/domains/returns-exchanges.ts','utf8')
const casSql=source.match(/const correctionCas = p\.recordedPriceOnlyRequest[\s\S]*?db\.prepare\(\s*\x60([\s\S]*?)\x60\s*\)\.bind\(\s*toInt\(audit\.itemId/)
const auditSql=source.match(/const immutableExchangeAudit = [\s\S]*?db\.prepare\(\s*\x60([\s\S]*?)\x60\s*\)\.bind\(/)
assert(casSql&&auditSql,'Exact transaction CAS/audit SQL must remain recognizable')
assert(source.includes("findPartialV2OldPriceLink(db,id,correction.orderItemId"),'Manager price handler must classify partial old lines')
assert(source.includes("exchangeRole: linkedExchangePriceCorrections.get"),'Audit role missing')
assert(cancelSource.includes('expectedCurrentUnitPrice'),'Cancel must compare corrected current price')
assert(cancelSource.includes('const projectedRestoredTotal = activeTotal - removedNewValue + correctedRemovedValue'),'Projected cancellation total must use corrected old price')
const sql=new DatabaseSync(':memory:')
sql.exec([
 "CREATE TABLE orders(id INTEGER PRIMARY KEY,order_status TEXT,total_amount INTEGER,received_amount INTEGER,return_amount INTEGER)",
 "CREATE TABLE order_items(id INTEGER PRIMARY KEY,order_id INTEGER,quantity INTEGER,unit_price INTEGER,line_total INTEGER,catalog_price_snapshot INTEGER)",
 "CREATE TABLE exchanges(id INTEGER PRIMARY KEY,order_id INTEGER,status TEXT,old_order_item_id INTEGER,new_order_item_id INTEGER,refund_return_id INTEGER)",
 "CREATE TABLE exchange_items(id INTEGER PRIMARY KEY,exchange_id INTEGER,order_item_id INTEGER,role TEXT)",
 "CREATE TABLE critical_operations(id INTEGER PRIMARY KEY,operation_type TEXT,target_type TEXT,target_id INTEGER,context_json TEXT,created_at TEXT,status TEXT)",
 "CREATE TABLE returns(id INTEGER PRIMARY KEY,order_id INTEGER,status TEXT)",
 "CREATE TABLE return_items(id INTEGER PRIMARY KEY,return_id INTEGER,order_item_id INTEGER)",
 "CREATE TABLE payments(id INTEGER PRIMARY KEY,order_id INTEGER,amount INTEGER)",
 "CREATE TABLE inventory_stock(id INTEGER PRIMARY KEY,variant_id INTEGER,quantity INTEGER,reserved_quantity INTEGER)",
].join(';')+';')
sql.exec(readFileSync('migrations/0110_v72_exchange_order_item_price_correction_audit.sql','utf8'))
const db={prepare(query){let args=[];return{
 bind(...x){args=x;return this},
 async first(){return sql.prepare(query).get(...args)??null},
 async all(){return {results:sql.prepare(query).all(...args)}},
}}}
const plan={executionPlan:{
  oldItems:[{orderItemId:11,quantity:1,unitPrice:10000}],
  newItems:[{item:{unitPrice:30000,quantity:1}}],
  removedValue:10000
}}
sql.exec([
 "INSERT INTO orders VALUES(42,'active',50000,35000,0)",
 "INSERT INTO order_items VALUES(11,42,2,10000,20000,10000)",
 "INSERT INTO order_items VALUES(12,42,1,30000,30000,30000)",
 "INSERT INTO exchanges VALUES(101,42,'completed',11,12,NULL)",
 "INSERT INTO exchange_items VALUES(501,101,11,'old')",
 "INSERT INTO exchange_items VALUES(502,101,12,'new')",
 "INSERT INTO payments VALUES(1,42,35000)",
 "INSERT INTO inventory_stock VALUES(1,240,4,2)",
].join(';')+';')
sql.prepare("INSERT INTO critical_operations VALUES(100,'exchange_set_create','exchange',101,?,'2026-10-17','completed')").run(JSON.stringify(plan))
let link=await findPartialV2OldPriceLink(db,42,11,10000)
assert.deepEqual(link,{exchangeId:101,originalUnitPrice:10000})
assert.equal(await findPartialV2OldPriceLink(db,42,12,30000),null,'V2 new line must stay on new-line handler')
function apply(oldPrice,newPrice,oldTotal,requestId) {
  const oldLine=2*oldPrice,newLine=2*newPrice
  sql.exec('BEGIN')
  try {
    sql.prepare(casSql[1]).all(11,42,2,oldPrice,oldLine,10000,10000,oldTotal,35000,0,101,101,101,'old','old')
    sql.prepare(auditSql[1]).run(requestId,42,11,101,'old',10000,oldPrice,newPrice,2,'Менеджер','2026-10-17')
    sql.prepare('UPDATE orders SET total_amount=? WHERE id=42').run(oldTotal+(newLine-oldLine))
    sql.prepare('UPDATE order_items SET unit_price=?,line_total=? WHERE id=11').run(newPrice,newLine)
    sql.exec('COMMIT')
    return true
  } catch(error){sql.exec('ROLLBACK');return String(error)}
}
assert.equal(apply(10000,11000,50000,'req1'),true,'Initial old remainder correction CAS should succeed')
assert.deepEqual(await findPartialV2OldPriceLink(db,42,11,11000),{exchangeId:101,originalUnitPrice:10000})
assert.equal(await isApprovedExchangePriceLineage(db,101,11,10000,11000,'old'),true)
assert.equal(await isApprovedExchangePriceLineage(db,101,11,10000,11000,'new'),false,'Old correction must not affect new line')
assert.equal(sql.prepare('SELECT total_amount FROM orders WHERE id=42').get().total_amount,52000)
assert.equal(sql.prepare('SELECT line_total FROM order_items WHERE id=11').get().line_total,22000)
assert.equal(sql.prepare('SELECT amount FROM payments WHERE id=1').get().amount,35000)
assert.deepEqual({...sql.prepare('SELECT quantity,reserved_quantity FROM inventory_stock WHERE id=1').get()},{quantity:4,reserved_quantity:2})
assert.match(apply(10000,10500,50000,'stale'),/malformed JSON|ORDER_RECORDED_PRICE_STALE/i,'Stale price CAS must fail')
assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM exchange_order_item_price_corrections').get().n,1,'No audit on failed transaction')
assert.equal(apply(11000,12000,52000,'req2'),true,'Second correction must maintain contiguous lineage')
assert.equal(await isApprovedExchangePriceLineage(db,101,11,10000,12000,'old'),true)
assert.equal(sql.prepare('SELECT total_amount FROM orders WHERE id=42').get().total_amount,54000)
assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM exchange_order_item_price_corrections').get().n,2)
assert.match(apply(12000,13000,52000,'stale-total'),/malformed JSON|ORDER_RECORDED_PRICE_STALE/i,'Mismatched order total cannot overwrite')
assert.throws(()=>sql.exec('DELETE FROM exchange_order_item_price_corrections'),/immutable/i)
const currentTotal=54000,removedNewValue=30000,correctedRemovedValue=12000
const projectedRestoredTotal=currentTotal-removedNewValue+correctedRemovedValue
assert.equal(projectedRestoredTotal,36000,'Cancel restores only exchanged quantity at corrected price')
assert.equal(35000<=projectedRestoredTotal,true,'Known net paid passes preflight')
assert.equal(38000>projectedRestoredTotal,true,'Overpayment must block cancellation before inventory movement')

sql.exec("INSERT INTO returns VALUES(200,42,'completed')")
sql.exec("INSERT INTO return_items VALUES(201,200,11)")
await assert.rejects(()=>findPartialV2OldPriceLink(db,42,11,12000),/возврате/i)
assert.match(apply(12000,13000,54000,'return-race'),/malformed JSON|ORDER_RECORDED_PRICE_STALE/i,'Active Return to same old line must block in atomic CAS')
sql.exec("UPDATE returns SET status='cancelled' WHERE id=200")
sql.exec("INSERT INTO exchanges VALUES(102,42,'completed',11,13,NULL)")
sql.exec("INSERT INTO exchange_items VALUES(503,102,11,'old')")
await assert.rejects(()=>findPartialV2OldPriceLink(db,42,11,12000),/нескольких обменах/i)
assert.match(apply(12000,13000,54000,'exchange-race'),/malformed JSON|ORDER_RECORDED_PRICE_STALE/i,'Second active Exchange must block in CAS')
sql.exec("UPDATE exchanges SET status='cancelled' WHERE id=102")
sql.exec("INSERT INTO critical_operations VALUES(300,'exchange_set_cancel','exchange',101,NULL,'2026-10-17','started')")
await assert.rejects(()=>findPartialV2OldPriceLink(db,42,11,12000),/Отмена/i)
assert.match(apply(12000,13000,54000,'cancel-race'),/malformed JSON|ORDER_RECORDED_PRICE_STALE/i,'Concurrent cancellation must block in CAS')
sql.exec("UPDATE critical_operations SET status='completed' WHERE id=300")
assert.match(apply(12000,13000,54000,'cancel-done'),/malformed JSON|ORDER_RECORDED_PRICE_STALE/i)
sql.close()
console.log('PARTIAL_V2_OLD_LINE_PRICE_CAS_LEDGER_MONEY_STOCK_AND_CANCEL_PREFLIGHT_PASSED')
