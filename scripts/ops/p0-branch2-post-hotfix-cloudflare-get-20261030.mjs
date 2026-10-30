import assert from 'node:assert/strict'
const account=process.env.CLOUDFLARE_ACCOUNT_ID
const token=process.env.CLOUDFLARE_API_TOKEN
assert(/^[a-f0-9]{32}$/.test(account||'')&&token,'Cloudflare read-only credentials unavailable')
const base='https://api.cloudflare.com/client/v4/accounts/'+account
const name='orders-app-branch2'
const expectedDeployment='a400a419-de33-4880-ad58-7c93634ce4b0'
const expectedVersion='2781a20c-e430-4bbd-bfd2-47c500056a00'
const mergedSha='91a9c1dde726659cc67ac7c85a72096701bed155'
async function get(path) {
 assert(path==='/workers/scripts'||path==='/workers/scripts/'+name+'/deployments'||
 /^\/builds\/workers\/[0-9a-f-]{8,}\/(triggers|builds)$/.test(path),'GET path must be allowlisted')
 const r=await fetch(base+path,{method:'GET',headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(30000)})
 const j=await r.json()
 if(!r.ok||j.success!==true)throw Error('Read-only Cloudflare GET HTTP '+r.status)
 return j.result
}
const workers=await get('/workers/scripts')
const b=workers.find(x=>x.id===name)
assert(b?.tag,'Branch2 Worker missing')
const trigger=await get('/builds/workers/'+b.tag+'/triggers')
assert.equal(trigger?.length,1)
assert.deepEqual(trigger[0].branch_includes,['branch2'])
assert.equal(trigger[0].deploy_command,'npx wrangler versions upload')
const d=await get('/workers/scripts/'+name+'/deployments')
const list=Array.isArray(d)?d:d?.deployments
assert(list?.length>0,'No Branch2 deployments')
const live=list[0]
assert.equal(live.id,expectedDeployment,'Branch2 active deployment changed')
assert.deepEqual(live.versions?.map(x=>({versionId:x.version_id,percentage:x.percentage})),
 [{versionId:expectedVersion,percentage:100}],'Branch2 served version changed')
const builds=await get('/builds/workers/'+b.tag+'/builds')
const matched=(Array.isArray(builds)?builds:[]).find(x=>x.build_trigger_metadata?.commit_hash===mergedSha&&x.build_trigger_metadata?.branch==='branch2')
console.log('BRANCH2_POST_MERGE_UPLOAD_READ_ONLY '+JSON.stringify({
 mainProductionTouched:false,activeDeployment:live.id,activeVersion:expectedVersion,
 liveUnchanged:true,nativeUploadOnly:true,
 mergedCodeSha:mergedSha,
 newBuild:matched?{status:matched.status,outcome:matched.build_outcome,
 deployCommand:matched.build_trigger_metadata?.deploy_command,createdOn:matched.created_on}:null,
}))
if(!matched||matched.status!=='stopped'||matched.build_outcome!=='success') {
 throw Error('Expected inactive merged-P0 hotfix upload was not confirmed: release requires review')
}
assert.equal(matched.build_trigger_metadata.deploy_command,'npx wrangler versions upload')
console.log('BRANCH2_POST_MERGE_NO_AUTO_DEPLOY_VERIFIED')
