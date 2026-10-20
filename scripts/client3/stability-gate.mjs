import {spawnSync} from 'node:child_process'
import {existsSync} from 'node:fs'
const scripts=[
  "test-catalog-resolver-r9-final-acceptance.mjs",
  "test-catalog-resolver-r11-preserve-known-gender.mjs",
  "test-catalog-resolver-r12-catalog-consistency.mjs",
  "test-catalog-resolver-r13-known-facts.mjs",
  "test-stage01-resolver-active-reservation-r12.mjs",
  "test-pending-known-reservation-shipping-20261020.mjs",
  "test-stage02-phase2b-shipping-possession-resolver.mjs",
  "test-legacy-exchange-product-pick-no-white-screen-20261017.mjs",
  "test-exchange-not-issued-r1.mjs",
  "test-return-exchange-physical-receipt-r1.mjs",
  "test-operational-autonomy-a5-exchange-financial-correction.mjs",
  "test-order-exchange-bulk-cancellation-20261018.mjs",
  "test-stage01-money-only-return-shipping-r19b.mjs",
  "test-operational-autonomy-a3-post-return-debt-close.mjs",
  "test-order-edit-payment-method-correction.mjs",
  "test-finance-f4-money-journal.mjs",
  "test-stage01-finance-correction-reliability-r4.mjs",
  "test-stocktake-functional-acceptance.mjs",
  "test-auth-production-hardening.mjs",
  "test-auth-r7-login-reliability.mjs"
]
for(const script of scripts){
 const path='scripts/'+script
 if(!existsSync(path))throw Error('Missing high-risk regression: '+path)
 const r=spawnSync(process.execPath,[path],{stdio:'inherit',encoding:'utf8',maxBuffer:24*1024*1024})
 if(r.error||r.status!==0)throw Error('Client3 high-risk regression failed: '+path+' (exit '+r.status+')')
}
const extra=spawnSync(process.execPath,['scripts/verify-database-safety.mjs'],{stdio:'inherit'})
if(extra.error||extra.status!==0)throw Error('Client3 database guard failed')
console.log('CLIENT3_STABILITY_GATE_PASSED — '+scripts.length+' resolver/exchange/payment/stock/auth regressions + DB safety')
