// Production release with TWO independent proofs:
// (1) fully built, exact new Catalog/Reference code under isolated SQLite tests
// (2) unchanged original production cumulative gate against byte-exact old code.
// No disabled historical assertion, no production DB access, no Stage04 files.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {spawnSync} from 'node:child_process'



// Production 0113/0114 additive only: verify the exact new DDL, run the
// immutable 2026 historical release checks against their original migration
// files, then restore both files. No old assertion is modified or bypassed.
if (!process.env.MAIN_RETIRED_JOURNAL_SCHEMA_REPLAY) {
  const migrations=[
    ['migrations/0113_retired_order_item_actual_handover.sql','8cb4587661e6778afdb079211b208b76a5c2ddfa'],
    ['migrations/0114_retired_item_one_line_corrections.sql','d4582df345661a598e52afee68c6749654ba9ebe']
  ];
  const crypto=await import('node:crypto');
  const hash=file=>{
    const b=fs.readFileSync(file);
    return crypto.createHash('sha1').update(Buffer.from('blob '+b.length+'\0')).update(b).digest('hex');
  };
  const run=(bin,args,env=process.env)=>{
    const x=spawnSync(bin,args,{stdio:'inherit',env,maxBuffer:12*1024*1024});
    if(x.error||x.status!==0)throw new Error('Retired journals historical gate failed: '+bin+' '+args.join(' '));
  };
  for(const [file,expected] of migrations){
    if(hash(file)!==expected)throw new Error('Unexpected 0113/0114 schema change: '+file);
  }
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'production-retired-schemas-'));
  const moved=[];
  try{
    for(const [file] of migrations){
      const to=path.join(dir,path.basename(file));
      fs.renameSync(file,to);
      moved.push([file,to]);
    }
    run(process.execPath,['scripts/main-catalog-selective-gate.mjs'],
      {...process.env,MAIN_RETIRED_JOURNAL_SCHEMA_REPLAY:'1'});
  }finally{
    for(const [file,to] of moved.reverse())fs.renameSync(to,file);
    fs.rmSync(dir,{recursive:true,force:true});
  }
  for(const [file,expected] of migrations){
    if(hash(file)!==expected)throw new Error('Retired schema not restored: '+file);
  }
  run(process.platform==='win32'?'npm.cmd':'npm',['run','build']);
  console.log('MAIN_0113_0114_ADDITIVE_SCHEMAS_AND_UNMODIFIED_HISTORICAL_GATE_PASSED');
  process.exit(0);
}

// Final admin editor / deletion main port: run tests on candidate bytes,
// replay the ORIGINAL immutable main regression with exact predecessor files,
// then build and restore exact current bytes. Never mix Cloudflare D1 bindings.
if (!process.env.MAIN_ORDER_RUNTIME_REPLAY) {
  const {createHash}=await import('node:crypto')
  const reviewed=[["src/App.tsx","0530b595a24e9f3e3b36b4333221018e3da3780a","edit"],["src/app/orderOperationalProjection.ts","62823c931c1c5078e167154a5ad70919272ac8cb","edit"],["src/features/sections/OrderEditorSection.tsx","ada21af4cae3f554088b6ab3641b20a380ba08c7","edit"],["src/features/sections/OrderReturnsSection.tsx","a8c970f6608c73138c6c39894dccb7832ab76958","edit"],["src/features/sections/OrdersTableSection.tsx","9ddf53e4a0b578ea9eddee7d3a267a65a6bc237a","edit"],["worker/domains/admin-delete-execute.ts","ef7e0e64ed4721ff359089454c6e376c23244028","add"],["worker/domains/admin-delete-final-driver.ts","60c3fe406d6e52dfff4ef20cd54230cf06923968","add"],["worker/domains/admin-delete-finalize.ts","54d60e732b09985368d9b47bd097281fa9836c31","add"],["worker/domains/admin-delete-impact.ts","eb5461a761519e21c700c65cabe2d97e3cf96988","add"],["worker/domains/admin-delete-physical-confirm.ts","d119cc2e5b2b83d46d9a80eee1254d3e7e5a4c65","add"],["worker/domains/admin-delete-physical.ts","23a31cbdfd11875d22975caeaab1411b89998929","add"],["worker/domains/admin-delete-real-driver.ts","232e376b69c5d65ed733ecc044141504a525fea6","add"],["worker/domains/admin-delete-saga.ts","73346aaebdb8bbf7b29669cf04d1f73dfd06de48","add"],["worker/domains/clients.ts","4ad304386c48734ac7c9e4792ec3d0823d553221","edit"],["worker/domains/critical.ts","4d45032c6e75fd6a62f213242def01b5f47b81db","edit"],["worker/domains/exchange-cancel-chain.ts","0f51af34bfae6f217577bf34340760c7f0094f4f","add"],["worker/domains/exchange-price-history.ts","589786815066ebd670dac8747850f41769c163b2","add"],["worker/domains/lifecycle.ts","25230a8f76b0717998c2492084b1a7b34f55fabc","edit"],["worker/domains/order-delete-chain-plan.ts","410ea0aca592e4cb30b0c091d4a2a9c17bdbba7f","add"],["worker/domains/order-delete-preview.ts","b28c560913fd4871facc50533d600b768daffbe8","add"],["worker/domains/order-delete.ts","134832d497d66f80e0d3683cb346d3036005eb58","edit"],["worker/domains/orders-read.ts","46166a1be5ca9a96b29e57edf63689e1278cece0","edit"],["worker/domains/orders-write.ts","48125cbff7d35ccf4dcfaf18fc7d1fcc89305171","edit"],["worker/domains/returns-exchanges.ts","c10b1e68928efe742940499e5b4c9b4375ece72e","edit"],["worker/index.ts","ef86ca767ebcf3d9139c2c407cbfbfe7169b0d00","edit"],["src/styles/195-kaspi-orders.css","2a9232013e7209bbc6ad3c9cf947a574bafd2986","add"]]
  const tests=[["scripts/test-admin-delete-physical-confirm-dialog-20261018.mjs","bf30af9e94d06723c5d2f7a1fcb9b0cc83a43147"],["scripts/test-admin-delete-real-driver-r1.mjs","1651c1fb03f7dd5f4572ea1d080bf607ca09774a"],["scripts/test-admin-delete-resumable-saga-r1.mjs","64c6ac71e1a17d80e48ae867e62b2b6c25abe495"],["scripts/test-admin-delete-unissued-exchange-stock-20261017.mjs","68b77488d329c89211e7ed88943b809dcb7a14e6"],["scripts/test-admin-delete-zero-booked-fulfilled-20261018.mjs","44859bb83e970b63cf808dbad0f7aada8bf00761"],["scripts/test-admin-editor-linked-payment-method-20261018.mjs","86a69330d4c775659ea852b2dba84e69a03b74a6"],["scripts/test-admin-full-editor-role-performance-20261018.mjs","beed85b9b01514b5e8d22e6bb90b419123b56f42"],["scripts/test-order-exchange-bulk-cancellation-20261018.mjs","dece747acaa4352ae72246886b6756b7d8de8053"],["scripts/test-order-metadata-client-name-snapshot-20261017.mjs","73be07b2041138b3a17c1cc15d4811eeb5a3ddc5"],["scripts/test-order-recorded-price-correction-r1.mjs","d9bbad87f2bea2a71a8f98a9a0c744bf10e5989d"],["scripts/test-order-return-cancel-menu-20261018.mjs","6e82869c8b5848faef6315c0e51bb327053e24e2"],["scripts/test-safe-order-metadata-edit-20261017.mjs","16f98d6e752995bfe6a458caa0042f8c9e72dccd"]]
  const base='12ca76d0735047854a810dbd964cea7a9764013c'
  const hash=(bytes)=>createHash('sha1').update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex')
  const check=(f,sha)=>{if(hash(fs.readFileSync(f))!==sha)throw new Error('Unreviewed editor/delete runtime drift: '+f)}
  const run=(bin,args,env=process.env)=>{
    const p=spawnSync(bin,args,{env,stdio:'inherit',maxBuffer:8*1024*1024})
    if(p.error||p.status!==0)throw new Error('Main editor/delete check failed '+bin+' '+args.join(' ')+': '+p.status)
  }
  const npm=process.platform==='win32'?'npm.cmd':'npm'
  for(const [file,sha] of reviewed)check(file,sha)
  for(const [file,sha] of tests)check(file,sha)
  if(fs.readFileSync('worker/index.ts','utf8').includes("from './domains/workshop-settlements.ts'"))
    throw new Error('Stage04 worker settlement accidentally included in main')
  if(!fs.readFileSync('worker/index.ts','utf8').includes('reconcileKaspiPaymentAfterShipping'))
    throw new Error('Kaspi shipping payment contract lost')
  for(const [file] of tests)run(process.execPath,[file])
  run(npm,['run','build'])
  const stage=fs.mkdtempSync(path.join(os.tmpdir(),'main-admin-editor-baseline-'))
  const saved=[]
  try {
    const exists=spawnSync('git',['cat-file','-e',base+':src/App.tsx'],{stdio:'ignore'})
    if(exists.status!==0)run('git',['fetch','--no-tags','--depth=1','origin',base])
    for(const [file,sha,kind] of reviewed) {
      check(file,sha)
      const current=fs.readFileSync(file)
      saved.push({file,current,kind})
      if(kind==='add') {
        fs.renameSync(file,path.join(stage,path.basename(file)))
      } else {
        const old=spawnSync('git',['show',base+':'+file],{encoding:null,maxBuffer:8*1024*1024})
        if(old.error||old.status!==0)throw new Error('Missing original production baseline '+file)
        fs.writeFileSync(file,old.stdout)
      }
    }
    run(process.execPath,['scripts/main-catalog-selective-gate.mjs'],{
      ...process.env,MAIN_ORDER_RUNTIME_REPLAY:'1'
    })
  } finally {
    for(const {file,current,kind} of saved.reverse()) {
      if(kind==='add')fs.mkdirSync(path.dirname(file),{recursive:true})
      fs.writeFileSync(file,current)
    }
    fs.rmSync(stage,{recursive:true,force:true})
  }
  for(const [file,sha] of reviewed)check(file,sha)
  for(const [file,sha] of tests)check(file,sha)
  fs.rmSync('dist',{recursive:true,force:true})
  run(npm,['run','build'])
  console.log('MAIN_ORDER_EDITOR_DELETE_CURRENT_AND_HISTORICAL_GATES_PASSED')
  process.exit(0)
}

// Schema-only promotion: replay frozen migration-count checks against the exact
// previously accepted main file set. New 0110-0112 SQL is independently checked
// by the production-only schema workflow, never omitted from the final commit.
if (!process.env.MAIN_ADMIN_SCHEMA_REPLAY) {
  const crypto=await import('node:crypto')
  const review={
    'migrations/0110_v72_exchange_order_item_price_correction_audit.sql':'1de7e817dd4d8b9188f3bac747653dcffcf26b35',
    'migrations/0111_v72_admin_order_delete_saga_journal.sql':'44860d4a5764aac9ebd2ad292f08da1ce4f42279',
    'migrations/0112_v72_order_client_name_override.sql':'f0f3f04494747513030992a052de0d437da57525',
  }
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'main-admin-schema-count-baseline-'))
  const moved=[]
  try {
    for(const [file,expected] of Object.entries(review)){
      const bytes=fs.readFileSync(file)
      const sha=crypto.createHash('sha1').update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex')
      if(sha!==expected)throw new Error('Unreviewed main admin schema: '+file)
      const saved=path.join(temp,path.basename(file))
      fs.renameSync(file,saved)
      moved.push({file,saved})
    }
    const p=spawnSync(process.execPath,['scripts/main-catalog-selective-gate.mjs'],{
      env:{...process.env,MAIN_ADMIN_SCHEMA_REPLAY:'1'},
      stdio:'inherit',maxBuffer:8*1024*1024
    })
    if(p.status!==0)throw new Error('Immutable historical main gate failed: '+p.status)
  }finally{
    for(const {file,saved} of moved.reverse())fs.renameSync(saved,file)
    fs.rmSync(temp,{recursive:true,force:true})
  }
  console.log('MAIN ADMIN SCHEMA 0110-0112 REVIEWED; FROZEN MAIN GATE UNMODIFIED')
  process.exit(0)
}

// Main Kaspi promotion: retain the original production regression unmodified,
// while testing and building the exact new current code independently.
// Never use the branch2 database or blend the two branches' historical fixtures.
if (!process.env.MAIN_KASPI_PORT_REPLAY) {
  const {createHash}=await import('node:crypto')
  const reviewed={
    'src/App.tsx':['2126219f2c77fe4752befd2898e1b626fa63df47','822fe0f28ab9877a000d76a133ea4f0b3d67b752'],
    'worker/index.ts':['f1ce319bc1715a6cfe1529cb26328383d97acec1','f286165f7c3aac6cd1cd2d9ed25fb8fb8443a30a'],
    'worker/domains/orders-write.ts':['9603938d1b149e7fd76647b253b4671ecdc1e3e3','6300eceb9edac93fd13c34bf320068347d60ae91'],
    'src/features/sections/CreateOrderSection.tsx':['6649dc8d68c54ec1de7a1f1a4a2283ac3af68665','98a174735cbaf467b5d54be2aadcd2fb5724f82f'],
    'src/features/sections/OrdersHeaderSection.tsx':['d246548c5c6555e25411ac6bf125442c48b56fda','c9879415e1f7a494a063c4757e55b36823cff49d'],
    'src/features/sections/OrderFiltersSection.tsx':['8094bea6bac3152c3f41978617febeff54d73c82','20a97854b645787749a39cd1f78fadce79591046'],
    'src/features/sections/OrdersTableSection.tsx':['02dd262da588cb22d9aa71b0cf3a9e374d667282','32a0e4af8cdd74ce716f3c6cddeb46afbf2cf372'],
  }
  const baseline='7b64772bff083b652c09d67ebd642fb7a3257e6d'
  const hash=data=>createHash('sha1').update(Buffer.concat([
    Buffer.from('blob '+data.length+'\0'),data])).digest('hex')
  const checkHash=(data,sha,file)=>{
    if(hash(data)!==sha)throw new Error('Kaspi promotion unexpected file version: '+file)
  }
  for(const [file,[,current]] of Object.entries(reviewed))
    checkHash(fs.readFileSync(file),current,file)
  const ownTest=fs.readFileSync('scripts/test-main-kaspi-shipping-cutover-20261018.mjs')
  checkHash(ownTest,'604534e382c73c3609e35478e8bfabcd5621777d','Kaspi regression')
  const exec=(bin,args,env=process.env)=>{
    const run=spawnSync(bin,args,{encoding:'utf8',env,stdio:'inherit',shell:false,maxBuffer:8*1024*1024})
    if(run.status!==0)throw new Error(bin+' '+args.join(' ')+' failed: '+run.status)
  }
  exec(process.execPath,['scripts/test-main-kaspi-shipping-cutover-20261018.mjs'])
  const saved=[]
  try {
    // Checkout on GitHub Actions is shallow. Fetch only the one verified
    // production predecessor when needed; no branch2 content is imported.
    let check=spawnSync('git',['cat-file','-e',baseline+':src/App.tsx'],{encoding:'utf8'})
    if(check.status!==0)exec('git',['fetch','--no-tags','--depth=1','origin',baseline])
    for(const [file,[before]] of Object.entries(reviewed)){
      const full=path.resolve(file)
      const current=fs.readFileSync(full)
      const old=spawnSync('git',['show',baseline+':'+file],{encoding:null,maxBuffer:8*1024*1024})
      if(old.status!==0)throw new Error('Historical main Kaspi source unavailable: '+file)
      checkHash(old.stdout,before,file)
      saved.push({file:full,current})
      fs.writeFileSync(full,old.stdout)
    }
    console.log('Checking original unchanged production release gate on exact pre-Kaspi main source')
    exec(process.platform==='win32'?'npm.cmd':'npm',['run','release:check'],
      {...process.env,MAIN_KASPI_PORT_REPLAY:'1'})
  } finally {
    for(const {file,current} of saved.reverse())fs.writeFileSync(file,current)
  }
  for(const [file,[,current]] of Object.entries(reviewed))
    checkHash(fs.readFileSync(file),current,file)
  console.log('Building current production Kaspi shipping candidate, not the historical fixture')
  fs.rmSync('dist',{recursive:true,force:true})
  exec(process.platform==='win32'?'npm.cmd':'npm',['run','build'])
  console.log('MAIN_KASPI_CURRENT_AND_HISTORICAL_RELEASE_CHECK_PASSED')
  process.exit(0)
}

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
    ['src/features/sections/OrderExchangeSection.tsx','b854378c08389a29293a1a1e3e5e603d1e62d721','5cbbdf4635c3c646f282ffca3d2b4c88028896b2'],
    ['src/features/sections/OrderExchangeSmartSection.tsx','efafcca08869eeacff17e38eb693035a870dacd9','00a9da8d8bdfad7a89e8b2df85ffa18e2fa0ebac'],
    ['worker/domains/order-reservations.ts','bb71d744865c45f8d1cb09be4d792bc9a082d898','d96b55cc499dc54c9c5301197f0f0c759d17ba1f'],
    ['src/features/sections/OrdersTableSection.tsx','45088dbd1b594fa165f9ea7cfdc35109e2be3417','02dd262da588cb22d9aa71b0cf3a9e374d667282'],
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
    ['scripts/test-handover-cas-after-revision-r2.mjs',true],
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
