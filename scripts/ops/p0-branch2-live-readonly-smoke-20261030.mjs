import assert from 'node:assert/strict'
const host='https://orders-app-branch2.orders-clothes.workers.dev'
const expected={
 ReferencesSection:['Все рабочие справочники','Проверка дублей'],
 WorkshopSection:['Расчёты с Цехом','История операций'],
 InventorySection:['Остатки какой точки?','С учтённым наличием или резервом','Активные модели каталога','На месте','В заказах'],
}
async function get(path) {
 assert(path.startsWith('/'),'Only relative path')
 const r=await fetch(host+path,{method:'GET',cache:'no-store',redirect:'manual',headers:{'Cache-Control':'no-cache'},signal:AbortSignal.timeout(20000)})
 return r
}
let prevEntry=null
for(let pass=1;pass<=3;pass++){
 const page=await get('/?p0-post-merge='+pass)
 assert.equal(page.status,200,'Branch2 public UI unavailable')
 const html=await page.text()
 const entry=html.match(/src=["'](\/assets\/index-[^"']+\.js)["']/)
 assert(entry,'Missing current JS entry')
 if(prevEntry)assert.equal(entry[1],prevEntry,'Current Branch2 assets are unstable')
 prevEntry=entry[1]
 const js=await get(entry[1]);assert.equal(js.status,200)
 const entryText=await js.text()
 const chunks={}
 for(const [name,markers] of Object.entries(expected)){
  const m=entryText.match(new RegExp(name+'-[a-zA-Z0-9_-]+\\.js'))
  assert(m,'Missing lazy chunk '+name)
  const chunk=await get('/assets/'+m[0]);assert.equal(chunk.status,200)
  const body=await chunk.text()
  for(const marker of markers)assert(body.includes(marker),'Missing '+name+' marker '+marker)
  chunks[name]=m[0]
 }
 console.log('P0_BRANCH2_ACTIVE_UI_PASS '+JSON.stringify({pass,entry:entry[1],chunks}))
}
for(const p of ['/api/orders','/api/orders?limit=1']){
 const r=await get(p)
 assert.equal(r.status,401,'Unauthenticated orders must be denied')
 console.log('P0_BRANCH2_ANONYMOUS_ORDERS_DENIED '+JSON.stringify({path:p,status:r.status}))
}
console.log('P0_BRANCH2_LIVE_READ_ONLY_SMOKE_PASSED — 3 stable UI reads, authenticated order guard, no writes')
