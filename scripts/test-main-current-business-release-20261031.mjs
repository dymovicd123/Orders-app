// Current Main business regression gate: real SQL/HTTP and intent-based tests only.
// No byte-pinned historical release diff, no writes to Cloudflare, no moving Main assets.
import {spawnSync} from 'node:child_process'
const tests=[
 'scripts/verify-database-safety.mjs',
 'scripts/test-ci-historical-workflow-archive-20261108.mjs',
 'scripts/test-main-manager-three-workspaces-20261022.mjs',
 'scripts/test-main-product-kpi-20261027.mjs',
 'scripts/test-main-city-staff-20261025.mjs',
 'scripts/test-main-product-kpi-selection-20261028.mjs',
 'scripts/test-return-attributes-20261029.mjs',
 'scripts/test-step189d-team-activity.mjs',
 'scripts/test-finance-f3-summary-ux.mjs',
 'scripts/test-auth-production-team-access.mjs',
 'scripts/test-auth-production-password-manager.mjs',
 'scripts/test-auth-production-hardening.mjs',
 'scripts/test-reference-payment-merge.mjs',
 'scripts/test-stage01-workshop-truth-r3.mjs',
 'scripts/test-stage02-post-review-resolver-return-ux.mjs',
 'scripts/test-return-unissued-physical-safety-r2.mjs',
 'scripts/test-exchange-set-v2-ui.mjs',
 'scripts/test-stage03-h9c-production-multi-exchange.mjs',
 'scripts/test-main-resolver-opposite-gender-20261022.mjs',
 'scripts/test-main-resolver-actionable-20261022.mjs',
 'scripts/test-catalog-resolver-r10-acceptance-matrix.mjs',
 'scripts/test-catalog-resolver-r13-known-facts.mjs',
 'scripts/test-catalog-exhaustive-sku-identity.mjs',
 'scripts/test-step191d-transfer-runtime-safety.mjs',
 'scripts/test-stocktake-functional-acceptance.mjs',
 'scripts/test-inventory-complete-cursor-pagination.mjs',
 'scripts/test-arrival-save-reliability.mjs',
 'scripts/test-arrival-variant-integrity-r2.mjs',
 'scripts/test-arrival-materialization-reliability.mjs',
 'scripts/test-arrival-canonical-product-alias-r1.mjs',
 'scripts/test-arrival-inline-recovery-ux.mjs',
 'scripts/test-return-active-reserve-p0-20261021.mjs',
 'scripts/test-return-exchange-physical-receipt-r1.mjs',
 'scripts/test-p0-legacy-partial-exchange-worker-sqlite-20261027.mjs',
 'scripts/test-stage345-concurrent-return-exchange-http-20261031.mjs',
 'scripts/test-stage345-concurrent-legacy-return-exchange-http-20261031.mjs',
 'scripts/test-stage3-partial-return-http-20261031.mjs',
 'scripts/test-stage3-delayed-return-post-stocktake-http-20261031.mjs',
 'scripts/test-stage3-return-receipt-fractional-checkpoint-20261031.mjs',
 'scripts/test-work733-partial-return-shipping-undo-20261101.mjs',
 'scripts/test-p0-financial-atomic-20261027.mjs',
 'scripts/test-finance-day-transparency.mjs',
 'scripts/test-operational-autonomy-a5-exchange-financial-correction.mjs',
 'scripts/test-return-exchange-cancel-autonomy.mjs',
 'scripts/test-order-exchange-bulk-cancellation-20261018.mjs',
 'scripts/test-operational-autonomy-r3-return-exchange-capacity.mjs',
 'scripts/test-operational-autonomy-a4-handover-correction.mjs',
 'scripts/test-main-arrival-canonical-sku-20261031.mjs',
 'scripts/test-main-transfer-canonical-sku-20261031.mjs',
 'scripts/test-main-found-stocktake-identity-race-20261031.mjs',
 'scripts/test-main-warehouse-sku-feedback-20261031.mjs',
 'scripts/test-main-resolver-proven-sku-hydration-20261031.mjs',
 'scripts/test-main-implicit-sku-guard-20261107.mjs',
 'scripts/test-main-stage1-final-resolver-20261031.mjs',
 'scripts/test-main-stage16-atomic-reservation-20261101.mjs',
 'scripts/test-main-stage16-worker-shipping-recovery-20261101.mjs',
 'scripts/test-main-stage15-exact-pending-reserve-retry-20261101.mjs',
 'scripts/test-main-stage24-found-catalog-navigation-20261101.mjs',
 'scripts/test-storage-background-alert-scope-20261101.mjs',
 'scripts/test-stage5-client-quantity-replay-20261102.mjs',
 'scripts/test-main-prior-issued-shipping-20261105.mjs',
 'scripts/test-stage5b-dispatch-atomic-d1-20261101.mjs',
 'scripts/test-stage5b-http-routes-20261101.mjs',
 'scripts/test-old-order-post-stocktake-handover-r1.mjs',
 'scripts/test-old-order-post-stocktake-guard-r1.mjs',
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
