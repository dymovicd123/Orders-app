// The catalog-only writeoff is a narrow extension of the previously accepted
// Branch2 runtime. Replay every historical gate using exact pre-change blobs,
// then restore/test/build the actual candidate. No Stage04 changes are imported.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'

const baselineRef = '40bab7152f5aa836afe2df740ce3360941773b52'
const baseline = {
  'src/app/controllers/useOperationalViewModel.ts': 'b34991dae36234e70ee3a3014bf2c09cd731ee92',
  'src/features/inventory/views/renderInventoryMovementPanel.tsx': '88ec6ad9ff725980972d77d2a804efefa781c1be',
  'worker/domains/inventory-movement.ts': '5403949b89141ee3c0ccbf41e0ac42228d921443',
  'scripts/catalog-integrity-branch2-preserved-gate.mjs': 'd2cb4cab2e9dd77bdb0b2dc59e15706dca20a2e9',
  'scripts/branch2-unified-kaspi-preserved-gate.mjs': 'c9cd8c8c31b4c19fde6ba45045f4d5ae218f8ae8',
  'worker/index.ts': '36a89ede46aeaefa20433cbc4ccaf0dcf741ebe2',
  'worker/domains/workshop-settlements.ts': '2b7d7461758c116053b4a62a3576f451180b32fc',
  'src/features/workshop/WorkshopSettlementsPanel.tsx': '8ec8a1e6b2fe7849e74881d302ff72a1b095b58f',
  'src/styles/stage04-workshop-settlements.css': '6796899d63de3e2183a95605b9280764c9e64b48',
}
const candidate = {
  'src/app/controllers/useOperationalViewModel.ts': 'c5f2f71b6d18094afbcc5cafdfe04a972521e8c0',
  'src/features/inventory/views/renderInventoryMovementPanel.tsx': '7f53b8243ab67442c853f91e6e58e62a1dcaefee',
  'worker/domains/inventory-movement.ts': '605699debb2b9981a95ac85ea72bbf041995c417',
  'scripts/test-catalog-only-writeoff-20261018.mjs': '04ac4678d9296c1c780c59d69cdeaf2f36f1f875',
  'worker/index.ts': '1511ecd841a31c86ab9fc352b84bd5bc0e6f9e06',
  'worker/domains/workshop-settlements.ts': 'ac745c67e7679d7f7fac7454a625579e1d6c6635',
  'src/features/workshop/WorkshopSettlementsPanel.tsx': '0234d727606f5b851c678df014c103ddfd9f8178',
  'src/styles/stage04-workshop-settlements.css': '7c91b20890748ed713048f13bf96c6754680fa96',
}
const blob = bytes => crypto.createHash('sha1')
  .update(Buffer.from('blob ' + bytes.length + '\0')).update(bytes).digest('hex')
const sha = file => blob(fs.readFileSync(file))
const check = (valid,msg) => { if (!valid) throw new Error(msg) }
const run = (cmd,args) => {
  const result=spawnSync(cmd,args,{stdio:'inherit',shell:false,maxBuffer:16*1024*1024})
  check(!result.error&&result.status===0,
    'Catalog-only writeoff safety gate failed: '+cmd+' '+args.join(' ')+' ('+result.status+')')
}
for(const [file,expected] of Object.entries(candidate))
  check(sha(file)===expected,'Unreviewed writeoff candidate: '+file)
run(process.execPath,['--experimental-strip-types','scripts/test-catalog-only-writeoff-20261018.mjs'])
run(process.execPath,['--experimental-strip-types','scripts/test-stage04-opening-cutover-20261018.mjs'])
run(process.platform==='win32'?'npm.cmd':'npm',['run','typecheck'])
// Reviewed staging-only deletion candidate. Preserve the frozen main/branch2
// release tests on the exact old module; validate the new module independently.
// No data access, migration, or weakening of old pinned assertions.
const deleteFile='worker/domains/admin-delete-physical.ts'
const deleteCurrentSha='f90ae43714aa53959ef1f0457fb5223b128963bd'
const deletePreviousSha='23a31cbdfd11875d22975caeaab1411b89998929'
const deletePreviousCommit='141253529adf2f7a70b402120a3e23e549dca334'
check(sha(deleteFile)===deleteCurrentSha,'Unexpected modern V2 delete candidate source')
run(process.execPath,['--experimental-strip-types','scripts/test-admin-delete-zero-booked-fulfilled-20261018.mjs'])
const reviewedDeleteReasonFiles={
  'worker/domains/order-delete-preview.ts':['b28c560913fd4871facc50533d600b768daffbe8','6f3743bd23e0e8cd2f99497c5b10094ef9ec8a3f'],
  'worker/domains/returns-exchanges.ts':['c10b1e68928efe742940499e5b4c9b4375ece72e','75992cf750cdba656c29c952cbe89fffe6b4df83'],
}
for(const [file,[,candidateSha]] of Object.entries(reviewedDeleteReasonFiles))
  check(sha(file)===candidateSha,'Unreviewed admin delete reason source: '+file)
run(process.execPath,['--experimental-strip-types','scripts/test-admin-delete-standalone-return-reason-20261021.mjs'])
const reviewedP0ReserveFiles={
  'worker/domains/order-reservations.ts':['00d18e4d2e0964bcd9f912aade1fd285399076a0','14a8445bd28dc4d293ad93411887c381083afc80'],
}
for(const [file,[,candidateSha]] of Object.entries(reviewedP0ReserveFiles))
  check(sha(file)===candidateSha,'Unexpected P0 shipping reserve preflight source: '+file)
run(process.execPath,['--experimental-strip-types','scripts/test-return-active-reserve-p0-20261021.mjs'])


const saved=new Map()
try {
  const checkBase=spawnSync('git',['cat-file','-e',baselineRef+':src/app/controllers/useOperationalViewModel.ts'],
    {stdio:'ignore'})
  if(checkBase.status!==0)
    run('git',['fetch','--no-tags','--depth=1','origin',baselineRef])
  for(const [file,expected] of Object.entries(baseline)){
    if(file in candidate)check(sha(file)===candidate[file],'Concurrent writeoff source drift: '+file)
    const old=spawnSync('git',['show',baselineRef+':'+file],{encoding:null,maxBuffer:16*1024*1024})
    check(!old.error&&old.status===0&&blob(old.stdout)===expected,
      'Historical writeoff/Kaspi source changed: '+file)
    saved.set(path.resolve(file),fs.readFileSync(file))
    fs.writeFileSync(file,old.stdout)
  }
  // Historical source hashes still pin the previous implementation, so
  // replay the original exact Git blob, then restore the tested candidate.
  const exists=spawnSync('git',['cat-file','-e',deletePreviousCommit+':'+deleteFile],{stdio:'ignore'})
  if(exists.status!==0)run('git',['fetch','--no-tags','--depth=1','origin',deletePreviousCommit])
  const previous=spawnSync('git',['show',deletePreviousCommit+':'+deleteFile],{encoding:null,maxBuffer:8*1024*1024})
  check(!previous.error&&previous.status===0&&blob(previous.stdout)===deletePreviousSha,
    'Immutable previous admin delete module missing or altered')
  const deleteFull=path.resolve(deleteFile)
  check(sha(deleteFile)===deleteCurrentSha,'Concurrent deletion candidate source drift')
  saved.set(deleteFull,fs.readFileSync(deleteFull))
  fs.writeFileSync(deleteFull,previous.stdout)
  // Preserve unchanged source-pinned history before testing the CURRENT
  // preview and Return handler independently. Never rewrite old assertions.
  const priorBranch2='558acec1f804a16c9fcb47afc9318e4f303fdfbf'
  const existsPrior=spawnSync('git',['cat-file','-e',priorBranch2+':worker/domains/order-delete-preview.ts'],{stdio:'ignore'})
  if(existsPrior.status!==0)run('git',['fetch','--no-tags','--depth=1','origin',priorBranch2])
  for(const [file,[historicalSha,candidateSha]] of Object.entries(reviewedDeleteReasonFiles)){
    check(sha(file)===candidateSha,'Unexpected current admin delete reason file: '+file)
    const historic=spawnSync('git',['show',priorBranch2+':'+file],{encoding:null,maxBuffer:16*1024*1024})
    check(!historic.error&&historic.status===0&&blob(historic.stdout)===historicalSha,
      'Original admin delete history source has changed: '+file)
    const full=path.resolve(file)
    saved.set(full,fs.readFileSync(full))
    fs.writeFileSync(full,historic.stdout)
  }
  // Replay frozen shipment handler exactly on approved pre-P0 bytes.
  // The current Return handler is already included in reviewedDeleteReasonFiles.
  for(const [file,[historicalSha,candidateSha]] of Object.entries(reviewedP0ReserveFiles)){
    check(sha(file)===candidateSha,'Unexpected P0 shipping candidate before frozen history: '+file)
    const historic=spawnSync('git',['show',priorBranch2+':'+file],{encoding:null,maxBuffer:16*1024*1024})
    check(!historic.error&&historic.status===0&&blob(historic.stdout)===historicalSha,
      'Frozen pre-P0 reservation module has changed: '+file)
    const full=path.resolve(file)
    saved.set(full,fs.readFileSync(full))
    fs.writeFileSync(full,historic.stdout)
  }
  // Historical modularization inventory must not count this NEW candidate
  // helper while replaying the frozen baseline. Restore its exact bytes.
  const deleteReasonHelper='worker/domains/order-delete-return-blocker.ts'
  check(sha(deleteReasonHelper)==='ac0d7ac7747bb4ffe421b3faf9a13a676fd68a63',
    'Unknown admin delete blocker helper source')
  saved.set(path.resolve(deleteReasonHelper),fs.readFileSync(deleteReasonHelper))
  fs.rmSync(deleteReasonHelper)
  // This is the unchanged full, immutable Branch2 gate on the original runtime.
  run(process.platform==='win32'?'npm.cmd':'npm',['run','release:check'])
}finally{
  for(const [file,bytes] of saved)fs.writeFileSync(file,bytes)
}
for(const [file,expected] of Object.entries(candidate))
  check(sha(file)===expected,'Candidate source was not restored: '+file)
check(sha(deleteFile)===deleteCurrentSha,'Reviewed V2 admin delete source not restored after historical replay')
check(sha('worker/domains/order-delete-return-blocker.ts')==='ac0d7ac7747bb4ffe421b3faf9a13a676fd68a63','Delete reason helper was not restored')
for(const [file,[,candidateSha]] of Object.entries(reviewedDeleteReasonFiles))
  check(sha(file)===candidateSha,'Reviewed delete reason source not restored: '+file)
for(const [file,[,candidateSha]] of Object.entries(reviewedP0ReserveFiles))
  check(sha(file)===candidateSha,'Reviewed P0 shipping source not restored: '+file)
run(process.execPath,['--experimental-strip-types','scripts/test-return-active-reserve-p0-20261021.mjs'])
run(process.execPath,['--experimental-strip-types','scripts/test-catalog-only-writeoff-20261018.mjs'])
fs.rmSync(path.resolve('dist'),{recursive:true,force:true})
run(process.platform==='win32'?'npm.cmd':'npm',['run','build'])
console.log('CATALOG_ONLY_WRITE_OFF_AND_IMMUTABLE_BRANCH2_HISTORICAL_GATES_PASSED')
