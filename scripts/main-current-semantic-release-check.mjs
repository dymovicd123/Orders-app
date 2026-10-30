// Current Main CI only. No remote D1 writes, Cloudflare operations or git checkout.
import fs from 'node:fs'
import {spawnSync} from 'node:child_process'
const fail=message=>{throw new Error(message)}
const config=fs.readFileSync('wrangler.jsonc','utf8')
for(const marker of ['"name": "orders-app"','"binding": "DB"','"database_name": "orders_db_prod"','"database_id": "17e68a41-1d58-4a36-8a63-47c3e32443c4"'])
  if(!config.includes(marker))fail('Main Worker/D1 config mismatch: '+marker)
for(const marker of ['orders-app-branch2','orders_db_branch2','40065052-854e-44b8-bcd5-251bdd488301','0904a573-21ff-44d8-93b0-c9200f771702'])
  if(config.includes(marker))fail('Branch2 identity leaked into Main: '+marker)
if((config.match(/"binding"\s*:\s*"DB"/g)||[]).length!==1)fail('Main expects exactly one DB binding')
const groups=[
  ['Main identity and Resolver',[
    'scripts/verify-database-safety.mjs',
    'scripts/test-production-environment.mjs',
    'scripts/test-deployment-workflow-safety-20261030.mjs',
    'scripts/test-main-resolver-opposite-gender-20261022.mjs',
    'scripts/test-main-resolver-active-reserve-20261022.mjs',
    'scripts/test-main-resolver-actionable-20261022.mjs',
  ]],
  ['Order shipment, warehouse and physical stock',[
    'scripts/test-old-order-post-stocktake-handover-r1.mjs',
    'scripts/test-old-order-post-stocktake-guard-r1.mjs',
    'scripts/test-order-shortage-save-nonblocking.mjs',
    'scripts/test-shipping-shortage-nonblocking.mjs',
    'scripts/test-stocktake-functional-acceptance.mjs',
    'scripts/test-w8-warehouse-operation-integrity.mjs',
    'scripts/test-w11-manual-correction-runtime.mjs',
  ]],
  ['Returns, catalog and workshop',[
    'scripts/test-order-delete-mobility.mjs',
    'scripts/test-return-exchange-physical-receipt-r1.mjs',
    'scripts/test-catalog-semantic-sku-identity.mjs',
    'scripts/test-catalog-order-history-preservation-r1.mjs',
    'scripts/test-operational-autonomy-r3-return-exchange-capacity.mjs',
    'scripts/test-manager-workshop-sent-order-actions-r2.mjs',
    'scripts/test-legacy-exchange-product-pick-no-white-screen-20261017.mjs',
    'scripts/test-w7-sku-history-price-readiness.mjs',
    'scripts/test-stage01-money-only-return-shipping-r19b.mjs',
  ]],
]
const errors=[]
const run=(cmd,args)=>{
  const r=spawnSync(cmd,args,{stdio:'inherit',shell:false,env:process.env,timeout:150000})
  if(!r.error&&r.status===0)return true
  console.error('FAILED',cmd,args.join(' '),r.error?.message||r.status)
  return false
}
let checked=0
for(const [group,tests] of groups){
  console.log('\n=== CURRENT MAIN: '+group+' ===')
  for(const file of tests){
    if(!fs.existsSync(file)){errors.push(file+' missing');continue}
    console.log('CHECK '+file)
    if(!run(process.execPath,['--experimental-strip-types',file]))errors.push(file)
    checked++
  }
}
console.log('\n=== CURRENT MAIN: TypeScript + Worker + client build ===')
if(!run(process.platform==='win32'?'npm.cmd':'npm',['run','build']))errors.push('build')
if(!fs.existsSync('dist/client/assets'))errors.push('Build assets missing')
if(errors.length)fail('Current Main gate: '+errors.length+' failures: '+errors.join(', '))
console.log('MAIN_CURRENT_SEMANTIC_RELEASE_PASSED: '+checked+' current regressions and complete build')
