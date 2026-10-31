// Native workerd + native local D1 (not an in-memory adapter). Isolated synthetic
// data only. Two independent create-order HTTP requests compete for the last piece.
import assert from 'node:assert/strict'
const origin='http://127.0.0.1:8798'
let cookie=''
async function api(path,method='GET',input,expected){
 const response=await fetch(origin+path,{method,
  headers:{...(cookie?{cookie}:{}),...(input?{'content-type':'application/json'}:{})},
  ...(input?{body:JSON.stringify(input)}:{})})
 const data=await response.json().catch(()=>({}))
 if(!response.ok) {
  console.log('NATIVE_D1_HTTP_REJECTION',JSON.stringify({method,path,status:response.status,code:data.code,message:data.message}))
  await new Promise(resolve=>setTimeout(resolve,1500))
 }
 if(expected!==undefined) assert.equal(response.status,expected,method+' '+path+' '+JSON.stringify(data))
 return {status:response.status,response,data}
}
assert.equal((await api('/api/orders?limit=1')).status,401)
const setup=await api('/api/auth/setup','POST',{
 login:'b2nativeadmin',password:'synthetic-native-admission-2026',
 bootstrapLogin:'admin',bootstrapPassword:'synthetic-bootstrap-2026',
 displayName:'Native D1 Test Actor'
},201)
assert(setup.data.user?.role==='admin')
cookie=(setup.response.headers.get('set-cookie')||'').split(';')[0]
assert(cookie.startsWith('orders_session='))
const name='CI B2 NATIVE D1 ADMISSION'
const product=await api('/api/catalog/products','POST',{name,category:'adult',genderScope:'female'},201)
const productId=Number(product.data.id)
const variant=await api('/api/catalog/variants','POST',{
 productId,category:'adult',gender:'ЖЕН',color:'ЧЕРНЫЙ',
 material:'СТАНДАРТ',length:'СТАНДАРТ',sizeLabel:'46'
},201)
const variantId=Number(variant.data.id)
assert(variantId>0)
// Historical migrations seed an active test manager #1 in the local fixture.
const managerId=1
const payload=(id)=>({
 requestId:'b2-native-admission-'+id+'-20261031',orderDate:'2026-10-31',
 managerId,customerPhone:'77019990000',city:'АЛМАТЫ',pricingMode:'itemized_v1',
 workshopStatus:'ready',orderStatus:'active',
 items:[{productName:name,audienceType:'ВЗРОСЛЫЙ',gender:'ЖЕН',color:'ЧЕРНЫЙ',
 material:'СТАНДАРТ',length:'СТАНДАРТ',size:'46',sourceType:'warehouse',
 quantity:1,unitPrice:10000,catalogPriceSnapshot:null}],
 payments:[],
})
const empty=await api('/api/orders','POST',payload('empty'),201)
const emptyOrderId=Number(empty.data.orderId)
assert(emptyOrderId>0)
const replay=await api('/api/orders','POST',payload('empty'))
assert([200,201].includes(replay.status),JSON.stringify(replay.data))
const arrival=await api('/api/inventory/movements?returnInventory=0','POST',{
 requestId:'b2-native-one-physical-arrival-20261031',inventorySource:'warehouse',
 movementType:'arrival',items:[{productId,variantId,productName:name,
 gender:'ЖЕН',color:'ЧЕРНЫЙ',material:'СТАНДАРТ',length:'СТАНДАРТ',
 size:'46',quantity:1}]
},201)
assert.equal(arrival.data.duplicate,false)
const results=await Promise.all([
 api('/api/orders','POST',payload('raceA')),
 api('/api/orders','POST',payload('raceB')),
])
for(const [i,r] of results.entries()){
 assert.equal(r.status,201,'Concurrent order '+i+': '+JSON.stringify(r.data))
 assert(Number(r.data.orderId)>0)
}
const raceOrders=results.map(r=>Number(r.data.orderId))
const retryRace=await api('/api/orders','POST',payload('raceA'))
assert([200,201].includes(retryRace.status),'Retry after race failed: '+JSON.stringify(retryRace.data))
console.log('BRANCH2_NATIVE_D1_RESERVATION_HTTP_REQUESTS_PASS',JSON.stringify({
 productId,variantId,emptyOrderId,raceOrders,
 retriedRequestId:'b2-native-admission-raceA-20261031'
}))
