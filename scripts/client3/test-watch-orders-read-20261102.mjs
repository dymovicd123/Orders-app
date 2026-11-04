import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import { routeClient3Watches } from '../../worker/domains/client3-watches.ts'

const sql=new DatabaseSync(':memory:')
sql.exec('PRAGMA foreign_keys=ON')
sql.exec([
'CREATE TABLE managers(id INTEGER PRIMARY KEY,name TEXT,is_active INTEGER DEFAULT 1);',
'CREATE TABLE app_users(id INTEGER PRIMARY KEY);',
'CREATE TABLE catalog_products(id INTEGER PRIMARY KEY);',
'CREATE TABLE catalog_variants(id INTEGER PRIMARY KEY);',
"CREATE TABLE orders(id INTEGER PRIMARY KEY,external_id TEXT,order_date TEXT,manager_id INTEGER,manager_snapshot_name TEXT,source_type TEXT,shipping_status TEXT,order_status TEXT,total_amount INTEGER,received_amount INTEGER,debt_amount INTEGER,return_amount INTEGER);",
'CREATE TABLE order_items(id INTEGER PRIMARY KEY,order_id INTEGER,quantity INTEGER,product_name_snapshot TEXT,unit_price INTEGER,source_type TEXT);',
'CREATE TABLE payments(id INTEGER PRIMARY KEY,order_id INTEGER,payment_date TEXT,method TEXT,amount INTEGER,payment_kind TEXT);',
'CREATE TABLE returns(id INTEGER PRIMARY KEY,order_id INTEGER,status TEXT);',
'CREATE TABLE return_items(id INTEGER PRIMARY KEY,return_id INTEGER,order_item_id INTEGER,quantity INTEGER,physical_tracking INTEGER DEFAULT 0,physical_received_at TEXT);',
'CREATE TABLE exchange_items(id INTEGER PRIMARY KEY,exchange_id INTEGER,order_item_id INTEGER,quantity INTEGER,role TEXT,physical_tracking INTEGER DEFAULT 0,physical_received_at TEXT);',
'CREATE TABLE exchanges(id INTEGER PRIMARY KEY,order_id INTEGER,new_order_item_id INTEGER,status TEXT);',
'CREATE TABLE order_dispatches(id INTEGER PRIMARY KEY,order_id INTEGER);',
'CREATE TABLE order_dispatch_items(id INTEGER PRIMARY KEY,dispatch_id INTEGER,order_item_id INTEGER,quantity INTEGER,cancelled_quantity INTEGER);',
'CREATE TABLE inventory_stock(id INTEGER PRIMARY KEY);',
'CREATE TABLE inventory_reservations(id INTEGER PRIMARY KEY,order_id INTEGER,status TEXT);',
'CREATE TABLE financial_events(id INTEGER PRIMARY KEY,order_id INTEGER,event_date TEXT,event_type TEXT,amount_delta INTEGER,payment_method TEXT,external_order_id TEXT,reason TEXT,comment TEXT);',
`INSERT INTO managers VALUES(1,'Alice',1),(2,'Bob',1);`,
'INSERT INTO app_users VALUES(9);',
"INSERT INTO orders VALUES(1,'W-1','2026-11-01',1,'Alice','warehouse','not_sent','active',20000,10000,10000,0);",
"INSERT INTO orders VALUES(2,'W-2','2026-11-02',2,'Bob','boutique','sent','active',60000,60000,0,0);",
"INSERT INTO orders VALUES(3,'W-3','2026-10-01',1,'Alice','warehouse','sent','active',30000,30000,0,0);",
'INSERT INTO order_items VALUES(101,1,1,\'WATCH ONE\',20000,\'warehouse\'),(102,2,1,\'WATCH TWO\',60000,\'boutique\'),(103,3,1,\'WATCH THREE\',30000,\'warehouse\');',
"INSERT INTO payments VALUES(1,1,'2026-11-01','KASPI RED',4000,'primary'),(2,1,'2026-11-01','KASPI GOLD',6000,'extra'),(3,2,'2026-11-02','KASPI GOLD',60000,'primary');",
"INSERT INTO financial_events VALUES(1,1,'2026-11-01','order_payment',10000,'KASPI GOLD','W-1',NULL,NULL);",
"INSERT INTO financial_events VALUES(2,1,'2026-11-02','order_refund',-1500,'KASPI GOLD','W-1',NULL,NULL);",
"INSERT INTO financial_events VALUES(3,2,'2026-11-02','order_payment',60000,'KASPI RED','W-2',NULL,NULL);",
"INSERT INTO financial_events VALUES(4,3,'2026-10-01','order_payment',30000,'KASPI GOLD','W-3',NULL,NULL);",
"INSERT INTO order_dispatches(id,order_id) VALUES(10,1);",
"INSERT INTO order_dispatch_items VALUES(11,10,101,1,0);",
].join('\n'))
sql.exec(`CREATE TABLE customers(id INTEGER PRIMARY KEY,display_name TEXT,phone_normalized TEXT);
 ALTER TABLE orders ADD COLUMN customer_id INTEGER;
 ALTER TABLE orders ADD COLUMN customer_name_override TEXT;
 ALTER TABLE orders ADD COLUMN city TEXT;
 ALTER TABLE orders ADD COLUMN delivery_type TEXT;
 ALTER TABLE orders ADD COLUMN comment TEXT;
 ALTER TABLE order_items ADD COLUMN line_total INTEGER;
 ALTER TABLE order_items ADD COLUMN catalog_price_snapshot INTEGER;
 ALTER TABLE order_items ADD COLUMN stock_writeoff_status TEXT;
 UPDATE order_items SET line_total=unit_price*quantity;`)
sql.exec('ALTER TABLE payments ADD COLUMN comment TEXT')
sql.exec('ALTER TABLE financial_events ADD COLUMN created_at TEXT')
sql.exec(fs.readFileSync('migrations/client3-watch/0002_client3_watch_foundation.sql','utf8'))
sql.exec(fs.readFileSync('migrations/client3-watch/0004_client3_shared_reference_values.sql','utf8'))
sql.exec(fs.readFileSync('migrations/client3-watch/0005_client3_editable_sku_references.sql','utf8'))
sql.exec([
'INSERT INTO watch_manager_brands(manager_id,brand_id) VALUES(1,1),(2,2);',
"INSERT INTO watch_order_details(order_id,brand_id,recipient_name,recipient_phone,delivery_full_address,postal_code,city,delivery_method,urgent,shipping_deadline_at) VALUES(1,1,'Private Customer 1','777','Address 1','050000','Almaty','Kazpost',0,'2026-11-05T12:00:00Z');",
"INSERT INTO watch_order_details(order_id,brand_id,recipient_name,recipient_phone,delivery_full_address,postal_code,city,delivery_method,urgent,shipping_deadline_at) VALUES(2,2,'Private Customer 2','888','Address 2','010000','Astana','Kazpost',1,'2026-11-06T12:00:00Z');",
"INSERT INTO watch_order_details(order_id,brand_id,recipient_name,recipient_phone,delivery_full_address,postal_code,city,delivery_method,urgent,shipping_deadline_at) VALUES(3,1,'Historical Customer 3','999','Address 3','050000','Almaty','Kazpost',0,'2026-10-06T12:00:00Z');",
'INSERT INTO watch_logistics_jobs(order_id) VALUES(1),(2),(3);',
].join('\n'))
function dbMock() {
  return { prepare(query) {
    let params=[]
    return {
      bind(...args){params=args;return this},
      async first(){return sql.prepare(query).get(...params)||null},
      async all(){return {results:sql.prepare(query).all(...params)}},
    }
  }}
}
const db=dbMock()
const alice={id:1,role:'manager',managerId:1,employeeRole:'Менеджер'}
const bob={id:2,role:'manager',managerId:2,employeeRole:'Менеджер'}
const admin={id:9,role:'admin',managerId:null,employeeRole:'Администратор'}
const query=async(actor,params)=>{
  const url=new URL('https://example.test/api/client3/watches/orders?'+params)
  const response=await routeClient3Watches(db,new Request(url),url,actor)
  assert(response,'GET order route must exist')
  return {httpStatus:response.status,...await response.json()}
}
const aliceMonth=await query(alice,'brand=TAUWACH&from=2026-11-01&to=2026-11-30')
assert.equal(aliceMonth.httpStatus,200)
assert.equal(aliceMonth.rows.length,1)
assert.equal(aliceMonth.totals.orderCount,1)
assert.equal(aliceMonth.totals.totalAmount,20000)
assert.equal(aliceMonth.totals.receivedAmount,10000)
assert.equal(aliceMonth.totals.debtAmount,10000)
assert.equal((await query(alice,'brand=TAUWACH&shipping=not_sent&payment=debt')).rows.length,0,
  'A physically dispatched item is sent even when the old order marker says not_sent')
assert.equal((await query(alice,'brand=TAUWACH&shipping=sent')).rows.length,1,
  'Only the operationally dispatched order is sent, regardless of old aggregate status')
assert.equal((await query(alice,'brand=TAUWACH&shipping=not_sent')).rows.length,1,
  'Old sent marker with no physical dispatch belongs to the unresolved queue')
assert.equal((await query(alice,'brand=TAUWACH&payment=paid')).rows.length,1)
assert.equal((await query(alice,'brand=TAUWACH&payment=invalid')).httpStatus,400)
const split=JSON.parse(aliceMonth.rows[0].paymentLines)
assert.deepEqual(split.map(x=>[x.method,x.amount]),[['KASPI RED',4000],['KASPI GOLD',6000]])
const lines=JSON.parse(aliceMonth.rows[0].itemLines)
assert.equal(lines.length,1)
assert.equal(lines[0].productName,'WATCH ONE')
assert.equal(lines[0].unitPrice,20000)
assert.equal(lines[0].source,'warehouse')
assert.equal(aliceMonth.rows[0].shippedLineCount,1,'Dispatch exists even when whole order status is not sent')
assert.equal(lines[0].shipped,1,'Per-item shipment marker is derived from Main dispatch history')
assert.equal(lines[0].shippedQuantity,1,'Exact per-position shipment quantity comes from dispatch ledger')
assert.equal(lines[0].returnableQuantity,1,'Only the physically issued unit can be returned')
sql.exec("UPDATE order_items SET quantity=2 WHERE id=101")
const partialShipment=await query(alice,'brand=TAUWACH&shipping=not_sent')
assert.equal(partialShipment.rows.length,2,
  'A line with one of two units issued must remain in the unshipped queue')
assert.equal(JSON.parse(partialShipment.rows.find(x=>x.orderId===1).itemLines)[0].shippedQuantity,1)
sql.exec("UPDATE order_items SET quantity=1 WHERE id=101")
sql.exec("INSERT INTO returns VALUES(1,1,'completed')")
sql.exec("INSERT INTO return_items(id,return_id,order_item_id,quantity,physical_tracking) VALUES(1,1,101,1,1)")
const afterReturn=await query(alice,'brand=TAUWACH&from=2026-11-01')
const returnedLine=JSON.parse(afterReturn.rows[0].itemLines)[0]
assert.equal(returnedLine.returnedQuantity,1,'Registered returned units remain visible')
assert.equal(returnedLine.pendingReturnQuantity,1,'Physical intake is not implied by refund registration')
assert.equal(returnedLine.returnableQuantity,0,'Already returned units cannot be returned twice')
sql.exec("UPDATE return_items SET physical_received_at='2026-11-03T12:00:00Z' WHERE id=1")
const afterIntake=await query(alice,'brand=TAUWACH&from=2026-11-01')
assert.equal(JSON.parse(afterIntake.rows[0].itemLines)[0].pendingReturnQuantity,0,
  'Only confirmed physical receipt clears the intake queue')
sql.exec("UPDATE order_items SET quantity=0 WHERE id=101")
const historicalOrder=await query(alice,'brand=TAUWACH&from=2026-11-01')
assert.equal(historicalOrder.rows.length,1,'A returned historical line does not erase the order')
const historicalLine=JSON.parse(historicalOrder.rows[0].itemLines)[0]
assert.equal(historicalLine.quantity,0,'Historical watch line remains available after its active quantity becomes zero')
assert.equal(historicalLine.returnedQuantity,1,'Exact returned quantity remains visible')
sql.exec("UPDATE order_items SET quantity=1 WHERE id=101")
const historicalNotSent=await query(alice,'brand=TAUWACH&from=2026-10-01&to=2026-10-31')
const unissuedWatch=JSON.parse(historicalNotSent.rows[0].itemLines)[0]
assert.equal(unissuedWatch.returnableQuantity,0,
 'An old order-wide sent marker alone cannot prove actual customer possession')
assert.equal(unissuedWatch.exchangeableQuantity,1,
 'Unissued watch may still be exchanged without physical intake')
const pct=await query(alice,'brand=TAUWACH&q=%25')
assert.equal(pct.rows.length,0,'Wildcard input may not expand beyond literal matches')
const underscore=await query(alice,'brand=TAUWACH&q=_')
assert.equal(underscore.rows.length,0,'Underscore search is literal, not LIKE wildcard')
const forbidden=await query(alice,'brand=WACHIZEN')
assert.equal(forbidden.httpStatus,403)
assert(!JSON.stringify(forbidden).includes('Private Customer 2'))
const missing=await query(alice,'')
assert.equal(missing.httpStatus,400)
const bobMonth=await query(bob,'brand=WACHIZEN&from=2026-11-01&to=2026-11-30')
assert.equal(bobMonth.rows.length,1)
assert.equal(bobMonth.totals.receivedAmount,60000)
const adminOne=await query(admin,'brand=TAUWACH&from=2026-10-01&to=2026-11-30&limit=1')
assert.equal(adminOne.totals.orderCount,2)
assert.equal(adminOne.rows.length,1)
assert.equal(adminOne.hasMore,true)
const next=await query(admin,'brand=TAUWACH&from=2026-10-01&to=2026-11-30&limit=1&offset=1')
assert.equal(next.rows.length,1)
assert.notEqual(next.rows[0].orderId,adminOne.rows[0].orderId)
const searched=await query(alice,'brand=TAUWACH&q=Private%20Customer%201')
assert.equal(searched.rows.length,1)
const invalid=await query(alice,'brand=TAUWACH&from=2026-02-30')
assert.equal(invalid.httpStatus,400)
const finance=async(actor,params)=>{
  const url=new URL('https://example.test/api/client3/watches/finance?'+params)
  const response=await routeClient3Watches(db,new Request(url),url,actor)
  assert(response,'Finance route must exist')
  return {httpStatus:response.status,...await response.json()}
}
const aliceFinance=await finance(alice,'brand=TAUWACH&month=2026-11')
assert.equal(aliceFinance.httpStatus,200)
assert.equal(aliceFinance.totals.eventCount,2)
assert.equal(aliceFinance.totals.incoming,10000)
assert.equal(aliceFinance.totals.outgoing,1500)
assert.equal(aliceFinance.totals.net,8500)
assert.equal(aliceFinance.methods[0].method,'KASPI GOLD')
assert(!JSON.stringify(aliceFinance).includes('W-2'),'Cannot leak WACHIZEN money events')
const deniedFinance=await finance(alice,'brand=WACHIZEN&month=2026-11')
assert.equal(deniedFinance.httpStatus,403)
const bobFinance=await finance(bob,'brand=WACHIZEN&month=2026-11')
assert.equal(bobFinance.totals.net,60000)
const olderFinance=await finance(admin,'brand=TAUWACH&month=2026-10')
assert.equal(olderFinance.totals.net,30000)
const badFinance=await finance(admin,'brand=TAUWACH&month=2026-13')
assert.equal(badFinance.httpStatus,400)
const oldUrl=new URL('https://example.test/api/client3/watches/legacy-orders')
const oldAdmin=await routeClient3Watches(db,new Request(oldUrl),oldUrl,admin)
assert.equal(oldAdmin.status,200)
assert.deepEqual((await oldAdmin.json()).rows,[],'All fixture orders have watch domains')
const oldManager=await routeClient3Watches(db,new Request(oldUrl),oldUrl,alice)
assert.equal(oldManager.status,403)

sql.close()
console.log('CLIENT3_WATCH_ORDERS_READ_PASS: scoped manager ledger, brand totals, date validation, pagination, search')
