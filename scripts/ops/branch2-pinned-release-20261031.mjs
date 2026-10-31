// One-shot controlled activation of fully tested Branch2 version only.
// Never deploy Main and never mutate D1. Abort on any unexpected state.
import assert from 'node:assert/strict'
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs'
import {spawnSync} from 'node:child_process'
import {createHash} from 'node:crypto'
const expectedRef='refs/heads/ops/branch2-release-catalog-attention-20261031'
const expectedSha='81ebdd8f2533e891d8f3f899813d4751bb0e51be'
const version='67128ad2-b86a-43dc-80f7-8e7332d8657f'
const previousVersion='23b5f04d-9340-4a0c-af53-4968527f821f'
const previousDeployment='037e7375-70e8-4ff9-b8d9-daef3d082f01'
const dbId='0904a573-21ff-44d8-93b0-c9200f771702'
const name='orders-app-branch2'
assert.equal(process.env.GITHUB_REF,expectedRef,'Not an approved isolated release ref')
assert.equal(process.env.GITHUB_SHA,process.env.EXPECTED_RELEASE_COMMIT_SHA,'Release workflow must bind exact one-shot commit')
const account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN
assert(/^[0-9a-f]{32}$/.test(account||'')&&token,'Missing Cloudflare release credentials')
const conf=JSON.parse(readFileSync('wrangler.jsonc','utf8').replace(/\/\*[\s\S]*?\*\//g,''))
assert.equal(conf.name,name)
assert.deepEqual(conf.d1_databases?.map(x=>({binding:x.binding,database_name:x.database_name,database_id:x.database_id})),[
 {binding:'DB',database_name:'orders_db_branch2_mirror_20261027',database_id:dbId}
])
const root='https://api.cloudflare.com/client/v4/accounts/'+account
async function get(path){
 assert(path==='/workers/scripts'||path==='/workers/scripts/'+name+'/deployments'||
 path==='/workers/scripts/'+name+'/versions'||path==='/workers/scripts/'+name+'/versions/'+version||
 path==='/d1/database/'+dbId+'/time_travel/bookmark'||
 /^\/builds\/workers\/[a-f0-9-]{8,}\/(triggers|builds)$/.test(path),'Unknown Cloudflare GET')
 const r=await fetch(root+path,{method:'GET',headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(30000)})
 const p=await r.json()
 if(!r.ok||p.success!==true)throw Error('Cloudflare '+path.split('/').at(-1)+' HTTP '+r.status)
 return p.result
}
async function active(){
 const d=await get('/workers/scripts/'+name+'/deployments')
 const row=(Array.isArray(d)?d:d.deployments)[0]
 assert(row && row.versions?.length===1 && row.versions[0].percentage===100,'Traffic split/unexpected deployment')
 return {deployment:row.id,version:row.versions[0].version_id}
}
const liveUrl='https://orders-app-branch2.orders-clothes.workers.dev'
const previewUrl='https://67128ad2-orders-app-branch2.orders-clothes.workers.dev'
async function inspect(host){
 let asset=null
 for(let i=0;i<3;i++){
  const r=await fetch(host+'/?release-stable='+i,{method:'GET',cache:'no-store',signal:AbortSignal.timeout(25000)})
  assert.equal(r.status,200,'Site '+host+' HTTP '+r.status)
  const html=await r.text()
  const js=html.match(/src=["'](\/assets\/index-[^"']+\.js)["']/)?.[1]
  assert(js)
  if(asset)assert.equal(js,asset,'Unstable frontend entry')
  asset=js
  const bundle=await fetch(host+asset,{method:'GET',cache:'no-store',signal:AbortSignal.timeout(25000)})
  assert.equal(bundle.status,200)
  const text=await bundle.text()
  assert(text.includes('Заказ можно сохранить без подтверждения физического наличия'),'New nonblocking order flow missing')
  assert(!text.includes('Подтвердить резерв при нехватке — товар физически есть'),'Old confirmation still present')
 }
 for(const path of ['/api/orders?limit=1','/api/inventory?source=warehouse']){
  const r=await fetch(host+path,{method:'GET',cache:'no-store',signal:AbortSignal.timeout(25000)})
  assert.equal(r.status,401,'Anonymous access regression at '+path)
 }
 return asset
}
function deploy(target,message){
 assert([version,previousVersion].includes(target),'Unexpected target release')
 const result=spawnSync('npx',['wrangler','versions','deploy',target+'@100%','--name',name,
 '--config','wrangler.jsonc','--yes','--message',message],
 {env:process.env,encoding:'utf8',timeout:180000,maxBuffer:5*1024*1024})
 if(result.error||result.status!==0){
  const safe=(result.stderr||'').replace(/[A-Za-z0-9_-]{70,}/g,'[redacted]').slice(-700)
  throw Error('Cloudflare version deploy failed '+String(result.status||result.error)+' '+safe)
 }
 console.log('PINNED_BRANCH2_DEPLOY_ACCEPTED '+target)
}
const gh=await fetch('https://api.github.com/repos/dymovicd123/Orders-app/branches/branch2',{
 headers:{'User-Agent':'branch2-safe-release-20261031'},signal:AbortSignal.timeout(25000)})
assert.equal(gh.status,200)
assert.equal((await gh.json()).commit.sha,expectedSha,'Branch2 advanced since candidate verified')
const workers=(await get('/workers/scripts')).filter(x=>x.id===name)
assert.equal(workers.length,1)
const t=await get('/builds/workers/'+workers[0].tag+'/triggers')
assert.equal(t.length,1)
assert.deepEqual(t[0].branch_includes,['branch2'])
assert.equal(t[0].deploy_command,'npx wrangler versions upload')
const builds=await get('/builds/workers/'+workers[0].tag+'/builds')
const related=(Array.isArray(builds)?builds:builds.builds||[]).filter(x=>x.build_trigger_metadata?.branch==='branch2')
assert.equal(related[0]?.build_trigger_metadata?.commit_hash,expectedSha)
assert.equal(related[0]?.build_outcome,'success')
assert.equal(related[0]?.build_trigger_metadata?.deploy_command,'npx wrangler versions upload')
const versions=await get('/workers/scripts/'+name+'/versions')
const currentVersions=(Array.isArray(versions)?versions:versions.items||versions.versions||[])
assert.equal(currentVersions[0].id,version,'Newer unreviewed Worker version uploaded')
const v=await get('/workers/scripts/'+name+'/versions/'+version)
assert.equal(v.id,version)
assert.equal(v.metadata?.has_preview,true)
const before=await active()
assert.deepEqual(before,{version:previousVersion,deployment:previousDeployment},'Active Worker drift, refusing deployment')
const pinnedAsset=await inspect(previewUrl)
const bookmark=(await get('/d1/database/'+dbId+'/time_travel/bookmark')).bookmark
assert(typeof bookmark==='string'&&bookmark.length>5,'Missing safe D1 Time Travel bookmark')
mkdirSync('release-proof',{recursive:true})
writeFileSync('release-proof/branch2-20261031-before-switch.json',JSON.stringify({
 sourceSha:expectedSha,target:version,previous:before,databaseId:dbId,bookmark,
 createdAt:new Date().toISOString()},null,2)+'\n',{mode:0o600})
console.log('BRANCH2_RELEASE_PREFLIGHT_PASS '+JSON.stringify({sourceSha:expectedSha,
 previous:before,target:version,pinnedAsset,bookmarkHash:createHash('sha256').update(bookmark).digest('hex').slice(0,16)}))
try{
 deploy(version,'Branch2 only: display older active unresolved catalogue reservations')
 const after=await active()
 assert.equal(after.version,version,'Live version changed to unexpected target')
 assert.notEqual(after.deployment,previousDeployment,'No new deployment created')
 let liveAsset=null
 let lastLiveError=''
 for(let attempt=1;attempt<=12;attempt++){
  try{
   const observed=await active()
   assert.equal(observed.version,version,'Active Worker drift while waiting for public propagation')
   liveAsset=await inspect(liveUrl)
   assert.equal(liveAsset,pinnedAsset,'Live asset does not match pinned immutable candidate')
   break
  }catch(error){
   lastLiveError=String(error?.message||error)
   if(attempt===12)throw Error('Active-version UI failed after bounded propagation checks: '+lastLiveError)
   await new Promise(resolve=>setTimeout(resolve,2000))
  }
 }
 console.log('BRANCH2_RELEASE_20261031_SUCCESS '+JSON.stringify({
  sourceSha:expectedSha,activeDeployment:after.deployment,activeVersion:after.version,
  previousVersion,asset:liveAsset,anonymousApi:401,physicalStockWrites:0,d1Writes:0,mainWrites:0}))
}catch(error){
 console.error('BRANCH2_RELEASE_20261031_ERROR '+String(error?.message||error))
 try{
  const now=await active()
  if(now.version===version){
   deploy(previousVersion,'Rollback Branch2 failed warehouse/order release')
   const restored=await active()
   assert.equal(restored.version,previousVersion,'Rollback failed')
   console.log('BRANCH2_RELEASE_20261031_ROLLBACK_VERIFIED '+restored.version)
  }else if(now.version!==previousVersion)console.error('BRANCH2_UNKNOWN_ACTIVE_VERSION '+now.version)
 }catch(e){console.error('BRANCH2_ROLLBACK_NEEDS_MANUAL_HELP '+String(e?.message||e))}
 process.exitCode=1
}
