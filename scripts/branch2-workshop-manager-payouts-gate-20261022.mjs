// Review ONLY the role split for workshop settlement payment on current Branch2,
// then replay the exact previous source through ALL unchanged historical tests.
// No credentials, D1 writes or Worker publishing.
import fs from 'node:fs'
import crypto from 'node:crypto'
import {spawnSync} from 'node:child_process'
const baseline='709669552fc70b5590d1985f86bf35846bb91189'
const pinned={
  "src/features/sections/WorkshopSection.tsx": [
    "4beafa4f0d641133a42ae0bd08d21898740bfc95",
    "86a9fcea1a569a6a72f67cf42cea92f75ead5d1d"
  ],
  "src/features/workshop/WorkshopSettlementsPanel.tsx": [
    "448da027de1a70ad5ceabdf7ebaf25809db23804",
    "0234d727606f5b851c678df014c103ddfd9f8178"
  ],
  "worker/index.ts": [
    "a7ef327eb4fe7a79696470bc048324ca92858e6a",
    "1aa17956a79249c1346fcbbd577ab0edb2db2851"
  ],
  "worker/domains/workshop-settlements.ts": [
    "47582b31371e3cd51ea25709a9d0dfc94ed5d7ff",
    "ac745c67e7679d7f7fac7454a625579e1d6c6635"
  ]
}
const blob=bytes=>crypto.createHash('sha1').update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex')
const check=(x,msg)=>{if(!x)throw Error(msg)}
const run=(tool,args)=>{
 const result=spawnSync(tool,args,{stdio:'inherit',shell:false,timeout:44*60*1000,maxBuffer:32*1024*1024})
 check(!result.error&&result.status===0,'Workshop manager payout release failed: '+tool+' '+args.join(' ')+' '+result.status)
}
const npm=process.platform==='win32'?'npm.cmd':'npm'
const assertPinned=(i)=>{for(const [path,hashes] of Object.entries(pinned))check(blob(fs.readFileSync(path))===hashes[i],'Unexpected source: '+path)}
const verify=()=>{
 assertPinned(0)
 run(process.execPath,['--experimental-strip-types','scripts/test-workshop-manager-payouts-20261022.mjs'])
 run(process.execPath,['--experimental-strip-types','scripts/test-stage04c-workshop-payments.mjs'])
 run(process.execPath,['--experimental-strip-types','scripts/test-stage04-fast-workshop-settlements.mjs'])
}
verify()
run(npm,['run','typecheck'])
const saved=new Map()
try{
 const first=Object.keys(pinned)[0]
 if(spawnSync('git',['cat-file','-e',baseline+':'+first],{stdio:'ignore'}).status!==0)
   run('git',['fetch','--no-tags','--depth=1','origin',baseline])
 for(const [path,[,hash]] of Object.entries(pinned)){
   const original=spawnSync('git',['show',baseline+':'+path],{encoding:null,maxBuffer:32*1024*1024})
   check(!original.error&&original.status===0&&blob(original.stdout)===hash,
     'Immutable pre-permission source missing: '+path)
   saved.set(path,fs.readFileSync(path))
   fs.writeFileSync(path,original.stdout)
 }
 assertPinned(1)
 run(process.execPath,['scripts/branch2-unified-kaspi-preserved-gate.mjs'])
}finally{for(const [path,bytes] of saved)fs.writeFileSync(path,bytes)}
verify()
fs.rmSync('dist',{recursive:true,force:true})
run(npm,['run','build'])
check(fs.existsSync('dist/client/assets'),'New current workshop UI assets missing')
console.log('BRANCH2_WORKSHOP_MANAGER_PAYOUTS_ALL_TESTS_AND_IMMUTABLE_RELEASE_PASSED')
