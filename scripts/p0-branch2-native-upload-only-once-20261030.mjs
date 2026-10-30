// 2026-10-30: one-shot, Branch2-only CI trigger safety transition.
// Never touches Main, D1, Worker script, versions or deployments.
// PATCH payload contains only "deploy_command" (no other fields).
import assert from 'node:assert/strict'

const ACCOUNT=process.env.CLOUDFLARE_ACCOUNT_ID
const TOKEN=process.env.CLOUDFLARE_API_TOKEN
const WANT='npx wrangler versions upload'
const EXPECTED_WORKER='orders-app-branch2'
const MAIN_WORKER='orders-app'
assert(/^[a-f0-9]{32}$/.test(ACCOUNT||''),'Unexpected account configuration')
assert(TOKEN,'Cloudflare CI token missing')
const base='https://api.cloudflare.com/client/v4/accounts/'+ACCOUNT
const jsonFetch=async(path,method='GET',body)=>{
  assert(method==='GET'||(method==='PATCH'&&
    /^\/builds\/triggers\/[a-f0-9-]{36}$/.test(path) &&
    JSON.stringify(body)===JSON.stringify({deploy_command:WANT})),
    'Refusing request not in exact Branch2 deploy-command-only allowlist')
  assert(method!=='PATCH'||process.env.GITHUB_REF==='refs/heads/safe/p0-d1-readonly-inspection-20261030',
    'Refusing mutation outside isolated inspection branch')
  assert(path==='/workers/scripts'||/^\/builds\/workers\/[a-f0-9-]{8,}\/triggers$/.test(path)||
    /^\/builds\/triggers\/[a-f0-9-]{36}$/.test(path),'Unknown API path')
  const response=await fetch(base+path,{
    method,
    headers:{Authorization:'Bearer '+TOKEN,'Content-Type':'application/json'},
    ...(body?{body:JSON.stringify(body)}:{}),
    signal:AbortSignal.timeout(25000),
  })
  let json;try{json=await response.json()}catch{throw Error('Cloudflare returned non-JSON HTTP '+response.status)}
  if(!response.ok||json.success!==true) {
    // Do not leak response body: may include token or account-level details.
    throw Error('Cloudflare '+method+' request rejected HTTP '+response.status)
  }
  return json.result
}
const workers=await jsonFetch('/workers/scripts')
assert(Array.isArray(workers),'Worker list invalid')
const branch2=workers.filter(x=>x.id===EXPECTED_WORKER)
const main=workers.filter(x=>x.id===MAIN_WORKER)
assert.equal(branch2.length,1,'Branch2 Worker name not unique')
assert.equal(main.length,1,'Main Worker name not unique')
assert(branch2[0].tag!==main[0].tag,'Branch2 and Main tags must differ')
assert(/^[a-f0-9-]{8,}$/.test(branch2[0].tag),'Invalid Worker tag')
const endpoint='/builds/workers/'+branch2[0].tag+'/triggers'
const load=async()=>await jsonFetch(endpoint)
const triggers=await load()
assert(Array.isArray(triggers)&&triggers.length===1,'Refusing ambiguous Branch2 triggers')
const old=triggers[0]
assert(old.external_script_id===branch2[0].tag,'Trigger is not bound to Branch2 Worker')
assert(Array.isArray(old.branch_includes)&&old.branch_includes.length===1&&old.branch_includes[0]==='branch2','Trigger can target other branches')
assert(Array.isArray(old.branch_excludes)&&old.branch_excludes.length===0,'Unexpected excluded branches')
assert(Array.isArray(old.path_includes)&&old.path_includes.length===1&&old.path_includes[0]==='*','Unexpected path rules')
assert(/^[a-f0-9-]{36}$/.test(old.trigger_uuid||''),'Trigger UUID invalid')
assert(old.repo_connection?.repo_name==='Orders-app','Wrong GitHub repository connected')
assert(old.repo_connection?.provider_type==='github','Wrong SCM provider')
assert(old.deleted_on==null,'Trigger is already deleted')
if(old.deploy_command===WANT){
  console.log('P0_BRANCH2_UPLOAD_ONLY_ALREADY_SET — verified existing command; no change')
}else{
  assert(/^(?:npx\s+)?wrangler\s+deploy(?:\s+.*)?$/.test(old.deploy_command||''),'Refusing unknown prior deploy command')
  assert(old.build_command && typeof old.build_command==='string','Build step missing')
  // API PATCH changes only deploy_command. Never send or mutate repo, branches,
  // cache, token, Worker identity, D1, version or deployment.
  await jsonFetch('/builds/triggers/'+old.trigger_uuid,'PATCH',{deploy_command:WANT})
}
const verified=await load()
assert(Array.isArray(verified)&&verified.length===1,'Trigger count drifted')
const current=verified[0]
assert.equal(current.trigger_uuid,old.trigger_uuid)
assert.equal(current.external_script_id,old.external_script_id)
assert.equal(current.deploy_command,WANT)
for(const field of ['build_command','root_directory','build_token_uuid','build_caching_enabled','branch_includes','branch_excludes','path_includes','path_excludes']){
  assert.deepEqual(current[field],old[field],field+' changed unexpectedly')
}
console.log('P0_BRANCH2_NATIVE_UPLOAD_ONLY_VERIFIED '+JSON.stringify({
 worker:EXPECTED_WORKER,branch:'branch2',mode:'version-upload-only',
 oldMode:old.deploy_command===WANT?'version-upload-only':'automatic-deploy',
 changed:old.deploy_command!==WANT,
 mainWorkerUntouched:true,remoteD1Writes:false,workerDeployments:false,
}))
