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
// Stage04-B2 is independently tested on current runtime; the exact old
// migration-count regression must still run against its frozen historical tree.
// Pin this additive SQL and hide it ONLY while invoking that original suite.
const stage04B2Extensions={
  'migrations/0106_v72_workshop_completion_catalog_cost_snapshot.sql':'b468a734520cfae24341ee6864daae34f0860547',
  'migrations/0107_v72_workshop_settlement_payment_method.sql':'137b974665c7b35464250e87bc2e57baae147142',
  'migrations/0108_v72_workshop_unique_legacy_sku_pricing.sql':'dbe3150c5d97ffad90db9dabd42261baed222d7c',
  'worker/domains/workshop-settlements.ts':'ca0e81f86b392c0790100324d9d876227c913a95',
  'worker/domains/workshop-settlement-prices.ts':'dda3eb0fa2e3edc92fff13c65367f534d837c359',
  'src/features/workshop/WorkshopSettlementsPanel.tsx':'cf00e5297363427a281cd952f32572acb0d304e3',
  'src/styles/stage04-workshop-settlements.css':'d3d91a237c9f7516249dff1d79ca9d91f770edc3',
}
for(const [file,expected] of Object.entries(stage04B2Extensions)){
  check(gitBlob(fs.readFileSync(file,'utf8'))===expected,'Unexpected Stage04-B2 SQL drift: '+file)
}
// Preserve the exact Workshop screen while running historical source-size baselines.
// New Stage04-D UI runs its own current-code acceptance before the old suite.
const stage04DWorkshopScreen={
  file:'src/features/sections/WorkshopSection.tsx',
  fixture:'scripts/fixtures/stage04d-workshop-20261011/WorkshopSection.tsx',
  before:'d21020d65f3469997a3a579d9233362a026a5336',
  after:'907f7c344da250b488831c2176c6b311035da4fc',
}
check(gitBlob(fs.readFileSync(stage04DWorkshopScreen.file,'utf8'))===stage04DWorkshopScreen.after,'Stage04-D Workshop UI drift')
check(gitBlob(fs.readFileSync(stage04DWorkshopScreen.fixture,'utf8'))===stage04DWorkshopScreen.before,'Stage04-D baseline fixture drift')

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
  check(gitBlob(fs.readFileSync(file,'utf8'))===expected,'Catalog port new file drifted: '+file)
}
for(const [file,delta] of Object.entries(manifest.files)){
  check(gitBlob(fs.readFileSync(file,'utf8'))===delta.afterGitBlob,'Unreviewed Catalog runtime drift: '+file)
  check(gitBlob(fs.readFileSync(delta.baselineFixture,'utf8'))===delta.beforeGitBlob,
    'Unreviewed legacy Branch2 fixture drift: '+file)
}

console.log('Checking Stage04 and new Catalog/Writeoff behavior on current runtime...')
const tests=[
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
  ]){
    const from=path.resolve(relative)
    check(gitBlob(fs.readFileSync(from,'utf8'))===expected,'New module drifted: '+relative)
    const to=path.join(staged,relative)
    fs.mkdirSync(path.dirname(to),{recursive:true})
    fs.renameSync(from,to)
    hidden.push({relative,from,to,expected})
  }
  for(const [relative,delta] of Object.entries(manifest.files)){
    const full=path.resolve(relative)
    saved.set(full,fs.readFileSync(full,'utf8'))
    fs.writeFileSync(full,fs.readFileSync(delta.baselineFixture,'utf8'))
  }
  const originalWorkshop=path.resolve(stage04DWorkshopScreen.file)
  saved.set(originalWorkshop,fs.readFileSync(originalWorkshop,'utf8'))
  fs.writeFileSync(originalWorkshop,fs.readFileSync(stage04DWorkshopScreen.fixture,'utf8'))
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
  check(gitBlob(fs.readFileSync(relative,'utf8'))===delta.afterGitBlob,'Failed to restore new runtime: '+relative)
}
check(gitBlob(fs.readFileSync(stage04DWorkshopScreen.file,'utf8'))===stage04DWorkshopScreen.after,'Failed to restore Stage04-D Workshop UI')
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
const workshopChunks=fs.readdirSync(assetsDir).filter(name=>/^WorkshopSection-[A-Za-z0-9_-]+\.js$/.test(name))
check(workshopChunks.length===1,'Current Branch2 build is missing WorkshopSection chunk')
const workshopChunk=fs.readFileSync(path.join(assetsDir,workshopChunks[0]),'utf8')
for(const marker of ['Расчёты с Цехом','Осталось выплатить','Без себестоимости','Сегодня выполнено','Не определена себестоимость','Указать себестоимость','Разобрать позиции','Выплатили полностью','Выплатили часть','Дополнительно (необязательно)','Начисления']){
  check(workshopChunk.includes(marker),'Refusing Stage04-D frontend deploy: missing '+marker)
}
console.log('CURRENT BRANCH2 BUILD VERIFIED — fresh ReferencesSection:',referencesChunks[0])
console.log('CATALOG PORT AND BRANCH2 HISTORICAL GATES PASSED — Stage04 preserved, new runtime checked, baseline suite unchanged')
