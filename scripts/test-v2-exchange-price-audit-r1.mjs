import assert from 'node:assert/strict'
import fs from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { findExchangeNewPriceLink,isApprovedExchangePriceLineage } from '../worker/domains/exchange-price-history.ts'

const sql=new DatabaseSync(':memory:')
sql.exec([
'CREATE TABLE orders(id INTEGER PRIMARY KEY)',
'CREATE TABLE order_items(id INTEGER PRIMARY KEY,order_id INTEGER,quantity INTEGER,unit_price INTEGER,line_total INTEGER)',
'CREATE TABLE exchanges(id INTEGER PRIMARY KEY,order_id INTEGER,status TEXT,old_order_item_id INTEGER,new_order_item_id INTEGER,refund_return_id INTEGER)',
'CREATE TABLE exchange_items(id INTEGER PRIMARY KEY,exchange_id INTEGER,order_item_id INTEGER,role TEXT)',
'CREATE TABLE critical_operations(id INTEGER PRIMARY KEY,operation_type TEXT,target_type TEXT,target_id INTEGER,context_json TEXT,created_at TEXT)',
].join(';')+';')
sql.exec(fs.readFileSync('migrations/0110_v72_exchange_order_item_price_correction_audit.sql','utf8'))
const db={prepare(query){let args=[];return {
 bind(...x){args=x;return this},
 async first(){return sql.prepare(query).get(...args)??null},
 async all(){return {results:sql.prepare(query).all(...args)}},
}}}
const plan={executionPlan:{newItems:[{item:{unitPrice:20000,quantity:1}}],oldItems:[{orderItemId:1,unitPrice:17000,quantity:1}],removedValue:17000}}
sql.exec("INSERT INTO orders VALUES(42)")
sql.exec("INSERT INTO order_items VALUES(11,42,1,20000,20000)")
sql.exec("INSERT INTO exchanges VALUES(100,42,'completed',1,11,NULL)")
sql.exec("INSERT INTO exchange_items VALUES(501,100,11,'new')")
sql.prepare("INSERT INTO critical_operations VALUES(1000,'exchange_set_create','exchange',100,?,'2026-10-17')").run(JSON.stringify(plan))
let linked=await findExchangeNewPriceLink(db,42,11,20000)
assert.deepEqual(linked,{exchangeId:100,originalUnitPrice:20000})
assert.equal(await isApprovedExchangePriceLineage(db,100,11,20000,23000),false,'Unrecorded price edit must be untrusted')
const add=sql.prepare("INSERT INTO exchange_order_item_price_corrections(request_id,order_id,order_item_id,exchange_id,original_exchange_unit_price,old_unit_price,new_unit_price,quantity_at_correction,actor_label,corrected_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
add.run('r1',42,11,100,20000,20000,23000,1,'manager','2026-10-17T10:00:00Z')
assert.equal(await isApprovedExchangePriceLineage(db,100,11,20000,23000),true)
sql.exec("UPDATE order_items SET unit_price=23000,line_total=23000 WHERE id=11")
linked=await findExchangeNewPriceLink(db,42,11,23000)
assert.deepEqual(linked,{exchangeId:100,originalUnitPrice:20000})
add.run('r2',42,11,100,20000,23000,22000,1,'manager','2026-10-17T11:00:00Z')
assert.equal(await isApprovedExchangePriceLineage(db,100,11,20000,22000),true,'Two corrections must preserve a contiguous chain')
assert.equal(await isApprovedExchangePriceLineage(db,100,11,20000,23000),false,'Prior corrected price cannot override latest')
assert.equal(await isApprovedExchangePriceLineage(db,100,11,20000,25000),false,'Unrecorded price remains rejected')
sql.exec("UPDATE order_items SET unit_price=22000,line_total=22000 WHERE id=11")
await assert.rejects(()=>findExchangeNewPriceLink(db,42,11,25000),/историей исправлений/i)
assert.throws(()=>sql.exec("UPDATE exchange_order_item_price_corrections SET new_unit_price=50000 WHERE id=1"),/immutable/i)
assert.throws(()=>sql.exec("DELETE FROM exchange_order_item_price_corrections"),/immutable/i)
assert.throws(()=>add.run('r2',42,11,100,20000,22000,26000,1,'manager','2026-10-17'),/UNIQUE/i)
sql.exec("INSERT INTO exchanges VALUES(101,42,'completed',11,12,NULL)")
sql.exec("INSERT INTO exchange_items VALUES(502,101,11,'old')")
await assert.rejects(()=>findExchangeNewPriceLink(db,42,11,22000),/нескольких обменах/i)
sql.exec("UPDATE exchanges SET status='cancelled' WHERE id=101")
linked=await findExchangeNewPriceLink(db,42,11,22000)
assert.equal(linked.exchangeId,100)
sql.exec("UPDATE exchanges SET status='cancelled' WHERE id=100")
assert.equal(await findExchangeNewPriceLink(db,42,11,22000),null)
const cancel=fs.readFileSync('worker/domains/returns-exchanges.ts','utf8')
const cancelCode=cancel.slice(cancel.indexOf('export async function cancelExchangeSetV2('))
assert(cancelCode.includes('isApprovedExchangePriceLineage('),'V2 cancellation must use audit provenance')
assert(cancelCode.includes('const expectedLineTotal = expectedQuantity * unitPrice'),'V2 cancellation removes corrected value')
assert(cancelCode.includes('originalRemovedValue !== plan.removedValue'),'V2 original removed value must remain verifiable against the immutable execution plan')
assert(cancelCode.includes('const projectedRestoredTotal = activeTotal - removedNewValue + correctedRemovedValue'),'Cancellation must restore an explicitly audited old-price correction, not rewrite original plan')
const write=fs.readFileSync('worker/domains/orders-write.ts','utf8')
assert(write.includes('findExchangeNewPriceLink('),'Editor validates V2 exchange origin')
assert(write.includes('...immutableExchangeAudit,'),'Audit and price correction must be atomic')
assert(write.includes('...correctionCas,'),'Stale guard before writes')
assert(write.includes("totals.receivedAmount > totals.totalAmount"),'No silent overpayment')
assert(write.includes("stockReversals = (p.rewriteItems || p.deletingOrder)"),'No physical stock edit')
sql.close()
console.log('V2_EXCHANGE_NEW_PRICE_IMMUTABLE_LINEAGE_TEST_PASSED')
