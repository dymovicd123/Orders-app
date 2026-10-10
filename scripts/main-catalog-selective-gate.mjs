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
const chunks=fs.readdirSync(dir).filter(s=>/^ReferencesSection-[A-Za-z0-9_-]+\.js$/.test(s))
check(chunks.length===1,'Expected one ReferencesSection chunk')
const chunk=fs.readFileSync(path.join(dir,chunks[0]),'utf8')
for(const phrase of ['Все рабочие справочники','Объединить значения','Разобрать прежнее объединение']){
 check(chunk.includes(phrase),'New References UI missing: '+phrase)
}
console.log('MAIN SELECTIVE REFERENCE RELEASE VERIFIED:',chunks[0])
