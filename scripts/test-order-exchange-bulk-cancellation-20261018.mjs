// Narrow regression for safe order-linked Exchange cancellation and deletion consent.
// Existing local Worker+D1 cancellation tests remain authoritative for stock/money.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { build } from 'esbuild'
import { composeOrderExchangeCancellationPlan } from '../src/app/orderExchangeCancellationPlan.ts'
const app=readFileSync('src/App.tsx','utf8')
const cancellations=readFileSync('src/features/orders/orderDependentCancellationActions.ts','utf8')
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
assert(app.includes('createOrderDependentCancellationActions({') && cancellations.includes('async function loadOrderExchangeCancellationPlan(')
  &&cancellations.includes('async function cancelOrderExchangeChain('),
  'Plan and execution must be separate')
assert(cancellations.includes("const selected=mode==='last' ? available.slice(-1) : [...available]"),
  'Last exchange is the newest active exchange, not the oldest')
assert(graph.includes('preview.manualReviewRequired')&&graph.includes('ordered.length!==nodes.size') && cancellations.includes('composeOrderExchangeCancellationPlan(mode,available,selected,previews)'),
  'Legacy and ambiguous dependency graphs must fail closed')
assert(cancellations.includes('const current=await loadOrderExchangeCancellationPlan(order,expected.mode)')
  &&cancellations.includes('current.signature!==expected.signature'),
  'Re-read the graph immediately before mutation')
assert(cancellations.includes("const url=step.type==='exchange'") &&
  cancellations.includes("'/api/exchanges/'+step.id+'/cancel'") &&
  cancellations.includes("'/api/returns/'+step.id+'/cancel'"),
  'Only existing guarded cancellation handlers may write')
assert(cancellations.includes("prepareCriticalRequest(key,payload)")&&cancellations.includes('completeCriticalRequest(key,critical.requestId)'),
  'Each cancellation step must be idempotent')
assert(!cancellations.includes('UPDATE inventory_stock'),
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
const makeGraphPreview=(steps,manualReviewRequired=false)=>({steps,manualReviewRequired})
const inputs=[
 makeGraphPreview([step('return',91),step('exchange',81)]),
 makeGraphPreview([step('return',92),step('exchange',82),step('return',91),step('exchange',81)]),
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
const onlyLast=composeOrderExchangeCancellationPlan('last',[81,82],[82],[makeGraphPreview([step('exchange',82)])])
assert.deepEqual(onlyLast.steps.map(x=>x.id),[82])
assert.notEqual(onlyLast.signature,plan.signature,'Different user-confirmed modes must not share cancellation signatures')
const ambiguous=composeOrderExchangeCancellationPlan('all',[81],[81],[makeGraphPreview([step('exchange',81)],true)])
assert.equal(ambiguous.canExecute,false,'Legacy ambiguity must fail closed')
assert.equal(ambiguous.manualReviewRequired,true)
assert.match(ambiguous.notice,/заблокирована/)
const stepReview=composeOrderExchangeCancellationPlan('all',[81],[81],[makeGraphPreview([step('exchange',81,true)])])
assert.equal(stepReview.canExecute,false,'Individual operation manual review must block all automatic cancellation')
assert.throws(()=>composeOrderExchangeCancellationPlan('all',[81,82],[81,82],[
 makeGraphPreview([step('exchange',81),step('exchange',82)]),
 makeGraphPreview([step('exchange',82),step('exchange',81)]),
]),/цикл|отсутствующую операцию/i,'A cyclic downstream chain must never start writes')
assert.throws(()=>composeOrderExchangeCancellationPlan('all',[81,82],[81,82],[
 makeGraphPreview([step('exchange',81)]),
]),/цикл|отсутствующую операцию/i,'A selected exchange missing from the graph must fail closed')
assert.throws(()=>composeOrderExchangeCancellationPlan('last',[81],[81],[makeGraphPreview([step('exchange',0)])]),
 /Неоднозначная зависимость/i,'Invalid operation IDs must be rejected')
console.log('ORDER_EXCHANGE_REAL_TOPOLOGICAL_CANCEL_GRAPH_PASS')

// Actual compiled browser chain, including a fresh pre-write graph read and
// original per-operation request IDs. All HTTP is isolated; Worker SQL is tested elsewhere.
const compiled = await build({
 entryPoints: ['src/features/orders/orderDependentCancellationActions.ts'],
 bundle: true, platform: 'node', format: 'esm', target: 'es2022', write: false, logLevel: 'silent',
})
const {createOrderDependentCancellationActions} = await import(
 'data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64')
)
const order={id:42,external_id:'QA-42',order_status:'active'}
const previews={
 81:{exchangeId:81,blockedByLaterOperations:false,canAttemptCancelNow:true,
   manualReviewRequired:false,notice:'',steps:[step('return',91),step('exchange',81)]},
 82:{exchangeId:82,blockedByLaterOperations:false,canAttemptCancelNow:true,
   manualReviewRequired:false,notice:'',steps:[step('return',92),step('exchange',82),
    step('return',91),step('exchange',81)]},
}
let activeIds=[81,82],requests=[],completed=[],progress=[],stockInvalidations=0
let financeInvalidations=0,refreshes=[],busyStates=[],lastMessage='',lastError=null
let failNext=false
const choices=[
 {id:201,date:'2026-10-10',amount:300,method:'КАРТА',itemQuantity:1,parentExchangeId:null},
 {id:202,date:'2026-10-11',amount:400,method:'НАЛИЧНЫЕ',itemQuantity:1,parentExchangeId:81},
]
const mocks={
 apiFetch:async(url,init={})=>{
  const name=String(url)
  requests.push({url:name,init})
  if(failNext&&init.method==='PATCH'){failNext=false;throw Error('unknown chain response')}
  const body=name.includes('exchange-cancel-chain')
    ? name.includes('exchangeId=')
      ? {ok:true,availableExchangeIds:activeIds,preview:previews[Number(name.split('exchangeId=')[1])]}
      : {ok:true,availableExchangeIds:activeIds}
    : name.endsWith('/return-cancel-choices')
      ? {ok:true,choices}
      : {ok:true,order}
  return new Response(JSON.stringify(body),{status:200,headers:{'content-type':'application/json'}})
 },
 prepareCriticalRequest:(key,payload)=>({requestId:'fixed:'+key,payload:{...payload,requestId:'fixed:'+key}}),
 completeCriticalRequest:(key,id)=>completed.push({key,id}),
 setSavingOrder:flag=>busyStates.push(flag),
 setError:value=>{lastError=value},
 setMessage:value=>{lastMessage=value||''},
 upsertOrderInState:()=>{},
 invalidateInventoryStockCaches:()=>{stockInvalidations++},
 invalidateFinanceReadCaches:()=>{financeInvalidations++},
 loadExchangeHistory:async()=>refreshes.push('exchanges'),
 loadReturnHistory:async()=>refreshes.push('returns'),
 loadDashboard:async()=>refreshes.push('orders'),
 loadWorkshopData:async()=>refreshes.push('workshop'),
 refreshFinanceReportsIfVisible:()=>refreshes.push('finance'),
 loadInventoryLifecycle:async()=>refreshes.push('lifecycle'),
}
const chain=createOrderDependentCancellationActions(mocks)
const confirmedPlan=await chain.loadOrderExchangeCancellationPlan(order,'all')
assert.equal(confirmedPlan.canExecute,true)
assert.deepEqual(confirmedPlan.steps.map(x=>x.type+':'+x.id),
 ['return:92','exchange:82','return:91','exchange:81'])
const beforeWrites=requests.length
await chain.cancelOrderExchangeChain(order,confirmedPlan,(done,total)=>progress.push([done,total]))
const mutations=requests.slice(beforeWrites).filter(x=>x.init.method==='PATCH')
assert.deepEqual(mutations.map(x=>x.url),[
 '/api/returns/92/cancel','/api/exchanges/82/cancel',
 '/api/returns/91/cancel','/api/exchanges/81/cancel',
], 'Only the server-proven dependent Return/Exchange operations can be cancelled')
assert(mutations.every(x=>x.init.headers['X-Idempotency-Key']===JSON.parse(x.init.body).requestId))
assert.equal(completed.length,4)
assert.deepEqual(progress,[[1,4],[2,4],[3,4],[4,4]])
assert.deepEqual(busyStates,[true,false])
assert.equal(stockInvalidations,1)
assert.equal(financeInvalidations,1)
assert(lastMessage.includes('отменены'))
assert(!mutations.some(x=>x.url.includes('/999/')))

requests=[];completed=[];progress=[];stockInvalidations=0;financeInvalidations=0
activeIds=[81]
await assert.rejects(
 ()=>chain.cancelOrderExchangeChain(order,confirmedPlan),
 /История обменов изменилась|небезопасная операция/,
 'Stale all-exchange confirmation must never authorize cancellation writes')
assert(!requests.some(x=>x.init.method==='PATCH'))
assert.equal(completed.length,0)
assert.equal(stockInvalidations,0)
activeIds=[81,82]

const beforeReturn=requests.length
await assert.rejects(
 ()=>chain.cancelOrderReturnChoice(order,choices[1]),
 /связан с обменом/,
 'Exchange-linked Return can only be cancelled via the dependency graph')
assert(!requests.slice(beforeReturn).some(x=>x.init.method==='PATCH'))
const staleStandalone={...choices[0],amount:301}
await assert.rejects(
 ()=>chain.cancelOrderReturnChoice(order,staleStandalone),
 /Возврат изменился/,
 'A stale Return money amount cannot authorize an independent cancel')
const beforeStandalone=requests.length
await chain.cancelOrderReturnChoice(order,choices[0])
const standaloneWrites=requests.slice(beforeStandalone).filter(x=>x.init.method==='PATCH')
assert.deepEqual(standaloneWrites.map(x=>x.url),['/api/returns/201/cancel'])
assert.equal(completed.at(-1).key,'order-return-cancel:42:201')
assert.equal(stockInvalidations,1)
assert.equal(financeInvalidations,1)

requests=[];completed=[];progress=[];stockInvalidations=0;financeInvalidations=0
failNext=true
await assert.rejects(
 ()=>chain.cancelOrderExchangeChain(order,confirmedPlan),
 /unknown chain response/)
assert.equal(requests.filter(x=>x.init.method==='PATCH').length,1)
assert.equal(completed.length,0,'Unknown first step may not be considered committed')
assert.equal(stockInvalidations,1,'Unknown outcome should refresh physical stock without assuming a write')
assert.equal(financeInvalidations,1,'Unknown outcome should refresh financial truth')

console.log('ORDER_EXCHANGE_LAST_ALL_CANCELLATION_AND_DELETE_CONSENT_GUARDS_PASSED')
