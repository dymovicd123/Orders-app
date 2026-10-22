// A new, source-pinned business contract around the unmodified historical
// Branch2 release gate. Historical tests only ever execute accepted old blobs.
// This wrapper restores the actual candidate and builds it before deployment.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'

const acceptedRef = '2ce0f7449b239e2f6e36d4c4886b2f672e66f38d'
const accepted = {
  'package.json': '7f57884cca246755f08735078fdf4dfa882348cd',
  'src/App.tsx': 'c21c662a85da31297d5a77ca7b8a640e6885f9a4',
  'worker/index.ts': '527547151f4ea89baa4465fac4df4eba4dd3281f',
  'worker/domains/workshop-settlements.ts': '2b7d7461758c116053b4a62a3576f451180b32fc',
  'src/features/workshop/WorkshopSettlementsPanel.tsx': '8ec8a1e6b2fe7849e74881d302ff72a1b095b58f',
  'src/styles/stage04-workshop-settlements.css': '6796899d63de3e2183a95605b9280764c9e64b48',
  'worker/domains/orders-write.ts': '48125cbff7d35ccf4dcfaf18fc7d1fcc89305171',
  'src/features/sections/CreateOrderSection.tsx': '98a174735cbaf467b5d54be2aadcd2fb5724f82f',
  'src/app/constants.ts': '8175cd21630318ebd9ebc339db3296482d43b83d',
  'src/app/utils.ts': '622efa7c4baec907f398bf4221427a757e7f310f',
  'src/features/inventory/views/renderInventoryMovementPanel.tsx': '817caf27f28b95bbcb3bd19fa5d422c444cf38e1',
}
const current = {
  'package.json': '3df7ee1f437c6c203c3076d1a6055355d595641c',
  'src/App.tsx': '9d9987b976aa3e5844ed8c968d46f97e3e7d004b',
  'worker/index.ts': '1511ecd841a31c86ab9fc352b84bd5bc0e6f9e06',
  'worker/domains/workshop-settlements.ts': 'ac745c67e7679d7f7fac7454a625579e1d6c6635',
  'src/features/workshop/WorkshopSettlementsPanel.tsx': '0234d727606f5b851c678df014c103ddfd9f8178',
  'src/styles/stage04-workshop-settlements.css': '7c91b20890748ed713048f13bf96c6754680fa96',
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
// The new narrow known-SKU guard is independently proved before replaying the
// previous accepted Branch2 source. The wrapper alone updates the two files;
// historic tests and the Cloudflare/D1 environment remain untouched.
if (!process.env.BRANCH2_KNOWN_SKU_HISTORIC_REPLAY &&
    sha('worker/domains/catalog-review.ts') === 'd005822b7d2eba6dbc170f5101e1a39dc173b1aa' &&
    sha('worker/domains/order-reservations.ts') === 'ae3fca346c8ac92e8bb6e8feef27c80214e1e0ae') {
  const next=spawnSync(process.execPath,['scripts/branch2-resolver-known-sku-preserved-gate.mjs'],
    {stdio:'inherit',shell:false,maxBuffer:16*1024*1024,env:process.env})
  check(!next.error && next.status === 0,'Known-SKU resolver repair and frozen Branch2 regression failed')
  process.exit(0)
}

// Updated outgoing semantics are gated independently before any frozen
// historical source is substituted. This keeps all prior shipping assertions.
if (!process.env.SHIPPING_SHORTAGE_FROZEN_REPLAY &&
    sha('worker/index.ts') === 'ba5fd71331815f1073410c8aae9a28c28663c5e1' &&
    sha('src/App.tsx') === 'de474a96c837294c409ea134b4d5d4cac82995e5') {
  const next = spawnSync(process.execPath,['scripts/branch2-shipping-no-shortage-popup-preserved-gate.mjs'],
    {stdio:'inherit',shell:false,maxBuffer:16*1024*1024,env:process.env})
  check(!next.error && next.status === 0,'Current shipping and frozen Branch2 release checks failed')
  process.exit(0)
}

// The newest Resolver code must be checked FIRST. Its immutable Branch2 replay
// then invokes the already-reviewed stock-attention release gate, preserving
// every old order/stock/finance test in the correct historical source context.
if (!process.env.RESOLVER_GENDER_FROZEN_REPLAY &&
    sha('worker/domains/catalog.ts') === '69aa179efc7403d2452199ebc882771a3788ded3' &&
    sha('worker/domains/order-reservations.ts') === 'd8300a40e2beec2dd38b214a6e3a33fb2836a994' &&
    sha('src/App.tsx') === 'bec55aa26cdcb38f284cdf47daa7ccceae9ea9b2') {
  const next = spawnSync(process.execPath, ['scripts/branch2-resolver-gender-preserved-gate.mjs'],
    {stdio:'inherit',shell:false,maxBuffer:16*1024*1024,env:process.env})
  check(!next.error && next.status === 0,
    'Current Resolver and previously accepted Branch2 release checks failed')
  process.exit(0)
}

if (!process.env.STOCK_ATTENTION_FROZEN_REPLAY &&
    sha('src/App.tsx') === 'bec55aa26cdcb38f284cdf47daa7ccceae9ea9b2') {
  const next = spawnSync(process.execPath,['scripts/branch2-stock-attention-preserved-gate.mjs'],
    {stdio:'inherit',shell:false,maxBuffer:16*1024*1024,env:process.env})
  check(!next.error && next.status===0, 'Stock attention and original release checks failed')
  process.exit(0)
}
// Dispatch only this reviewed writeoff extension. Its archived baseline gate
// is staged byte-for-byte; Kaspi's existing frozen assertions stay intact.
if (sha('worker/domains/inventory-movement.ts')==='605699debb2b9981a95ac85ea72bbf041995c417'
  && sha('src/app/controllers/useOperationalViewModel.ts')==='c5f2f71b6d18094afbcc5cafdfe04a972521e8c0') {
  const next=spawnSync(process.execPath,['scripts/branch2-catalog-only-writeoff-safe-gate.mjs'],
    {stdio:'inherit',shell:false,maxBuffer:16*1024*1024,env:process.env})
  check(!next.error && next.status===0,'Catalog-only writeoff candidate gate failed')
  process.exit(0)
}
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
run(process.execPath,['--experimental-strip-types','scripts/test-stage04-opening-cutover-20261018.mjs'])

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
