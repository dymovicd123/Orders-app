// Read-only financial lifecycle regression. A disposable in-memory SQLite DB
// exercises the real production ledger SQL, not a mocked money formula.
// A Return is a customer-facing refund, not automatically a newly payable debt.
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {readOrderFinancialLedger,syncOrderFinancialLedger} from '../worker/domains/money.ts'
import {deriveExchangeSetSettlement} from '../worker/domains/returns-exchanges.ts'

const sqlite=new DatabaseSync(':memory:')
sqlite.exec(`
 CREATE TABLE orders(id INTEGER PRIMARY KEY,total_amount INTEGER,received_amount INTEGER DEFAULT 0,return_amount INTEGER DEFAULT 0,debt_amount INTEGER DEFAULT 0,updated_at TEXT);
 CREATE TABLE payments(id INTEGER PRIMARY KEY,order_id INTEGER,amount INTEGER);
 CREATE TABLE returns(id INTEGER PRIMARY KEY,order_id INTEGER,amount INTEGER,status TEXT);
 INSERT INTO orders (id,total_amount) VALUES (11,10000),(12,10000);
`)
const db={
  prepare(statement){
    return {
      bind(...params){
        return {
          async first(){return sqlite.prepare(statement).get(...params)??null},
          async run(){return sqlite.prepare(statement).run(...params)},
        }
      }
    }
  }
}
const exec=(sql,...params)=>sqlite.prepare(sql).run(...params)
const view=async id=>{
  const ledger=await syncOrderFinancialLedger(db,id,'2026-10-21T12:00:00Z')
  const stored=sqlite.prepare('SELECT total_amount,received_amount,return_amount,debt_amount FROM orders WHERE id=?').get(id)
  assert.equal(ledger.totalAmount,stored.total_amount)
  assert.equal(ledger.receivedAmount,stored.received_amount)
  assert.equal(ledger.returnAmount,stored.return_amount)
  assert.equal(ledger.debtAmount,stored.debt_amount)
  assert.deepEqual(await readOrderFinancialLedger(db,id),ledger)
  return ledger
}

// The normal debt is the unpaid portion of the original order price.
exec('INSERT INTO payments VALUES (1,11,4000)')
assert.deepEqual(await view(11),{totalAmount:10000,receivedAmount:4000,returnAmount:0,debtAmount:6000})
const higherPrice=deriveExchangeSetSettlement({
  currentTotalAmount:10000,currentNetPaid:4000,removedValue:10000,addedValue:12000,paymentAmount:1000
})
assert.deepEqual(higherPrice,{finalTotalAmount:12000,dueBeforeSettlement:8000,refundAmount:0,finalNetPaid:5000,remainingDebt:7000})
exec('UPDATE orders SET total_amount=12000 WHERE id=11')
exec('INSERT INTO payments VALUES (2,11,1000)')
assert.deepEqual(await view(11),{totalAmount:12000,receivedAmount:5000,returnAmount:0,debtAmount:7000})
exec('INSERT INTO payments VALUES (3,11,7000)')
assert.deepEqual(await view(11),{totalAmount:12000,receivedAmount:12000,returnAmount:0,debtAmount:0})

// Fully paid order -> a cheaper exchange makes an exact refund due.
exec('INSERT INTO payments VALUES (4,12,10000)')
const cheaper=deriveExchangeSetSettlement({
  currentTotalAmount:10000,currentNetPaid:10000,removedValue:10000,addedValue:9000,paymentAmount:0
})
assert.deepEqual(cheaper,{finalTotalAmount:9000,dueBeforeSettlement:0,refundAmount:1000,finalNetPaid:9000,remainingDebt:0})
exec('UPDATE orders SET total_amount=9000 WHERE id=12')
exec("INSERT INTO returns VALUES (1,12,1000,'completed')")
assert.deepEqual(await view(12),{totalAmount:9000,receivedAmount:10000,returnAmount:1000,debtAmount:0})
// A separate discretionary money-only refund must remain visible in cash history
// without inventing automatic debt on a historic gross-paid order.
exec("INSERT INTO returns VALUES (2,12,1000,'completed')")
const afterExtraRefund=await view(12)
assert.equal(afterExtraRefund.debtAmount,0)
assert.equal(afterExtraRefund.receivedAmount-afterExtraRefund.returnAmount,8000)
const nextExchange=deriveExchangeSetSettlement({
  currentTotalAmount:9000,currentNetPaid:afterExtraRefund.receivedAmount-afterExtraRefund.returnAmount,
  removedValue:9000,addedValue:9000,paymentAmount:0
})
assert.equal(nextExchange.dueBeforeSettlement,1000,'New exchange must use net cash, not gross receipts')
assert.equal(nextExchange.remainingDebt,1000,'Exchange preview must still distinguish the unpaid settlement')
// Cancel independent refund, then exchange-owned refund. Each cancel affects
// net cash only once; order balance must remain semantically unchanged.
exec("UPDATE returns SET status='cancelled' WHERE id=2")
assert.deepEqual(await view(12),{totalAmount:9000,receivedAmount:10000,returnAmount:1000,debtAmount:0})
exec("UPDATE returns SET status='cancelled' WHERE id=1")
exec('UPDATE orders SET total_amount=10000 WHERE id=12')
assert.deepEqual(await view(12),{totalAmount:10000,receivedAmount:10000,returnAmount:0,debtAmount:0})
assert.deepEqual(await view(12),{totalAmount:10000,receivedAmount:10000,returnAmount:0,debtAmount:0})
console.log('FINANCIAL_LIFECYCLE_GROSS_DEBT_AND_NET_SETTLEMENT_PASSED: real ledger SQL + exchange settlement, partial payment, extra payment, linked/standalone refunds, cancellation and replay')
