// Selective production promotion of Finance report provenance.
// Test current bytes and real SQL before replaying the UNMODIFIED frozen
// production chain; leave all customer databases and Cloudflare untouched.
// Restore every temporarily swapped file even when the historical gate fails.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {spawnSync} from 'node:child_process'
import {createHash} from 'node:crypto'

const root=fs.mkdtempSync(path.join(os.tmpdir(),'orders-main-finance-lineage-'))
const financeFile='worker/domains/finance-reports.ts'
const pkg='package.json'
const candidateSha='4e2df4d0a1611a0bf5a2194e632e8f01e2f3fa60'
const historicalSha='731c40de473b00a353fc58e987626d16d7671186'
const originalPackageSha='37023f33f1588fb7d0f3ab1370a49c3602e0f3ec'
const originalMain='4e8ecb43f567cf43293985d7c937d1f5ac2f4e0a'
const test='scripts/test-finance-exchange-payment-lineage-20261021.mjs'
const self='scripts/test-main-finance-lineage-release-20261021.mjs'
const blob=(bytes)=>createHash('sha1').update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex')
const sha=(filename)=>blob(fs.readFileSync(filename))
const check=(v,message)=>{if(!v)throw Error(message)}
const run=(exe,args)=>{
 const res=spawnSync(exe,args,{stdio:'inherit',shell:false,maxBuffer:32*1024*1024})
 check(!res.error&&res.status===0,'Main Finance lineage gate failed: '+exe+' '+args.join(' ')+', status='+res.status)
}
const npm=process.platform==='win32'?'npm.cmd':'npm'
const wrangler=fs.readFileSync('wrangler.jsonc','utf8')
check(wrangler.includes('"name": "orders-app"')&&wrangler.includes('"database_name": "orders_db_prod"')
 &&!wrangler.includes('orders_db_branch2'),'STOP: incorrect Worker/D1 production binding')
check(sha(financeFile)===candidateSha,'Unexpected Finance report source before production promotion')
const presentPackage=JSON.parse(fs.readFileSync(pkg,'utf8'))
check(presentPackage.scripts?.['release:check']==='node '+self,
 'Unexpected current Finance production release script mapping')

run(process.execPath,['--experimental-strip-types',test])
run(npm,['run','typecheck'])
run(npm,['run','build'])

const saved=new Map()
try{
 if(spawnSync('git',['cat-file','-e',originalMain+':'+financeFile],{stdio:'ignore'}).status!==0)
   run('git',['fetch','--no-tags','--depth=1','origin',originalMain])
 const historicalFinance=spawnSync('git',['show',originalMain+':'+financeFile],{encoding:null,maxBuffer:16*1024*1024})
 check(!historicalFinance.error&&historicalFinance.status===0
  &&blob(historicalFinance.stdout)===historicalSha,'Immutable old Production Finance source unavailable')
 const historicalPkg=spawnSync('git',['show',originalMain+':'+pkg],{encoding:null,maxBuffer:2*1024*1024})
 check(!historicalPkg.error&&historicalPkg.status===0
  &&blob(historicalPkg.stdout)===originalPackageSha,'Immutable previous production release mapping unavailable')

 saved.set(financeFile,fs.readFileSync(financeFile))
 fs.writeFileSync(financeFile,historicalFinance.stdout)
 saved.set(pkg,fs.readFileSync(pkg))
 fs.writeFileSync(pkg,historicalPkg.stdout)

 // New audit-only scripts did not exist in the historic source inventory.
 // Hide them only during the byte-identical cumulative original release.
 for(const file of [test,self]){
   const moved=path.join(root,path.basename(file))
   fs.renameSync(file,moved)
   saved.set(file,moved)
 }
 // The previous P0 release wrapper itself restores immutable pre-P0 bytes,
 // Stage04 and all earlier protected tests. Do not edit those gate assertions.
 run(process.execPath,['scripts/test-main-return-reserve-p0-release-20261021.mjs'])
}finally{
 for(const [file,original] of saved){
   if(typeof original==='string'){
     if(fs.existsSync(original))fs.renameSync(original,file)
   }else fs.writeFileSync(file,original)
 }
 fs.rmSync(root,{recursive:true,force:true})
}
check(sha(financeFile)===candidateSha,'Finance source not restored after immutable replay')
check(JSON.parse(fs.readFileSync(pkg,'utf8')).scripts?.['release:check']==='node '+self,
 'Current production release mapping not restored')
check(fs.existsSync(test)&&fs.existsSync(self),'Current Finance tests not restored')
run(process.execPath,['--experimental-strip-types',test])
run(npm,['run','build'])
console.log('MAIN_FINANCE_EXCHANGE_PAYMENT_LINEAGE_AND_IMMUTABLE_PRODUCTION_RELEASE_PASSED')
