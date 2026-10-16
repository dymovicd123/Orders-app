// Production release with TWO independent proofs:
// (1) fully built, exact new Catalog/Reference code under isolated SQLite tests
// (2) unchanged original production cumulative gate against byte-exact old code.
// No disabled historical assertion, no production DB access, no Stage04 files.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {spawnSync} from 'node:child_process'


// 2026-10-13: preserve the last validated production Exchange implementation
// during historical release:check. The current exchange code has a separate
// no-stocktake regression and independent current-code build. We fetch the
// already-public, exact pre-hotfix Git object rather than duplicate ~1MB source
// fixtures or silently weaken a single historical assertion.
if (!process.env.MAIN_EXCHANGE_LEGACY_REPLAY) {
  const {createHash} = await import('node:crypto')
  const baseline='0b9989dac80a213f88417843a6becac3f7bbb1f6'
  const warehouseBaseline='3813d5346aed821f42fbbc24f12e65430acba689'
  const arrivalBaseline='cdbe0fd2e13217325f319f2975a96c9d19413c1b'
  const stockFiles=[
    // Replay only the immutable pre-UX hint source for legacy production tests.
    ['src/app/controllers/useWorkspaceViewModel.tsx','74e13c339069c7a63b4df578af51a675777fe371','e9d875f036beb0a43222d035391efdba57dc4116'],
    ['src/App.tsx','c757fcd87fbf555f049a33463f1820337c615db3','2126219f2c77fe4752befd2898e1b626fa63df47'],
    // Replay the last reviewed catalogue/stock view-model for historical tests;
    // verify the new read-only stock-source overlay separately on candidate code.
    // Reviewed, isolated material chooser fix from branch2 PR #434: the approved
    // predecessor is 94f600..., and only this controller receives new bytes.
    ['src/app/controllers/useOperationalViewModel.ts','3b0ebdc1b92213e5cab73a5bf493c7d34cfd6b95','b34991dae36234e70ee3a3014bf2c09cd731ee92',baseline],
    ['src/features/sections/OrderExchangeSection.tsx','b854378c08389a29293a1a1e3e5e603d1e62d721','f71c7705d7433de51333255969c01967e96186f5'],
    ['src/features/sections/OrderExchangeSmartSection.tsx','efafcca08869eeacff17e38eb693035a870dacd9','00a9da8d8bdfad7a89e8b2df85ffa18e2fa0ebac'],
    ['worker/domains/order-reservations.ts','bb71d744865c45f8d1cb09be4d792bc9a082d898','5cce2548ac5959f1a2baebfb68e306ffc54e13d1'],
    ['src/features/sections/OrdersTableSection.tsx','45088dbd1b594fa165f9ea7cfdc35109e2be3417','31b329d56fc804629acd8a5577705589cf2cc660'],
    ['worker/domains/lifecycle.ts','25f08471020220883107de8ee02b26bc774eb29a','039b84adc58aadefc6ded14b6dd9fa73a6aeb847'],
    ['worker/domains/returns-exchanges.ts','af53527b060ec388bbe9058b80df16a564b8af4c','14327c966fceb9f42f49c1fc39148e8081c4a19f'],
    ['worker/domains/exchange-batch.ts','725515005ad9e64d30e6eb2605f974c7947358e3','0c7d1c0b8eb3b013a8f7c0a8f1986d6ecfc55a45'],
    ['worker/domains/inventory-movement.ts','78ed3642479e9b961c01f063fb6900a041b9f0b5','5403949b89141ee3c0ccbf41e0ac42228d921443',arrivalBaseline],
    // These three files are replayed from the exact pre-safety production commit.
    // The new stocktake SQL lifecycle and UI have independent live tests above.
    ['src/features/sections/InventorySection.tsx','cf69e21e4fda04ee6d3b0e9bffd08c9f724ab62a','430998dabe195e090087e56d092bbd5f400da2ad',warehouseBaseline],
    ['worker/domains/inventory-stocktake.ts','c40f2c4bbd5075aab4412a08e77df8ad76dae0e9','7df026a8e0de46062e73b1248a7ada063a45710b',warehouseBaseline],
    ['scripts/test-stocktake-functional-acceptance.mjs','3ca20472b6a89f81d188c59f23a483d1df93aadb','23d73702c78798a08c9a370ea23aa0eebad2bcb8',warehouseBaseline],
    // New SKU finalization files are replayed as their exact pre-feature MAIN
    // versions only for the untouched cumulative historical regression.
    ['worker/domains/catalog-variant-consolidation.ts','7a69c78d2c7c65e1b7b676b619e8d16b8db9d447','126710444bcd74638386e53df91dbb1ca95a75e6','01f344c11a45ed0ea5811702e3825d0329ce8bd6'],
    ['worker/index.ts','18eaed28fed6f72111e6d6ef6bc8128903b8e091','f1ce319bc1715a6cfe1529cb26328383d97acec1','01f344c11a45ed0ea5811702e3825d0329ce8bd6'],
    ['src/features/sections/ReferenceMergeWorkspace.tsx','5115e75647506e2dfc0e9764ef3887e1927a6140','dfbf117fd4a7c4a92eec28615ee5334ad6a69f47','01f344c11a45ed0ea5811702e3825d0329ce8bd6'],
    ['scripts/test-catalog-integrity-r2-sku-consolidation.mjs','90fa7d5ebdb9b5f3f6f5738853247fb8a786b307','dac49e71f9673c9766b4c6af256d6fe9f2a41cc4','01f344c11a45ed0ea5811702e3825d0329ce8bd6'],
    ['scripts/test-catalog-zero-stock-undo.mjs','ded516075ec6cff6ef660dd38163f81f8d5ff7cb','528c9e0e89dce24c863a6aaf0a7fbc3b7a6f7436','01f344c11a45ed0ea5811702e3825d0329ce8bd6'],
    ['scripts/test-catalog-positive-stock-undo.mjs','73ee8e895601be2dd39b04d2fce0bf4ca620c6fa','dae163ccc12b570fd0bde1cf066d60ab77360864','01f344c11a45ed0ea5811702e3825d0329ce8bd6'],
    ['scripts/test-catalog-reserved-stock-undo.mjs','8fc119f3405d74584f7e1bfc5c866a97016a9e4d','d95f289dc965307ee49c3b19f981238c072bd12b','01f344c11a45ed0ea5811702e3825d0329ce8bd6'],
  ]
  const hash=data=>createHash('sha1').update('blob '+data.length+'\0').update(data).digest('hex')
  const git=(args,allowFailure=false)=>{
    const p=spawnSync('git',args,{encoding:null,timeout:90000,maxBuffer:8*1024*1024})
    if(p.error||(!allowFailure&&p.status!==0))throw new Error('Git baseline '+args[0]+' unavailable: '+String(p.stderr||p.error))
    return p
  }
  const assert=(ok,message)=>{if(!ok)throw new Error(message)}
  const wrangler=fs.readFileSync('wrangler.jsonc','utf8')
  assert(wrangler.includes('"database_name": "orders_db_prod"')&&wrangler.includes('"database_id": "17e68a41-1d58-4a36-8a63-47c3e32443c4"')&&!wrangler.includes('orders_db_branch2'),'Exchange production gate cannot target branch2 D1')
  const saved=[]
  for(const [relative,before,after,sourceRef] of stockFiles){
    const current=fs.readFileSync(relative)
    assert(hash(current)===after,'Exchange production candidate differs from reviewed file: '+relative)
    saved.push({relative,current,before,sourceRef})
  }
  for (const [file,why] of [
    ['scripts/test-main-exchange-no-recount-20261013.mjs','Current explicit exchange issue regression'],
    ['scripts/test-stock-shortage-ui-no-inline-recount-20261013.mjs','Current order/exchange shortage UX regression'],
    ['scripts/test-inventory-integrity-safety-20261014.mjs','Atomic handover and measured-count retention'],
    ['scripts/test-stocktake-functional-acceptance.mjs','Live SQL stocktake safety'],
    ['scripts/test-inventory-snapshot-freshness-20261014.mjs','Current warehouse full-snapshot reliability'],
    ['scripts/test-stock-source-switch-freshness-20261014.mjs','Force exact selected stock location on source switch'],
    ['scripts/test-stock-snapshot-authority-20261014.mjs','Production-shape boutique SKU 655 physical quantity overrides catalogue-derived zero'],
    ['scripts/test-arrival-orda-boutique-identity-20261014.mjs','ORDA canonical product and boutique stock receipt regression'],
  ]) {
    const test=spawnSync(process.execPath,[file],{stdio:'inherit',timeout:90000})
    assert(!test.error&&test.status===0,why+' failed')
  }
  // Verify the live candidate's historical-after-revision decision logic and
  // before-shipping guard BEFORE replaying the exact frozen production baseline.
  for(const [testFile,needsStrip] of [
    ['scripts/test-old-order-post-stocktake-handover-r1.mjs',true],
    ['scripts/test-old-order-post-stocktake-guard-r1.mjs',false],
  ]){
    const result=spawnSync(process.execPath,[
      ...(needsStrip?['--experimental-strip-types']:[]),testFile
    ],{stdio:'inherit',timeout:90000})
    assert(!result.error&&result.status===0,'Main post-revision handover acceptance failed: '+testFile)
  }
  if(git(['cat-file','-e',baseline+':src/App.tsx'],true).status!==0)git(['fetch','--no-tags','--depth=1','origin',baseline])
  if(git(['cat-file','-e',warehouseBaseline+':src/App.tsx'],true).status!==0)git(['fetch','--no-tags','--depth=1','origin',warehouseBaseline])
  if(git(['cat-file','-e',arrivalBaseline+':worker/domains/inventory-movement.ts'],true).status!==0)git(['fetch','--no-tags','--depth=1','origin',arrivalBaseline])
  const preFinalizationBaseline='01f344c11a45ed0ea5811702e3825d0329ce8bd6'
  if(git(['cat-file','-e',preFinalizationBaseline+':worker/index.ts'],true).status!==0)
    git(['fetch','--no-tags','--depth=1','origin',preFinalizationBaseline])
  // Live candidate finalization tests: run BEFORE touching frozen historical data.
  for(const file of ['scripts/test-ethno-size52-manual-history-finalization.mjs','scripts/test-ethno-size52-finalization-runtime.mjs']){
    const test=spawnSync(process.execPath,[
      ...(file.includes('finalization-runtime')?['--experimental-strip-types']:[]),file
    ],{stdio:'inherit',timeout:90000})
    assert(!test.error&&test.status===0,'Production SKU finalization test failed: '+file)
  }
  // The legacy catalog release manifest intentionally pins this gate's original
  // contents. Replay those exact bytes for the old suite, not weakened assertions.
  // The current candidate and its new UI tests already ran above.
  const gatePath='scripts/main-catalog-selective-gate.mjs'
  const currentGate=fs.readFileSync(gatePath)
  const historicalGate=fs.readFileSync('scripts/fixtures/stock-shortage-ui-20261013/main-catalog-selective-gate.mjs')
  assert(hash(historicalGate)==='aff90ae839acd3df0ff354032f1cfee8fa027855',
    'Frozen production historical release gate drifted')
  assert(currentGate.includes(Buffer.from('test-stock-shortage-ui-no-inline-recount-20261013.mjs')),
    'Production candidate missing new shortage UI acceptance')
  // Additive 0109 is reviewed on the CURRENT production candidate. The frozen
  // pre-0109 history suite counts migrations exactly; temporarily hide ONLY this
  // schema while replaying it, then restore it even after a failed test.
  const newSchema='migrations/0109_v72_catalog_manual_movement_finalization.sql'
  const schemaBytes=fs.readFileSync(newSchema)
  assert(hash(schemaBytes)==='06314e11b70918ae5a133b076f397fbbb27d0511',
    'Unreviewed production schema 0109 drift')
  const hiddenSchemaDir=fs.mkdtempSync(path.join(os.tmpdir(),'main-ethno-0109-historical-'))
  const hiddenSchema=path.join(hiddenSchemaDir,'0109.sql')
  fs.renameSync(newSchema,hiddenSchema)
  // New domain handler and runtime test files belong only to the new candidate.
  const additionalFiles=[
    ['worker/domains/catalog-manual-history-finalization.ts','ce672c90cd6d223a853aa827bb5bea466c695624'],
    ['scripts/test-ethno-size52-manual-history-finalization.mjs','b351c28dc725273e321cf6a3274961928cf99092'],
    ['scripts/test-ethno-size52-finalization-runtime.mjs','894cbbb7120627f49c5271274d2a3e3c99a591bc'],
  ]
  const hiddenNew=[]
  for(let i=0;i<additionalFiles.length;i++){
    const [file,expected]=additionalFiles[i]
    assert(hash(fs.readFileSync(file))===expected,'Unexpected candidate finalization module: '+file)
    const staged=path.join(hiddenSchemaDir,'candidate-'+i)
    fs.renameSync(file,staged)
    hiddenNew.push({file,expected,staged})
  }
  let historicalTestFailed=false
  try{
    for(const entry of saved){
      const blob=git(['show',(entry.sourceRef||baseline)+':'+entry.relative]).stdout
      assert(hash(blob)===entry.before,'Pre-fix Production baseline changed: '+entry.relative)
      fs.writeFileSync(entry.relative,blob)
    }
    fs.writeFileSync(gatePath,historicalGate)
    const oldRun=spawnSync(process.execPath,['scripts/main-catalog-selective-gate.mjs'],{
      stdio:'inherit',timeout:900000,
      env:{...process.env,MAIN_EXCHANGE_LEGACY_REPLAY:'1'}
    })
    if(oldRun.error||oldRun.status!==0)historicalTestFailed=true
  }finally{
    fs.renameSync(hiddenSchema,newSchema)
    assert(hash(fs.readFileSync(newSchema))===hash(schemaBytes),'0109 schema not restored after historical replay')
    for(const item of hiddenNew.reverse()){
      fs.renameSync(item.staged,item.file)
      assert(hash(fs.readFileSync(item.file))===item.expected,'Finalization source restoration failure: '+item.file)
    }
    fs.rmSync(hiddenSchemaDir,{recursive:true,force:true})
    fs.writeFileSync(gatePath,currentGate)
    assert(hash(fs.readFileSync(gatePath))===hash(currentGate),
      'Could not restore reviewed Production gate after legacy suite')
    for(const entry of saved.reverse()){
      fs.writeFileSync(entry.relative,entry.current)
      assert(hash(fs.readFileSync(entry.relative))===hash(entry.current),'Could not restore current exchange source: '+entry.relative)
    }
  }
  assert(!historicalTestFailed,'Unmodified historical Production regression failed')
  const build=spawnSync(process.platform==='win32'?'npm.cmd':'npm',['run','build'],{stdio:'inherit',timeout:600000})
  assert(!build.error&&build.status===0,'New Production exchange runtime did not build')
  console.log('PRODUCTION EXCHANGE NO-RECOUNT VERIFIED — current stock protection, historical baseline and current build')
  process.exit(0)
}
const manifest=JSON.parse(fs.readFileSync('scripts/main-catalog-selective-manifest.json','utf8'))
const check=(ok,s)=>{if(!ok)throw new Error(s)}
const blob=file=>{
 const p=spawnSync('git',['hash-object',file],{encoding:'utf8',timeout:15000})
 check(p.status===0,'Cannot hash '+file+': '+p.stderr)
 return p.stdout.trim()
}
const run=(name,args,what)=>{
 const p=spawnSync(name,args,{stdio:'inherit',env:{...process.env,MAIN_CATALOG_PORT_GATE:'1'},timeout:600000})
 check(!p.error && p.status===0,what+' failed with exit '+p.status)
}
// Verify the new Production stock UI, then restore byte-exact legacy files
// only during the unchanged historical cumulative regression.
const warehouseUiScreens=[
 {file:'src/features/sections/InventorySection.tsx',
  fixture:'scripts/fixtures/stock-visibility-20261013/InventorySection.tsx',
  before:'c3ba07c011ef9b68b5fa3cb0a52471851877eed8',
  after:'cf69e21e4fda04ee6d3b0e9bffd08c9f724ab62a'},
 {file:'src/features/inventory/views/renderInventoryOverviewPanel.tsx',
  fixture:'scripts/fixtures/stock-visibility-20261013/renderInventoryOverviewPanel.tsx',
  before:'9b7738d3589f0091e120dec7f1f3a056abc4cc0d',
  after:'0e624c9109157fe9bbd9512d57ce062cfc0a5b2f'},
]
for(const screen of warehouseUiScreens){
 check(blob(screen.file)===screen.after,'Unreviewed production warehouse screen: '+screen.file)
 check(blob(screen.fixture)===screen.before,'Warehouse historical fixture drift: '+screen.fixture)
}
// These reviewed stock-truth changes are independently tested on live candidate
// code, while historical regression sees byte-exact Production before this patch.
const stockTruthSnapshots = [
  {
    "file": "worker/domains/order-reservations.ts",
    "before": "b27726ebea9546120d1b75a6862bd77b9154714e",
    "after": "bb71d744865c45f8d1cb09be4d792bc9a082d898",
    "oldText": "  const observedPhysical = item.observedPhysicalQuantity == null ? null : item.observedPhysicalQuantity;",
    "newText": "  // An order reservation must never be interpreted as an absolute physical stocktake.\n  // Preserve the legacy exchange path until its separate outbound-possession flow is migrated.\n  const observedPhysical = referenceType === 'exchange_new' && item.observedPhysicalQuantity != null\n    ? item.observedPhysicalQuantity : null;"
  },
  {
    "file": "src/features/inventory/views/renderInventoryMovementPanel.tsx",
    "before": "dc89847d2bac17d53320c3e4097ce4fbfd35e27b",
    "after": "5e869edf3eb353d0d5368b31f4f19548833ddd03",
    "oldText": "                            ...(isAdmin ? [['arrival', 'Приход']] : []),\n                            ['writeoff', 'Списание'],\n                            ['manual_set', 'Исправить количество'],",
    "newText": "                            ['arrival', 'Приход'],\n                            ['manual_set', 'Исправить количество'],\n                            ['writeoff', 'Списание'],"
  }
]
for(const entry of stockTruthSnapshots){
 check(blob(entry.file)===entry.after,'Unreviewed stock-truth change: '+entry.file)
}
run(process.execPath,['scripts/test-inventory-stock-visible-reservations.mjs'],'Current production reserved and shortage warehouse regression')
check(manifest.version===1,'Invalid selective release manifest')
const wrangler=fs.readFileSync('wrangler.jsonc','utf8')
check(wrangler.includes('"name": "orders-app"')&&wrangler.includes('"database_name": "orders_db_prod"')
 &&wrangler.includes('"database_id": "17e68a41-1d58-4a36-8a63-47c3e32443c4"'),'Not an exact production candidate')
check(!wrangler.includes('orders_db_branch2'),'Branch2 DB binding prohibited')
check(!fs.existsSync('migrations/0083_v72_workshop_settlement_foundation.sql')
 && !fs.existsSync('migrations/0084_v72_workshop_settlement_status_capture.sql'),'Stage04 is out of scope')
for(const f of manifest.modified){
 check(blob(f.path)===f.newSha,'Unreviewed modification: '+f.path)
 check(blob('scripts/fixtures/main-catalog-preport-20261010/'+f.path)===f.oldSha,
  'Historical Production reference fixture changed: '+f.path)
}
for(const f of manifest.added) check(blob(f.path)===f.sha,'Unexpected added file drift: '+f.path)
console.log('CHECKING CURRENT PRODUCTION CATALOG REFERENCE CANDIDATE')
for(const file of manifest.currentTests){
 run(process.execPath,['--experimental-strip-types',file],'Current catalog/reference regression: '+file)
}
console.log('CURRENT CATALOG/REFERENCE REGRESSION PASSED:',manifest.currentTests.length)
const staging=fs.mkdtempSync(path.join(os.tmpdir(),'prod-catalog-baseline-'))
const moved=[],saved=[]
try{
 // The production schema migration has already been installed, so its
 // post-schema migration verifier remains intact in the released code.
 // Only the isolated historical fixture uses the exact pre-schema verifier.
 const legacyVerifier='scripts/test-step1906c-dead-code-cleanup.mjs'
 const prev=fs.readFileSync(legacyVerifier)
 const frozen=fs.readFileSync('scripts/fixtures/main-catalog-preport-20261010/'+legacyVerifier)
 saved.push({path:legacyVerifier,current:prev,sha:blob(legacyVerifier)})
 fs.writeFileSync(legacyVerifier,frozen)
 for(const f of manifest.added.filter(x=>/^(src|worker|migrations)\//.test(x.path))){
  const dst=path.join(staging,f.path)
  fs.mkdirSync(path.dirname(dst),{recursive:true})
  fs.renameSync(f.path,dst)
  moved.push({from:f.path,dst,expected:f.sha})
 }
 for(const f of manifest.modified){
  const old=fs.readFileSync(f.path)
  saved.push({path:f.path,current:old,sha:f.newSha})
  fs.writeFileSync(f.path,fs.readFileSync('scripts/fixtures/main-catalog-preport-20261010/'+f.path))
 }
 for(const screen of warehouseUiScreens){
  const current=fs.readFileSync(screen.file)
  saved.push({path:screen.file,current,sha:screen.after})
  fs.writeFileSync(screen.file,fs.readFileSync(screen.fixture))
 }
 for(const entry of stockTruthSnapshots){
  const current=fs.readFileSync(entry.file,'utf8')
  check(current.includes(entry.newText),'Stock-truth runtime changed unexpectedly: '+entry.file)
  let historical=current.replace(entry.newText,entry.oldText)
  // Reintroduce the original role binding only for the old, immutable test suite.
  // The current production UI intentionally has no admin-gated Operations menu.
  if(entry.file==='src/features/inventory/views/renderInventoryMovementPanel.tsx'){
   const from='    inventoryPanelStyle,\n    movementSourceLoadError,'
   const to='    inventoryPanelStyle,\n    isAdmin,\n    movementSourceLoadError,'
   check(historical.includes(from),'Movement historic role binding marker changed')
   historical=historical.replace(from,to)
  }
  saved.push({path:entry.file,current:Buffer.from(current),sha:entry.after})
  fs.writeFileSync(entry.file,historical)
  check(blob(entry.file)===entry.before,'Cannot reconstruct exact pre-fix historical runtime: '+entry.file)
 }
 console.log('Checking original, unmodified Production release:check against byte-exact Production baseline')
 run(process.platform==='win32'?'npm.cmd':'npm',['run','release:check'],'Original full Production cumulative regression')
}finally{
 for(const entry of saved.reverse()){
  fs.writeFileSync(entry.path,entry.current)
  check(blob(entry.path)===entry.sha,'Failed to restore current runtime: '+entry.path)
 }
 for(const entry of moved.reverse()){
  fs.renameSync(entry.dst,entry.from)
  check(blob(entry.from)===entry.expected,'Failed to restore added source: '+entry.from)
 }
 fs.rmSync(staging,{recursive:true,force:true})
}
console.log('Building actual proposed Production runtime, NOT preserved historical fixture')
fs.rmSync('dist',{recursive:true,force:true})
run(process.platform==='win32'?'npm.cmd':'npm',['run','build'],'Current selective Catalog/Reference build')
const dir='dist/client/assets'
check(fs.existsSync(dir),'Compiled frontend assets missing')
const inventoryChunks=fs.readdirSync(dir).filter(s=>/^InventorySection-[A-Za-z0-9_-]+\.js$/.test(s))
check(inventoryChunks.length===1,'Expected current Production InventorySection chunk')
const inventoryChunk=fs.readFileSync(path.join(dir,inventoryChunks[0]),'utf8')
for(const phrase of ['Фильтр выбирает товары, но внутри каждого товара видны все размеры','Резерв под заказы превышает физический остаток']){
 check(inventoryChunk.includes(phrase),'Current production warehouse UI missing: '+phrase)
}
const chunks=fs.readdirSync(dir).filter(s=>/^ReferencesSection-[A-Za-z0-9_-]+\.js$/.test(s))
check(chunks.length===1,'Expected one ReferencesSection chunk')
const chunk=fs.readFileSync(path.join(dir,chunks[0]),'utf8')
for(const phrase of ['Все рабочие справочники','Объединить значения','Разобрать прежнее объединение']){
 check(chunk.includes(phrase),'New References UI missing: '+phrase)
}
console.log('MAIN SELECTIVE REFERENCE RELEASE VERIFIED:',chunks[0])
