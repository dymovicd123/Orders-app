// Exact read-only release preflight for Branch2; no SQL writes, deploys or triggers.
import assert from 'node:assert/strict'
import {writeFileSync, mkdirSync} from 'node:fs'
import {createHash} from 'node:crypto'
const account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN
assert(/^[a-f0-9]{32}$/.test(account||'')&&token,'CF secrets unavailable')
const worker='orders-app-branch2'
const dbid='0904a573-21ff-44d8-93b0-c9200f771702'
const expectedActive='a400a419-de33-4880-ad58-7c93634ce4b0'
const candidate='56d81b89-4929-44c6-b5f8-b2b55a5610b5'
const mergedSha='459cfe0fdb552e20dc76392265067dd82688b655'
const base='https://api.cloudflare.com/client/v4/accounts/'+account
async function get(path) {
 const allowed=path==='/workers/scripts' ||
 path==='/workers/scripts/'+worker+'/deployments' ||
 path==='/workers/scripts/'+worker+'/versions/'+candidate ||
 path==='/d1/database/'+dbid ||
 path==='/d1/database/'+dbid+'/time_travel/bookmark' ||
 /^\/builds\/workers\/[a-f0-9-]{8,}\/(builds|triggers)$/.test(path)
 assert(allowed,'Unknown target/path')
 const response=await fetch(base+path,{method:'GET',headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(25000)})
 const j=await response.json()
 if(!response.ok||j.success!==true)throw Error('Read-only Cloudflare GET HTTP '+response.status+' endpoint='+path.split('/').at(-1))
 return j.result
}
const workers=await get('/workers/scripts')
const target=workers.filter(x=>x.id===worker)
assert.equal(target.length,1,'Wrong/missing Branch2 Worker')
assert(/^[a-f0-9-]{8,}$/.test(target[0].tag))
const native=await get('/builds/workers/'+target[0].tag+'/triggers')
assert(Array.isArray(native)&&native.length===1,'Ambiguous Branch2 build triggers')
assert.deepEqual(native[0].branch_includes,['branch2'])
assert.equal(native[0].deploy_command,'npx wrangler versions upload','Branch2 must remain upload-only')
const deployments=await get('/workers/scripts/'+worker+'/deployments')
const latest=Array.isArray(deployments)?deployments:deployments?.deployments
assert(latest?.length>0,'No active Branch2 deployment')
const activeDeploymentDrift=latest[0].id!==expectedActive
assert(!activeDeploymentDrift,'Active deployment changed again after emergency safeguards')
assert.deepEqual(latest[0].versions?.map(v=>({id:v.version_id,percentage:v.percentage})),[{id:'2781a20c-e430-4bbd-bfd2-47c500056a00',percentage:100}],'Active version unexpectedly changed')
console.log('P0_BRANCH2_DEPLOYMENT_HISTORY '+JSON.stringify(latest.slice(0,6).map(x=>({
 id:x.id,createdOn:x.created_on,source:x.source,
 versions:(x.versions||[]).map(v=>({versionId:v.version_id,percentage:v.percentage}))
}))))
if(activeDeploymentDrift) console.log('P0_BRANCH2_UNEXPECTED_ACTIVE_DEPLOYMENT — promotion blocked pending review')
const version=await get('/workers/scripts/'+worker+'/versions/'+candidate)
assert.equal(version?.id,candidate,'Candidate Worker version missing')
const d1=await get('/d1/database/'+dbid)
assert.equal(d1?.name,'orders_db_branch2_mirror_20261027','Incorrect D1 database')
const bookmarkResult=await get('/d1/database/'+dbid+'/time_travel/bookmark')
assert(typeof bookmarkResult?.bookmark==='string'&&bookmarkResult.bookmark.length>0,'D1 bookmark unavailable')
const builds=await get('/builds/workers/'+target[0].tag+'/builds')
const exact=(Array.isArray(builds)?builds:[]).filter(x=>x.build_trigger_metadata?.branch==='branch2'&&x.build_trigger_metadata?.commit_hash===mergedSha).sort((a,b)=>String(b.created_on).localeCompare(String(a.created_on)))[0]
const aggregate={
 currentActiveDeployment:latest[0].id,
 currentActiveVersion:latest[0].versions[0].version_id,
 activeDeploymentDrift,
 candidate,
 candidateExists:true,
 worker,
 d1Name:d1.name,
 branch2NativeUploadOnly:true,
 bookmarkSha256:createHash('sha256').update(bookmarkResult.bookmark).digest('hex').slice(0,20),
 nativeMergedBuild:exact?{status:exact.status,outcome:exact.build_outcome,deployCommand:exact.build_trigger_metadata?.deploy_command}:null,
 asOf:new Date().toISOString()
}
mkdirSync('release-proof',{recursive:true})
writeFileSync('release-proof/branch2-before-p0.json',JSON.stringify({
 ...aggregate, bookmark:bookmarkResult.bookmark,dbId:dbid
},null,2)+'\n',{mode:0o600})
console.log('P0_BRANCH2_FORENSIC_READONLY_COMPLETED '+JSON.stringify(aggregate))
console.log('P0_BRANCH2_D1_BOOKMARK_CAPTURED_FOR_REVIEW — No D1 writes made')
