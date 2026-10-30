// P0 controlled Branch2 Worker VERSION promotion, never a fresh deploy.
// No D1 SQL writes/migrations, no Main modification. Fails closed on any drift.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync,writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
const account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN
assert(/^[a-f0-9]{32}$/.test(account||'')&&token,'CF credentials unavailable')
assert.equal(process.env.GITHUB_REF,'refs/heads/ops/p0-branch2-controlled-activation-20261030')
const name='orders-app-branch2'
const dbid='0904a573-21ff-44d8-93b0-c9200f771702'
const version='9ae4a96a-9abe-46c3-a3df-b5451461c64d'
const previous='2781a20c-e430-4bbd-bfd2-47c500056a00'
const prevDeployment='a400a419-de33-4880-ad58-7c93634ce4b0'
const sha='91a9c1dde726659cc67ac7c85a72096701bed155'
const base='https://api.cloudflare.com/client/v4/accounts/'+account
async function get(path){
 assert(path==='/workers/scripts' || path==='/workers/scripts/'+name+'/deployments' ||
 path==='/workers/scripts/'+name+'/versions/'+version ||
 path==='/d1/database/'+dbid+'/time_travel/bookmark' ||
 path==='/d1/database/'+dbid ||
 /^\/builds\/workers\/[a-f0-9-]{8,}\/(triggers|builds)$/.test(path))
 const response=await fetch(base+path,{method:'GET',headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(26000)})
 const p=await response.json()
 if(!response.ok||p.success!==true)throw Error('Cloudflare GET HTTP '+response.status)
 return p.result
}
async function current(){
 const p=await get('/workers/scripts/'+name+'/deployments')
 const a=Array.isArray(p)?p:p?.deployments
 assert(a?.length>0,'No active deployments')
 const v=a[0].versions
 assert(v?.length===1 && v[0].percentage===100,'Unexpected traffic split')
 return {deployment:a[0].id,version:v[0].version_id}
}
function deploy(id,message){
 assert([previous,version].includes(id),'Unexpected version ID')
 const args=['wrangler','versions','deploy',id+'@100%','--name',name,'--config','wrangler.jsonc','--yes','--message',message]
 const r=spawnSync('npx',args,{encoding:'utf8',env:process.env,timeout:180000})
 if(r.status!==0||r.error){
  const safeErr=(r.stderr||'').replace(/[A-Za-z0-9_-]{80,}/g,'[redacted]').slice(-1200)
  throw Error('Version promotion failed '+String(r.status??r.error)+' '+safeErr)
 }
 console.log('P0_BRANCH2_VERSION_DEPLOY_COMMAND_ACCEPTED '+JSON.stringify({versionId:id}))
}
async function smoke(){
 const host='https://orders-app-branch2.orders-clothes.workers.dev'
 let entry=null
 for(let pass=0;pass<3;pass++){
  const resp=await fetch(host+'/?p0-lease-hotfix='+pass,{method:'GET',redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(25000)})
  assert.equal(resp.status,200,'Live Branch2 root returned '+resp.status)
  const html=await resp.text()
  const x=html.match(/src=["'](\/assets\/index-[^"']+\.js)["']/)
  assert(x,'Missing bundled frontend')
  if(entry)assert.equal(x[1],entry,'Unstable live frontend entry')
  entry=x[1]
 }
 for(const url of ['/api/orders','/api/orders?limit=1']){
  const r=await fetch(host+url,{method:'GET',redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(25000)})
  assert.equal(r.status,401,'Unauthenticated API is not denied')
 }
 console.log('P0_BRANCH2_POST_PROMOTION_GET_SMOKE_PASSED '+JSON.stringify({entry,passes:3,auth:'401'}))
}
const workers=await get('/workers/scripts')
const target=workers.filter(x=>x.id===name)
assert.equal(target.length,1,'Unexpected Branch2 Worker')
const trigger=await get('/builds/workers/'+target[0].tag+'/triggers')
assert.equal(trigger.length,1)
assert.deepEqual(trigger[0].branch_includes,['branch2'])
assert.equal(trigger[0].deploy_command,'npx wrangler versions upload','Native autopublishing re-enabled')
const workerVersion=await get('/workers/scripts/'+name+'/versions/'+version)
assert.equal(workerVersion.id,version)
const d=await get('/d1/database/'+dbid)
assert.equal(d.name,'orders_db_branch2_mirror_20261027')
const builds=await get('/builds/workers/'+target[0].tag+'/builds')
const b=builds.find(x=>x.build_trigger_metadata?.commit_hash===sha&&x.build_trigger_metadata?.branch==='branch2')
assert(b?.status==='stopped'&&b?.build_outcome==='success')
assert.equal(b.build_trigger_metadata.deploy_command,'npx wrangler versions upload')
const before=await current()
assert.equal(before.deployment,prevDeployment,'Active deployment differs from reviewed baseline')
assert.equal(before.version,previous,'Active version differs from reviewed baseline')
const bookmark=(await get('/d1/database/'+dbid+'/time_travel/bookmark')).bookmark
assert(typeof bookmark==='string'&&bookmark.length>0)
mkdirSync('release-proof',{recursive:true})
writeFileSync('release-proof/branch2-hotfix-promotion-bookmark.json',
 JSON.stringify({d1DatabaseId:dbid,bookmark,reviewedCurrent:before,targetVersion:version,sourceSha:sha},null,2)+'\n',
 {mode:0o600})
console.log('P0_BRANCH2_PROMOTION_PREFLIGHT_PASSED '+JSON.stringify({before,targetVersion:version,
 bookmarkHash:createHash('sha256').update(bookmark).digest('hex').slice(0,16)}))
let switched=false
try {
 deploy(version,'P0 mapped evidence lease guard after 45 regression tests; SHA '+sha)
 const after=await current()
 switched=after.version===version
 assert(switched&&after.deployment!==before.deployment,'Promotion did not change active deployment as expected')
 await smoke()
 console.log('P0_BRANCH2_HOTFIX_PROMOTED_AND_VERIFIED '+JSON.stringify({previous:before,newActive:after,sourceSha:sha,dbWrites:false}))
} catch(error){
 console.error('P0_BRANCH2_PROMOTION_FAILED '+String(error?.message||error))
 try {
  const observed=await current()
  if(observed.version===version) {
   deploy(previous,'Automatic rollback of failed P0 Branch2 hotfix smoke')
   const restored=await current()
   assert.equal(restored.version,previous,'Rollback failed to restore known-good version')
   console.log('P0_BRANCH2_ROLLBACK_CONFIRMED '+JSON.stringify({restoredVersion:restored.version,originalDeployment:before.deployment}))
  }else if(observed.version!==previous) {
   console.error('P0_BRANCH2_UNEXPECTED_ACTIVE_VERSION_AFTER_FAILURE '+observed.version)
  }
 } catch(rollbackError) {
  console.error('P0_BRANCH2_ROLLBACK_NEEDS_MANUAL_REVIEW '+String(rollbackError?.message||rollbackError))
 }
 process.exitCode=1
}
