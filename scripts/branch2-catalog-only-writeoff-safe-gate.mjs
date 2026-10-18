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
}
const candidate = {
  'src/app/controllers/useOperationalViewModel.ts': 'c5f2f71b6d18094afbcc5cafdfe04a972521e8c0',
  'src/features/inventory/views/renderInventoryMovementPanel.tsx': '7f53b8243ab67442c853f91e6e58e62a1dcaefee',
  'worker/domains/inventory-movement.ts': '605699debb2b9981a95ac85ea72bbf041995c417',
  'scripts/test-catalog-only-writeoff-20261018.mjs': '04ac4678d9296c1c780c59d69cdeaf2f36f1f875',
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
run(process.platform==='win32'?'npm.cmd':'npm',['run','typecheck'])

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
  // This is the unchanged full, immutable Branch2 gate on the original runtime.
  run(process.platform==='win32'?'npm.cmd':'npm',['run','release:check'])
}finally{
  for(const [file,bytes] of saved)fs.writeFileSync(file,bytes)
}
for(const [file,expected] of Object.entries(candidate))
  check(sha(file)===expected,'Candidate source was not restored: '+file)
run(process.execPath,['--experimental-strip-types','scripts/test-catalog-only-writeoff-20261018.mjs'])
fs.rmSync(path.resolve('dist'),{recursive:true,force:true})
run(process.platform==='win32'?'npm.cmd':'npm',['run','build'])
console.log('CATALOG_ONLY_WRITE_OFF_AND_IMMUTABLE_BRANCH2_HISTORICAL_GATES_PASSED')
