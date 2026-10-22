// Enforce actionable-only Resolver routing on current Branch2, then rerun
// every previously accepted release test against the exact unchanged Worker
// entrypoint. No D1 connection, mutation, migration or production deploy.
import fs from 'node:fs'
import crypto from 'node:crypto'
import {spawnSync} from 'node:child_process'
const baseline='3097e20f8ee2b17dec7d03dcccfcdd823c0ce660'
const reviewed={
  'worker/index.ts':['1aa17956a79249c1346fcbbd577ab0edb2db2851','ba5fd71331815f1073410c8aae9a28c28663c5e1'],
  'scripts/catalog-integrity-branch2-preserved-gate.mjs':['77224a07263998dcbfceefca1e7e7a0c30a7674d','bdfc1ebe2a1c98763b27a37125bc7acc9eb5ba24'],
}
const hash=bytes=>crypto.createHash('sha1').update(Buffer.from('blob '+bytes.length+'\\0'.replace('\\0','\0'))).update(bytes).digest('hex')
const assertCurrent=()=>{for(const [file,[current]] of Object.entries(reviewed))if(hash(fs.readFileSync(file))!==current)throw Error('Resolver gate differs from reviewed candidate: '+file)}
const run=(command,args,env=process.env)=>{
 const x=spawnSync(command,args,{env,stdio:'inherit',shell:false,timeout:30*60*1000,maxBuffer:16*1024*1024})
 if(x.error||x.status!==0)throw Error('Actionable Resolver verification failed: '+command+' '+args.join(' ')+' ('+x.status+')')
}
assertCurrent()
run(process.execPath,['--experimental-strip-types','scripts/test-branch2-resolver-only-when-actionable-20261022.mjs'])
run(process.platform==='win32'?'npm.cmd':'npm',['run','typecheck'])
const saved=new Map()
try{
 const first=Object.keys(reviewed)[0]
 if(spawnSync('git',['cat-file','-e',baseline+':'+first],{stdio:'ignore'}).status!==0)
   run('git',['fetch','--no-tags','--depth=1','origin',baseline])
 for(const [file,[,old]] of Object.entries(reviewed)){
   const t=spawnSync('git',['show',baseline+':'+file],{encoding:null,maxBuffer:16*1024*1024})
   if(t.error||t.status!==0||hash(t.stdout)!==old)throw Error('Immutable prior source unavailable: '+file)
   saved.set(file,fs.readFileSync(file))
   fs.writeFileSync(file,t.stdout)
 }
 run(process.execPath,['scripts/branch2-unified-kaspi-preserved-gate.mjs'],
   {...process.env,BRANCH2_RESOLVER_ACTIONABLE_BASELINE_REPLAY:'1'})
}finally{for(const [file,bytes] of saved)fs.writeFileSync(file,bytes)}
assertCurrent()
run(process.execPath,['--experimental-strip-types','scripts/test-branch2-resolver-only-when-actionable-20261022.mjs'])
fs.rmSync('dist',{recursive:true,force:true})
run(process.platform==='win32'?'npm.cmd':'npm',['run','build'])
if(!fs.existsSync('dist/client/assets'))throw Error('Current frontend not rebuilt')
console.log('BRANCH2_RESOLVER_ACTIONABLE_REAL_SQL_AND_COMPLETE_FROZEN_REGRESSIONS_PASSED')
