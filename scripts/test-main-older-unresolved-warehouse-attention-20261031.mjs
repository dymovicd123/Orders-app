import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {catalogReviewBasePredicate,catalogReviewOperationalPredicate} from '../worker/domains/catalog-review.ts'
const db=new DatabaseSync(':memory:')
db.exec([
 "CREATE TABLE orders(id INTEGER PRIMARY KEY,order_status TEXT,archived_at TEXT,shipping_status TEXT,order_date TEXT,created_at TEXT)",
 "CREATE TABLE order_items(id INTEGER PRIMARY KEY,order_id INTEGER,quantity INTEGER,product_id INTEGER,variant_id INTEGER,stock_writeoff_status TEXT,created_at TEXT,is_workshop INTEGER)",
 "CREATE TABLE inventory_reservations(id INTEGER PRIMARY KEY,order_id INTEGER,order_item_id INTEGER,status TEXT,unresolved_reason TEXT)",
 "CREATE TABLE return_items(order_item_id INTEGER,return_id INTEGER,quantity INTEGER)",
 "CREATE TABLE returns(id INTEGER PRIMARY KEY,status TEXT)",
 "CREATE TABLE workshop_tasks(order_item_id INTEGER,quantity INTEGER,status TEXT)"
].join(';')+';')
const old='2026-01-01T00:00:00.000Z',fresh=new Date().toISOString()
const record=(id,{date=old,shipping='not_sent',status='active',reserve='none',reason='variant',workshop=0}={})=>{
 db.prepare('INSERT INTO orders(id,order_status,archived_at,shipping_status,order_date,created_at) VALUES(?,?,?,?,?,?)')
 .run(id,status,null,shipping,date.slice(0,10),date)
 db.prepare("INSERT INTO order_items(id,order_id,quantity,product_id,variant_id,stock_writeoff_status,created_at,is_workshop) VALUES(?,?,1,NULL,NULL,'catalog_unresolved',?,?)")
 .run(id,id,date,workshop)
 if(reserve!=='none')db.prepare('INSERT INTO inventory_reservations(order_id,order_item_id,status,unresolved_reason) VALUES(?,?,?,?)')
 .run(id,id,reserve,reason)
}
record(101,{reserve:'unresolved',reason:'product'})       // old active unsent: visible
record(102,{reserve:'unresolved',reason:'variant'})       // old active unsent: visible
record(103)                                              // old, no pending reserve: not visible
record(104,{reserve:'unresolved',shipping:'sent'})        // sent: not visible
record(105,{date:fresh})                                 // ordinary recent: visible
record(106,{reserve:'unresolved',status:'deleted'})       // deleted: not visible
record(107,{reserve:'released'})                         // finished reserve: not visible
record(108,{reserve:'unresolved',workshop:1})             // workshop: no date bypass
record(109,{reserve:'unresolved',reason:'other'})         // other unresolved reason: no bypass
const base=catalogReviewBasePredicate('oi','o')
const operational=catalogReviewOperationalPredicate('oi','o')
const query=`SELECT oi.id FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE ${base} AND ${operational} ORDER BY oi.id`
assert.deepEqual(db.prepare(query).all().map(x=>x.id),[101,102,105],
 'Only currently actionable older unresolved catalogue orders and recent orders appear')
const attention=readFileSync('worker/domains/warehouse-attention.ts','utf8')
assert.match(attention,/catalogReviewOperationalPredicate\('oi', 'o'\)/)
assert.match(attention,/AS catalog_count/)
assert.match(attention,/catalog: \(catalogResult\.results \|\| \[\]\)/)
console.log('MAIN_OLDER_UNRESOLVED_WAREHOUSE_ATTENTION_PASSED — active unsent product/variant retained, sent/deleted/workshop/released/other old excluded, SQLite predicate and real warehouse wiring')
