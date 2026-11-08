// Narrow regression for safe order-linked Exchange cancellation and deletion consent.
// Existing local Worker+D1 cancellation tests remain authoritative for stock/money.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { composeOrderExchangeCancellationPlan } from '../src/app/orderExchangeCancellationPlan.ts'
const app=readFileSync('src/App.tsx','utf8')
const graph=readFileSync('src/app/orderExchangeCancellationPlan.ts','utf8')
const ui=readFileSync('src/features/sections/OrdersTableSection.tsx','utf8')
const projection=readFileSync('src/app/orderOperationalProjection.ts','utf8')
const routes=readFileSync('worker/index.ts','utf8')
const preview=readFileSync('worker/domains/order-delete-preview.ts','utf8')
const physical=readFileSync('worker/domains/admin-delete-physical.ts','utf8')
assert(ui.includes('Отменить последний обмен')&&ui.includes('Отменить все обмены'),
  'Both human cancellation modes must be available')
assert(ui.includes('Зависимых возвратов:')&&ui.includes('Самостоятельные возвраты'),
  'Consent must disclose dependent returns and preserve independent returns')
assert(ui.includes('setLinkedAdminEditOrder(order)')&&ui.includes('if(projection.canEdit)handleEditOrder'),
  'Admin post-exchange corrections must not open the unrestricted composition editor')
assert(ui.includes('isAdmin && projection.hasCommittedDownstreamOperation'),
  'Never expose linked-order admin correction surface to manager')
assert(projection.includes('canEdit: mutableWorkingOrder && !hasCommittedDownstreamOperation && simpleAdmin'),
  'Full editor safety projection must remain unchanged')
assert(app.includes('async function loadOrderExchangeCancellationPlan(')
  &&app.includes('async function cancelOrderExchangeChain('),
  'Plan and execution must be separate')
assert(app.includes("const selected=mode==='last' ? available.slice(-1) : [...available]"),
  'Last exchange is the newest active exchange, not the oldest')
assert(graph.includes('preview.manualReviewRequired')&&graph.includes('ordered.length!==nodes.size') && app.includes('composeOrderExchangeCancellationPlan(mode,available,selected,previews)'),
  'Legacy and ambiguous dependency graphs must fail closed')
assert(app.includes('const current=await loadOrderExchangeCancellationPlan(order,expected.mode)')
  &&app.includes('current.signature!==expected.signature'),
  'Re-read the graph immediately before mutation')
assert(app.includes("const url=step.type==='exchange'") &&
  app.includes("'/api/exchanges/'+step.id+'/cancel'") &&
  app.includes("'/api/returns/'+step.id+'/cancel'"),
  'Only existing guarded cancellation handlers may write')
assert(app.includes("prepareCriticalRequest(key,payload)")&&app.includes('completeCriticalRequest(key,critical.requestId)'),
  'Each cancellation step must be idempotent')
assert(!app.slice(app.indexOf('async function cancelOrderExchangeChain('),
  app.indexOf('async function handleEditOrder(')).includes('UPDATE inventory_stock'),
  'Never invent warehouse SQL in browser cancellation flow')
assert(routes.includes("const returnCancelMatch") && routes.includes("const exchangeCancelMatch"),
  'Both cancellation routes must remain available')
assert(ui.includes('const physicalQuestionRequired=Boolean(adminDeleteDraft?.preview')
  &&ui.includes('adminDeleteDraft.preview.requiresPhysicalFact')
  &&ui.includes('adminDeleteDraft.preview.appliedStockReview?.allowed'),
  'Consent only when server detects handover or a safely reversible applied movement')
assert(preview.includes("const requiresPhysicalFact=shipping==='sent'") &&
  preview.includes('toInt(fulfilled?.issued_count,0)>0&&!bookedOnlyFulfilled') &&
  preview.includes('appliedStockReview.bookkeepingFulfilledCount'),
  'Only the independently proved zero-booked fulfillment may skip physical handover correction')
assert(physical.includes('if(!valid)return bad(appliedCount'),
  'Unsafe booked stock movements must not be deleted through a checkbox')
// Exercise the actual pure dependency graph, not merely a code-text marker.
const step=(type,id,requiresManualReview=false)=>({type,id,reason:'Зависит от операции',requiresManualReview,order:1})
const preview=(steps,manualReviewRequired=false)=>({steps,manualReviewRequired})
const inputs=[
 preview([step('return',91),step('exchange',81)]),
 preview([step('return',92),step('exchange',82),step('return',91),step('exchange',81)]),
]
const plan=composeOrderExchangeCancellationPlan('all',[81,82],[81,82],inputs)
assert.deepEqual(plan.steps.map(x=>x.type+':'+x.id),
 ['return:92','exchange:82','return:91','exchange:81'],
 'Return dependencies must be ordered by the actual graph, not only by exchange ID')
assert.deepEqual(plan.steps.map(x=>x.order),[1,2,3,4])
assert.equal(plan.canExecute,true)
assert.equal(plan.manualReviewRequired,false)
assert.match(plan.notice,/зависимые возвраты/i)
assert.equal(plan.steps.length,4,'Shared downstream return/exchange nodes must not be cancelled twice')
assert(!plan.steps.some(x=>x.id===999),'Never include a Return not in the server-proven dependency graph')
assert.equal(plan.signature,composeOrderExchangeCancellationPlan('all',[81,82],[81,82],inputs).signature,
 'Equal server-proven plans must have stable signatures')
const onlyLast=composeOrderExchangeCancellationPlan('last',[81,82],[82],[preview([step('exchange',82)])])
assert.deepEqual(onlyLast.steps.map(x=>x.id),[82])
assert.notEqual(onlyLast.signature,plan.signature,'Different user-confirmed modes must not share cancellation signatures')
const ambiguous=composeOrderExchangeCancellationPlan('all',[81],[81],[preview([step('exchange',81)],true)])
assert.equal(ambiguous.canExecute,false,'Legacy ambiguity must fail closed')
assert.equal(ambiguous.manualReviewRequired,true)
assert.match(ambiguous.notice,/заблокирована/)
const stepReview=composeOrderExchangeCancellationPlan('all',[81],[81],[preview([step('exchange',81,true)])])
assert.equal(stepReview.canExecute,false,'Individual operation manual review must block all automatic cancellation')
assert.throws(()=>composeOrderExchangeCancellationPlan('all',[81,82],[81,82],[
 preview([step('exchange',81),step('exchange',82)]),
 preview([step('exchange',82),step('exchange',81)]),
]),/цикл|отсутствующую операцию/i,'A cyclic downstream chain must never start writes')
assert.throws(()=>composeOrderExchangeCancellationPlan('all',[81,82],[81,82],[
 preview([step('exchange',81)]),
]),/цикл|отсутствующую операцию/i,'A selected exchange missing from the graph must fail closed')
assert.throws(()=>composeOrderExchangeCancellationPlan('last',[81],[81],[preview([step('exchange',0)])]),
 /Неоднозначная зависимость/i,'Invalid operation IDs must be rejected')
console.log('ORDER_EXCHANGE_REAL_TOPOLOGICAL_CANCEL_GRAPH_PASS')

console.log('ORDER_EXCHANGE_LAST_ALL_CANCELLATION_AND_DELETE_CONSENT_GUARDS_PASSED')
