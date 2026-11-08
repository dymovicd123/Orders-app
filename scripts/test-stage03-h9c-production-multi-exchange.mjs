import fs from 'node:fs'
import assert from 'node:assert/strict'
import { build } from 'esbuild'

const read = path => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }
const between = (source, start, end) => {
  const a = source.indexOf(start)
  const b = source.indexOf(end, a + start.length)
  check(a >= 0 && b > a, 'Missing source boundary: ' + start)
  return source.slice(a, b)
}

const wrangler = read('wrangler.jsonc')
const app = read('src/App.tsx')
const ui = read('src/features/sections/OrderExchangeSection.tsx')
const workerIndex = read('worker/index.ts')
const batchWorker = read('worker/domains/exchange-batch.ts')
const exchangeRequests = read('src/app/legacyExchangeCriticalRequests.ts')

check(wrangler.includes('"name": "orders-app"'), 'H9C Production Worker identity drifted')
check(wrangler.includes('"database_name": "orders_db_prod"') && wrangler.includes('"database_id": "17e68a41-1d58-4a36-8a63-47c3e32443c4"'), 'H9C Production D1 identity drifted')
check(!wrangler.includes('orders_db_branch2') && !wrangler.includes('40065052-854e-44b8-bcd5-251bdd488301'), 'H9C Branch2 D1 identity leaked into Production')

const saveExchange = between(app, 'async function saveExchange()', '\n\n  async function receiveReturnedItemAction')
check(!saveExchange.includes('itemizedExchange && pairDrafts.length !== 1'), 'H9C Production still blocks itemized multi-pair exchange')
check(saveExchange.includes('itemizedExchange && unsavedPairs.length > 1'), 'H9C Production multi-pair save branch missing')
check(saveExchange.includes('prepareLegacyExchangePairs(exchangeSelectedOrder, exchangeDraft, getOrderSourceAvailability)'), 'App must validate legacy Exchange pairs before any write')
check(saveExchange.includes('submitLegacyExchangeBatch(') && exchangeRequests.includes("client.apiFetch('/api/exchanges/batch'"), 'H9C production must retain the real batch endpoint through the typed client')
check(exchangeRequests.includes('expectedOrderTotal: Number(exchangeSelectedOrder.total_amount)'), 'H9C Production order-total stale snapshot missing')
for (const field of ['expectedOldActiveQuantity', 'expectedOldUnitPrice', 'expectedOldLineTotal', 'expectedOldCatalogPriceSnapshot']) {
  check(exchangeRequests.includes(field), 'H9C Production pair stale snapshot missing ' + field)
}
check(exchangeRequests.includes("'X-Idempotency-Key': critical.requestId"), 'H9C Production browser batch write is not retry-safe')
check(exchangeRequests.includes('client.completeCriticalRequest(batchKey, critical.requestId)'), 'H9C Production browser does not retire completed batch idempotency token')

check(ui.includes('Добавить ещё позицию'), 'H9C Production multi-pair control missing')
check(!ui.includes('if (itemizedExchange || !currentPairReady) return'), 'H9C Production queue still rejects itemized orders')
check(ui.includes('exchangeBatchRequired') && ui.includes('queuedSameNewQuantity'), 'H9C Production aggregate same-SKU stock guard missing')
check(ui.includes('const exchangePhysicalShortage =') && ui.includes('exchangePhysical < exchangeBatchRequired') && ui.includes('const exchangeIssueConfirmed = Boolean(exchangeDraft.newItem.stockObservationEnabled)'), 'H9C aggregate queued physical shortage confirmation missing')
check(ui.includes("exchangePhysicalShortage && exchangeIssueConfirmed && exchangeNewItemKey(queued.newItem) === currentExchangeNewItemKey")
  && ui.includes('stockObservationEnabled: true, observedPhysicalQuantity: null')
  && ui.includes("if (exchangeDraft.newItem.shipmentState === 'sent' && exchangePhysicalShortage && !exchangeIssueConfirmed) return"),
  'H9C confirmed shortage must be applied consistently to same-SKU queued lines and stop unconfirmed outbound')
check(ui.includes('nextRequestedByOldItem') && ui.includes('nextOldItem'), 'H9C Production queue does not advance to remaining old item')

check(workerIndex.includes("url.pathname === '/api/exchanges/batch'") && workerIndex.includes('createItemizedExchangeBatchFromRequest'), 'H9C Production Worker batch route missing')
const batchStart = batchWorker.indexOf('export async function createItemizedExchangeBatch')
check(batchStart >= 0, 'H9C Production backend batch function missing')
const batch = batchWorker.slice(batchStart)
check(batch.includes("beginCriticalOperation(db, 'exchange_itemized_batch_create'"), 'H9C Production parent critical operation missing')
check(batch.includes('criticalOperation.cachedResponse'), 'H9C Production parent replay cache missing')
check(batch.includes('executionPlan = operationContext.executionPlan'), 'H9C Production frozen execution plan missing')
check(batch.includes("cleanText((existing as any).pricing_mode) !== 'itemized_v1'"), 'H9C Production batch not isolated to itemized orders')
check(batch.includes('derivedCurrentTotal !== ledger.totalAmount'), 'H9C Production itemized total drift guard missing')
check(batch.includes('finalNetPaid > finalTotalAmount'), 'H9C Production aggregate overpayment guard missing')
check(batch.includes('right.delta - left.delta'), 'H9C Production safe child execution ordering missing')
check(batch.includes("financialAction === 'refund' && position === 0"), 'H9C Production refund ordering missing')
check(batch.includes("financialAction === 'extra_payment' && position === orderedPairs.length - 1"), 'H9C Production extra-payment ordering missing')
check(batch.includes('stockGroups') && batch.includes('group.requestedQuantity'), 'H9C Production repeated-SKU stock preflight missing')
check(batch.includes('group.requestedQuantity +=') && batch.includes('group.allConfirmed = group.allConfirmed && physicalIssueConfirmed')
  && batch.includes('physical < group.requestedQuantity && !group.allConfirmed'),
  'H9C aggregate identical-SKU demand and confirmation preflight must be enforced before any child Exchange')
check(batch.includes('observedPhysicalQuantity != null') && batch.includes('observedPhysicalQuantity = null')
  && batch.includes('issuePossessionConfirmed = pair.physicalIssueConfirmed'),
  'H9C no longer accepts full-SKU count, and only concrete possession proof reaches each child')
check(batch.includes('const childRequestId =') && batch.includes('criticalOperation.requestId') && batch.includes(':p'), 'H9C Production deterministic child idempotency missing')
check(batch.includes('await createExchange(db, {'), 'H9C Production batch does not reuse proven single-exchange mutation path')
check(batch.includes('completedPairs}_done') && batch.includes('advanceCriticalOperation(db, criticalOperation'), 'H9C Production resumable progress checkpoint missing')
check(batch.includes('await completeCriticalOperation(db, criticalOperation, response)'), 'H9C Production parent completion cache missing')

// Execute the actual extracted pure validator: no API/D1, no fixture mutation.
// Live execution guards partial repeats, inherited sources and physical observation.
const compiled = await build({entryPoints:['src/app/legacyExchangePreparation.ts'],
  bundle:true,platform:'node',format:'esm',write:false,target:'es2022',logLevel:'silent'})
const implementation = await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'))
const {prepareLegacyExchangePairs} = implementation
const soldItem = {id:51,productName:'СТАРАЯ ВЕЩЬ',sourceType:'boutique',
  quantity:2,availableOperationQuantity:2,unitPrice:4000,lineTotal:8000,catalogPriceSnapshot:4100}
const secondItem = {id:52,productName:'ВТОРАЯ ВЕЩЬ',sourceType:'warehouse',
  quantity:1,availableOperationQuantity:1,unitPrice:3000,lineTotal:3000,catalogPriceSnapshot:3200}
const oldOrder = {id:80,pricing_mode:'legacy_manual_total',items:[soldItem,secondItem]}
const newGood = {productName:'ЗАМЕНА',sourceType:'warehouse',quantity:1,
  unitPrice:4800,catalogPriceSnapshot:5000,stockObservationEnabled:false,observedPhysicalQuantity:99}
const draft = {queuedPairs:[],oldItemId:51,oldQuantity:1,oldPhysicalState:'pending',
  currentPairKey:'now-1',newItem:newGood,newSourceWasManuallyChanged:false,
  financialAction:'none',financialAmount:0,paymentMethod:'',comment:'UI legacy validation'}
const canIssue = (item,q) => ({canObservePhysical:true,currentPhysical:Math.max(q,10)})
const basic=prepareLegacyExchangePairs(oldOrder,draft,canIssue)
assert.equal(basic.ok,true)
assert.equal(basic.unsavedPairs.length,1)
assert.equal(basic.pairDrafts.length,1)
assert.equal(basic.unsavedPairs[0].effectiveNewItem.sourceType,'boutique',
 'Without explicit manager override, replacement must inherit original boutique source')
assert.equal(basic.unsavedPairs[0].effectiveNewItem.observedPhysicalQuantity,null,
 'A previous stock observation must never carry into a different exchange')
assert.equal(basic.unsavedPairs[0].oldPhysicalState,'pending')
assert.equal(basic.unsavedPairs[0].oldReturnSource,'none')
assert.equal(basic.unsavedPairs[0].isQueued,false)
const manual=prepareLegacyExchangePairs(oldOrder,{...draft,newSourceWasManuallyChanged:true},canIssue)
assert.equal(manual.ok,true)
assert.equal(manual.unsavedPairs[0].effectiveNewItem.sourceType,'warehouse',
 'Explicit new-source choice must not be silently overwritten')
const queued={draftKey:'old-1',oldItemId:51,oldQuantity:1,oldPhysicalState:'warehouse',
  oldReturnSource:'warehouse',newItem:newGood,newSourceWasManuallyChanged:false,saved:false}
const multi=prepareLegacyExchangePairs(oldOrder,{...draft,queuedPairs:[queued]},canIssue)
assert.equal(multi.ok,true)
assert.equal(multi.pairDrafts.length,2)
assert.equal(multi.unsavedPairs.length,2)
assert.equal(multi.unsavedPairs[0].isQueued,true)
assert.equal(multi.unsavedPairs[1].isQueued,false)
assert.deepEqual(multi.unsavedPairs.map(p=>p.oldQuantity),[1,1])
assert.deepEqual(multi.unsavedPairs.map(p=>p.oldReturnSource),['warehouse','none'])
assert.match(prepareLegacyExchangePairs(oldOrder,{...draft,queuedPairs:[{...queued,oldQuantity:2}]},canIssue).error,
 /суммарно выбрано 3 шт., доступно 2 шт/,
 'The aggregate old SKU quantity cap must apply across queued and current rows')
const saved={...queued,saved:true}
const partial=prepareLegacyExchangePairs(oldOrder,{...draft,queuedPairs:[saved]},canIssue)
assert.equal(partial.ok,true)
assert.equal(partial.pairDrafts.length,2)
assert.equal(partial.unsavedPairs.length,1,'Saved child exchange must never be submitted a second time')
assert.equal(partial.unsavedPairs[0].index,1,'Final money action must remain on the final pair')
assert.match(prepareLegacyExchangePairs(oldOrder,{...draft,queuedPairs:[saved],newItem:{...newGood,productName:''}},canIssue).error,
 /уже были сохранены/,'Replay with only saved rows must not write again')
assert.match(prepareLegacyExchangePairs(oldOrder,{...draft,queuedPairs:[],newItem:{...newGood,productName:''}},canIssue).error,
 /Добавьте хотя бы одну позицию/)
assert.match(prepareLegacyExchangePairs(oldOrder,{...draft,oldItemId:999,queuedPairs:[{...queued,oldItemId:999}]},canIssue).error,
 /старая вещь уже недоступна/)
assert.match(prepareLegacyExchangePairs(oldOrder,{...draft,financialAction:'refund',financialAmount:0},canIssue).error,
 /сумму доплаты или возврата/)
assert.match(prepareLegacyExchangePairs(oldOrder,{...draft,financialAction:'extra_payment',financialAmount:200},canIssue).error,
 /способ оплаты/)
assert.match(prepareLegacyExchangePairs(oldOrder,draft,()=>({canObservePhysical:true,currentPhysical:0})).error,
 /Подтвердите только наличие/)
const observed=prepareLegacyExchangePairs(oldOrder,{...draft,newItem:{...newGood,stockObservationEnabled:true}},()=>({canObservePhysical:true,currentPhysical:0}))
assert.equal(observed.ok,true,
 'Confirmed concrete physical quantity must not be blocked by an inferred free stock shortage')
const itemized={...oldOrder,pricing_mode:'itemized_v1'}
assert.equal(prepareLegacyExchangePairs(itemized,draft,canIssue).ok,true)
assert.match(prepareLegacyExchangePairs({...itemized,items:[{...soldItem,lineTotal:0}]},draft,canIssue).error,
 /ценовые данные старой позиции/)
assert.match(prepareLegacyExchangePairs(itemized,{...draft,newItem:{...newGood,unitPrice:undefined}},canIssue).error,
 /фактическую цену продажи/)
assert.match(prepareLegacyExchangePairs(itemized,{...draft,newItem:{...newGood,catalogPriceSnapshot:-1}},canIssue).error,
 /снимок цены Каталога/)
console.log('LEGACY_EXCHANGE_PURE_PREPARATION_CAPACITY_PRICE_PARTIAL_REPLAY_PASS')

// Exercise both real extracted transport paths, preserving retry IDs,
// CAS snapshots and money exactly once on the last unsaved child.
const transportBundle=await build({entryPoints:['src/app/legacyExchangeCriticalRequests.ts'],
 bundle:true,platform:'node',format:'esm',write:false,target:'es2022',logLevel:'silent'})
const transport=await import('data:text/javascript;base64,'+Buffer.from(transportBundle.outputFiles[0].text).toString('base64'))
const {submitLegacyExchangeBatch,submitLegacyExchangePair}=transport
const observedRequests=[], completedOperations=[], pendingRequests=new Map()
let currentSequence=0,failNext=true,conflictNext=false
const client={
 prepareCriticalRequest(key,payload){
  const fingerprint=JSON.stringify(payload)
  let previous=pendingRequests.get(key)
  if(!previous||previous.fingerprint!==fingerprint){
   previous={fingerprint,requestId:'exchange-transport-'+(++currentSequence)}
   pendingRequests.set(key,previous)
  }
  return {requestId:previous.requestId,payload:{...payload,requestId:previous.requestId}}
 },
 completeCriticalRequest(key,id){
  completedOperations.push({key,id})
  if(pendingRequests.get(key)?.requestId===id)pendingRequests.delete(key)
 },
 async apiFetch(url,init){
  observedRequests.push({url,method:init.method,token:init.headers['X-Idempotency-Key'],body:JSON.parse(init.body)})
  if(failNext){failNext=false;throw new Error('Exchange response unknown')}
  if(conflictNext){conflictNext=false;return new Response(JSON.stringify({message:'Снимок заказа устарел'}),{status:409,headers:{'Content-Type':'application/json'}})}
  return new Response(JSON.stringify({ok:true,order:{id:80},exchangeId:135,exchangeCount:2,pendingInventoryCount:0}),
   {status:200,headers:{'Content-Type':'application/json'}})
 },
}
const itemizedMulti=prepareLegacyExchangePairs(itemized,{...draft,queuedPairs:[queued]},canIssue)
assert.equal(itemizedMulti.ok,true)
await assert.rejects(()=>submitLegacyExchangeBatch(client,itemized,{...draft,queuedPairs:[queued]},itemizedMulti.unsavedPairs),
 /Exchange response unknown/)
assert.equal(completedOperations.length,0,'Unknown batch outcome must retain its requestId')
const batchResult=await submitLegacyExchangeBatch(client,itemized,{...draft,queuedPairs:[queued]},itemizedMulti.unsavedPairs)
assert.equal(batchResult.exchangeCount,2)
assert.equal(observedRequests[0].url,'/api/exchanges/batch')
assert.equal(observedRequests[0].method,'POST')
assert.equal(observedRequests[0].token,observedRequests[1].token,'Batch replay must use one stable idempotency requestId')
assert.equal(observedRequests[1].body.expectedOrderTotal,undefined,
 'Legacy payload should not manufacture an order total if not provided')
assert.equal(observedRequests[1].body.pairs.length,2)
assert.equal(observedRequests[1].body.pairs[0].expectedOldActiveQuantity,2)
assert.equal(observedRequests[1].body.pairs[0].expectedOldUnitPrice,4000)
assert.equal(observedRequests[1].body.pairs[0].expectedOldLineTotal,8000)
assert.equal(observedRequests[1].body.pairs[0].expectedOldCatalogPriceSnapshot,4100)
assert.equal(observedRequests[1].body.pairs[0].newItem.issuePossessionConfirmed,false)
assert.equal(observedRequests[1].body.pairs[0].newItem.observedPhysicalQuantity,null)
assert.equal(observedRequests[1].body.financialAction,'none')
assert.deepEqual(completedOperations[0],{key:'exchange-batch-create:80:old-1.now-1',id:observedRequests[1].token})
const financeDraft={...draft,financialAction:'extra_payment',financialAmount:150,paymentMethod:'НАЛИЧНЫЕ'}
const unsaved=multi.unsavedPairs
failNext=true
await assert.rejects(()=>submitLegacyExchangePair(client,oldOrder,financeDraft,unsaved[0],2,false),
 /Exchange response unknown/)
assert.equal(completedOperations.length,1,'Unknown child outcome must not clear the child retry key')
const firstResult=await submitLegacyExchangePair(client,oldOrder,financeDraft,unsaved[0],2,false)
assert.equal(firstResult.exchangeId,135)
const firstAttempt=observedRequests[2], firstRetry=observedRequests[3]
assert.equal(firstAttempt.url,'/api/exchanges')
assert.equal(firstAttempt.token,firstRetry.token)
assert.equal(firstRetry.body.financialAction,'none')
assert.equal(firstRetry.body.financialAmount,0)
assert.equal(firstRetry.body.paymentMethod,'')
assert.equal(firstRetry.body.oldPhysicalState,'warehouse')
assert.equal(firstRetry.body.newItem.observedPhysicalQuantity,null)
conflictNext=true
await assert.rejects(()=>submitLegacyExchangePair(client,oldOrder,financeDraft,unsaved[1],2,false),
 /Снимок заказа устарел/)
assert.equal(completedOperations.length,2,'Stale 409 must not finalize the last money-bearing Exchange child')
const lastResult=await submitLegacyExchangePair(client,oldOrder,financeDraft,unsaved[1],2,false)
assert.equal(lastResult.order.id,80)
const lastAttempt=observedRequests[4],lastRetry=observedRequests[5]
assert.equal(lastAttempt.token,lastRetry.token)
assert.notEqual(lastRetry.token,firstRetry.token)
assert.equal(lastRetry.body.financialAction,'extra_payment')
assert.equal(lastRetry.body.financialAmount,150)
assert.equal(lastRetry.body.paymentMethod,'НАЛИЧНЫЕ')
assert.equal(lastRetry.body.oldPhysicalState,'pending')
assert.equal(completedOperations.length,3,'Only successful durable batch and children complete a critical token')
const itemizedFirst=await submitLegacyExchangePair(client,itemized,financeDraft,itemizedMulti.unsavedPairs[0],2,true)
assert.equal(itemizedFirst.exchangeId,135)
const itemizedBody=observedRequests[6].body
assert.equal(itemizedBody.expectedOrderTotal,undefined,'Itemized stale snapshot must only use actually supplied order total')
assert.equal(itemizedBody.expectedOldActiveQuantity,2)
assert.equal(itemizedBody.expectedOldUnitPrice,4000)
assert.equal(itemizedBody.expectedOldLineTotal,8000)
assert.equal(itemizedBody.expectedOldCatalogPriceSnapshot,4100)
assert.equal(itemizedBody.newItem.issuePossessionConfirmed,false)
assert.equal(itemizedBody.newItem.observedPhysicalQuantity,null)
console.log('LEGACY_EXCHANGE_BATCH_CHILD_POST_IDEMPOTENT_REPLAY_FINANCIAL_ONCE_PASS')

console.log('STAGE03-H9C PRODUCTION MULTI-EXCHANGE PASSED — Production has the Branch2-tested multi-position itemized Exchange path with stale-safe aggregate validation, resumable idempotency and repeated-SKU stock protection')
