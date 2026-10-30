import assert from 'node:assert/strict'
const token=process.env.CLOUDFLARE_API_TOKEN,account=process.env.CLOUDFLARE_ACCOUNT_ID
assert(token&&/^[0-9a-f]{32}$/.test(account||''),'Cloudflare credentials missing')
const base='https://api.cloudflare.com/client/v4/accounts/'+account
const sha='91a9c1dde726659cc67ac7c85a72096701bed155'
async function get(path){
 assert(path==='/workers/scripts'||/^\/builds\/workers\/[a-f0-9-]{8,}\/builds$/.test(path)||/^\/builds\/builds\/[a-f0-9-]{36}\/logs$/.test(path))
 const resp=await fetch(base+path,{method:'GET',headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(25000)})
 const p=await resp.json()
 if(!resp.ok||p.success!==true)throw Error('Cloudflare metadata GET HTTP '+resp.status)
 return p.result
}
const workers=await get('/workers/scripts')
const b=workers.filter(x=>x.id==='orders-app-branch2')
assert.equal(b.length,1)
const builds=await get('/builds/workers/'+b[0].tag+'/builds')
const matches=builds.filter(x=>x.build_trigger_metadata?.commit_hash===sha&&x.build_trigger_metadata?.branch==='branch2')
const target=matches.sort((a,b)=>String(b.created_on).localeCompare(String(a.created_on)))[0]
assert(target?.status==='stopped'&&target?.build_outcome==='success')
assert.equal(target.build_trigger_metadata.deploy_command,'npx wrangler versions upload')
const log=await get('/builds/builds/'+target.build_uuid+'/logs')
const lines=(log.lines||[]).map(x=>Array.isArray(x)?x.join(' '):String(x))
const found=lines.map(x=>x.match(/(?:Worker Version ID:|Current Version ID:)\s*([a-f0-9-]{36})/i)).filter(Boolean).map(x=>x[1])
const URLs=lines.map(x=>x.match(/https:\/\/[a-f0-9]{8}-orders-app-branch2\.orders-clothes\.workers\.dev/)).filter(Boolean).map(x=>x[0])
const unique=[...new Set(found)]
assert.equal(unique.length,1,'Expected exact single uploaded version ID in native build logs')
console.log('P0_BRANCH2_HOTFIX_UPLOAD_VERSION '+JSON.stringify({sha,versionId:unique[0],previewURL:URLs.at(-1)||null,buildUUID:target.build_uuid,buildCreated:target.created_on,buildResult:target.build_outcome}))
