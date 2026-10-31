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

console.log('BRANCH2_STAGE2_UNIFIED_NATIVE_HTTP_PASS',JSON.stringify({
 transferOnce:true,writeoffOnce:true,correctionOnce:true,staleRejected:true,
 quickCount:true,revisionOnce:true,sourceIsolation:true,workerAuth:true
}))
