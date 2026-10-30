// Branch2 post-merge GET-only attestation. Never reads D1 or publishes.
import assert from 'node:assert/strict'
const token=process.env.CLOUDFLARE_API_TOKEN
const account=process.env.CLOUDFLARE_ACCOUNT_ID
assert(token&&/^[a-f0-9]{32}$/.test(account||''),'Cloudflare GET credentials unavailable')
const base='https://api.cloudflare.com/client/v4/accounts/'+account
const sha='e75604432ed11729129e811afda3ee879496a268'
const mergeAt=Date.parse('2026-10-30T16:36:38Z')
async function get(path){
  assert(path==='/workers/scripts'||path==='/workers/scripts/orders-app-branch2/deployments'||
    /^\/builds\/workers\/[a-f0-9-]{8,}\/(triggers|builds)$/.test(path),'Unknown API path')
  const res=await fetch(base+path,{method:'GET',headers:{Authorization:'Bearer '+token},
    signal:AbortSignal.timeout(25000)})
  const j=await res.json()
  if(!res.ok||j.success===false)throw Error('Cloudflare GET failed HTTP '+res.status)
  return j.result
}
const workers=await get('/workers/scripts')
const target=workers.find(x=>x.id==='orders-app-branch2')
assert(target&&/^[a-f0-9-]{8,}$/.test(target.tag))
const triggers=await get('/builds/workers/'+target.tag+'/triggers')
assert(triggers.length===1)
assert.deepEqual(triggers[0].branch_includes,['branch2'])
assert.equal(triggers[0].deploy_command,'npx wrangler versions upload')
console.log('P0_BRANCH2_NATIVE_TRIGGER_STILL_UPLOAD_ONLY')
const builds=await get('/builds/workers/'+target.tag+'/builds')
const match=(Array.isArray(builds)?builds:[]).filter(b=>b.build_trigger_metadata?.commit_hash===sha &&
 b.build_trigger_metadata?.branch==='branch2').sort((a,b)=>String(b.created_on).localeCompare(String(a.created_on)))[0]
console.log('P0_BRANCH2_MERGED_BUILD '+JSON.stringify(match?{
 status:match.status,outcome:match.build_outcome||null,
 deployCommand:match.build_trigger_metadata?.deploy_command||null,
 createdOn:match.created_on,
}:{observed:false,reason:'Native build not yet present in first result page'}))
const result=await get('/workers/scripts/orders-app-branch2/deployments')
const deployments=Array.isArray(result)?result:
  (Array.isArray(result?.deployments)?result.deployments:[])
assert(deployments.length>0,'No active deployment metadata')
const latest=deployments[0]
assert(latest.id && Date.parse(latest.created_on)>0,'Invalid deployment metadata')
const afterMerge=Date.parse(latest.created_on)>mergeAt
console.log('P0_BRANCH2_ACTIVE_DEPLOYMENT '+JSON.stringify({
 activeDeploymentId:latest.id,createdOn:latest.created_on,
 versions:(latest.versions||[]).map(v=>({versionId:v.version_id,percentage:v.percentage})),
 afterMerge,
}))
assert(!afterMerge,'Branch2 active Worker deployment changed after safety merge; investigate')
console.log('P0_BRANCH2_NO_AUTO_DEPLOY_VERIFIED — Branch2 upload-only, live deployment older than safety merge')
