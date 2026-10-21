// Actual finance report query and pure linkage function, exercised against
// disposable SQLite. No remote DB, no Worker writes, no financial recalculation.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {matchExchangePaymentLineage} from '../worker/domains/finance-reports.ts'
const src=readFileSync('worker/domains/finance-reports.ts','utf8')
const anchor="\`SELECT p.id,\n              p.order_id,"
const at=src.indexOf(anchor)
assert(at>=0,'Expected real payment-operations SQL query')
const end=src.indexOf('\`',at+1)
assert(end>at)
const query=src.slice(at+1,end)
assert.match(query,/AS active_exchange_id/)
assert.match(query,/COALESCE\(e.status, 'completed'\) <> 'cancelled'/)
assert.match(src,/eventLineageStatus = 'exchange_id'/)
assert.match(src,/else if \(exchangeCandidates.length > 1\)/)
const sql=new DatabaseSync(':memory:')
sql.exec(\`
 CREATE TABLE orders(id INTEGER PRIMARY KEY,external_id TEXT,order_date TEXT,created_at TEXT,
  manager_id INTEGER,manager_snapshot_name TEXT,city TEXT,customer_id INTEGER,order_status TEXT);
 CREATE TABLE payments(id INTEGER PRIMARY KEY,order_id INTEGER,payment_date TEXT,method TEXT,
  amount INTEGER,payment_kind TEXT,comment TEXT,created_at TEXT);
 CREATE TABLE exchanges(id INTEGER PRIMARY KEY,order_id INTEGER,payment_id INTEGER,status TEXT,financial_action TEXT);
 CREATE TABLE managers(id INTEGER PRIMARY KEY,name TEXT,color_key TEXT);
 CREATE TABLE customers(id INTEGER PRIMARY KEY,display_name TEXT,phone_normalized TEXT);
 INSERT INTO orders VALUES(1,'TEST-FIN-1','2026-10-14','2026-10-14T10:00:00Z',NULL,NULL,'АЛМАТЫ',NULL,'active');
 INSERT INTO payments VALUES(9,1,'2026-10-21','ТЕРМИНАЛ',500,'extra','Коррекция', '2026-10-15T10:00:00Z');
 INSERT INTO exchanges VALUES(7,1,9,'completed','extra_payment');
\`)
const queryRow=()=>sql.prepare(query).all('2026-10-21','2026-10-21')[0]
let row=queryRow()
assert.equal(row.active_exchange_id,7)
assert.equal(row.operation_type,'exchange_extra')
const payment={
  exchangeId:row.active_exchange_id,orderId:row.order_id,operationType:row.operation_type,
  paymentDate:row.payment_date,amount:row.amount,method:row.method
}
const event={
  id:101,order_id:1,source_type:'exchange',source_id:7,
  event_type:'exchange_extra',event_date:'2026-10-21',
  amount_delta:500,payment_method:'ТЕРМИНАЛ',
  event_at:'2026-10-21T12:00:00Z',
  reason:'exchange_financial_correction'
}
assert.equal(matchExchangePaymentLineage([event],payment)[0].id,101,
  'Correction journal must link to active payment via exchange even though payment.created_at differs')
assert.equal(matchExchangePaymentLineage([{...event,source_id:8}],payment).length,0)
assert.equal(matchExchangePaymentLineage([{...event,order_id:2}],payment).length,0)
assert.equal(matchExchangePaymentLineage([{...event,payment_method:'НАЛИЧКА'}],payment).length,0)
assert.equal(matchExchangePaymentLineage([{...event,event_date:'2026-10-22'}],payment).length,0)
assert.equal(matchExchangePaymentLineage([{...event,amount_delta:600}],payment).length,0)
assert.equal(matchExchangePaymentLineage([{...event,event_type:'order_payment'}],payment).length,0)
assert.equal(matchExchangePaymentLineage([event,{...event,id:102}],payment).length,2,
  'Same amount/date method corrections are ambiguous; never silently pick a guessed event')
// A cancelled Exchange must never claim an event from the old link.
sql.exec("UPDATE exchanges SET status='cancelled' WHERE id=7")
row=queryRow()
assert.equal(row.active_exchange_id,null)
assert.equal(row.operation_type,'order_extra')
assert.equal(matchExchangePaymentLineage([event],{
  ...payment,exchangeId:row.active_exchange_id||0,operationType:row.operation_type
}).length,0)
console.log('FINANCE_EXCHANGE_PAYMENT_EXACT_LINEAGE_PASSED: corrected payment links through active exchange id; amount/date/method guards, cancellation, ambiguity')
