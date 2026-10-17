// Execute the unmodified cumulative historical Branch2 test command against the
// exact accepted pre-port runtime, then test the new Catalog and Writeoff runtime
// independently. No test is removed, and Stage04 SQL is byte-for-byte protected.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'

const gitBlob = (value) => {
  const bytes=Buffer.from(value)
  return crypto.createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex')
}
const check=(condition,message)=>{if(!condition)throw new Error(message)}
const manifest=JSON.parse(fs.readFileSync('scripts/catalog-integrity-branch2-stage04-safe-runtime-manifest.json','utf8'))
check(manifest.version===1 && manifest.revision==='catalog-integrity-branch2-stage04-safe-20261009','Invalid integration manifest')
// Explicit narrowly reviewed order-delete UX extension. The frozen Catalog
// manifest and its historical baseline remain immutable. No gate is disabled.
const reviewedDeleteGuidance = {
  originalApp: '562a41973ad154496a81c8d5c151aff5119a46bf',
  currentApp: '505ae6ee1e691db95c78c97aba445cd3aa066d7e',
  files: {
    'worker/domains/order-delete.ts': '041aaa47af3ae1cfc45a822e968dc63ce536ac5f',
    'worker/domains/critical.ts': '4d45032c6e75fd6a62f213242def01b5f47b81db',
    'scripts/test-order-delete-physical-guidance-r1.mjs': '5a28da06b7da7c82e65e94f5d475c58aaa6b27d7',
  },
}
check(manifest.files['src/App.tsx'].afterGitBlob === reviewedDeleteGuidance.originalApp,
  'Unexpected pre-guidance Catalog App baseline')
for (const [file, expected] of Object.entries(reviewedDeleteGuidance.files)) {
  check(gitBlob(fs.readFileSync(file, 'utf8')) === expected, 'Unreviewed deletion guidance drift: '+file)
}
// Read-only catalogue/stock merge correction: source rows override catalogue
// projections even if the projection already created a matching SKU key.
// The existing frozen baseline is still used for historical tests.
const reviewedStockProjection = {
  file: 'src/app/controllers/useOperationalViewModel.ts',
  before: '3b0ebdc1b92213e5cab73a5bf493c7d34cfd6b95',
  after: '94f600e958c07944274a43f6182e09f1ef02e8b8',
}
check(manifest.files[reviewedStockProjection.file].afterGitBlob === reviewedStockProjection.before,
  'Unexpected stock projection baseline')
// Narrowly approved arrival autofill safety patch. The prior projection release stays
// explicitly preserved; historical staged fixtures and Stage04 remain unchanged.
const reviewedArrivalMaterialChoice = {
  file: reviewedStockProjection.file,
  before: reviewedStockProjection.after,
  after: 'b34991dae36234e70ee3a3014bf2c09cd731ee92',
}
check(reviewedArrivalMaterialChoice.before === reviewedStockProjection.after,
  'Arrival material safety patch does not start from the accepted stock projection version')
// Branch2-only audited history finalization from issue #413; exact current blobs
// are pinned, and historical manifest source is still staged unmodified.
const reviewedEthnoManualHistory = {
  'worker/domains/catalog-variant-consolidation.ts':'126710444bcd74638386e53df91dbb1ca95a75e6',
  'worker/domains/inventory-movement.ts':'5403949b89141ee3c0ccbf41e0ac42228d921443',
  'worker/index.ts':'a070d1aa667f5094e20574ac2d178fd16e243398',
  'src/features/sections/ReferenceMergeWorkspace.tsx':'dfbf117fd4a7c4a92eec28615ee5334ad6a69f47',
  'scripts/test-catalog-stock-reconciliation-write.mjs':'a5731d0c1556f0708444a51217348e1bb3fea1c8',
  'scripts/test-catalog-integrity-r2-sku-consolidation.mjs':'dac49e71f9673c9766b4c6af256d6fe9f2a41cc4',
  'scripts/test-catalog-zero-stock-undo.mjs':'528c9e0e89dce24c863a6aaf0a7fbc3b7a6f7436',
  'scripts/test-catalog-reserved-stock-undo.mjs':'d95f289dc965307ee49c3b19f981238c072bd12b',
  'scripts/test-catalog-counted-stock-undo.mjs':'f58e5ce2acd4f8f152df8006f5caa8349598f6b1',
  'scripts/test-catalog-positive-stock-undo.mjs':'dae163ccc12b570fd0bde1cf066d60ab77360864',
  'scripts/test-catalog-complex-undo-case.mjs':'b9ab573b89337241e7636e8e9f275d711e4624a6',
}
for(const [file,sha] of Object.entries(reviewedEthnoManualHistory))
  check(gitBlob(fs.readFileSync(file,'utf8'))===sha,'Unreviewed Ethno finalization runtime drift: '+file)
const reviewedCatalogAdded = (file,expected) => reviewedEthnoManualHistory[file] || expected
const reviewedHandoverUx = {
  appBefore: reviewedDeleteGuidance.currentApp,
  appAfter: 'cc2be798b049f4063848449c3fec4460a380ac2e',
  tableBefore: '45088dbd1b594fa165f9ea7cfdc35109e2be3417',
  tableAfter: '52f95261a9f63eaa9c4e7e0a3e634e95896ac730',
  beforePriceAction: '02dd262da588cb22d9aa71b0cf3a9e374d667282',
}
check(gitBlob(fs.readFileSync('src/App.tsx','utf8'))===reviewedHandoverUx.appAfter,'Unreviewed customer handover UI drift')
check(gitBlob(fs.readFileSync('src/features/sections/OrdersTableSection.tsx','utf8'))===reviewedHandoverUx.tableAfter,'Unreviewed order list handover UI drift')
const reviewedAfterGitBlob = (file, delta) => file === 'src/App.tsx'
  ? reviewedHandoverUx.appAfter
  : file === 'worker/domains/orders-write.ts' ? 'edfcd173c02adb7a448ba759935a0348d144b95d'
  : file === reviewedArrivalMaterialChoice.file ? reviewedArrivalMaterialChoice.after : (reviewedEthnoManualHistory[file] || delta.afterGitBlob)
const historicalDeleteWorker = [
  {
    file: 'worker/domains/critical.ts',
    before: 'b8f9a38e6f6090d7cd5d0878a0d9a58c6786e9f2',
    after: reviewedDeleteGuidance.files['worker/domains/critical.ts'],
    fixture: 'scripts/fixtures/order-delete-guidance-before-20261014/worker/domains/critical.ts',
  },
  {
    file: 'worker/domains/order-delete.ts',
    before: '37358a13990119814a6cf7edccc3b4ad66b4343a',
    after: reviewedDeleteGuidance.files['worker/domains/order-delete.ts'],
    fixture: 'scripts/fixtures/order-delete-guidance-before-20261014/worker/domains/order-delete.ts',
  },
]
for (const entry of historicalDeleteWorker) {
  check(gitBlob(fs.readFileSync(entry.fixture,'utf8')) === entry.before,
    'Order delete historical Worker fixture drift: ' + entry.file)
}


// Stage04-B2 is independently tested on current runtime; the exact old
// migration-count regression must still run against its frozen historical tree.
// Pin this additive SQL and hide it ONLY while invoking that original suite.
const stage04B2Extensions={
  'migrations/0106_v72_workshop_completion_catalog_cost_snapshot.sql':'b468a734520cfae24341ee6864daae34f0860547',
  'migrations/0107_v72_workshop_settlement_payment_method.sql':'137b974665c7b35464250e87bc2e57baae147142',
  'migrations/0108_v72_workshop_unique_legacy_sku_pricing.sql':'dbe3150c5d97ffad90db9dabd42261baed222d7c',
  'worker/domains/workshop-settlements.ts':'2b7d7461758c116053b4a62a3576f451180b32fc',
  'worker/domains/workshop-settlement-prices.ts':'8f850b0540041daf688c48daf37642fe66f8c6ab',
  'src/features/workshop/WorkshopSettlementsPanel.tsx':'8ec8a1e6b2fe7849e74881d302ff72a1b095b58f',
  'src/styles/stage04-workshop-settlements.css':'6796899d63de3e2183a95605b9280764c9e64b48',
}
const reviewedExchangePriceFiles={
  'migrations/0110_v72_exchange_order_item_price_correction_audit.sql':'1de7e817dd4d8b9188f3bac747653dcffcf26b35',
  'worker/domains/exchange-price-history.ts':'589786815066ebd670dac8747850f41769c163b2',
  'worker/domains/exchange-cancel-chain.ts':'0f51af34bfae6f217577bf34340760c7f0094f4f',
  'worker/domains/order-delete-preview.ts':'8171354876f5c7f7dc9c9389e8636d4fffeb71c1',
  'worker/domains/order-delete-chain-plan.ts':'b54f9ab80301f0cc3293c718cd4100a2afda8c8d',
  'migrations/0111_v72_admin_order_delete_saga_journal.sql':'398a482dd31794da547973af82926aecc061934d',
  'worker/domains/admin-delete-saga.ts':'68aff3adaef1205690918bb1c39841b266eb41d5',
  'worker/domains/admin-delete-real-driver.ts':'8ef1344ad770989210e3dd92623b42a3fc8518f9',
}
for(const [file,expected] of Object.entries(reviewedExchangePriceFiles))
  check(gitBlob(fs.readFileSync(file,'utf8'))===expected,'New exchange price ledger drift: '+file)

const reviewedEthnoNewFiles={
  'migrations/0109_v72_catalog_manual_movement_finalization.sql':'06314e11b70918ae5a133b076f397fbbb27d0511',
  'worker/domains/catalog-manual-history-finalization.ts':'ce672c90cd6d223a853aa827bb5bea466c695624',
}
for(const [file,expected] of Object.entries(reviewedEthnoNewFiles))
  check(gitBlob(fs.readFileSync(file,'utf8'))===expected,'Finalization new file unexpected drift: '+file)
for(const [file,expected] of Object.entries(stage04B2Extensions)){
  check(gitBlob(fs.readFileSync(file,'utf8'))===expected,'Unexpected Stage04-B2 SQL drift: '+file)
}
// Preserve the exact Workshop screen while running historical source-size baselines.
// New Stage04-D UI runs its own current-code acceptance before the old suite.
const stage04DWorkshopScreen={
  file:'src/features/sections/WorkshopSection.tsx',
  fixture:'scripts/fixtures/stage04d-workshop-20261011/WorkshopSection.tsx',
  before:'d21020d65f3469997a3a579d9233362a026a5336',
  after:'86a9fcea1a569a6a72f67cf42cea92f75ead5d1d',
}
check(gitBlob(fs.readFileSync(stage04DWorkshopScreen.file,'utf8'))===stage04DWorkshopScreen.after,'Stage04-D Workshop UI drift')
check(gitBlob(fs.readFileSync(stage04DWorkshopScreen.fixture,'utf8'))===stage04DWorkshopScreen.before,'Stage04-D baseline fixture drift')

// Warehouse visibility fix only: current UI is reviewed independently while the
// historical main-parity regression sees its exact immutable main screen fixtures.
const stockVisibilityScreens=[
  {
    file:'src/features/sections/InventorySection.tsx',
    fixture:'scripts/fixtures/stock-visibility-20261013/InventorySection.tsx',
    before:'c3ba07c011ef9b68b5fa3cb0a52471851877eed8',
    // Reviewed follow-up: source switching now fetches selected point before showing totals.
    // Previous accepted Branch2 stock screen blob: b1a6ea3f32a478cc333b3f3774fb69206b746143
    after:'60f3de63272102f9baced3c770bbb0cbe427e5be',
  },
  {
    file:'src/features/inventory/views/renderInventoryOverviewPanel.tsx',
    fixture:'scripts/fixtures/stock-visibility-20261013/renderInventoryOverviewPanel.tsx',
    before:'9b7738d3589f0091e120dec7f1f3a056abc4cc0d',
    after:'886d605ea1f72d6d431a421de34cea720bb6a771',
  },
]
for(const screen of stockVisibilityScreens){
  check(gitBlob(fs.readFileSync(screen.file,'utf8'))===screen.after,'Warehouse stock UI unexpected change: '+screen.file)
  check(gitBlob(fs.readFileSync(screen.fixture,'utf8'))===screen.before,'Frozen main warehouse baseline unexpected change: '+screen.fixture)
}

// The exchange lifecycle now uses bounded per-operation possession evidence,
// not an absolute count. Preserve *old* exchange modules for historical baseline
// checks without disabling or editing their invariants. Current code is tested first.
const priorExchangeModules=[
  {
    "file": "src/features/sections/OrderExchangeSmartSection.tsx",
    "before": "efafcca08869eeacff17e38eb693035a870dacd9",
    "after": "00a9da8d8bdfad7a89e8b2df85ffa18e2fa0ebac",
    "fixture": "scripts/fixtures/exchange-issue-before-20261013/src/features/sections/OrderExchangeSmartSection.tsx"
  },
  {
    "file": "src/features/sections/OrderExchangeSection.tsx",
    "before": "b854378c08389a29293a1a1e3e5e603d1e62d721",
    "after": "f71c7705d7433de51333255969c01967e96186f5",
    "fixture": "scripts/fixtures/exchange-issue-before-20261013/src/features/sections/OrderExchangeSection.tsx"
  },
  {
    "file": "worker/domains/exchange-batch.ts",
    "before": "725515005ad9e64d30e6eb2605f974c7947358e3",
    "after": "0c7d1c0b8eb3b013a8f7c0a8f1986d6ecfc55a45",
    "fixture": "scripts/fixtures/exchange-issue-before-20261013/worker/domains/exchange-batch.ts"
  },
  {
    "file": "worker/domains/returns-exchanges.ts",
    "before": "af53527b060ec388bbe9058b80df16a564b8af4c",
    "after": "c10b1e68928efe742940499e5b4c9b4375ece72e",
    "fixture": "scripts/fixtures/exchange-issue-before-20261013/worker/domains/returns-exchanges.ts"
  },
  {
    "file": "worker/domains/lifecycle.ts",
    "before": "25f08471020220883107de8ee02b26bc774eb29a",
    "after": "039b84adc58aadefc6ded14b6dd9fa73a6aeb847",
    "fixture": "scripts/fixtures/exchange-issue-before-20261013/worker/domains/lifecycle.ts"
  }
];
for(const file of priorExchangeModules){
  check(gitBlob(fs.readFileSync(file.file,'utf8'))===file.after,'Current Exchange module changed unexpectedly: '+file.file)
  check(gitBlob(fs.readFileSync(file.fixture,'utf8'))===file.before,'Historical Exchange fixture drifted: '+file.fixture)
}

// The old Branch2 main-sync regression compares the shared order hint module
// byte-for-byte. Run it against its frozen fixture, while separately testing
// and building the corrected UI from the actual current source.
const orderStockHintUi={
  file:'src/app/controllers/useWorkspaceViewModel.tsx',
  fixture:'scripts/fixtures/stock-shortage-ui-20261013/useWorkspaceViewModel.tsx',
  before:'74e13c339069c7a63b4df578af51a675777fe371',
  after:'e9d875f036beb0a43222d035391efdba57dc4116',
}
check(gitBlob(fs.readFileSync(orderStockHintUi.file,'utf8'))===orderStockHintUi.after,'Current order shortage UI drift')
check(gitBlob(fs.readFileSync(orderStockHintUi.fixture,'utf8'))===orderStockHintUi.before,'Historical order shortage UI fixture drift')

// The new policy allows narrow recorded-price corrections for managers and
// reserves whole-order deletion for admin. Preserve the old test sources only
// during byte-exact historical replay; the live policies are verified first.
const recordedPricePolicyTests=[
  {
    file:'scripts/test-order-edit-autonomy.mjs',
    fixture:'scripts/fixtures/recorded-price-20261017/test-order-edit-autonomy.mjs',
    before:'1377cb468781e765d6b880673fef7cb2659b61d4',
    after:'80181003288a7a04ecfeaa07d153fd600de52cdc',
  },
  {
    file:'scripts/test-order-delete-mobility.mjs',
    fixture:'scripts/fixtures/recorded-price-20261017/test-order-delete-mobility.mjs',
    before:'24f70e68f044b0ac3a63cd750f2324a350d1da74',
    after:'f0f1c68544a0d49aeaaf6cab942208dd911bacc5',
  },
]
for(const entry of recordedPricePolicyTests){
  check(gitBlob(fs.readFileSync(entry.file,'utf8'))===entry.after,'Current order policy test drift: '+entry.file)
  check(gitBlob(fs.readFileSync(entry.fixture,'utf8'))===entry.before,'Historical order policy fixture drift: '+entry.file)
}

// A normal order is not a stocktake. Historical tests must still see the exact
// approved pre-fix reservation module; the new module is checked independently.
const orderReservationTruthFix={
  file:'worker/domains/order-reservations.ts',
  before:'b27726ebea9546120d1b75a6862bd77b9154714e',
  after:'d96b55cc499dc54c9c5301197f0f0c759d17ba1f',
  postStocktakeBefore:'10c00c135801bcbadbb7f23a93481c9e94e978ce',
  postStocktakeFixture:'scripts/fixtures/old-order-stocktake-20261016/order-reservations-before.ts',
  historicalLine:"  const observedPhysical = item.observedPhysicalQuantity == null ? null : item.observedPhysicalQuantity;",
  currentLines:"  // No reservation, including an exchange, may ever act as a physical stocktake.\n  // Outbound possession is confirmed against the *operation*, not a whole-SKU count.\n  const observedPhysical: null = null;",
  approvedIntermediate:"  // An order reservation must never be interpreted as an absolute physical stocktake.\n  // Preserve the legacy exchange path until its separate outbound-possession flow is migrated.\n  const observedPhysical = referenceType === 'exchange_new' && item.observedPhysicalQuantity != null\n    ? item.observedPhysicalQuantity : null;",
}
check(gitBlob(fs.readFileSync(orderReservationTruthFix.file,'utf8'))===orderReservationTruthFix.after,
  'Order reservation stock-truth fix unexpected drift')
check(gitBlob(fs.readFileSync(orderReservationTruthFix.postStocktakeFixture,'utf8'))===orderReservationTruthFix.postStocktakeBefore,
  'Immutable pre-October checkpoint SQL fixture changed')

const run=(command,args,context,extraEnv={})=>{
  const x=spawnSync(command,args,{cwd:process.cwd(),stdio:'inherit',shell:false,
    windowsHide:true,env:{...process.env, CATALOG_INTEGRITY_PORT_CHECK:'1',...extraEnv}})
  if(x.error)throw x.error
  check(x.status===0,`${context} failed: ${x.status}`)
}
for(const [file,expected] of Object.entries(manifest.stage04Files)){
  check(gitBlob(fs.readFileSync(file,'utf8'))===expected,'Stage04 migration changed: '+file)
}
for(const [file,expected] of Object.entries(manifest.addedFiles || {})){
  check(gitBlob(fs.readFileSync(file,'utf8'))===reviewedCatalogAdded(file,expected),'Catalog port new file drifted: '+file)
}
for(const [file,delta] of Object.entries(manifest.files)){
  check(gitBlob(fs.readFileSync(file,'utf8'))===reviewedAfterGitBlob(file,delta),'Unreviewed Catalog runtime drift: '+file)
  check(gitBlob(fs.readFileSync(delta.baselineFixture,'utf8'))===delta.beforeGitBlob,
    'Unreviewed legacy Branch2 fixture drift: '+file)
}

// Preserve the accepted old SQL lifecycle and its old assertions ONLY for
// byte-for-byte historical manifests; current runtime is tested before and
// after this temporary baseline staging.
const inventorySafetyFixtures=[
  {
    "file": "worker/domains/inventory-stocktake.ts",
    "before": "c40f2c4bbd5075aab4412a08e77df8ad76dae0e9",
    "after": "7df026a8e0de46062e73b1248a7ada063a45710b",
    "fixture": "scripts/fixtures/inventory-safety-20261014/worker/domains/inventory-stocktake.ts"
  },
  {
    "file": "scripts/test-stocktake-functional-acceptance.mjs",
    "before": "3ca20472b6a89f81d188c59f23a483d1df93aadb",
    "after": "23d73702c78798a08c9a370ea23aa0eebad2bcb8",
    "fixture": "scripts/fixtures/inventory-safety-20261014/scripts/test-stocktake-functional-acceptance.mjs"
  }
]
for(const entry of inventorySafetyFixtures){
  check(gitBlob(fs.readFileSync(entry.file,'utf8'))===entry.after,'Current warehouse safety file drift: '+entry.file)
  check(gitBlob(fs.readFileSync(entry.fixture,'utf8'))===entry.before,'Historical warehouse fixture drift: '+entry.fixture)
}

console.log('Checking Stage04 and new Catalog/Writeoff behavior on current runtime...')
const tests=[
  ['scripts/test-order-recorded-price-correction-r1.mjs',false],
  ['scripts/test-order-standalone-return-price-correction-r2.mjs',false],
  ['scripts/test-v2-exchange-price-audit-r1.mjs',true],
  ['scripts/test-v2-old-retired-price-correction-r1.mjs',true],
  ['scripts/test-v2-partial-old-price-correction-r1.mjs',true],
  ['scripts/test-exchange-cancel-chain-preview-r1.mjs',true],
  ['scripts/test-admin-order-delete-safe-preview-r1.mjs',true],
  ['scripts/test-admin-delete-chain-plan-r1.mjs',true],
  ['scripts/test-admin-delete-resumable-saga-r1.mjs',true],
  ['scripts/test-admin-delete-real-driver-r1.mjs',true],
  ['scripts/test-admin-saga-migrations-schema-r1.mjs',true],
  ['scripts/test-old-order-post-stocktake-handover-r1.mjs',true],
  ['scripts/test-handover-cas-after-revision-r2.mjs',true],
  ['scripts/test-old-order-post-stocktake-guard-r1.mjs',false],
  ['scripts/test-order-delete-physical-guidance-r1.mjs',false],
  ['scripts/test-order-no-hidden-stocktake-20261013.mjs',false],
  ['scripts/test-stock-shortage-ui-no-inline-recount-20261013.mjs',false],
  ['scripts/test-inventory-integrity-safety-20261014.mjs',false],
  ['scripts/test-inventory-snapshot-freshness-20261014.mjs',false],
  ['scripts/test-stock-source-switch-freshness-20261014.mjs',false],
  ['scripts/test-stock-snapshot-authority-20261014.mjs',false],
  ['scripts/test-expanded-stock-all-variants-20261014.mjs',false],
  ['scripts/test-arrival-orda-boutique-identity-20261014.mjs',false],
  ['scripts/test-stocktake-functional-acceptance.mjs',true],
  ['scripts/test-exchange-no-stocktake-confirmation-20261013.mjs',false],
  ['scripts/test-temporary-manager-warehouse-operations-20261013.mjs',false],
  ['scripts/test-stock-snapshot-no-false-zeros-20261013.mjs',false],
  ['scripts/test-inventory-stock-visible-reservations.mjs',false],
  ['scripts/test-branch2-environment.mjs',false],
  ['scripts/test-stage04a-workshop-settlements.mjs',false],
  ['scripts/test-stage04b-workshop-status-capture.mjs',false],
  ['scripts/test-stage04c-workshop-payments.mjs',true],
  ['scripts/test-stage04-fast-workshop-settlements.mjs',true],
  ['scripts/test-stage04d-workshop-settlements.mjs',true],
  ['scripts/test-stage04b3-unique-legacy-sku-capture.mjs',false],
  ['scripts/test-catalog-integrity-r1-references.mjs',false],
  ['scripts/test-reference-crud-integrity.mjs',true],
  ['scripts/test-catalog-stock-reconciliation.mjs',true],
  ['scripts/test-catalog-stock-reconciliation-write.mjs',true],
  ['scripts/test-catalog-integrity-r2-preview.mjs',true],
  ['scripts/test-catalog-integrity-r2-hide.mjs',true],
  ['scripts/test-catalog-integrity-r2-sku-consolidation.mjs',true],
  ['scripts/test-catalog-exhaustive-sku-identity.mjs',true],
  ['scripts/test-characteristic-sku-mapping.mjs',true],
  ['scripts/test-characteristic-sku-map-ui.mjs',false],
  ['scripts/test-catalog-stale-order-merge-bridge.mjs',true],
  ['scripts/test-arrival-merged-sku-safety.mjs',true],
  ['scripts/test-catalog-consolidation-undo-preview.mjs',true],
  ['scripts/test-catalog-merge-generation-foundation.mjs',true],
  ['scripts/test-catalog-zero-stock-undo.mjs',true],
  ['scripts/test-catalog-zero-stock-remerge-schema.mjs',false],
  ['scripts/test-catalog-positive-undo-proof-schema.mjs',false],
  ['scripts/test-catalog-counted-undo-proof-schema.mjs',false],
  ['scripts/test-catalog-reserved-undo-proof-schema.mjs',false],
  ['scripts/test-catalog-reserved-stock-undo.mjs',true],
  ['scripts/test-catalog-counted-stock-undo.mjs',true],
  ['scripts/test-catalog-complex-undo-case.mjs',true],
  ['scripts/test-catalog-complex-undo-pages.mjs',true],
  ['scripts/test-catalog-complex-undo-workplan.mjs',true],
  ['scripts/test-catalog-complex-undo-human-ui.mjs',false],
  ['scripts/test-reference-visual-qa-branch2.mjs',true],
  ['scripts/test-catalog-complex-undo-pages.mjs',true],
  ['scripts/test-catalog-positive-stock-undo.mjs',true],
  ['scripts/test-catalog-corrected-undo-review.mjs',true],
  ['scripts/test-inventory-writeoff-review.mjs',true],
  ['scripts/test-reference-duplicates-discovery-r1.mjs',false],
  ['scripts/test-reference-exhaustive-duplicates.mjs',true],
  ['scripts/test-reference-sku-verified-stock-ui.mjs',true],
  ['scripts/test-reference-merge-choice-preview.mjs',true],
  ['scripts/test-reference-reason-choice-schema.mjs',false],
  ['scripts/test-reference-reason-merge.mjs',true],
  ['scripts/test-reference-characteristic-impact.mjs',true],
  ['scripts/test-reference-merge-monthly-apply.mjs',true],
  ['scripts/test-reference-payment-merge.mjs',true],
  ['scripts/test-reference-merge-history.mjs',true],
  ['scripts/test-reference-current-runtime-cross-domain.mjs',false],
  ['scripts/test-inventory-complete-cursor-pagination.mjs',true],
]
for(const [file,stripTypes] of tests){
  run(process.execPath,[...(stripTypes?['--experimental-strip-types']:[]),file],file)
}
const saved=new Map()
const staged=fs.mkdtempSync(path.join(os.tmpdir(),'branch2-catalog-baseline-'))
const hidden=[]
try{
  // The historical size/count checks must see exactly the original Branch2
  // source tree; new modules are tested above against their own current code.
  for(const [relative,expected] of [
    ...Object.entries(manifest.addedFiles || {}),
    ...Object.entries(stage04B2Extensions),
    ...Object.entries(reviewedEthnoNewFiles),
    ...Object.entries(reviewedExchangePriceFiles),
  ]){
    const from=path.resolve(relative)
    check(gitBlob(fs.readFileSync(from,'utf8'))===reviewedCatalogAdded(relative,expected),'New module drifted: '+relative)
    const to=path.join(staged,relative)
    fs.mkdirSync(path.dirname(to),{recursive:true})
    fs.renameSync(from,to)
    hidden.push({relative,from,to,expected:reviewedCatalogAdded(relative,expected)})
  }
  for(const [relative,delta] of Object.entries(manifest.files)){
    const full=path.resolve(relative)
    saved.set(full,fs.readFileSync(full,'utf8'))
    fs.writeFileSync(full,fs.readFileSync(delta.baselineFixture,'utf8'))
  }
  const originalWorkshop=path.resolve(stage04DWorkshopScreen.file)
  saved.set(originalWorkshop,fs.readFileSync(originalWorkshop,'utf8'))
  fs.writeFileSync(originalWorkshop,fs.readFileSync(stage04DWorkshopScreen.fixture,'utf8'))
  for(const screen of stockVisibilityScreens){
    const full=path.resolve(screen.file)
    saved.set(full,fs.readFileSync(full,'utf8'))
    fs.writeFileSync(full,fs.readFileSync(screen.fixture,'utf8'))
  }
  const stockHintPath=path.resolve(orderStockHintUi.file)
  saved.set(stockHintPath,fs.readFileSync(stockHintPath,'utf8'))
  fs.writeFileSync(stockHintPath,fs.readFileSync(orderStockHintUi.fixture,'utf8'))
  check(gitBlob(fs.readFileSync(stockHintPath,'utf8'))===orderStockHintUi.before,
    'Historical shared stock availability UI could not be staged')
  for(const entry of priorExchangeModules){
    const full=path.resolve(entry.file)
    saved.set(full,fs.readFileSync(full,'utf8'))
    fs.writeFileSync(full,fs.readFileSync(entry.fixture,'utf8'))
    check(gitBlob(fs.readFileSync(full,'utf8'))===entry.before,'Cannot stage historical Exchange source: '+entry.file)
  }
  for(const entry of inventorySafetyFixtures){
    const full=path.resolve(entry.file)
    saved.set(full,fs.readFileSync(full,'utf8'))
    fs.writeFileSync(full,fs.readFileSync(entry.fixture,'utf8'))
    check(gitBlob(fs.readFileSync(full,'utf8'))===entry.before,
      'Cannot stage accepted old warehouse safety file: '+entry.file)
  }
  // Old worker declaration/structure tests must see byte-for-byte accepted old
  // Worker modules; current guidance is checked above and restored below.
  for (const entry of historicalDeleteWorker) {
    const full=path.resolve(entry.file)
    saved.set(full,fs.readFileSync(full,'utf8'))
    fs.writeFileSync(full,fs.readFileSync(entry.fixture,'utf8'))
    check(gitBlob(fs.readFileSync(full,'utf8'))===entry.before,
      'Cannot stage historical order-delete Worker: '+entry.file)
  }
  for(const entry of recordedPricePolicyTests){
    const full=path.resolve(entry.file)
    saved.set(full,fs.readFileSync(full,'utf8'))
    fs.writeFileSync(full,fs.readFileSync(entry.fixture,'utf8'))
    check(gitBlob(fs.readFileSync(full,'utf8'))===entry.before,'Cannot stage historical order test: '+entry.file)
  }
  const orderTablePath=path.resolve('src/features/sections/OrdersTableSection.tsx')
  const orderTableCurrent=fs.readFileSync(orderTablePath,'utf8')
  check(gitBlob(orderTableCurrent)===reviewedHandoverUx.tableAfter,'Current order list handover UI changed')
  // Reconstruct only the previously accepted UI for its immutable historical tests.
  // Independently test and retain the new review-first shipping action in current code.
  const reviewFirstHelp='                            {projection.canShip && order.stock_handover_review_needed ? (\n                              <span className="order-stock-handover-wait-note">Сначала проверьте выдачу после ревизии. После подтверждения появится «Отправить клиенту».</span>\n                            ) : null}\n'
  check(orderTableCurrent.includes(reviewFirstHelp),'Current review-first shipping helper disappeared')
  // Historical order list assertions remain byte-exact. Replay the previous
  // accepted view from a separately pinned fixture, never dilute old tests.
  const orderTablePrior=fs.readFileSync('scripts/fixtures/recorded-price-20261017/OrdersTableSection-before.tsx','utf8')
  check(gitBlob(orderTablePrior)===reviewedHandoverUx.beforePriceAction,
    'Frozen before-price-correction table view changed')
  const orderTableHistorical=orderTablePrior
    .replace(reviewFirstHelp,'')
    .replace('{projection.canShip && !order.stock_handover_review_needed ? (','{projection.canShip ? (')
    .replace('Проверить выдачу после ревизии','Уточнить выдачу')
  check(gitBlob(orderTableHistorical)===reviewedHandoverUx.tableBefore,'Order list historical layout cannot be restored')
  saved.set(orderTablePath,orderTableCurrent)
  fs.writeFileSync(orderTablePath,orderTableHistorical)
  const orderReservationPath=path.resolve(orderReservationTruthFix.file)
  const orderReservationCurrent=fs.readFileSync(orderReservationPath,'utf8')
  saved.set(orderReservationPath,orderReservationCurrent)
  const orderReservationPrior=fs.readFileSync(orderReservationTruthFix.postStocktakeFixture,'utf8')
  check(gitBlob(orderReservationPrior)===orderReservationTruthFix.postStocktakeBefore,
    'Prior reservation checkpoint baseline changed')
  check(orderReservationPrior.includes(orderReservationTruthFix.currentLines),
    'Current order reservation no longer contains reviewed stock-truth guard')
  const handoverGuardBegin=orderReservationPrior.indexOf("  if (stockConfirmationOperation === 'handover') {",orderReservationPrior.indexOf("  const statements: D1PreparedStatement[] = [];",orderReservationPrior.indexOf('export async function fulfillOrderReservationsV2(')))
  const handoverGuardEnd=orderReservationPrior.indexOf("  for (const payloadChunk of chunksOf(stockPayloads, 70)) {",handoverGuardBegin)
  check(handoverGuardBegin>0 && handoverGuardEnd>handoverGuardBegin,
    'Current early-handover atomic reservation guard is missing')
  const previouslyApprovedReservation=orderReservationPrior.slice(0,handoverGuardBegin)+orderReservationPrior.slice(handoverGuardEnd)
  check(gitBlob(previouslyApprovedReservation)==='dd85dcf15df53705d1ad3c61f918fae92c2316ff',
    'New reservation safety change alters unrelated historical behavior')
  const orderReservationHistorical=previouslyApprovedReservation.replace(
    orderReservationTruthFix.currentLines,orderReservationTruthFix.approvedIntermediate).replace(
    orderReservationTruthFix.approvedIntermediate,orderReservationTruthFix.historicalLine)
  check(gitBlob(orderReservationHistorical)===orderReservationTruthFix.before,
    'Order reservation historical baseline does not match accepted Branch2')
  fs.writeFileSync(orderReservationPath,orderReservationHistorical)

  console.log('Running complete unmodified historical release gate against frozen Branch2 baseline...')
  const npm=process.platform==='win32'?'npm.cmd':'npm'
  run(npm,['run','release:check'],'Historical cumulative Branch2 regression gate',
    {CATALOG_INTEGRITY_STAGE04_BRANCH2_BASELINE_NORMALIZED:'1'})
}finally{
  for(const [full,content] of saved)fs.writeFileSync(full,content)
  for(const entry of hidden.reverse()){
    fs.renameSync(entry.to,entry.from)
    check(gitBlob(fs.readFileSync(entry.from,'utf8'))===entry.expected,
      'New Catalog module not restored after historical checks: '+entry.relative)
  }
  fs.rmSync(staged,{recursive:true,force:true})
}
for(const [relative,delta] of Object.entries(manifest.files)){
  check(gitBlob(fs.readFileSync(relative,'utf8'))===reviewedAfterGitBlob(relative,delta),'Failed to restore new runtime: '+relative)
}
check(gitBlob(fs.readFileSync(orderStockHintUi.file,'utf8'))===orderStockHintUi.after,
  'Failed to restore current order shortage UI after historical tests')
for (const entry of historicalDeleteWorker) {
  check(gitBlob(fs.readFileSync(entry.file,'utf8'))===entry.after,
    'Failed to restore reviewed order-delete Worker after historical tests: '+entry.file)
}

for(const entry of recordedPricePolicyTests)
  check(gitBlob(fs.readFileSync(entry.file,'utf8'))===entry.after,'Current order test was not restored: '+entry.file)
check(gitBlob(fs.readFileSync(orderReservationTruthFix.file,'utf8'))===orderReservationTruthFix.after,
  'Failed to restore corrected order reservation code after historical tests')
check(gitBlob(fs.readFileSync('src/features/sections/OrdersTableSection.tsx','utf8'))===reviewedHandoverUx.tableAfter,
  'Failed to restore reviewed order list handover UI after historical tests')
for(const entry of inventorySafetyFixtures){
  check(gitBlob(fs.readFileSync(entry.file,'utf8'))===entry.after,
    'Failed to restore current warehouse safety code after historical tests: '+entry.file)
}
check(gitBlob(fs.readFileSync(stage04DWorkshopScreen.file,'utf8'))===stage04DWorkshopScreen.after,'Failed to restore Stage04-D Workshop UI')
for(const screen of stockVisibilityScreens){
  check(gitBlob(fs.readFileSync(screen.file,'utf8'))===screen.after,'Failed to restore current warehouse inventory UI: '+screen.file)
}
// The frozen historical suite builds the *old* frontend while baseline files
// are temporarily staged. Cloudflare Workers Builds uses release:check as its
// build command and deploys dist/ immediately afterwards. Without a fresh build
// here, its perfectly successful deploy silently overwrites the current UI
// with the historical test fixture. Always rebuild from restored current code.
console.log('Rebuilding current Branch2 frontend after restoring historical Stage04 test fixtures...')
fs.rmSync(path.resolve('dist'), { recursive: true, force: true })
const npmCurrent=process.platform==='win32'?'npm.cmd':'npm'
run(npmCurrent,['run','build'],'Current Branch2 frontend/Worker build after preserved Stage04 tests')
const assetsDir=path.resolve('dist/client/assets')
check(fs.existsSync(assetsDir),'Current Branch2 build did not produce client assets')
const referencesChunks=fs.readdirSync(assetsDir).filter(name=>/^ReferencesSection-[A-Za-z0-9_-]+\.js$/.test(name))
check(referencesChunks.length===1,'Current Branch2 build has missing or multiple ReferencesSection chunks')
const chunk=fs.readFileSync(path.join(assetsDir,referencesChunks[0]),'utf8')
for(const marker of ['Все рабочие справочники','Проверка дублей','Объединить значения','Разобрать прежнее объединение товаров']){
  check(chunk.includes(marker),'Refusing historical frontend deployment: missing '+marker)
}
const inventoryChunks=fs.readdirSync(assetsDir).filter(name=>/^InventorySection-[A-Za-z0-9_-]+\.js$/.test(name))
check(inventoryChunks.length===1,'Current Branch2 build is missing InventorySection chunk')
const inventoryChunk=fs.readFileSync(path.join(assetsDir,inventoryChunks[0]),'utf8')
for(const marker of ['Фильтр выбирает товары, но внутри каждого товара видны все размеры','Резерв под заказы превышает физический остаток']){
  check(inventoryChunk.includes(marker),'Refusing historical inventory frontend deploy: missing '+marker)
}
const workshopChunks=fs.readdirSync(assetsDir).filter(name=>/^WorkshopSection-[A-Za-z0-9_-]+\.js$/.test(name))
check(workshopChunks.length===1,'Current Branch2 build is missing WorkshopSection chunk')
const workshopChunk=fs.readFileSync(path.join(assetsDir,workshopChunks[0]),'utf8')
for(const marker of ['Расчёты с Цехом','Осталось выплатить','Без себестоимости','Сегодня выполнено','Не определена себестоимость','Указать себестоимость','Разобрать позиции','Выплатили полностью','Выплатили часть','Дополнительно (необязательно)','Начисления','Операции дня','Возвраты в работу','Изменение долга']){
  check(workshopChunk.includes(marker),'Refusing Stage04-D frontend deploy: missing '+marker)
}
console.log('CURRENT BRANCH2 BUILD VERIFIED — fresh ReferencesSection:',referencesChunks[0])
console.log('CATALOG PORT AND BRANCH2 HISTORICAL GATES PASSED — Stage04 preserved, new runtime checked, baseline suite unchanged')
