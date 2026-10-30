// 2026-10-30 Main CI safety: change only its native production build command
// from auto-publish to version upload, with exact-branch and deployment checks.
// No Worker deploy, no D1 SQL, no Main repo branch writes. Fail closed.
import assert from 'node:assert/strict'

const account=process.env.CLOUDFLARE_ACCOUNT_ID
const token=process.env.CLOUDFLARE_API_TOKEN
assert(/^[0-9a-f]{32}$/.test(account||'') && token,'Cloudflare secrets unavailable')
assert.equal(process.env.GITHUB_REF,'refs/heads/ops/p0-main-native-upload-only-20261030')
const root='https://api.cloudflare.com/client/v4/accounts/'+account
const branchSha='e0dc37a07203d7c0cfb767cac7f9e64e38c33c1a'
const productionWorker='orders-app'
const branch2Worker='orders-app-branch2'
const upload='npx wrangler versions upload'

async function request(path,method='GET',payload){
 assert(path==='/workers/scripts' || path==='/workers/scripts/'+productionWorker+'/deployments' ||
 /^\/builds\/workers\/[0-9a-f-]{8,}\/triggers$/.test(path) ||
 /^\/builds\/triggers\/[0-9a-f-]{36}$/.test(path), 'Cloudflare URL not on allowlist')
 assert(method==='GET' || (method==='PATCH' && /^\/builds\/triggers\/[0-9a-f-]{36}$/.test(path)
     && JSON.stringify(payload)===JSON.stringify({deploy_command:upload})),
     'Only exact deployment-command PATCH allowed')
 const response=await fetch(root+path,{
  method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
  ...(payload?{body:JSON.stringify(payload)}:{}),signal:AbortSignal.timeout(30000)
 })
 const data=await response.json()
 if(!response.ok || data.success!==true) throw Error('Cloudflare '+method+' failed HTTP '+response.status)
 return data.result
}
const github=await fetch('https://api.github.com/repos/dymovicd123/Orders-app/branches/main',{
 headers:{'User-Agent':'Orders-app-p0-native-cd-safe-check','Accept':'application/vnd.github+json'},
 signal:AbortSignal.timeout(20000)
})
assert(github.ok,'Cannot verify current Main SHA')
const current=await github.json()
assert.equal(current.commit?.sha,branchSha,'Main code changed since last reviewed snapshot')

const scripts=await request('/workers/scripts')
assert(Array.isArray(scripts),'Worker listing malformed')
const prod=scripts.filter(x=>x.id===productionWorker)
const test=scripts.filter(x=>x.id===branch2Worker)
assert.equal(prod.length,1)
assert.equal(test.length,1)
assert(prod[0].tag && prod[0].tag!==test[0].tag,'Main and Branch2 tags must differ')
assert(/^[0-9a-f-]{8,}$/.test(prod[0].tag),'Invalid Main Worker tag')

const getActive=async()=>{
 const deployments=await request('/workers/scripts/'+productionWorker+'/deployments')
 const rows=Array.isArray(deployments)?deployments:deployments?.deployments
 assert(rows?.length>0,'Main deployment missing')
 assert(rows[0].id && Array.isArray(rows[0].versions),'Main deployment metadata incomplete')
 return {id:rows[0].id,versions:rows[0].versions.map(v=>({id:v.version_id,percentage:v.percentage}))}
}
const load=async()=>{
 const items=await request('/builds/workers/'+prod[0].tag+'/triggers')
 assert(Array.isArray(items)&&items.length===2,'Expected exactly two Main native build triggers')
 return items
}
const original=await load()
const selected=original.filter(t=>JSON.stringify(t.branch_includes)===JSON.stringify(['main']))
const preview=original.filter(t=>t!==selected[0])
assert.equal(selected.length,1,'Production trigger must be unambiguous')
assert.equal(preview.length,1,'Main preview trigger must be unambiguous')
const target=selected[0]
assert.equal(target.external_script_id,prod[0].tag)
assert.deepEqual(target.branch_excludes,[])
assert.deepEqual(target.path_includes,['*'])
assert(target.repo_connection?.repo_name==='Orders-app'&&target.repo_connection?.provider_type==='github')
assert(target.deleted_on==null,'Cannot modify deleted native build trigger')
assert(/^[0-9a-f-]{36}$/.test(target.trigger_uuid),'Unexpected trigger UUID')
assert(typeof target.build_command==='string' && target.build_command.length>0,'Build command absent')
assert.deepEqual(preview.branch_excludes,['main'])
assert(preview.branch_includes.includes('*'),'Non-main preview trigger changed')
assert.equal(preview.deploy_command,upload,'Main preview trigger unexpectedly publishes')
const liveBefore=await getActive()
assert.equal(liveBefore.versions.length,1,'Main currently uses unexpected version split')
assert.equal(liveBefore.versions[0].percentage,100,'Main must serve one reviewed version')
console.log('P0_MAIN_NATIVE_UPLOAD_ONLY_PRECHECK '+JSON.stringify({
 productionTrigger:target.trigger_uuid,
 oldCommand:target.deploy_command,
 previewCommand:preview.deploy_command,
 liveDeployment:liveBefore.id,
 mainSha:branchSha
}))
if(target.deploy_command!==upload){
 assert(/^(?:npx\s+)?wrangler\s+deploy(?:\s+.*)?$/.test(target.deploy_command||''),
   'Unreviewed previous Main deploy command; refusing PATCH')
 await request('/builds/triggers/'+target.trigger_uuid,'PATCH',{deploy_command:upload})
}
const after=await load()
const updated=after.find(t=>t.trigger_uuid===target.trigger_uuid)
const previewAfter=after.find(t=>t.trigger_uuid===preview[0].trigger_uuid)
assert(updated && previewAfter && after.length===original.length)
assert.equal(updated.deploy_command,upload,'Main is not upload-only')
for(const field of ['external_script_id','branch_includes','branch_excludes','path_includes','path_excludes','build_command','root_directory','build_token_uuid','build_caching_enabled','repo_connection']){
 assert.deepEqual(updated[field],target[field],'Main trigger property changed unexpectedly: '+field)
}
assert.deepEqual(previewAfter,preview[0],'Main preview trigger changed')
const liveAfter=await getActive()
assert.deepEqual(liveAfter,liveBefore,'Active production Main Worker deployment unexpectedly changed')
console.log('P0_MAIN_NATIVE_UPLOAD_ONLY_VERIFIED '+JSON.stringify({
 mainWorker:productionWorker,
 branch:'main',
 nativeMode:'version-upload-only',
 changed:target.deploy_command!==upload,
 productionActiveDeploymentUnchanged:true,
 activeDeployment:liveAfter.id,
 branch2WorkerUntouched:true,
 D1Writes:false,
 workerDeployments:false,
 mainGitBranchUnchanged:true
}))
