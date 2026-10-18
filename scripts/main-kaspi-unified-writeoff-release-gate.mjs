// Narrow production release for Kaspi unification and catalog-only writeoff.
// The unfinished Stage04 files are NOT promoted. No D1 mutations in tests.
// Replay the exact pre-change production release gate and rebuild current assets.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'

const baseRef = '163610dfa7375e12095b1f74c54b2f5a4f3cfc10'
const baseline = {
  'src/App.tsx': 'c21c662a85da31297d5a77ca7b8a640e6885f9a4',
  'worker/index.ts': 'eef52a7c298538d8d595677f9d18595e39328dff',
  'worker/domains/orders-write.ts': '48125cbff7d35ccf4dcfaf18fc7d1fcc89305171',
  'src/features/sections/CreateOrderSection.tsx': '98a174735cbaf467b5d54be2aadcd2fb5724f82f',
  'src/app/constants.ts': '8175cd21630318ebd9ebc339db3296482d43b83d',
  'src/app/utils.ts': '622efa7c4baec907f398bf4221427a757e7f310f',
  'src/features/inventory/views/renderInventoryMovementPanel.tsx': '5e869edf3eb353d0d5368b31f4f19548833ddd03',
  'src/app/controllers/useOperationalViewModel.ts': 'b34991dae36234e70ee3a3014bf2c09cd731ee92',
  'worker/domains/inventory-movement.ts': '5403949b89141ee3c0ccbf41e0ac42228d921443',
  'scripts/main-catalog-selective-gate.mjs': 'e07e2ac383a2c7fea0ded8c08d01c2972788199f',
}
const candidate = {
  'src/App.tsx': '9d9987b976aa3e5844ed8c968d46f97e3e7d004b',
  'worker/index.ts': 'b22e62557120aeece3b2ea1916784a9759d450be',
  'worker/domains/orders-write.ts': '4511edc57947784301aaf411ac669f6cbc206381',
  'src/features/sections/CreateOrderSection.tsx': '55a68a53eb5c3bf501f1e5655240a05b5ad5ec2e',
  'src/app/constants.ts': 'eb9a28ebcf6ecd4456dd5885c747eba8df3b2993',
  'src/app/utils.ts': 'ca9811f22152c5a40badb9918a8561d820e54b33',
  'src/features/inventory/views/renderInventoryMovementPanel.tsx': '7f53b8243ab67442c853f91e6e58e62a1dcaefee',
  'src/app/controllers/useOperationalViewModel.ts': 'c5f2f71b6d18094afbcc5cafdfe04a972521e8c0',
  'worker/domains/inventory-movement.ts': '605699debb2b9981a95ac85ea72bbf041995c417',
  'scripts/test-kaspi-unified-orders-writeoff-20261018.mjs': '489f81a7ac42188e0f607d3c2c02b852de78548a',
  'scripts/test-catalog-only-writeoff-20261018.mjs': '04ac4678d9296c1c780c59d69cdeaf2f36f1f875',
}
const added=[
  'src/features/inventory/views/WriteoffReview.tsx',
  'src/features/inventory/writeoffReview.ts',
  'src/styles/w4-writeoff-review.css',
  'scripts/test-kaspi-unified-orders-writeoff-20261018.mjs',
  'scripts/test-catalog-only-writeoff-20261018.mjs',
  'scripts/main-kaspi-unified-writeoff-release-gate.mjs',
]
const blob = bytes => crypto.createHash('sha1')
  .update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex')
const sha = file => blob(fs.readFileSync(file))
const check=(ok,msg)=>{if(!ok)throw new Error(msg)}
const run=(cmd,args)=>{
  const result=spawnSync(cmd,args,{stdio:'inherit',shell:false,maxBuffer:16*1024*1024})
  check(!result.error&&result.status===0,
    'Main Kaspi/writeoff gate failed: '+cmd+' '+args.join(' ')+' ('+result.status+')')
}
const npm=process.platform==='win32'?'npm.cmd':'npm'
for(const [file,expected] of Object.entries(candidate))
  check(sha(file)===expected,'Unreviewed production source: '+file)
check(!fs.existsSync('migrations/0084_v72_workshop_settlement_status_capture.sql'),
  'Stage04 must remain excluded from Production')
const worker=fs.readFileSync('worker/index.ts','utf8')
check(!worker.includes("from './domains/workshop-settlements.ts'"),
  'Dormant Stage04 unexpectedly imported into Production Worker')
check(worker.includes('correct-retired-item')&&worker.includes('confirm-retired-delivery'),
  'Accepted retired SKU correction is missing from Production')
check(!worker.includes('reconcileKaspiPaymentAfterShipping'),
  'Kaspi shipping must never synthesize an ordinary payment')
run(process.execPath,['scripts/test-kaspi-unified-orders-writeoff-20261018.mjs'])
run(process.execPath,['--experimental-strip-types','scripts/test-catalog-only-writeoff-20261018.mjs'])
run(npm,['run','typecheck'])

const saved=new Map()
const hidden=[]
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'main-kaspi-writeoff-old-'))
try{
  const checkBase=spawnSync('git',['cat-file','-e',baseRef+':src/App.tsx'],{stdio:'ignore'})
  if(checkBase.status!==0)run('git',['fetch','--no-tags','--depth=1','origin',baseRef])
  for(const [file,expected] of Object.entries(baseline)){
    if(file in candidate)check(sha(file)===candidate[file],'Concurrent production candidate change: '+file)
    const original=spawnSync('git',['show',baseRef+':'+file],{encoding:null,maxBuffer:16*1024*1024})
    check(!original.error&&original.status===0&&blob(original.stdout)===expected,
      'Previous production runtime changed: '+file)
    saved.set(path.resolve(file),fs.readFileSync(file))
    fs.writeFileSync(file,original.stdout)
  }
  for(const file of added) {
    const original=path.resolve(file)
    const target=path.join(folder,path.basename(file))
    fs.renameSync(original,target)
    hidden.push([original,target])
  }
  // Entire unchanged Production cumulative check on exact previous runtime.
  run(npm,['run','release:check'])
}finally{
  for(const [file,bytes] of saved)fs.writeFileSync(file,bytes)
  for(const [original,target] of hidden.reverse())fs.renameSync(target,original)
  fs.rmSync(folder,{recursive:true,force:true})
}
for(const [file,expected] of Object.entries(candidate))
  check(sha(file)===expected,'Production candidate was not restored: '+file)
run(process.execPath,['scripts/test-kaspi-unified-orders-writeoff-20261018.mjs'])
run(process.execPath,['--experimental-strip-types','scripts/test-catalog-only-writeoff-20261018.mjs'])
fs.rmSync(path.resolve('dist'),{recursive:true,force:true})
run(npm,['run','build'])
console.log('MAIN_KASPI_UNIFIED_CATALOG_ONLY_WRITEOFF_STAGE04_EXCLUDED_AND_HISTORICAL_GATES_PASSED')
