// One-shot Branch2-only version switch for tested warehouse SKU/Arrival fixes.
// Never changes Main, schema, orders, reservations, D1 rows or stock.
import assert from 'node:assert/strict'
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs'
import {spawnSync} from 'node:child_process'
import {createHash} from 'node:crypto'
const account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN
assert(/^[a-f0-9]{32}$/.test(account||'')&&token)
assert.equal(process.env.GITHUB_REF,'refs/heads/audit/branch2-warehouse-barcode-readiness-20261030')
const conf=JSON.parse(readFileSync('wrangler.jsonc','utf8').replace(/\/\*[\s\S]*?\*\//g,''))
assert.equal(conf.name,'orders-app-branch2')
assert.deepEqual(conf.d1_databases?.map(({binding,database_name,database_id})=>({binding,database_name,database_id})),
 [{binding:'DB',database_name:'orders_db_branch2_mirror_20261027',database_id:'0904a573-21ff-44d8-93b0-c9200f771702'}])
const name='orders-app-branch2'
const expectedSha='3c8b216dba88a1f75d7e6c575a057c0fab5bc6cf'
const newVersion='1fa6e7a3-32d4-4f77-b625-e044db46015a'
const oldVersion='9ae4a96a-9abe-46c3-a3df-b5451461c64d'
const oldDeployment='94856c4f-3aa0-46c7-bb12-29729cdc21f9'
const dbid='0904a573-21ff-44d8-93b0-c9200f771702'
const base='https://api.cloudflare.com/client/v4/accounts/'+account
async function get(path){
 assert(path==='/workers/scripts' || path==='/workers/scripts/'+name+'/deployments' ||
 path==='/workers/scripts/'+name+'/versions/'+newVersion ||
 path==='/d1/database/'+dbid+'/time_travel/bookmark'||
 /^\/builds\/workers\/[a-f0-9-]{8,}\/(triggers|builds)$/.test(path),'Cloudflare GET-only preflight path not allowed')
 const r=await fetch(base+path,{method:'GET',headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(30000)})
 const p=await r.json()
 if(!r.ok||p.success!==true)throw Error('Cloudflare GET '+path.split('/').at(-1)+' HTTP '+r.status)
 return p.result
}
async function current(){
 const d=await get('/workers/scripts/'+name+'/deployments')
 const first=(Array.isArray(d)?d:d.deployments)[0]
 assert(first && first.versions?.length===1 && first.versions[0].percentage===100,'Live Worker traffic is split or absent')
 return {deployment:first.id,version:first.versions[0].version_id}
}
async function checkLive(){
 const baseUrl='https://orders-app-branch2.orders-clothes.workers.dev'
 let entry=''
 for(let i=0;i<3;i++){
  const r=await fetch(baseUrl+'/?warehouse-guard-release='+i,{method:'GET',cache:'no-store',redirect:'manual',signal:AbortSignal.timeout(25000)})
  assert.equal(r.status,200,'Branch2 website did not load')
  const html=await r.text()
  const asset=html.match(/src=["'](\/assets\/index-[^"']+\.js)["']/)?.[1]
  assert(asset,'Missing public asset')
  if(entry)assert.equal(entry,asset,'Inconsistent live build')
  entry=asset
  const js=await fetch(baseUrl+entry,{method:'GET',signal:AbortSignal.timeout(25000)})
  assert.equal(js.status,200,'JS file not served')
 }
 const api=await fetch(baseUrl+'/api/orders?limit=1',{method:'GET',cache:'no-store',redirect:'manual',signal:AbortSignal.timeout(25000)})
 assert.equal(api.status,401,'Anonymous orders API not denied')
 console.log('BARCODE_READY_BRANCH2_LIVE_SMOKE_PASSED '+JSON.stringify({passes:3,entry,anonymousApi:401}))
}
function deploy(version,message){
 assert([newVersion,oldVersion].includes(version),'Version not reviewed')
 const args=['wrangler','versions','deploy',version+'@100%','--name',name,'--config','wrangler.jsonc','--yes','--message',message]
 const result=spawnSync('npx',args,{env:process.env,encoding:'utf8',timeout:180000,maxBuffer:6*1024*1024})
 if(result.status!==0||result.error){
  const err=(result.stderr||'').replace(/[A-Za-z0-9_-]{70,}/g,'[redacted]').slice(-600)
  throw Error('Branch2 Worker version switch failed '+String(result.status??result.error)+' '+err)
 }
 console.log('BARCODE_READY_BRANCH2_PINNED_VERSION_DEPLOY_ACCEPTED '+JSON.stringify({version}))
}
const github=await fetch('https://api.github.com/repos/dymovicd123/Orders-app/branches/branch2',{
 headers:{'User-Agent':'orders-app-safe-staged-warehouse-release'},signal:AbortSignal.timeout(20000)})
assert(github.ok)
assert.equal((await github.json()).commit.sha,expectedSha,'Branch2 code SHA changed since tested build')
const workers=(await get('/workers/scripts')).filter(x=>x.id===name)
assert.equal(workers.length,1)
const tr=await get('/builds/workers/'+workers[0].tag+'/triggers')
assert.equal(tr.length,1)
assert.deepEqual(tr[0].branch_includes,['branch2'])
assert.equal(tr[0].deploy_command,'npx wrangler versions upload')
const builds=await get('/builds/workers/'+workers[0].tag+'/builds')
const matched=builds.find(x=>x.build_trigger_metadata?.branch==='branch2' && x.build_trigger_metadata?.commit_hash===expectedSha)
assert(matched?.status==='stopped'&&matched.build_outcome==='success')
assert.equal(matched.build_trigger_metadata.deploy_command,'npx wrangler versions upload')
const version=await get('/workers/scripts/'+name+'/versions/'+newVersion)
assert.equal(version.id,newVersion)
const prior=await current()
assert.deepEqual(prior,{deployment:oldDeployment,version:oldVersion},'Public Branch2 already changed; abort')
const bookmark=(await get('/d1/database/'+dbid+'/time_travel/bookmark')).bookmark
assert(typeof bookmark==='string'&&bookmark.length>0,'D1 Time Travel bookmark unavailable')
mkdirSync('release-proof',{recursive:true})
writeFileSync('release-proof/branch2-warehouse-identity-rollback-bookmark.json',JSON.stringify({
 branch:'branch2',sourceSha:expectedSha,databaseId:dbid,bookmark,prior,targetVersion:newVersion},null,2)+'\n',{mode:0o600})
console.log('BARCODE_READY_BRANCH2_PRE_PROMOTION_SAFE '+JSON.stringify({active:prior,sourceSha:expectedSha,
 bookmarkHash:createHash('sha256').update(bookmark).digest('hex').slice(0,18)}))
try{
 deploy(newVersion,'Branch2 SKU identity and Arrival validation after 48 release regressions')
 const now=await current()
 assert(now.version===newVersion && now.deployment!==oldDeployment,'Pinned version not active after promotion')
 await checkLive()
 console.log('BARCODE_READY_BRANCH2_RELEASE_VERIFIED '+JSON.stringify({sourceSha:expectedSha,activeDeployment:now.deployment,activeVersion:newVersion,previousVersion:oldVersion,d1Writes:false}))
}catch(error){
 console.error('BARCODE_READY_BRANCH2_RELEASE_FAILED '+String(error?.message||error))
 try{
  const now=await current()
  if(now.version===newVersion){
   deploy(oldVersion,'Rollback failed Branch2 SKU guard release')
   const restored=await current()
   assert.equal(restored.version,oldVersion,'Rollback did not restore previous version')
   console.log('BARCODE_READY_BRANCH2_ROLLBACK_VERIFIED '+restored.version)
  }else if(now.version!==oldVersion){
   console.error('BARCODE_READY_BRANCH2_UNKNOWN_VERSION_REQUIRES_MANUAL_REVIEW '+now.version)
  }
 }catch(e){console.error('BARCODE_READY_BRANCH2_ROLLBACK_FAILED '+String(e?.message||e))}
 process.exitCode=1
}
