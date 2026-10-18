// A new, source-pinned business contract around the unmodified historical
// Branch2 release gate. Historical tests only ever execute accepted old blobs.
// This wrapper restores the actual candidate and builds it before deployment.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'

const acceptedRef = '2ce0f7449b239e2f6e36d4c4886b2f672e66f38d'
const accepted = {
  'src/App.tsx': 'c21c662a85da31297d5a77ca7b8a640e6885f9a4',
  'worker/index.ts': '527547151f4ea89baa4465fac4df4eba4dd3281f',
  'worker/domains/orders-write.ts': '48125cbff7d35ccf4dcfaf18fc7d1fcc89305171',
  'src/features/sections/CreateOrderSection.tsx': '98a174735cbaf467b5d54be2aadcd2fb5724f82f',
  'src/app/constants.ts': '8175cd21630318ebd9ebc339db3296482d43b83d',
  'src/app/utils.ts': '622efa7c4baec907f398bf4221427a757e7f310f',
  'src/features/inventory/views/renderInventoryMovementPanel.tsx': '817caf27f28b95bbcb3bd19fa5d422c444cf38e1',
}
const current = {
  'src/App.tsx': '9d9987b976aa3e5844ed8c968d46f97e3e7d004b',
  'worker/index.ts': '36a89ede46aeaefa20433cbc4ccaf0dcf741ebe2',
  'worker/domains/orders-write.ts': '4511edc57947784301aaf411ac669f6cbc206381',
  'src/features/sections/CreateOrderSection.tsx': '55a68a53eb5c3bf501f1e5655240a05b5ad5ec2e',
  'src/app/constants.ts': 'eb9a28ebcf6ecd4456dd5885c747eba8df3b2993',
  'src/app/utils.ts': 'ca9811f22152c5a40badb9918a8561d820e54b33',
  'src/features/inventory/views/renderInventoryMovementPanel.tsx': '88ec6ad9ff725980972d77d2a804efefa781c1be',
}
const immutable = {
  'scripts/catalog-integrity-branch2-preserved-gate.mjs': 'd2cb4cab2e9dd77bdb0b2dc59e15706dca20a2e9',
  'scripts/test-kaspi-unified-orders-writeoff-20261018.mjs': '489f81a7ac42188e0f607d3c2c02b852de78548a',
  'src/features/sections/WorkshopSection.tsx': '86a9fcea1a569a6a72f67cf42cea92f75ead5d1d',
}
const blob = bytes => crypto.createHash('sha1')
  .update(Buffer.from('blob ' + bytes.length + '\0')).update(bytes).digest('hex')
const sha = file => blob(fs.readFileSync(file))
const check = (test, message) => { if (!test) throw new Error(message) }
const run = (command,args,env=process.env) => {
  const result=spawnSync(command,args,{env,stdio:'inherit',shell:false,maxBuffer:16*1024*1024})
  check(!result.error && result.status===0,
    'Candidate / historical release gate failed: '+command+' '+args.join(' ')+' ('+String(result.status)+')')
}

// The unmodified old gate legitimately invokes npm run release:check on old
// files during its nested historical replay. Never re-enter this wrapper then.
if (process.env.KASPI_UNIFIED_HISTORICAL_REPLAY === '1' ||
    process.env.CATALOG_INTEGRITY_STAGE04_BRANCH2_BASELINE_NORMALIZED === '1') {
  run(process.execPath,['scripts/catalog-integrity-branch2-preserved-gate.mjs'])
  process.exit(0)
}

for(const [file,expected] of Object.entries({...current,...immutable}))
  check(sha(file)===expected,'Unreviewed current business source: '+file)
run(process.execPath,['scripts/test-kaspi-unified-orders-writeoff-20261018.mjs'])

const archived=new Map()
try {
  const presence=spawnSync('git',['cat-file','-e',acceptedRef+':src/App.tsx'],{stdio:'ignore'})
  if(presence.status!==0)
    run('git',['fetch','--no-tags','--depth=1','origin',acceptedRef])
  // Save the real working files. Do not rebase, edit fixtures, disable tests
  // or touch any database while replaying the previously accepted release.
  for(const [file,expected] of Object.entries(accepted)){
    check(sha(file)===current[file],'Concurrent source edit during test: '+file)
    const old=spawnSync('git',['show',acceptedRef+':'+file],{encoding:null,maxBuffer:16*1024*1024})
    check(!old.error&&old.status===0&&blob(old.stdout)===expected,
      'Historical source is missing/changed: '+file)
    archived.set(path.resolve(file),fs.readFileSync(file))
    fs.writeFileSync(file,old.stdout)
  }
  run(process.execPath,['scripts/catalog-integrity-branch2-preserved-gate.mjs'],
    {...process.env,KASPI_UNIFIED_HISTORICAL_REPLAY:'1'})
} finally {
  for(const [file,bytes] of archived)fs.writeFileSync(file,bytes)
}
for(const [file,expected] of Object.entries({...current,...immutable}))
  check(sha(file)===expected,'Candidate source not restored: '+file)
run(process.execPath,['scripts/test-kaspi-unified-orders-writeoff-20261018.mjs'])
// Historical release checks generate historical assets. Never deploy those
// assets instead of the new runtime.
fs.rmSync(path.resolve('dist'),{recursive:true,force:true})
run(process.platform==='win32'?'npm.cmd':'npm',['run','build'])
const assets=path.resolve('dist/client/assets')
check(fs.existsSync(assets),'Missing current frontend bundle')
const chunks=fs.readdirSync(assets).filter(n=>n.endsWith('.js'))
check(chunks.some(n=>n.startsWith('WorkshopSection-')),'Workshop frontend disappeared')
check(chunks.some(n=>n.startsWith('InventorySection-')),'Inventory frontend disappeared')
console.log('UNIFIED KASPI / WRITE-OFF CANDIDATE + IMMUTABLE HISTORICAL GATE PASSED')
