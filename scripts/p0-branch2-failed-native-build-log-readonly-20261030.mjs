// One-shot GET-only inspection of Branch2 native upload failure for exact commit.
import assert from 'node:assert/strict'
const account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN
assert(token&&/^[a-f0-9]{32}$/.test(account||''))
const base='https://api.cloudflare.com/client/v4/accounts/'+account
async function get(path){
  assert(path==='/workers/scripts'||/^\/builds\/workers\/[a-f0-9-]{8,}\/builds$/.test(path)||/^\/builds\/builds\/[a-f0-9-]{36}\/logs$/.test(path))
  const response=await fetch(base+path,{method:'GET',headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(25000)})
  const json=await response.json()
  if(!response.ok||json.success===false)throw Error('Read only Cloudflare metadata HTTP '+response.status)
  return json.result
}
const workers=await get('/workers/scripts')
const tag=workers.find(x=>x.id==='orders-app-branch2')?.tag
assert(/^[a-f0-9-]{8,}$/.test(tag||''))
const rows=await get('/builds/workers/'+tag+'/builds')
const build=rows.filter(r=>r.build_trigger_metadata?.branch==='branch2'&&
 r.build_trigger_metadata?.commit_hash==='e75604432ed11729129e811afda3ee879496a268')
 .sort((a,b)=>b.created_on.localeCompare(a.created_on))[0]
assert(build?.build_uuid,'Exact Branch2 build missing')
const data=await get('/builds/builds/'+build.build_uuid+'/logs')
const all=(data.lines||[]).map(x=>Array.isArray(x)?x.join(' '):String(x))
const candidates=all.filter(x=>/error|fail|token|permission|npm|wrangler|upload/i.test(x)).slice(-22)
const clean=candidates.map(x=>x.replace(/[A-Za-z0-9_-]{60,}/g,'[redacted-long-token]').slice(0,280))
console.log('P0_BRANCH2_NATIVE_BUILD_FAILURE '+JSON.stringify({
 status:build.status,outcome:build.build_outcome,lines:clean
}))
