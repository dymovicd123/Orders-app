import assert from 'node:assert/strict'
const publicUrl='https://orders-app-branch2.orders-clothes.workers.dev'
const pinnedUrl='https://1fa6e7a3-orders-app-branch2.orders-clothes.workers.dev'
const urls=[publicUrl,pinnedUrl]
const entries=[]
for(const host of urls){
  let previous=null
  for(let pass=0;pass<3;pass++){
    const page=await fetch(host+'/?warehouse-safe-readback='+pass,{method:'GET',cache:'no-store',redirect:'manual',signal:AbortSignal.timeout(25000)})
    assert.equal(page.status,200,host+' root HTTP '+page.status)
    const html=await page.text()
    const asset=html.match(/src=["'](\/assets\/index-[^"']+\.js)["']/)?.[1]
    assert(asset,host+' JS entry not found')
    if(previous) assert.equal(previous,asset,'Nonstable JS asset on '+host)
    previous=asset
    const js=await fetch(host+asset,{method:'GET',redirect:'manual',signal:AbortSignal.timeout(25000)})
    assert.equal(js.status,200,'Client JavaScript missing '+host)
  }
  entries.push(previous)
  for(const path of ['/api/orders?limit=1','/api/inventory?source=warehouse']){
    const response=await fetch(host+path,{method:'GET',redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(25000)})
    assert.equal(response.status,401,host+path+' must deny anonymous data access')
  }
}
assert.equal(entries[0],entries[1],'Live Branch2 does not have exact pinned warehouse frontend assets')
console.log('BRANCH2_ACTIVE_WAREHOUSE_VERSION_UI_PASSED '+JSON.stringify({
 live:publicUrl,preview:pinnedUrl,entry:entries[0],
 rootPassesPerUrl:3,authenticatedApiProtection:401,
 liveAndPinnedAssetsIdentical:true,mutations:0
}))
