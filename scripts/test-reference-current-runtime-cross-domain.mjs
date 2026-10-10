// Acceptance audit ON CURRENT BRANCH2 RUNTIME (not on the frozen Stage04 fixture).
// New references work must not break adjacent operational workflows.
// This runner performs no production writes and does not need Cloudflare credentials.
import {spawnSync} from 'node:child_process'
const tests=[
 ['orders:create/edit payment','scripts/test-order-edit-payment-method-correction.mjs'],
 ['orders:manager editing','scripts/test-order-edit-autonomy.mjs'],
 ['orders:deletion','scripts/test-order-delete-mobility.mjs'],
 ['orders:shortage save','scripts/test-order-shortage-save-nonblocking.mjs'],
 ['orders:merged source recovery','scripts/test-catalog-stale-order-merge-bridge.mjs'],
 ['arrivals:retired catalog','scripts/test-arrival-materialization-reliability.mjs'],
 ['arrivals:merged SKU','scripts/test-arrival-merged-sku-safety.mjs'],
 ['arrivals:save and post-commit','scripts/test-arrival-save-reliability.mjs'],
 ['exchanges:many-to-many','scripts/test-exchange-set-v2.mjs'],
 ['exchanges:unissued goods','scripts/test-exchange-not-issued-r1.mjs'],
 ['exchanges:itemized pricing','scripts/test-stage03-h9c-itemized-multi-exchange.mjs'],
 ['returns:physical receipt','scripts/test-return-exchange-physical-receipt-r1.mjs'],
 ['returns:cancel and rollback','scripts/test-return-exchange-cancel-autonomy.mjs'],
 ['stocktake:full SQL lifecycle','scripts/test-stocktake-functional-acceptance.mjs'],
 ['stock:writeoff and reserve','scripts/test-inventory-writeoff-review.mjs'],
 ['workshop:order and invoice','scripts/test-workshop-ui-r1.mjs'],
 ['kaspi:separated order/finance','scripts/test-kaspi-order-separation-r1.mjs'],
 ['finance:daily accounting','scripts/test-finance-day-transparency.mjs'],
 ['finance:release audit','scripts/test-finance-f6-release-audit.mjs'],
 ['stage04:capture must stay off','scripts/test-stage04b-workshop-status-capture.mjs'],
]
const failures=[]
for(const [area,file] of tests){
 const result=spawnSync(process.execPath,['--experimental-strip-types',file],{
  cwd:process.cwd(),encoding:'utf8',timeout:60000,env:{...process.env,REFERENCE_CROSS_DOMAIN_READONLY:'1'},
 })
 if(result.status===0&&!result.error){
  process.stdout.write('PASS '+area+' | '+file+'\n')
 }else{
  const desc=[result.error?.message,result.stderr,result.stdout].filter(Boolean).join('\n')
  process.stderr.write('FAIL '+area+' | '+file+'\n'+desc.slice(-5000)+'\n')
  failures.push({area,file,status:result.status,error:desc.slice(-600)})
 }
}
console.log('ACTIVE BRANCH2 CROSS-DOMAIN AUDIT: '+(tests.length-failures.length)+'/'+tests.length+' passed')
if(failures.length){console.error('Failed checks:',JSON.stringify(failures,null,2));process.exitCode=1}
