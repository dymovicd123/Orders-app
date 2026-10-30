// Read only: inspect Cloudflare native build trigger settings for exactly two Workers.
// Only GET requests; never log tokens, trigger environment variables or raw response bodies.
import assert from 'node:assert/strict'

const names=['orders-app','orders-app-branch2']
const account=process.env.CLOUDFLARE_ACCOUNT_ID
const token=process.env.CLOUDFLARE_API_TOKEN
assert(account && /^[a-f0-9]{32}$/.test(account),'Cloudflare account ID not configured')
assert(token,'Cloudflare token not configured')
const base='https://api.cloudflare.com/client/v4/accounts/'+account

async function read(path){
  assert(path==='/workers/scripts' || /^\/builds\/workers\/[a-f0-9-]{8,}\/triggers$/.test(path),
    'Only approved build metadata GET endpoints')
  const response=await fetch(base+path,{
    method:'GET',headers:{Authorization:'Bearer '+token},
    signal:AbortSignal.timeout(25000),
  })
  const json=await response.json()
  if(!response.ok||json.success===false){
    throw new Error('Cloudflare build metadata GET unavailable HTTP '+response.status+
      ' endpoint '+(path==='/workers/scripts'?'worker-list':'triggers'))
  }
  return json.result
}

const workers=await read('/workers/scripts')
assert(Array.isArray(workers),'Unexpected Worker list metadata')
for(const name of names){
  const found=workers.find(x=>x.id===name)
  assert(found && typeof found.tag==='string' && /^[a-f0-9-]{8,}$/.test(found.tag),
    'Worker tag not available: '+name)
  const result=await read('/builds/workers/'+found.tag+'/triggers')
  const triggers=Array.isArray(result)?result:
    Array.isArray(result?.triggers)?result.triggers:[]
  const sanitized=triggers.map(t=>{
    const v=t?.config&&typeof t.config==='object'?t.config:t
    const mode=(String(v?.deploy_command||'').includes('wrangler deploy'))?'deploy':
      (String(v?.deploy_command||'').includes('versions upload'))?'version-upload':
      v?.deploy_command?'other':'unset'
    return {
      triggerName:t.trigger_name??null,
      kind:t.type??t.trigger_type??null,
      enabled:t.enabled??null,
      branchIncludes:v?.branch_includes??null,
      branchExcludes:v?.branch_excludes??null,
      pathIncludes:v?.path_includes??null,
      pathExcludes:v?.path_excludes??null,
      deployMode:mode,
      hasBuildCommand:Boolean(v?.build_command),
      fields:Object.keys(t||{}).sort().filter(k=>!/token|environment|secret/i.test(k)),
    }
  })
  console.log('P0_CF_READ_ONLY_BUILD_TRIGGERS '+JSON.stringify({worker:name,count:triggers.length,triggers:sanitized}))
}
console.log('P0_CF_BUILD_METADATA_READ_ONLY_COMPLETE — no mutation or deploy')
