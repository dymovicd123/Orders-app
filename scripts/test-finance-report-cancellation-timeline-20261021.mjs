// Audit-only: distinguish current-state report rows from immutable cash events
// when a refund is cancelled on a different date. No runtime behavior changes.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
const source=readFileSync('worker/domains/finance-reports.ts','utf8')
const marker='`SELECT x.city AS city,'
const pos=source.indexOf(marker)
assert(pos>=0,'City cash report SQL missing')
const end=source.indexOf('`',pos+1)
assert(end>pos,'Cannot find SQL ending')
const currentStateSql=source.slice(pos+1,end)
assert.match(currentStateSql,/COALESCE\(r.status, 'completed'\) <> 'cancelled'/)
assert.match(currentStateSql,/r.return_date BETWEEN \? AND \?/)
const db=new DatabaseSync(':memory:')
db.exec(`
  CREATE TABLE orders(id INTEGER PRIMARY KEY,city TEXT,order_status TEXT);
  CREATE TABLE payments(id INTEGER PRIMARY KEY,order_id INTEGER,payment_date TEXT,amount INTEGER);
  CREATE TABLE returns(id INTEGER PRIMARY KEY,order_id INTEGER,return_date TEXT,amount INTEGER,status TEXT);
  CREATE TABLE financial_events(id INTEGER PRIMARY KEY,event_date TEXT,order_id INTEGER,amount_delta INTEGER,event_type TEXT);
  INSERT INTO orders VALUES(1,'АЛМАТЫ','active');
  INSERT INTO payments VALUES(1,1,'2026-10-20',10000);
  INSERT INTO returns VALUES(1,1,'2026-10-20',1000,'completed');
  INSERT INTO financial_events VALUES(1,'2026-10-20',1,10000,'order_payment');
  INSERT INTO financial_events VALUES(2,'2026-10-20',1,-1000,'order_refund');
`)
const report=()=>db.prepare(currentStateSql).all('2026-10-20','2026-10-20','2026-10-20','2026-10-20')
const amounts=report()
assert.equal(amounts.length,1)
assert.equal(amounts[0].total_received,10000)
assert.equal(amounts[0].total_returns,1000)
db.exec(`
  UPDATE returns SET status='cancelled' WHERE id=1;
  INSERT INTO financial_events VALUES(3,'2026-10-21',1,1000,'refund_reversal');
`)
const revised=report()
assert.equal(revised[0].total_received,10000)
assert.equal(revised[0].total_returns,0,
  'Live report is intentionally current-state and retroactively removes cancelled Return')
const journalByDate=db.prepare('SELECT event_date,SUM(amount_delta) AS net FROM financial_events GROUP BY event_date ORDER BY event_date').all()
assert.deepEqual(journalByDate,[
  {event_date:'2026-10-20',net:9000},
  {event_date:'2026-10-21',net:1000},
], 'Immutable cash journal preserves original Return and next-day reversal as distinct movements')
console.log('FINANCE_REPORT_CANCELLATION_TIMELINE_CHARACTERIZED: current-state report restates prior period, immutable money journal retains both dated events')
