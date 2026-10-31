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
 const v=await api('/api/catalog/variants','POST',{productId,category:'adult',gender:'ЖЕН',color:'СЕРО-ГОЛУБОЙ',material:'ДАК',length:'СТАНДАРТ',sizeLabel},201)
 variants[sizeLabel]=Number(v.data.id);assert(variants[sizeLabel]>0)
}
function item(size,quantity=1,patch={}){
 return {productId,variantId:variants[size],productName:name,category:'adult',gender:'ЖЕН',
 color:'СЕРО ГОЛУБОЙ',material:'ДАК',length:'СТАНДАРТ',size,quantity,...patch}
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
