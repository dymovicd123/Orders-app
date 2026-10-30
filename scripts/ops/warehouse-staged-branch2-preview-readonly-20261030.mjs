// Read-only exact Branch2 Worker build and private preview verification.
// GET only: cannot publish versions or mutate D1 or stock.
import assert from 'node:assert/strict'
const account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN
assert(/^[a-f0-9]{32}$/.test(account||'')&&token)
assert.equal(process.env.GITHUB_REF,'refs/heads/audit/branch2-warehouse-barcode-readiness-20261030')
const root='https://api.cloudflare.com/client/v4/accounts/'+account
const expectedSha='3c8b216dba88a1f75d7e6c575a057c0fab5bc6cf'
const oldDeployment='94856c4f-3aa0-46c7-bb12-29729cdc21f9'
async function get(path){
 assert(path==='/workers/scripts'||path==='/workers/scripts/orders-app-branch2/deployments'||
  /^\/builds\/workers\/[a-f0-9-]{8,}\/(triggers|builds)$/.test(path)||
  /^\/builds\/builds\/[a-f0-9-]{36}\/logs$/.test(path),'GET-only path allowlist')
 const r=await fetch(root+path,{method:'GET',headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(30000)})
 const p=await r.json()
 if(!r.ok||p.success!==true)throw Error('Cloudflare GET '+path.split('/').at(-1)+' HTTP '+r.status)
 return p.result
}
const worker=(await get('/workers/scripts')).filter(x=>x.id==='orders-app-branch2')
assert.equal(worker.length,1)
const tr=await get('/builds/workers/'+worker[0].tag+'/triggers')
assert.equal(tr.length,1)
assert.equal(tr[0].deploy_command,'npx wrangler versions upload')
assert.deepEqual(tr[0].branch_includes,['branch2'])
const d=await get('/workers/scripts/orders-app-branch2/deployments')
const active=(Array.isArray(d)?d:d.deployments)[0]
assert.equal(active.id,oldDeployment,'Existing Branch2 traffic changed unexpectedly')
const builds=await get('/builds/workers/'+worker[0].tag+'/builds')
const build=builds.find(b=>b.build_trigger_metadata?.commit_hash===expectedSha && b.build_trigger_metadata?.branch==='branch2')
assert(build,'Merged Branch2 SHA has no Cloudflare native build')
console.log('WAREHOUSE_STAGED_NATIVE_BUILD '+JSON.stringify({sha:expectedSha,status:build.status,outcome:build.build_outcome,deployCommand:build.build_trigger_metadata.deploy_command}))
assert(build.status==='stopped'&&build.build_outcome==='success','Native version upload is not yet successful')
assert.equal(build.build_trigger_metadata.deploy_command,'npx wrangler versions upload')
const logs=await get('/builds/builds/'+build.build_uuid+'/logs')
const lines=(logs.lines||[]).map(v=>Array.isArray(v)?v.join(' '):String(v))
const versions=[...new Set(lines.map(v=>v.match(/(?:Worker Version ID:|Current Version ID:)\s*([a-f0-9-]{36})/i)?.[1]).filter(Boolean))]
assert.equal(versions.length,1,'Cannot unambiguously identify uploaded Worker version')
const preview='https://'+versions[0].slice(0,8)+'-orders-app-branch2.orders-clothes.workers.dev'
for(let i=0;i<2;i++){
 const response=await fetch(preview+'/?warehouse-preview-check='+i,{method:'GET',cache:'no-store',redirect:'manual',signal:AbortSignal.timeout(25000)})
 assert.equal(response.status,200,'Exact new Worker preview root HTTP '+response.status)
 const html=await response.text()
 const asset=html.match(/src=["'](\/assets\/index-[^"']+\.js)["']/)?.[1]
 assert(asset,'Missing built JS asset')
 const js=await fetch(preview+asset,{method:'GET',signal:AbortSignal.timeout(25000)})
 assert.equal(js.status,200,'Built JS missing in preview')
}
const api=await fetch(preview+'/api/orders?limit=1',{method:'GET',redirect:'manual',signal:AbortSignal.timeout(25000)})
assert.equal(api.status,401,'Preview API anonymous access not denied')
console.log('WAREHOUSE_BRANCH2_PREVIEW_ASSETS_AND_AUTH_PASSED '+JSON.stringify({
 sourceSha:expectedSha,versionId:versions[0],preview,unchangedPublicDeployment:active.id,
 uiChecks:2,anonymousOrderApi:401,noD1Writes:true
}))
