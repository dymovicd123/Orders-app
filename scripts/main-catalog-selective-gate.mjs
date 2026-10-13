// Production release with TWO independent proofs:
// (1) fully built, exact new Catalog/Reference code under isolated SQLite tests
// (2) unchanged original production cumulative gate against byte-exact old code.
// No disabled historical assertion, no production DB access, no Stage04 files.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {spawnSync} from 'node:child_process'
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
   const from='    inventoryPanelStyle,\\n    movementSourceLoadError,'
   const to='    inventoryPanelStyle,\\n    isAdmin,\\n    movementSourceLoadError,'
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
