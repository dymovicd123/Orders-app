import assert from 'node:assert/strict'
const token=process.env.CLOUDFLARE_API_TOKEN,account=process.env.CLOUDFLARE_ACCOUNT_ID
assert(token&&/^[a-f0-9]{32}$/.test(account||''))
const base='https://api.cloudflare.com/client/v4/accounts/'+account
async function get(path){
 assert(path==='/workers/scripts'||/^\/builds\/workers\/[a-f0-9-]{8,}\/builds$/.test(path)||/^\/builds\/builds\/[a-f0-9-]{36}\/logs$/.test(path))
 const res=await fetch(base+path,{method:'GET',headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(25000)})
 const data=await res.json()
 if(!res.ok||!data.success)throw Error('Cloudflare GET HTTP '+res.status)
 return data.result
}
const workers=await get('/workers/scripts')
const tag=workers.find(x=>x.id==='orders-app-branch2')?.tag
assert(tag)
const builds=await get('/builds/workers/'+tag+'/builds')
const b=builds.find(x=>x.build_trigger_metadata?.commit_hash==='91a9c1dde726659cc67ac7c85a72096701bed155')
assert(b?.build_uuid)
const logs=await get('/builds/builds/'+b.build_uuid+'/logs')
const lines=(logs.lines||[]).map(x=>Array.isArray(x)?x.join(' '):String(x))
const interesting=lines.filter(x=>/configuration being used|original user's configuration|deploy configuration|assets|wrangler.*json|version|success|upload|worker.*binding|missing|warn|error|failed|Executing user|build command/i.test(x)).slice(-55)
console.log('P0_NATIVE_BUILD_DIAGNOSTIC '+JSON.stringify({
 build:b.build_uuid,status:b.status,outcome:b.build_outcome,
 lines:interesting.map(x=>x.replace(/[A-Za-z0-9_-]{80,}/g,'[redacted]').slice(0,230)),
}))
for(const path of ['/?p0-version-diagnostic=1','/api/orders?limit=1']){
 const response=await fetch('https://9ae4a96a-orders-app-branch2.orders-clothes.workers.dev'+path,{method:'GET',redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(20000)})
 const content=(await response.text()).slice(0,280)
 console.log('P0_INACTIVE_PREVIEW_RESPONSE '+JSON.stringify({path,status:response.status,contentType:response.headers.get('content-type'),cfRay:response.headers.get('cf-ray'),bodySample:content}))
}
