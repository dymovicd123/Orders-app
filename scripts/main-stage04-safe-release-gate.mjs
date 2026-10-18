// Stage04 production backport. Check the *actual* candidate and replay the exact
// original Production release gate against immutable pre-Stage04 files.
// The old assertions are not removed or weakened; after replay, rebuild candidate.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'

const preStage04 = '5910cd2bc632bc8799d0b9c325f4d3f64c92c93b'
const changed = {
  'package.json': ['6704ecffe7139119f982732584bb1b981a6df118','9867683a1a5733244ff70abfd4b8a2881fca94dd'],
  'worker/index.ts': ['b22e62557120aeece3b2ea1916784a9759d450be','c03ca7fb506a4cfe0ec8a0e41422c251bc095098'],
  'src/features/sections/WorkshopSection.tsx': ['d21020d65f3469997a3a579d9233362a026a5336','86a9fcea1a569a6a72f67cf42cea92f75ead5d1d'],
}
const added = {
  'migrations/0083_v72_workshop_settlement_foundation.sql':'d73a92f86317a9068a9a381742d55e5c96804879',
  'migrations/0084_v72_workshop_settlement_status_capture.sql':'2e3f51ab0b055d5b82d6b542cec28cf661359003',
  'migrations/0106_v72_workshop_completion_catalog_cost_snapshot.sql':'b468a734520cfae24341ee6864daae34f0860547',
  'migrations/0107_v72_workshop_settlement_payment_method.sql':'137b974665c7b35464250e87bc2e57baae147142',
  'migrations/0108_v72_workshop_unique_legacy_sku_pricing.sql':'dbe3150c5d97ffad90db9dabd42261baed222d7c',
  'worker/domains/workshop-settlements.ts':'ac745c67e7679d7f7fac7454a625579e1d6c6635',
  'worker/domains/workshop-settlement-prices.ts':'8f850b0540041daf688c48daf37642fe66f8c6ab',
  'src/features/workshop/WorkshopSettlementsPanel.tsx':'0234d727606f5b851c678df014c103ddfd9f8178',
  'src/styles/stage04-workshop-settlements.css':'7c91b20890748ed713048f13bf96c6754680fa96',
}
const blob = b=>createHash('sha1').update(Buffer.from('blob '+b.length+'\0')).update(b).digest('hex')
const sha = f=>blob(fs.readFileSync(f))
function check(ok,msg){if(!ok)throw new Error(msg)}
function run(bin,args,env=process.env){
 const r=spawnSync(bin,args,{stdio:'inherit',shell:false,env,maxBuffer:32*1024*1024})
 check(!r.error&&r.status===0,'Stage04 Production verification failed: '+bin+' '+args.join(' ')+', status '+r.status)
}
if(process.env.MAIN_STAGE04_HISTORICAL_REPLAY==='1'){
  run(process.execPath,['scripts/main-catalog-selective-gate.mjs'])
  process.exit(0)
}
const w=fs.readFileSync('wrangler.jsonc','utf8')
check(w.includes('"name": "orders-app"')&&w.includes('"database_name": "orders_db_prod"')
  &&w.includes('"database_id": "17e68a41-1d58-4a36-8a63-47c3e32443c4"')
  &&!w.includes('orders_db_branch2'), 'Production D1 binding mismatch')
for(const [f,[,current]] of Object.entries(changed))check(sha(f)===current,'Stage04 production candidate drift: '+f)
for(const [f,current] of Object.entries(added))check(sha(f)===current,'Stage04 addition drift: '+f)
const api=fs.readFileSync('worker/index.ts','utf8')
check(api.includes("'/api/workshop/settlements/activate'")&&api.includes('requireAdminUser(authUser'),
  'Stage04 protected activation route missing')
check(!api.includes('orders_db_branch2'),'Branch2 D1 reference in production Worker')
const stage=fs.readFileSync('src/features/workshop/WorkshopSettlementsPanel.tsx','utf8')
check(!stage.includes('Способ выплаты')&&!stage.includes('Kaspi Pay')&&stage.includes('Сохранить долг и включить учёт'),
  'Stage04 user-approved simple payment form was altered')

// Verify new Workshop ledger, frozen cost, status capture and initial launch.
for(const test of [
  'scripts/test-stage04a-workshop-settlements.mjs',
  'scripts/test-stage04b-workshop-status-capture.mjs',
  'scripts/test-stage04b2-workshop-catalog-cost.mjs',
  'scripts/test-stage04b3-unique-legacy-sku-capture.mjs',
  'scripts/test-stage04c-workshop-payments.mjs',
  'scripts/test-stage04d-workshop-settlements.mjs',
  'scripts/test-stage04-opening-cutover-20261018.mjs',
]){
  run(process.execPath,['--experimental-strip-types',test])
}
run(process.platform==='win32'?'npm.cmd':'npm',['run','build'])

// Replay the already approved Production baseline without importing Stage04.
// No data access and no historical source or test is modified permanently.
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'main-stage04-baseline-'))
const prior=new Map(),hidden=[]
try{
 let exists=spawnSync('git',['cat-file','-e',preStage04+':worker/index.ts'],{stdio:'ignore'}).status===0
 if(!exists)run('git',['fetch','--no-tags','--depth=1','origin',preStage04])
 for(const [f,[old,current]] of Object.entries(changed)){
   check(sha(f)===current,'Concurrent runtime edit: '+f)
   const r=spawnSync('git',['show',preStage04+':'+f],{encoding:null,maxBuffer:32*1024*1024})
   check(!r.error&&r.status===0&&blob(r.stdout)===old,'Original production runtime inaccessible: '+f)
   prior.set(f,fs.readFileSync(f));fs.writeFileSync(f,r.stdout)
 }
 for(const f of Object.keys(added)){
   const dst=path.join(dir,f)
   fs.mkdirSync(path.dirname(dst),{recursive:true})
   fs.renameSync(f,dst)
   hidden.push([f,dst])
 }
 run(process.execPath,['scripts/main-catalog-selective-gate.mjs'],
   {...process.env,MAIN_STAGE04_HISTORICAL_REPLAY:'1'})
}finally{
 for(const [f,dst] of hidden.reverse())fs.renameSync(dst,f)
 for(const [f,bytes] of prior)fs.writeFileSync(f,bytes)
 fs.rmSync(dir,{recursive:true,force:true})
}
for(const [f,[,current]] of Object.entries(changed))check(sha(f)===current,'Candidate restore failure: '+f)
for(const [f,current] of Object.entries(added))check(sha(f)===current,'Stage04 restore failure: '+f)
fs.rmSync('dist',{recursive:true,force:true})
run(process.platform==='win32'?'npm.cmd':'npm',['run','build'])
const files=fs.readdirSync('dist/client/assets')
const workshop=files.find(x=>/^WorkshopSection-[A-Za-z0-9_-]+\.js$/.test(x))
check(workshop,'Production Workshop frontend chunk missing')
const built=fs.readFileSync(path.join('dist/client/assets',workshop),'utf8')
for(const mark of ['Расчёты с Цехом','Сохранить долг и включить учёт','Выплатили часть','Выплатили полностью'])
 check(built.includes(mark),'Current Stage04 frontend missing: '+mark)
console.log('MAIN_STAGE04_DORMANT_CUTOVER_AND_UNMODIFIED_HISTORICAL_PRODUCTION_GATE_PASSED')
