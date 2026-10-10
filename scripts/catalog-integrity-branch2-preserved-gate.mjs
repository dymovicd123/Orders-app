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
  ['scripts/test-catalog-integrity-r1-references.mjs',false],
  ['scripts/test-reference-crud-integrity.mjs',true],
  ['scripts/test-catalog-stock-reconciliation.mjs',true],
  ['scripts/test-catalog-stock-reconciliation-write.mjs',true],
  ['scripts/test-catalog-integrity-r2-preview.mjs',true],
  ['scripts/test-catalog-integrity-r2-hide.mjs',true],
  ['scripts/test-catalog-integrity-r2-sku-consolidation.mjs',true],
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
  ['scripts/test-catalog-positive-stock-undo.mjs',true],
  ['scripts/test-catalog-corrected-undo-review.mjs',true],
  ['scripts/test-inventory-writeoff-review.mjs',true],
  ['scripts/test-reference-duplicates-discovery-r1.mjs',false],
  ['scripts/test-reference-merge-choice-preview.mjs',true],
  ['scripts/test-reference-characteristic-impact.mjs',true],
  ['scripts/test-reference-merge-monthly-apply.mjs',true],
  ['scripts/test-reference-payment-merge.mjs',true],
  ['scripts/test-reference-merge-history.mjs',true],
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
  for(const [relative,expected] of Object.entries(manifest.addedFiles || {})){
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
console.log('CATALOG PORT AND BRANCH2 HISTORICAL GATES PASSED — Stage04 preserved, new runtime checked, baseline suite unchanged')
