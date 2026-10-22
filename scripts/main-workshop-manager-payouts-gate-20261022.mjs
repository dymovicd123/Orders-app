// Main: verify new manager workshop payout code, replay the precise unchanged
// previous Main release sources for all existing tests, then build new code.
// No D1 access or production deploy in this validation.
import fs from 'node:fs'
import crypto from 'node:crypto'
import {spawnSync} from 'node:child_process'
const baseline='ffd13ac0ba5eac362ee8f8ac8688784d555b620b'
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
    "86de6fdc9fddecbd1df206abdad9944301cd1096",
    "b656ee65ed5278bcd5b21e7e77396452170c08d0"
  ],
  "worker/domains/workshop-settlements.ts": [
    "47582b31371e3cd51ea25709a9d0dfc94ed5d7ff",
    "ac745c67e7679d7f7fac7454a625579e1d6c6635"
  ]
}
const blob=bytes=>crypto.createHash('sha1').update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex')
const check=(x,msg)=>{if(!x)throw Error(msg)}
const run=(command,args)=>{
 const a=spawnSync(command,args,{stdio:'inherit',shell:false,timeout:44*60*1000,maxBuffer:32*1024*1024})
 check(!a.error&&a.status===0,'Main manager workshop payout failed: '+command+' '+args.join(' ')+' '+a.status)
}
const npm=process.platform==='win32'?'npm.cmd':'npm'
const verifyHashes=(i)=>{for(const [p,h] of Object.entries(pinned))check(blob(fs.readFileSync(p))===h[i],'Unexpected Main file '+p)}
const testCurrent=()=>{
 verifyHashes(0)
 run(process.execPath,['--experimental-strip-types','scripts/test-workshop-manager-payouts-20261022.mjs'])
 run(process.execPath,['--experimental-strip-types','scripts/test-stage04c-workshop-payments.mjs'])
 run(process.execPath,['--experimental-strip-types','scripts/test-stage04-fast-workshop-settlements.mjs'])
}
testCurrent()
run(npm,['run','typecheck'])
const saved=new Map()
try{
 const first=Object.keys(pinned)[0]
 if(spawnSync('git',['cat-file','-e',baseline+':'+first],{stdio:'ignore'}).status!==0)
   run('git',['fetch','--no-tags','--depth=1','origin',baseline])
 for(const [path,[,oldSha]] of Object.entries(pinned)){
   const previous=spawnSync('git',['show',baseline+':'+path],{encoding:null,maxBuffer:32*1024*1024})
   check(!previous.error&&previous.status===0&&blob(previous.stdout)===oldSha,'Frozen Main file unavailable '+path)
   saved.set(path,fs.readFileSync(path))
   fs.writeFileSync(path,previous.stdout)
 }
 verifyHashes(1)
 run(npm,['run','release:check'])
}finally{for(const [path,bytes] of saved)fs.writeFileSync(path,bytes)}
testCurrent()
fs.rmSync('dist',{recursive:true,force:true})
run(npm,['run','build'])
check(fs.existsSync('dist/client/assets'),'Main current frontend assets missing')
console.log('MAIN_WORKSHOP_MANAGER_PAYOUTS_ALL_TESTS_AND_IMMUTABLE_RELEASE_PASSED')
