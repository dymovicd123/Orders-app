// No remote D1 writes. Exercise the exact validator and net settlement formula
// used by Return and Exchange Set V2 before any money/stock mutation.
import assert from 'node:assert/strict'
import { normalizeMoneyParts, deriveExchangeSetSettlement } from '../worker/domains/returns-exchanges.ts'

const money=normalizeMoneyParts
assert.deepEqual(money(undefined,15000,'НАЛИЧКА'),[{method:'НАЛИЧКА',amount:15000}])
assert.deepEqual(money([{method:'KASPI',amount:10000},{method:'НАЛИЧКА',amount:5000}],15000,'KASPI'),
  [{method:'KASPI',amount:10000},{method:'НАЛИЧКА',amount:5000}])
assert.deepEqual(money(undefined,0,''),[])
assert.deepEqual(money([],0,''),[])
assert.throws(()=>money([{method:'KASPI',amount:10000},{method:'НАЛИЧКА',amount:4000}],15000,'KASPI'),/не совпадают/)
assert.throws(()=>money([{method:'KASPI',amount:10000},{method:'kaspi',amount:5000}],15000,'KASPI'),/дважды/)
assert.throws(()=>money([{method:'KASPI',amount:15000},{method:'НАЛИЧКА',amount:0}],15000,'KASPI'),/положительную/)
assert.throws(()=>money([{method:'KASPI',amount:15000.5}],15000,'KASPI'),/целую/)
assert.throws(()=>money([{method:'KASPI',amount:15000},{method:'НАЛИЧКА',amount:1}],15000,'KASPI'),/не совпадают/)
assert.throws(()=>money([{method:'KASPI',amount:15000},{method:'НАЛИЧКА',amount:1},{method:'БАНК',amount:1}],15002,'KASPI'),/один или два/)
assert.throws(()=>money([],1,'KASPI'),/один или два/)
assert.throws(()=>money(undefined,15000,''),/Выберите способ/)
assert.throws(()=>money([{method:'KASPI',amount:1}],0,''),/нулевой/)
assert.throws(()=>money(undefined,-1,'KASPI'),/Некорректная/)
assert.throws(()=>money(undefined,1.5,'KASPI'),/Некорректная/)

// User's screenshot scenario: 30,000 already paid, new total 45,000,
// collect 15,000 once via two methods; no second charge or extra debt.
const topUp=deriveExchangeSetSettlement({
  currentTotalAmount:30000,currentNetPaid:30000,
  removedValue:30000,addedValue:45000,paymentAmount:15000,
})
assert.equal(topUp.finalTotalAmount,45000)
assert.equal(topUp.finalNetPaid,45000)
assert.equal(topUp.remainingDebt,0)
assert.equal(topUp.refundAmount,0)
const refund=deriveExchangeSetSettlement({
  currentTotalAmount:45000,currentNetPaid:45000,
  removedValue:30000,addedValue:15000,paymentAmount:0,
})
assert.equal(refund.refundAmount,15000)
assert.equal(refund.finalNetPaid,30000)
assert.equal(refund.remainingDebt,0)
assert.throws(()=>deriveExchangeSetSettlement({
  currentTotalAmount:45000,currentNetPaid:45000,removedValue:30000,addedValue:15000,paymentAmount:1,
}),/Одновременно принимать оплату нельзя/)
console.log('MAIN_SPLIT_SETTLEMENT_VALIDATION_PASSED')
