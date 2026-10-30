// P0 uploaded version smoke: public assets and anonymous API access ONLY.
// No credentials, cookies, D1 SQL or state-changing requests.
import assert from 'node:assert/strict'
const base='https://56d81b89-orders-app-branch2.orders-clothes.workers.dev'
const must={reference:['Все рабочие справочники','Проверка дублей'],workshop:['Расчёты с Цехом','История операций'],inventory:['Остатки какой точки?','С учтённым наличием или резервом','Активные модели каталога','На месте','В заказах']}
async function response(path){
 const url=base+path
 const result=await fetch(url,{method:'GET',cache:'no-store',redirect:'manual',
  headers:{'Cache-Control':'no-cache'},signal:AbortSignal.timeout(20000)})
 return result
}
async function get(path){
 const r=await response(path)
 assert.equal(r.status,200,'GET '+path+' must return 200')
 return await r.text()
}
for(const pass of [1,2]){
 const html=await get('/?p0-preview-check='+pass)
 const entry=html.match(/src=["'](\/assets\/index-[^"']+\.js)["']/)
 assert(entry,'Version URL missing index bundle')
 const js=await get(entry[1])
 const chunks={}
 for(const [part,name] of [['reference','ReferencesSection'],['workshop','WorkshopSection'],['inventory','InventorySection']]){
  const match=js.match(new RegExp(name+'-[A-Za-z0-9_-]+\\.js'))
  assert(match,'Missing '+name+' chunk reference')
  chunks[part]=match[0]
  const content=await get('/assets/'+match[0])
  for(const marker of must[part]) assert(content.includes(marker),'Missing '+part+' UI '+marker)
 }
 console.log('P0_VERSION_URL_ASSETS_VERIFIED '+JSON.stringify({pass,entry:entry[1],chunks}))
}
for(const path of ['/api/orders','/api/orders?limit=1']){
 const r=await response(path)
 assert([401,403].includes(r.status),'Unauthenticated order data must be refused: '+r.status+' '+path)
 console.log('P0_VERSION_URL_ANONYMOUS_ORDERS_DENIED '+JSON.stringify({path,status:r.status}))
}
console.log('P0_VERSION_URL_READ_ONLY_SMOKE_PASSED — no mutation, public version only')
