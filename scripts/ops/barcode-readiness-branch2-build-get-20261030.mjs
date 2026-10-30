// Branch2-only, GET-only Cloudflare deployment identity and Build status.
import assert from 'node:assert/strict'
const account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN
assert(/^[0-9a-f]{32}$/.test(account||'') && token,'Cloudflare read token unavailable')
assert.equal(process.env.GITHUB_REF,'refs/heads/audit/branch2-warehouse-barcode-readiness-20261030')
const base='https://api.cloudflare.com/client/v4/accounts/'+account
async function get(path) {
 assert(path==='/workers/scripts'||
 path==='/workers/scripts/orders-app-branch2/deployments'||
 /^\/builds\/workers\/[a-f0-9-]{8,}\/(triggers|builds)$/.test(path),'No other Cloudflare paths')
 const response=await fetch(base+path,{method:'GET',headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(30000)})
 const p=await response.json()
 if(!response.ok||p.success!==true)throw Error('Cloudflare GET '+path.split('/').at(-1)+' HTTP '+response.status)
 return p.result
}
const workers=await get('/workers/scripts')
const branch=workers.filter(x=>x.id==='orders-app-branch2')
assert.equal(branch.length,1,'Branch2 Worker not unique')
const tr=await get('/builds/workers/'+branch[0].tag+'/triggers')
assert.equal(tr.length,1,'Native build trigger changed')
assert.deepEqual(tr[0].branch_includes,['branch2'])
assert.equal(tr[0].deploy_command,'npx wrangler versions upload')
const d=await get('/workers/scripts/orders-app-branch2/deployments')
const row=Array.isArray(d)?d[0]:d.deployments[0]
assert(row?.versions?.length>0)
const builds=await get('/builds/workers/'+branch[0].tag+'/builds')
const wanted='0d772f4a9820a64f1e60d829b09a20e78b0132c1'
const fresh=builds.find(x=>x.build_trigger_metadata?.branch==='branch2'&&x.build_trigger_metadata?.commit_hash===wanted)
console.log('BARCODE_READINESS_BRANCH2_DEPLOY_STATE '+JSON.stringify({
 activeDeployment:row.id,activeVersion:row.versions.map(v=>({id:v.version_id,percent:v.percentage})),
 nativeUploadOnly:tr[0].deploy_command,
 lastSourceSha:wanted,
 lastBuild:fresh?{status:fresh.status,outcome:fresh.build_outcome,created:fresh.created_on,command:fresh.build_trigger_metadata?.deploy_command}:null
}))
assert(fresh,'Latest branch2 merge not yet listed in Cloudflare builds')
console.log('BARCODE_READINESS_BRANCH2_GET_ONLY_PASSED')
