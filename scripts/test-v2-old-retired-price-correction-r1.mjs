import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { findRetiredV2OldItemPriceLink,recordRetiredV2OldPriceCorrection,isApprovedExchangePriceLineage } from '../worker/domains/exchange-price-history.ts'

const sql=new DatabaseSync(':memory:')
sql.exec([
 "CREATE TABLE orders(id INTEGER PRIMARY KEY, total_amount INTEGER, received_amount INTEGER)",
 "CREATE TABLE order_items(id INTEGER PRIMARY KEY,order_id INTEGER,quantity INTEGER,unit_price INTEGER,line_total INTEGER,product_name_snapshot TEXT)",
 "CREATE TABLE exchanges(id INTEGER PRIMARY KEY,order_id INTEGER,status TEXT,old_order_item_id INTEGER,new_order_item_id INTEGER)",
 "CREATE TABLE exchange_items(id INTEGER PRIMARY KEY,exchange_id INTEGER,order_item_id INTEGER,role TEXT)",
 "CREATE TABLE critical_operations(id INTEGER PRIMARY KEY,operation_type TEXT,target_type TEXT,target_id INTEGER,context_json TEXT,created_at TEXT,status TEXT)",
 "CREATE TABLE payments(id INTEGER PRIMARY KEY,order_id INTEGER,amount INTEGER)",
 "CREATE TABLE inventory_stock(id INTEGER PRIMARY KEY,variant_id INTEGER,quantity INTEGER,reserved_quantity INTEGER)",
].join(';')+';')
sql.exec(readFileSync('migrations/0110_v72_exchange_order_item_price_correction_audit.sql','utf8'))
const db={
 prepare(query){let params=[];return{
   bind(...args){params=args;return this},
   async first(){return sql.prepare(query).get(...params)??null},
   async all(){return {results:sql.prepare(query).all(...params)}},
   run(){return sql.prepare(query).run(...params)},
 }},
 async batch(statements){
   sql.exec('BEGIN')
   try {
     for(const st of statements){const raw=st;raw.run()}
     sql.exec('COMMIT');return []
   } catch(error){sql.exec('ROLLBACK');throw error}
 },
}
const plan={executionPlan:{oldItems:[{orderItemId:11,quantity:1,unitPrice:18000}],newItems:[{item:{quantity:1,unitPrice:20000}}],removedValue:18000}}
sql.exec("INSERT INTO orders VALUES(42,20000,20000)")
sql.exec("INSERT INTO order_items VALUES(11,42,0,18000,0,'Старый товар')")
sql.exec("INSERT INTO order_items VALUES(12,42,1,20000,20000,'Новый товар')")
sql.exec("INSERT INTO exchanges VALUES(100,42,'completed',11,12)")
sql.exec("INSERT INTO exchange_items VALUES(500,100,11,'old')")
sql.exec("INSERT INTO exchange_items VALUES(501,100,12,'new')")
sql.prepare("INSERT INTO critical_operations VALUES(1,'exchange_set_create','exchange',100,?,'2026-10-17','completed')").run(JSON.stringify(plan))
sql.exec("INSERT INTO payments VALUES(1,42,20000)")
sql.exec("INSERT INTO inventory_stock VALUES(1,240,4,2)")
const a=await findRetiredV2OldItemPriceLink(db,100,11)
assert.equal(a.currentRecordedUnitPrice,18000)
assert.equal(a.originalQuantity,1)
const record=(requestId,expected,next)=>recordRetiredV2OldPriceCorrection(db,{
 exchangeId:100,oldItemId:11,expectedUnitPrice:expected,newUnitPrice:next,requestId,actorLabel:'Менеджер',
})
assert.equal((await record('r1',18000,17000)).ok,true)
assert.equal((await record('r1',18000,17000)).alreadyApplied,true,'Idempotent retry')
assert.equal((await findRetiredV2OldItemPriceLink(db,100,11)).currentRecordedUnitPrice,17000)
assert.equal((await isApprovedExchangePriceLineage(db,100,11,18000,17000,'old')),true)
assert.deepEqual({...sql.prepare('SELECT quantity,unit_price,line_total FROM order_items WHERE id=11').get()},
 {quantity:0,unit_price:18000,line_total:0},'Retired original row MUST remain untouched')
assert.deepEqual({...sql.prepare('SELECT total_amount,received_amount FROM orders WHERE id=42').get()},
 {total_amount:20000,received_amount:20000},'Live order totals unchanged')
assert.deepEqual({...sql.prepare('SELECT quantity,reserved_quantity FROM inventory_stock WHERE id=1').get()},
 {quantity:4,reserved_quantity:2},'Warehouse quantities unchanged')
assert.equal(sql.prepare("SELECT amount FROM payments WHERE id=1").get().amount,20000)
await assert.rejects(()=>record('r2',18000,16000),/уже исправлена/i)
await assert.rejects(()=>record('r1',17000,16000),/уже использован/i)
assert.equal((await record('r3',17000,16500)).ok,true)
assert.equal((await isApprovedExchangePriceLineage(db,100,11,18000,16500,'old')),true)
assert.equal((await isApprovedExchangePriceLineage(db,100,11,18000,16500,'new')),false,'Old corrections may not authorize new line changes')
assert.throws(()=>sql.exec("DELETE FROM exchange_order_item_price_corrections"),/immutable/i)
sql.exec("INSERT INTO exchanges VALUES(101,42,'completed',11,13)")
sql.exec("INSERT INTO exchange_items VALUES(503,101,11,'new')")
await assert.rejects(()=>record('r4',16500,16000),/цепочке обменов/i)
sql.exec("UPDATE exchanges SET status='cancelled' WHERE id=101")
sql.exec("INSERT INTO critical_operations VALUES(2,'exchange_set_cancel','exchange',100,NULL,'2026-10-17','started')")
await assert.rejects(()=>record('r5',16500,16000),/Цена, цепочка обменов или статус отмены изменились/i)
sql.exec("UPDATE critical_operations SET status='completed' WHERE id=2")
await assert.rejects(()=>record('r6',16500,16000),/Цена, цепочка обменов или статус отмены изменились/i)
// Don't let any new historical correction through once the corresponding
// cancellation attempt started: preserve a stable, replayable cancellation preflight.
const cancel=readFileSync('worker/domains/returns-exchanges.ts','utf8')
const part=cancel.slice(cancel.indexOf('export async function cancelExchangeSetV2('))
assert(part.includes("const projectedRestoredTotal = activeTotal - removedNewValue + correctedRemovedValue"))
assert(part.includes("originalRemovedValue !== plan.removedValue"))
assert(part.includes("await isApprovedExchangePriceLineage(db,exchangeId,planItem.orderItemId,"))
assert(part.includes("SET quantity = ?,unit_price = ?,line_total = ?,stock_writeoff_status = ?"))
const worker=readFileSync('worker/index.ts','utf8')
assert(worker.includes('/exchange-old-price-candidates'))
assert(worker.includes('/old-recorded-price'))
const app=readFileSync('src/App.tsx','utf8')
const table=readFileSync('src/features/sections/OrdersTableSection.tsx','utf8')
assert(app.includes("async function correctRetiredExchangePrice("))
assert(table.includes("Исправить цену товара до обмена"))
sql.close()
console.log('V2_RETIRED_OLD_PRICE_IMMUTABLE_HISTORY_NO_STOCK_MONEY_CHANGE_PASSED')
