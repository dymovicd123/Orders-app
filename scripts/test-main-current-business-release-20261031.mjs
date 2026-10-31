// Current Main business regression gate: real SQL/HTTP and intent-based tests only.
// No byte-pinned historical release diff, no writes to Cloudflare, no moving Main assets.
import {spawnSync} from 'node:child_process'
const tests=[
 'scripts/test-main-resolver-opposite-gender-20261022.mjs',
 'scripts/test-main-resolver-actionable-20261022.mjs',
 'scripts/test-catalog-resolver-r10-acceptance-matrix.mjs',
 'scripts/test-catalog-resolver-r13-known-facts.mjs',
 'scripts/test-step191d-transfer-runtime-safety.mjs',
 'scripts/test-stocktake-functional-acceptance.mjs',
 'scripts/test-arrival-save-reliability.mjs',
 'scripts/test-arrival-variant-integrity-r2.mjs',
 'scripts/test-return-active-reserve-p0-20261021.mjs',
 'scripts/test-return-exchange-physical-receipt-r1.mjs',
 'scripts/test-p0-legacy-partial-exchange-worker-sqlite-20261027.mjs',
]
let completed=0
const started=Date.now()
for(const file of tests){
 const now=Date.now()
 const r=spawnSync(process.execPath,[file],{stdio:'inherit',timeout:90000,maxBuffer:15*1024*1024})
 if(r.error||r.status!==0){
  console.error('MAIN_CURRENT_BUSINESS_GATE_FAILED',JSON.stringify({file,exit:r.status,error:r.error?.message}))
  process.exit(1)
 }
 completed++
 console.log('MAIN_CURRENT_BUSINESS_GATE_CASE_PASS',JSON.stringify({file,ms:Date.now()-now}))
}
console.log('MAIN_CURRENT_BUSINESS_GATE_ALL_PASS',JSON.stringify({count:completed,durationMs:Date.now()-started}))
