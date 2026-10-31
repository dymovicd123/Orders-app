// Real local workerd + D1, actual HTTP, disposable synthetic catalog/stock only.
// No network/production D1 data; local loopback only. Source Main after PR #669/#670/#672.
import assert from 'node:assert/strict'
const origin='http://127.0.0.1:8799'
let cookie=''
async function api(url,method='GET',input,expected){
 const response=await fetch(origin+url,{method,headers:{...(cookie?{cookie}:{}),...(input?{'Content-Type':'application/json'}:{})},...(input?{body:JSON.stringify(input)}:{})})
 const data=await response.json().catch(()=>({}))
 if(!response.ok){
  console.log('NATIVE_D1_SYNTHETIC_REJECTION',JSON.stringify({route:url,status:response.status,code:data.code||null,message:String(data.message||'').slice(0,290)}))
  // Let native Workerd's async logger flush the underlying server exception
  // before the parent process captures a failed-HTTP diagnostic.
  await new Promise(resolve=>setTimeout(resolve,1000))
 }
 if(expected!==undefined)assert.equal(response.status,expected,method+' '+url+': '+JSON.stringify(data))
 else assert(response.ok,method+' '+url+' HTTP '+response.status+': '+JSON.stringify(data))
 return {response,data}
}
await api('/api/orders?limit=1','GET',undefined,401)
const setup=await api('/api/auth/setup','POST',{
 login:'localqa-admin',password:'local-qa-password-2026',
 bootstrapLogin:'admin',bootstrapPassword:'local-synthetic-bootstrap-2026',
 displayName:'Synthetic Local QA'
},201)
assert.equal(setup.data.user?.role,'admin')
cookie=(setup.response.headers.get('set-cookie')||'').split(';')[0]
assert(cookie.startsWith('orders_session='))
await api('/api/auth/me')
const name='CI LOCAL D1 WAREHOUSE SKU'
const product=await api('/api/catalog/products','POST',{name,category:'adult',genderScope:'female'},201)
const productId=Number(product.data.id)
assert(productId>0)
const color='ЧЕРНЫЙ',size='46'
const variant=await api('/api/catalog/variants','POST',{
 productId,category:'adult',gender:'ЖЕН',color,material:'СТАНДАРТ',length:'СТАНДАРТ',sizeLabel:size
},201)
const variantId=Number(variant.data.id)
assert(variantId>0)
const facts={productId,variantId,productName:name,gender:'ЖЕН',color,material:'СТАНДАРТ',length:'СТАНДАРТ',size,quantity:3}
const arrival={requestId:'main-native-arrival-20261031-1',inventorySource:'warehouse',movementType:'arrival',items:[facts]}
const created=await api('/api/inventory/movements?returnInventory=0','POST',arrival,201)
assert.equal(created.data.duplicate,false)
const replay=await api('/api/inventory/movements?returnInventory=0','POST',arrival,200)
assert.equal(replay.data.duplicate,true)
const invalid={...arrival,requestId:'main-native-invalid-arrival-20261031',items:[{...facts,color:'СИНИЙ',quantity:1}]}
const rejected=await api('/api/inventory/movements?returnInventory=0','POST',invalid,409)
assert.equal(rejected.response.ok,false,'Stale/wrong SKU must be rejected before any physical change')
assert(rejected.response.status>=400&&rejected.response.status<500)
const transfer={requestId:'main-native-transfer-20261031-1',fromSource:'warehouse',toSource:'boutique',
 items:[{...facts,quantity:1}]}
const moved=await api('/api/inventory/transfer?returnInventory=0','POST',transfer,201)
assert.equal(moved.data.duplicate,false)
assert.equal(moved.data.totalQuantity,1)
const movedReplay=await api('/api/inventory/transfer?returnInventory=0','POST',transfer,200)
assert.equal(movedReplay.data.duplicate,true)
const wrongTransfer={...transfer,requestId:'main-native-invalid-transfer-20261031',items:[{...facts,quantity:1,size:'48'}]}
const rejectedTransfer=await api('/api/inventory/transfer?returnInventory=0','POST',wrongTransfer,409)
assert.equal(rejectedTransfer.response.ok,false,'Wrong size may not cross stock locations')
assert(rejectedTransfer.response.status>=400&&rejectedTransfer.response.status<500)
const inventory=await api('/api/inventory?source=warehouse')
assert.equal(inventory.data.ok,true)
console.log('MAIN_NATIVE_LOCAL_D1_HTTP_OPERATION_PASS',JSON.stringify({
 productId,variantId,arrivalIdempotent:true,transferIdempotent:true,
 mismatchedArrivalRejected:true,mismatchedTransferRejected:true,
 source:'warehouse',destination:'boutique'
}))
