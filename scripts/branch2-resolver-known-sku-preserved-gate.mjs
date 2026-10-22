// Verify both known-SKU corrections on current Branch2 source, then replay the
// complete immutable previous release gates on the exact accepted baseline.
// This never connects to D1, modifies migrations or deploys any Worker.
import fs from 'node:fs'
import crypto from 'node:crypto'
import {spawnSync} from 'node:child_process'
const baseline = '1c4eea157a0c35ba0aa629476978867ffe5a7e0e'
const historical = {
  'worker/domains/catalog-review.ts':'7f230db90e1da9efd6c16f63519fbeaeb05c6639',
  'worker/domains/order-reservations.ts':'da314c1fe1c6c42d49f15c8e39c0344e1c368d4f',
}
const current = {
  'worker/domains/catalog-review.ts':'d005822b7d2eba6dbc170f5101e1a39dc173b1aa',
  'worker/domains/order-reservations.ts':'ae3fca346c8ac92e8bb6e8feef27c80214e1e0ae',
}
const blob=bytes=>crypto.createHash('sha1').update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex')
const verify=(pins)=>{for(const [p,expected] of Object.entries(pins))if(blob(fs.readFileSync(p))!==expected)throw Error('Unexpected Resolver source: '+p)}
const run=(program,args,env=process.env)=>{
 const p=spawnSync(program,args,{env,stdio:'inherit',shell:false,timeout:30*60*1000,maxBuffer:16*1024*1024})
 if(p.error||p.status!==0)throw Error('Known-SKU Branch2 gate failed: '+program+' '+args.join(' ')+' ('+String(p.status)+')')
}
function verifyCurrent(){
 verify(current)
 run(process.execPath,['scripts/test-branch2-resolver-known-pending-20261022.mjs'])
 run(process.execPath,['scripts/test-branch2-resolver-historic-reserve-20261022.mjs'])
}
verifyCurrent()
run(process.platform==='win32'?'npm.cmd':'npm',['run','typecheck'])
const original=new Map()
try{
 if(spawnSync('git',['cat-file','-e',baseline+':worker/domains/catalog-review.ts'],{stdio:'ignore'}).status!==0)
   run('git',['fetch','--no-tags','--depth=1','origin',baseline])
 for(const [path,expected] of Object.entries(historical)){
   const old=spawnSync('git',['show',baseline+':'+path],{encoding:null,maxBuffer:16*1024*1024})
   if(old.error||old.status!==0||blob(old.stdout)!==expected)throw Error('Missing immutable Resolver baseline: '+path)
   original.set(path,fs.readFileSync(path))
   fs.writeFileSync(path,old.stdout)
 }
 verify(historical)
 run(process.execPath,['scripts/branch2-unified-kaspi-preserved-gate.mjs'],
   {...process.env,BRANCH2_KNOWN_SKU_HISTORIC_REPLAY:'1'})
}finally{
 for(const [path,bytes] of original)fs.writeFileSync(path,bytes)
}
verifyCurrent()
fs.rmSync('dist',{recursive:true,force:true})
run(process.platform==='win32'?'npm.cmd':'npm',['run','build'])
if(!fs.existsSync('dist/client/assets'))throw Error('Current Branch2 frontend assets missing after full historical replay')
console.log('BRANCH2_RESOLVER_KNOWN_SKU_LIVE_SQL_AND_ALL_FROZEN_RELEASE_GATES_PASSED')
