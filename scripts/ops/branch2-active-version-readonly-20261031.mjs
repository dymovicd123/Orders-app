// Authorized GET-only Cloudflare release-state attestation. Never send a mutation.
import assert from 'node:assert/strict'
const name='orders-app-branch2'
const preview='b92e1432-516e-45f2-8dca-db96490fc9e5'
const branch='refs/heads/audit/branch2-active-version-readonly-20261031'
assert.equal(process.env.GITHUB_REF,branch,'Only isolated audit branch is permitted')
const account=process.env.CLOUDFLARE_ACCOUNT_ID
const token=process.env.CLOUDFLARE_API_TOKEN
assert(/^[0-9a-f]{32}$/.test(account||'')&&token,'Expected read-only metadata credentials')
const base='https://api.cloudflare.com/client/v4/accounts/'+account
async function get(path) {
 assert(path==='/workers/scripts'||path==='/workers/scripts/'+name+'/deployments'
   ||path==='/workers/scripts/'+name+'/versions/'+preview
   ||/^\/builds\/workers\/[a-f0-9-]{8,}\/triggers$/.test(path),
   'Not on strict GET allowlist')
 const res=await fetch(base+path,{method:'GET',
  headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(25000)})
 const response=await res.json()
 if(!res.ok||response.success!==true)throw Error('Metadata GET unsuccessful '+res.status+' '+path.split('/').at(-1))
 return response.result
}
const scriptList=await get('/workers/scripts')
const worker=scriptList.find(x=>x.id===name)
assert(worker&&/^[a-f0-9-]{8,}$/.test(worker.tag),'Expected Branch2 Worker tag')
const triggers=await get('/builds/workers/'+worker.tag+'/triggers')
assert(Array.isArray(triggers)&&triggers.length===1,'Branch2 trigger count changed')
assert.deepEqual(triggers[0].branch_includes,['branch2'])
assert.equal(triggers[0].deploy_command,'npx wrangler versions upload','No implicit Branch2 direct deploy allowed')
const uploaded=await get('/workers/scripts/'+name+'/versions/'+preview)
assert.equal(uploaded.id,preview,'Exact uploaded version unavailable')
const record=await get('/workers/scripts/'+name+'/deployments')
const current=(Array.isArray(record)?record:record.deployments)[0]
assert(current?.id,'Missing active deployment')
const versions=(current.versions||[]).map(x=>({id:x.version_id,percentage:x.percentage}))
assert(versions.length>0,'No active traffic assignment')
assert(versions.every(x=>typeof x.id==='string'&&Number.isFinite(x.percentage)))
// Compare public immutable build assets and anonymous API boundaries; GET only.
async function publicSmoke(root,label){
  const htmlResponse=await fetch(root+'/?read-only-version-audit=20261031',{
    method:'GET',redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(20000)})
  assert.equal(htmlResponse.status,200,label+' root GET failed')
  const body=await htmlResponse.text()
  const asset=body.match(/src=["'](\\/assets\\/index-[^"']+\\.js)["']/)?.[1]
  assert(asset,label+' HTML has no app bundle')
  const script=await fetch(root+asset,{method:'GET',signal:AbortSignal.timeout(20000)})
  assert.equal(script.status,200,label+' bundle missing')
  const denied=await fetch(root+'/api/orders?limit=1',{method:'GET',
    redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(20000)})
  assert.equal(denied.status,401,label+' anonymous order read must be denied')
  return {label,bundle:asset,anonymousOrdersStatus:401}
}
const live=await publicSmoke('https://orders-app-branch2.orders-clothes.workers.dev','live')
const previewSmoke=await publicSmoke('https://b92e1432-orders-app-branch2.orders-clothes.workers.dev','preview')
console.log('BRANCH2_READ_ONLY_LIVE_PREVIEW_SMOKE_PASS '+JSON.stringify({
 live,preview:previewSmoke,sameBundle:live.bundle===previewSmoke.bundle,noWrites:true
}))

console.log('BRANCH2_CLOUDFLARE_GET_ONLY_RELEASE_STATE '+JSON.stringify({
 currentDeployment:current.id,
 traffic:versions,
 testedPreviewVersion:preview,
 previewIsFullyLive:versions.length===1&&versions[0].id===preview&&versions[0].percentage===100,
 triggerMode:'upload-only',remoteDbRead:false,remoteDbWrite:false,deploymentPerformed:false
}))
