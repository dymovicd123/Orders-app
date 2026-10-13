import fs from 'node:fs'
import assert from 'node:assert/strict'

const read = path => fs.readFileSync(path,'utf8')
const reservation = read('worker/domains/order-reservations.ts')
const lifecycle = read('worker/domains/lifecycle.ts')
const exchange = read('worker/domains/returns-exchanges.ts')
const batch = read('worker/domains/exchange-batch.ts')
const app = read('src/App.tsx')
const classic = read('src/features/sections/OrderExchangeSection.tsx')
const smart = read('src/features/sections/OrderExchangeSmartSection.tsx')

assert.match(reservation, /const observedPhysical: null = null;/, 'Any exchange reservation could still overwrite the SKU shelf quantity')
assert.match(exchange, /if \(input\.newItem\?\.observedPhysicalQuantity != null\)/, 'Stale classic clients can still submit a full count')
assert.match(exchange, /if \(\(requested as any\)\.observedPhysicalQuantity != null\)/, 'Stale exchange-set clients can still submit a full count')
assert.match(batch, /if \(\(effectiveNewItem as any\)\.observedPhysicalQuantity != null\)/, 'Stale batch clients can still submit a full count')
assert.match(exchange, /physicalIssueConfirmed = \(input\.newItem as any\)\?\.issuePossessionConfirmed === true/)
assert.match(exchange, /physical < newItem\.quantity && !physicalIssueConfirmed/)
assert.match(batch, /group\.allConfirmed = group\.allConfirmed && physicalIssueConfirmed/)
assert.match(exchange, /group\.allConfirmed = group\.allConfirmed && physicalIssueConfirmed/)
assert.match(exchange, /outboundPossessionConfirmed: plan\.physicalIssueConfirmed/)
assert.match(exchange, /outboundPossessionConfirmed: physicalIssueConfirmed/)
assert.match(app, /issuePossessionConfirmed: item\.stockObservationEnabled === true/)
assert.match(app, /issuePossessionConfirmed: effectiveNewItem\.stockObservationEnabled === true/)
assert.match(lifecycle, /if \(missingPhysical && options\.outboundPossessionConfirmed !== true\)/)
assert.match(lifecycle, /isOutgoingExchange \? -Math\.min\(trackedPhysical, qty\) : -qty/)
assert.match(lifecycle, /__exchange_outbound_stock_conflict__/)
assert.match(lifecycle, /reversalDelta = isOutgoingExchange[\s\S]*?-Math\.min\(0, toInt\(originalMovement\?\.quantity_delta, 0\)\)/)
assert.match(lifecycle, /if \(isOutgoingExchange && !originalMovement\) \{[\s\S]*?reversePhysical = false;/)
assert.match(classic, /type="checkbox" checked=\{exchangeIssueConfirmed\}/)
assert.match(smart, /type="checkbox" checked=\{groupConfirmed\}/)
assert.ok(!classic.includes('На месте сейчас'), 'Classic exchange still asks for whole-SKU count')
assert.ok(!smart.includes('placeholder="На месте"'), 'Smart exchange still asks for whole-SKU count')
assert.ok(!app.includes('Позиция обмена ${index + 1}: укажите целое фактическое количество'))
assert.ok(!app.includes('Склад → Внимание'), 'Save feedback still routes to an overflowing diagnostic view')

// Pure deterministic bounded-stock and cancellation invariants:
function issue(tracked, qty, confirmed) {
  if (tracked < qty && !confirmed) return {blocked:true}
  const posted = -Math.min(tracked,qty)
  return {before:tracked,after:tracked+posted,posted,unrecorded:qty+posted,reversal:-posted}
}
for(const [tracked,qty,confirmed,expected] of [
  [0,1,false,{blocked:true}],
  [0,1,true,{before:0,after:0,posted:0,unrecorded:1,reversal:0}],
  [1,2,true,{before:1,after:0,posted:-1,unrecorded:1,reversal:1}],
  [3,1,false,{before:3,after:2,posted:-1,unrecorded:0,reversal:1}],
])assert.deepEqual(issue(tracked,qty,confirmed),expected)
console.log('EXCHANGE OUTBOUND NO-RECOUNT PASSED: single, set, batch, bounded issue and bounded cancellation')
