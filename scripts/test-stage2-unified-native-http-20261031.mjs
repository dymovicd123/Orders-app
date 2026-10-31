import assert from 'node:assert/strict'
const host='http://127.0.0.1:8798'
async function call(route,method='GET',body,cookie=''){
  const response=await fetch(host+route,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{})},...(body?{body:JSON.stringify(body)}:{})})
  const data=await response.json().catch(()=>({}))
  return {status:response.status,data,headers:response.headers}
}
const setup=await call('/api/auth/setup','POST',{login:'stage2admin',password:'synthetic-stage2-admin-2026',bootstrapLogin:'admin',bootstrapPassword:'synthetic-bootstrap-ui-2026',displayName:'Synthetic Arrival Test'})
assert.equal(setup.status,201,JSON.stringify(setup.data))
const auth=await call('/api/auth/login','POST',{login:'stage2admin',password:'synthetic-stage2-admin-2026'})
assert.equal(auth.status,200,JSON.stringify(auth.data))
const cookie=auth.headers.get('set-cookie')?.split(';')[0]||''
assert(cookie,'Missing authenticated session')
async function api(route,method,body,status){
 const x=await call(route,method,body,cookie)
 if(status!==undefined&&x.status!==status) {
   console.log('STAGE_NATIVE_REJECT_DEBUG',JSON.stringify({method,route,expected:status,actual:x.status,response:x.data}))
   await new Promise(resolve=>setTimeout(resolve,600))
 }
 if(status!==undefined)assert.equal(x.status,status,method+' '+route+': '+JSON.stringify(x.data))
 return x
}
const name='CI STAGE2 ARRIVAL ATOMIC CANONICAL'
const p=await api('/api/catalog/products','POST',{name,category:'adult',genderScope:'female'},201)
const productId=Number(p.data.id)
assert(productId>0)
const variants={}
for(const sizeLabel of ['46','48']){
 const v=await api('/api/catalog/variants','POST',{productId,category:'adult',gender:'ЖЕН',color:'ЧЕРНЫЙ',material:'СТАНДАРТ',length:'СТАНДАРТ',sizeLabel},201)
 variants[sizeLabel]=Number(v.data.id);assert(variants[sizeLabel]>0)
}
function item(size,quantity=1,patch={}){
 return {productId,variantId:variants[size],productName:name,category:'adult',gender:'ЖЕН',
 color:'ЧЕРНЫЙ',material:'СТАНДАРТ',length:'СТАНДАРТ',size,quantity,...patch}
}
const route='/api/inventory/movements?returnInventory=0'
async function arrival(requestId,source,items,status=201){
 return api(route,'POST',{requestId,inventorySource:source,movementType:'arrival',items},status===null?undefined:status)
}
const first=await arrival('s2-arrival-wh-46','warehouse',[item('46')])
assert.equal(first.data.duplicate,false)
const repeated=await arrival('s2-arrival-wh-46','warehouse',[item('46')],200)
assert.equal(repeated.data.duplicate,true,'Same request must never add a second piece')
const boutique=await arrival('s2-arrival-boutique-46','boutique',[item('46',2)])
assert.equal(boutique.data.duplicate,false)
await arrival('s2-arrival-wh-48','warehouse',[item('48')])
for(const [suffix,patch] of [
 ['wrong-product',{productId:productId+700}],
 ['wrong-gender',{gender:'МУЖ'}],
 ['wrong-color',{color:'КРАСНЫЙ'}],
 ['wrong-material',{material:'АТЛАС'}],
 ['wrong-size',{size:'50'}],
]){
 const response=await arrival('s2-arrival-reject-'+suffix,'warehouse',[item('46',1,patch)],null)
 assert(response.status>=400,'Wrong SKU '+suffix+' must never be accepted: '+JSON.stringify(response))
 console.log('STAGE2_ARRIVAL_SKU_REJECTION',JSON.stringify({suffix,status:response.status,code:response.data.code||null}))
}
console.log('BRANCH2_STAGE2_ARRIVAL_NATIVE_HTTP_PASS',JSON.stringify({productId,variants,warehouse46:1,boutique46:2,warehouse48:1,duplicatePrevented:true,mismatchCases:5}))


// Same authenticated workerd + disposable D1: combined 2.2–2.6 verification.
const transferInput={requestId:'s2-transfer-wh48-to-boutique48',
 fromSource:'warehouse',toSource:'boutique',items:[item('48',1,{expectedQuantity:1})]}
const transfer=await api('/api/inventory/transfer?returnInventory=0','POST',transferInput,201)
assert.equal(transfer.data.duplicate,false)
const repeatedTransfer=await api('/api/inventory/transfer?returnInventory=0','POST',transferInput,200)
assert.equal(repeatedTransfer.data.duplicate,true,'Transfer retry must not move stock twice')
const staleTransfer=await api('/api/inventory/transfer?returnInventory=0','POST',{
 requestId:'s2-transfer-stale',fromSource:'warehouse',toSource:'boutique',
 items:[item('46',1,{expectedQuantity:0})]},409)
assert.equal(staleTransfer.data.ok,false,'Stale displayed stock cannot authorize a transfer')

const correctionInput={requestId:'s2-correction-wh46',inventorySource:'warehouse',
 movementType:'manual_set',items:[item('46',3,{expectedQuantity:1,createMissingVariant:false})]}
const corrected=await api(route,'POST',correctionInput,201)
assert.equal(corrected.data.duplicate,false)
const correctionReplay=await api(route,'POST',correctionInput,200)
assert.equal(correctionReplay.data.duplicate,true)
const staleCorrection=await api(route,'POST',{
 requestId:'s2-correction-stale',inventorySource:'warehouse',movementType:'manual_set',
 items:[item('46',1,{expectedQuantity:1,createMissingVariant:false})]},409)
assert.equal(staleCorrection.data.ok,false)

const writeoffInput={requestId:'s2-writeoff-wh46',inventorySource:'warehouse',
 movementType:'writeoff',items:[item('46',1,{expectedQuantity:3})]}
const wroteOff=await api(route,'POST',writeoffInput,201)
assert.equal(wroteOff.data.duplicate,false)
const repeatedWriteoff=await api(route,'POST',writeoffInput,200)
assert.equal(repeatedWriteoff.data.duplicate,true)

const quick=await api('/api/inventory/stocktakes/quick-batch','POST',{
 source:'warehouse',requestId:'s2-quick-count-wh46',
 items:[{variantId:variants['46'],expectedQuantity:2,countedQuantity:4}]
},200)
assert.equal(quick.data.ok,true)

const started=await api('/api/inventory/stocktakes','POST',{source:'boutique'},201)
assert.equal(started.data.ok,true)
const session=started.data.session
assert(session?.id && session?.items?.length>=2,'Full Boutique revision must snapshot both real SKUs')
const resuming=await api('/api/inventory/stocktakes','POST',{source:'boutique'},201)
assert.equal(resuming.data.resumed,true,'Repeated stocktake start must resume')

const duringCount=await api('/api/inventory/stocktakes/quick-batch','POST',{
 source:'boutique',requestId:'s2-rejected-while-revision',
 items:[{variantId:variants['46'],expectedQuantity:2,countedQuantity:1}]
},409)
assert.equal(duringCount.data.code,'stocktake_active')
const duringTransfer=await api('/api/inventory/transfer?returnInventory=0','POST',{
 requestId:'s2-transfer-while-boutique-revision',fromSource:'warehouse',toSource:'boutique',
 items:[item('46',1,{expectedQuantity:4})]},409)
assert.equal(duringTransfer.data.ok,false,'Transfer during active target revision must fail atomically')

for(const row of session.items.filter(x=>[variants['46'],variants['48']].includes(Number(x.variantId)))){
 const fact=Number(row.variantId)===variants['46']?1:1
 const saved=await api('/api/inventory/stocktakes/'+encodeURIComponent(session.id)+'/items/'+row.id,'PATCH',{countedQuantity:fact},200)
 assert.equal(saved.data.ok,true,'Revision must persist a physical count')
}
const completed=await api('/api/inventory/stocktakes/'+encodeURIComponent(session.id)+'/complete','POST',{},200)
assert.equal(completed.data.ok,true)
const readback=await api('/api/inventory/stocktakes/'+encodeURIComponent(session.id),'GET',undefined,200)
assert.equal(readback.data.session?.status,'completed','A successful response must be durable')
await new Promise(resolve=>setTimeout(resolve,250))
const completedAgain=await call('/api/inventory/stocktakes/'+encodeURIComponent(session.id)+'/complete','POST',{},cookie)
console.log('NATIVE_STOCKTAKE_REPLAY_OBSERVED',JSON.stringify({status:completedAgain.status,code:completedAgain.data?.code||'',message:completedAgain.data?.message||''}))
assert.equal(completedAgain.status,200,'Native Worker must accept harmless retry after completed stocktake')
assert.equal(completedAgain.data.ok,true,'Revision completion replay must be harmless')


// Stage 1.6 + 2.5/2.6: run actual order admission and a physical correction
// against its active reservation on the *same* authorized Worker and local D1.
// This synthetic manager is seeded into both managers and the legacy
// migration shadow solely in the disposable D1 fixture before Workerd boots.
// The old fixture's orders FK still points at the shadow table.
const managerId=9000
function orderPayload(requestId,source,size,suffix){
 return {
  requestId,orderDate:'2026-10-31',managerId,
  customerPhone:'7701555'+suffix,city:'АЛМАТЫ',pricingMode:'itemized_v1',
  workshopStatus:'ready',orderStatus:'active',sourceType:source,
  items:[{productName:name,audienceType:'ВЗРОСЛЫЙ',gender:'ЖЕН',
   color:'ЧЕРНЫЙ',material:'СТАНДАРТ',length:'СТАНДАРТ',size,
   sourceType:source,quantity:1,unitPrice:10000,catalogPriceSnapshot:null}],
  payments:[]
 }
}
const orderA=await api('/api/orders','POST',orderPayload('s2-reservation-order-a','boutique','48','0001'),201)
const orderB=await api('/api/orders','POST',orderPayload('s2-reservation-order-b','boutique','48','0002'),201)
const orderC=await api('/api/orders','POST',orderPayload('s2-reservation-order-c','warehouse','46','0003'),201)
const orderAId=Number(orderA.data.orderId),orderBId=Number(orderB.data.orderId),orderCId=Number(orderC.data.orderId)
assert(orderAId>0&&orderBId>0&&orderCId>0,'Orders were not committed')
const a=await api('/api/orders/'+orderAId,'GET',undefined,200)
const b=await api('/api/orders/'+orderBId,'GET',undefined,200)
const cOrder=await api('/api/orders/'+orderCId,'GET',undefined,200)
assert.equal(a.data.order?.items?.length,1)
assert.equal(b.data.order?.items?.length,1)
assert.equal(cOrder.data.order?.items?.length,1)
const orderAItemId=Number(a.data.order.items[0].id)
const orderBItemId=Number(b.data.order.items[0].id)
assert(orderAItemId>0&&orderBItemId>0)
const pending=await api('/api/orders/'+orderBId+'/items/'+orderBItemId+'/pending-reservation','GET',undefined,200)
assert.equal(pending.data.pending,true,'Second customer must get pending reservation, not fictitious active stock')
assert.equal(pending.data.snapshot.inventorySource,'boutique')
assert.equal(pending.data.snapshot.variantId,variants['48'])
assert.equal(pending.data.shortage,1)
const orderRetry=await api('/api/orders','POST',orderPayload('s2-reservation-order-b','boutique','48','0002'),201)
assert.equal(Number(orderRetry.data.orderId),orderBId,'Same requestId must not create a third customer order')
const handoverBefore=await api('/api/orders/'+orderAId+'/stock-handover','GET',undefined,200)
const physicalCorrection=await api(route,'POST',{
 requestId:'s2-correction-reserved-boutique48',inventorySource:'boutique',
 movementType:'manual_set',items:[item('48',0,{expectedQuantity:1})]
},201)
assert.equal(physicalCorrection.data.duplicate,false)
const handoverAfter=await api('/api/orders/'+orderAId+'/stock-handover','GET',undefined,200)
assert.equal(handoverAfter.data.ok,true)
// Follow-up 1.6: replace the pending line's identity AND source through the
// real itemized order editor, preserving history and re-admitting a free SKU.
const originalPending=b.data.order.items[0]
const expectedItem={
 orderItemId:Number(originalPending.id),productName:originalPending.productName,
 audienceType:originalPending.audienceType,gender:originalPending.gender,
 color:originalPending.color,material:originalPending.material,
 length:originalPending.length,size:originalPending.size,
 quantity:originalPending.quantity,unitPrice:originalPending.unitPrice,
 lineTotal:originalPending.lineTotal,catalogPriceSnapshot:originalPending.catalogPriceSnapshot,
 sourceType:originalPending.sourceType
}
const movedItem={
 ...expectedItem,size:'46',sourceType:'warehouse'
}
delete movedItem.lineTotal
delete movedItem.orderItemId
const edited=await api('/api/orders/'+orderBId,'PATCH',{
 requestId:'s2-order-b-switch-source-and-sku',
 itemContentReplacement:{expectedItems:[expectedItem],items:[movedItem]}
},200)
assert.equal(edited.data.ok,true,'Order edit with exact new source/SKU must commit')
const refreshedB=await api('/api/orders/'+orderBId,'GET',undefined,200)
const refreshedItem=refreshedB.data.order.items[0]
assert.equal(refreshedItem.sourceType,'warehouse')
assert.equal(refreshedItem.size,'46')
assert.equal(Number(refreshedItem.variantId),variants['46'])
const repeatedEdit=await api('/api/orders/'+orderBId,'PATCH',{
 requestId:'s2-order-b-switch-source-and-sku',
 itemContentReplacement:{expectedItems:[expectedItem],items:[movedItem]}
},200)
assert.equal(repeatedEdit.data.ok,true,'Lost response retry must not edit or reserve twice')
console.log('BRANCH2_STAGE1_ORDER_SOURCE_SKU_REPLACEMENT_HTTP_PASS',
 JSON.stringify({orderBId,oldVariant:variants['48'],newVariant:variants['46'],
  source:'warehouse',orderItemId:refreshedItem.id}))

console.log('BRANCH2_STAGE1_2_ORDER_RESERVATION_HTTP_PASS',JSON.stringify({
 orderAId,orderBId,orderCId,
 activeOrderItemId:orderAItemId,pendingOrderItemId:orderBItemId,
 shortagePending:true,orderReplay:true,
 beforeReviewNeeded:handoverBefore.data?.items?.some(x=>x.reviewNeeded)??null,
 afterReviewNeeded:handoverAfter.data?.items?.some(x=>x.reviewNeeded)??null
}))

// Retired product during an open Arrival form: reject stale SKU, restore only
// via audited admin action, then retry the SAME physical receipt once.
const retiredName='CI STAGE2 RETIRED RECOVERY'
const retiredProduct=await api('/api/catalog/products','POST',{name:retiredName,category:'adult',genderScope:'female'},201)
const retiredProductId=Number(retiredProduct.data.id)
const staleVariant=await api('/api/catalog/variants','POST',{
 productId:retiredProductId,category:'adult',gender:'ЖЕН',color:'СИНИЙ',
 material:'СТАНДАРТ',length:'СТАНДАРТ',sizeLabel:'50'
},201)
const staleVariantId=Number(staleVariant.data.id)
const staleArrivalItem={
 productId:retiredProductId,variantId:staleVariantId,productName:retiredName,
 category:'adult',gender:'ЖЕН',color:'СИНИЙ',material:'СТАНДАРТ',
 length:'СТАНДАРТ',size:'50',quantity:1
}
const previewRetirement=await api('/api/catalog/products/'+retiredProductId+'/retirement-preview','GET',undefined,200)
assert.equal(previewRetirement.data.physicalQuantity,0)
assert.equal(previewRetirement.data.activeReservationQuantity,0)
const retired=await api('/api/catalog/products/'+retiredProductId+'/retire','POST',{
 requestId:'s2-retire-empty-product',reason:'Synthetic zero-stock test'
},200)
assert.equal(retired.data.ok,true)
const rejected=await arrival('s2-retired-physical-receipt','warehouse',[staleArrivalItem],409)
assert.equal(rejected.data.code,'arrival_retired_product')
assert.equal(Number(rejected.data.productId),retiredProductId)
const retirementId=Number(rejected.data.retirementId)
assert(retirementId>0,'A valid completed retirement must be offered for restoration')
const restoration=await api('/api/catalog/retirements/'+retirementId+'/restore','POST',{
 requestId:'s2-retired-restore-admin'
},200)
assert.equal(restoration.data.ok,true)
const restorationReplay=await api('/api/catalog/retirements/'+retirementId+'/restore','POST',{
 requestId:'s2-retired-restore-admin'
},200)
assert.equal(restorationReplay.data.replayed,true,'Restoring again cannot create another active SKU')
const recovered=await arrival('s2-retired-physical-receipt','warehouse',[
 {...staleArrivalItem,variantId:''}
],201)
assert.equal(recovered.data.duplicate,false)
const recoveredReplay=await arrival('s2-retired-physical-receipt','warehouse',[
 {...staleArrivalItem,variantId:''}
],200)
assert.equal(recoveredReplay.data.duplicate,true,'Retried receipt must be idempotent')
console.log('BRANCH2_STAGE2_RETIRED_ARRIVAL_RECOVERY_HTTP_PASS',JSON.stringify({
 retiredProductId,staleVariantId,retirementId,retiredConflict409:true,
 restorationReplay:true,receiptReplay:true
}))

// Found at inspection but not in any known SKU: retain physical proof
// without inventing a barcode or a reference. Real authorized Worker + D1.
const unknownProduct=await api('/api/catalog/products','POST',{
 name:'CI STAGE2 FOUND UNKNOWN',category:'adult',genderScope:'female'
},201)
const unknownProductId=Number(unknownProduct.data.id)
const unknownSessionStart=await api('/api/inventory/stocktakes','POST',{source:'warehouse'},201)
const unknownSessionId=unknownSessionStart.data.session.id
const deferred=await api('/api/inventory/stocktakes/'+encodeURIComponent(unknownSessionId)+'/items/combination','POST',{
 productId:unknownProductId,category:'adult',gender:'ЖЕН',
 color:'CI UNKNOWN COLOR',material:'СТАНДАРТ',length:'СТАНДАРТ',
 size:'97',deferUnknown:true
},201)
assert.equal(deferred.data.deferredUnknownCount,1,'Unknown reference must be deferred, not minted')
const foundItem=deferred.data.session?.items?.find(x=>Number(x.productId)===unknownProductId&&x.variantId==null)
assert(foundItem?.stockId>0,'Unidentified item must carry its own physical stock row')
await api('/api/inventory/stocktakes/'+encodeURIComponent(unknownSessionId)+'/items/'+foundItem.id,
 'PATCH',{countedQuantity:1},200)
const unknownComplete=await api('/api/inventory/stocktakes/'+encodeURIComponent(unknownSessionId)+'/complete',
 'POST',{},200)
assert.equal(unknownComplete.data.unresolvedFoundCount,1)
const notGuessed=await api('/api/inventory/found-stock/'+foundItem.stockId+'/reconcile','POST',{},200)
assert.equal(notGuessed.data.code,'identity_unresolved','No matching canonical SKU means no automatic barcode')
console.log('BRANCH2_STAGE2_UNKNOWN_FOUND_STOCK_HTTP_PASS',JSON.stringify({
 unknownProductId,stockId:foundItem.stockId,unresolvedFoundCount:1,barcodeNotGuessed:true
}))

console.log('BRANCH2_STAGE2_UNIFIED_NATIVE_HTTP_PASS',JSON.stringify({
 transferOnce:true,writeoffOnce:true,correctionOnce:true,staleRejected:true,
 quickCount:true,revisionOnce:true,sourceIsolation:true,workerAuth:true
}))
