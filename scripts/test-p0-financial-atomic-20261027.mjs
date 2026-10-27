// Exact SQL from live Worker money/Return paths against disposable SQLite.
// No Cloudflare credentials, network, D1 binding or business-data mutation.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

const moneySource=fs.readFileSync('worker/domains/money.ts','utf8')
const returnsSource=fs.readFileSync('worker/domains/returns-exchanges.ts','utf8')
function sqlFrom(source, start) {
  const at=source.indexOf('\x60'+start)
  assert(at>=0,'Missing actual production SQL: '+start)
  const end=source.indexOf('\x60',at+1)
  assert(end>at,'Unclosed production SQL')
  return source.slice(at+1,end)
}
const paymentSql=sqlFrom(moneySource,'INSERT INTO payments (order_id, payment_date, method, amount, payment_kind, comment, created_at)')
const refundSql=sqlFrom(returnsSource,'INSERT INTO returns (order_id, manager_id, return_date, amount, payment_method, comment, status, created_at)')
assert.match(paymentSql,/CASE WHEN EXISTS/)
assert.match(refundSql,/CASE WHEN \? = 0 OR EXISTS/)
assert.match(moneySource,/not null constraint failed:\\s\*payments\\\.amount/i)
assert.match(returnsSource,/not null constraint failed:\\s\*returns\\\.amount/i)
const db=new DatabaseSync(':memory:')
db.exec(`
 CREATE TABLE orders (id INTEGER PRIMARY KEY, total_amount INTEGER NOT NULL, order_status TEXT NOT NULL DEFAULT 'new', archived_at TEXT);
 CREATE TABLE payments (id INTEGER PRIMARY KEY, order_id INTEGER, payment_date TEXT, method TEXT, amount INTEGER NOT NULL, payment_kind TEXT, comment TEXT, created_at TEXT);
 CREATE TABLE returns (id INTEGER PRIMARY KEY, order_id INTEGER, manager_id INTEGER, return_date TEXT, amount INTEGER NOT NULL, payment_method TEXT, comment TEXT, status TEXT, created_at TEXT);
\`)
const now='2026-10-27T11:00:00.000Z'
const pay=(id,amount)=>db.prepare(paymentSql).run(id,'2026-10-27','НАЛИЧКА',id,amount,amount,'debt',null,now)
const refund=(id,amount)=>db.prepare(refundSql).run(id,null,'2026-10-27',amount,id,amount,amount,amount>0?'НАЛИЧКА':null,null,now)
const count=(table,id)=>db.prepare(\`SELECT COUNT(*) AS n, COALESCE(SUM(amount),0) AS amount FROM \${table} WHERE order_id=?\`).get(id)
const createOrder=id=>db.prepare('INSERT INTO orders (id,total_amount,order_status) VALUES (?,10000,?)').run(id,'new')

// Independent request ids both pass an earlier 10k preflight;
// only the first full payment INSERT is allowed to commit.
createOrder(1)
pay(1,10000)
assert.throws(()=>pay(1,10000),/NOT NULL constraint failed: payments.amount/i)
assert.deepEqual(count('payments',1),{n:1,amount:10000})
createOrder(2)
pay(2,6000)
assert.throws(()=>pay(2,6000),/NOT NULL constraint failed: payments.amount/i)
pay(2,4000)
assert.deepEqual(count('payments',2),{n:2,amount:10000})

// Money-only return: two preflighted 10k refunds cannot both
// commit against one paid order, regardless of distinct request ids.
createOrder(3)
pay(3,10000)
refund(3,10000)
assert.throws(()=>refund(3,10000),/NOT NULL constraint failed: returns.amount/i)
assert.deepEqual(count('returns',3),{n:1,amount:10000})
// A cancelled refund becomes refundable again.
db.prepare("UPDATE returns SET status='cancelled' WHERE order_id=3").run()
refund(3,10000)
assert.deepEqual(count('returns',3),{n:2,amount:20000})
assert.equal(db.prepare("SELECT SUM(amount) AS n FROM returns WHERE order_id=3 AND status!='cancelled'").get().n,10000)
refund(3,0) // old zero-sum Return remains supported

// Archived orders may not take fresh manual money writes.
createOrder(4)
db.prepare("UPDATE orders SET archived_at='2026-10-26' WHERE id=4").run()
assert.throws(()=>pay(4,5000),/NOT NULL constraint failed: payments.amount/i)
db.close()
console.log('P0_FINANCIAL_SQL_ATOMIC_GUARDS_PASSED: payment and Return limits execute against extracted Worker SQL')
