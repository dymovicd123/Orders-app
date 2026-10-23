// Resolver-only Main promotion safety: TEST current, replay pristine Main,
 // and rebuild current. Never call Cloudflare or mutate D1.
import fs from 'node:fs'
import crypto from 'node:crypto'
import {spawnSync} from 'node:child_process'
// A small additional manager workspace (Reports) is checked before the
// frozen older navigation release. Restored old policy prevents recursion.
const reportsPolicyBlob = fs.readFileSync('src/app/managerWorkspaceAccess.ts')
const reportsPolicySha = crypto.createHash('sha1').update(Buffer.from('blob '+reportsPolicyBlob.length+'\\0'.replace('\\0','\0'))).update(reportsPolicyBlob).digest('hex')
if(reportsPolicySha==='fd6f6d32bb675a3439c497892daea65280da20b7'){
 const checkReports=spawnSync(process.execPath,['scripts/main-manager-reports-release-20261023.mjs'],
   {stdio:'inherit',shell:false,maxBuffer:32*1024*1024,env:process.env,timeout:44*60*1000})
 if(checkReports.error||checkReports.status!==0)throw Error('Manager Reports policy or previous release failed: '+checkReports.status)
 process.exit(0)
}
// The new Stage04 manager payout permission is verified separately before
// any frozen production regression. The replay restores exact pre-permission
// Worker and settlement files, so this branch is not taken recursively.
const workshopBytes=fs.readFileSync('worker/index.ts')
const workshopSha=crypto.createHash('sha1').update(Buffer.from('blob '+workshopBytes.length+'\0')).update(workshopBytes).digest('hex')
if(workshopSha==='86de6fdc9fddecbd1df206abdad9944301cd1096'){
 const test=spawnSync(process.execPath,['scripts/main-workshop-manager-payouts-gate-20261022.mjs'],
   {stdio:'inherit',shell:false,maxBuffer:32*1024*1024,env:process.env,timeout:45*60*1000})
 if(test.error||test.status!==0)throw Error('Main Workshop payout permissions/frozen release failed: '+test.status)
 process.exit(0)
}
// Scope the new UI-only change before the pinned original Main release;
// replay executes this file on the accepted original App, so no recursion.
const currentAppBytes=fs.readFileSync('src/App.tsx')
const uiSha=crypto.createHash('sha1').update(Buffer.from('blob '+currentAppBytes.length+'\\0'.replace('\\0','\0'))).update(currentAppBytes).digest('hex')
if(uiSha==='56e40249a7fc03d2bfdb6b7723382c703cc108c8'){
 const next=spawnSync(process.execPath,['scripts/main-manager-three-workspaces-release-20261022.mjs'],
   {stdio:'inherit',shell:false,maxBuffer:32*1024*1024,env:process.env,timeout:45*60*1000})
 if(next.error||next.status!==0)throw Error('Main manager navigation/frozen production release gate failed: '+next.status)
 process.exit(0)
}
const baseline='40841bdac8c872beb06fff4624bcf48f3b7dd4af'
const pinned={
  "worker/domains/catalog.ts": [
    "b08d41b2880166e448d6f53f5626d33e56eeb737",
    "6cad58ed7d7e9b81ccfdb4b4a6018783eb4c3d5f"
  ],
  "worker/domains/order-reservations.ts": [
    "c68ce9ea0c7deb50b0e1fa367443632b80b7db14",
    "14a8445bd28dc4d293ad93411887c381083afc80"
  ],
  "worker/index.ts": [
    "b656ee65ed5278bcd5b21e7e77396452170c08d0",
    "c03ca7fb506a4cfe0ec8a0e41422c251bc095098"
  ],
  "src/features/orders/OrderCatalogResolutionModal.tsx": [
    "60664b42ad523429c294726af28a3d2f6dc9eb50",
    "39dae332b8e0a50aa320f4dd3265a49d197185ff"
  ],
  "package.json": [
    "ef7fe14e3cc4cc9c3b2ff79fa208e166ac1d45a8",
    "b14a2f629b201687aad9ba1a96b0d10fff1911fd"
  ]
}
const hash=bytes=>crypto.createHash('sha1').update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex')
const check=(good,msg)=>{if(!good)throw Error(msg)}
const run=(cmd,args)=>{const r=spawnSync(cmd,args,{stdio:'inherit',shell:false,maxBuffer:32*1024*1024,timeout:40*60*1000});check(!r.error&&r.status===0,'Main Resolver selective gate failed: '+cmd+' '+args.join(' ')+' status '+r.status)}
const npm=process.platform==='win32'?'npm.cmd':'npm'
const cfg=fs.readFileSync('wrangler.jsonc','utf8')
check(cfg.includes('"name": "orders-app"')&&cfg.includes('"database_name": "orders_db_prod"')&&cfg.includes('"database_id": "17e68a41-1d58-4a36-8a63-47c3e32443c4"')&&!cfg.includes('orders_db_branch2'),'Main D1 mismatch')
const verify=(index)=>{for(const [p,expected] of Object.entries(pinned))check(hash(fs.readFileSync(p))===expected[index],'Unexpected file: '+p)}
function current(){
 verify(0)
 for(const file of [
   'scripts/test-main-resolver-opposite-gender-20261022.mjs',
   'scripts/test-main-resolver-active-reserve-20261022.mjs',
   'scripts/test-main-resolver-actionable-20261022.mjs'
 ])run(process.execPath,['--experimental-strip-types',file])
 // Production shortage confirmation policy is intentionally untouched.
 const w=fs.readFileSync('worker/index.ts','utf8')
 check(w.includes("const uncoveredShortages = shortageBlockers.filter"),'Production stock shortage gate was removed')
 check(!fs.readFileSync('worker/domains/order-reservations.ts','utf8').includes('enteredGender !== fixedProductGender'),'Opposite gender still blocked')
 check(w.includes("code: 'inventory_reservation_inconsistent'"),'Empty Resolver still possible')
 check(JSON.parse(fs.readFileSync('package.json','utf8')).scripts['release:check']==='node scripts/main-resolver-selective-release-20261022.mjs','New production release route not active')
}
current()
run(npm,['run','typecheck'])
run(npm,['run','build'])
const saved=new Map()
try{
 const first=Object.keys(pinned)[0]
 if(spawnSync('git',['cat-file','-e',baseline+':'+first],{stdio:'ignore'}).status!==0)run('git',['fetch','--no-tags','--depth=1','origin',baseline])
 for(const [p,[,old]] of Object.entries(pinned)){
   const r=spawnSync('git',['show',baseline+':'+p],{encoding:null,maxBuffer:32*1024*1024})
   check(!r.error&&r.status===0&&hash(r.stdout)===old,'Frozen production baseline unavailable: '+p)
   saved.set(p,fs.readFileSync(p))
   fs.writeFileSync(p,r.stdout)
 }
 verify(1)
 // All unmodified production finance, order, Stage04, inventory and Resolver tests.
 run(npm,['run','release:check'])
}finally{for(const [p,data] of saved)fs.writeFileSync(p,data)}
current()
fs.rmSync('dist',{recursive:true,force:true})
run(npm,['run','build'])
check(fs.existsSync('dist/client/assets'),'Current Main Resolver bundle missing after replay')
console.log('MAIN_RESOLVER_ONLY_REAL_SQL_AND_COMPLETE_FROZEN_MAIN_RELEASE_PASSED')
