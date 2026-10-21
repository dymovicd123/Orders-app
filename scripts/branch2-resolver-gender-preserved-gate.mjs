// Validate relaxed exact-SKU gender semantics using the current code, then
// replay all previous release assertions on immutable Branch2 Git source.
import fs from 'node:fs'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'

const baseline = '1de7392cf951019535fbafada3acf34c70a75d22'
const current = {
 'worker/domains/catalog.ts':'69aa179efc7403d2452199ebc882771a3788ded3',
 'worker/domains/order-reservations.ts':'d8300a40e2beec2dd38b214a6e3a33fb2836a994',
 'src/features/orders/OrderCatalogResolutionModal.tsx':'0168319e9db456fbec800116fb82abbe101732be',
}
const historicalFiles = [...Object.keys(current), 'scripts/catalog-integrity-branch2-preserved-gate.mjs']
const blobHash = bytes => crypto.createHash('sha1')
  .update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex')
const failUnless = (value,message) => {if(!value)throw new Error(message)}
const exec = (cmd,args,env=process.env) => {
 const child=spawnSync(cmd,args,{stdio:'inherit',shell:false,env,maxBuffer:16*1024*1024,timeout:25*60*1000})
 failUnless(!child.error&&child.status===0, 'Resolver exact-gender current/historical gate failed '+cmd+' '+args.join(' ')+' ('+String(child.status)+')')
}
const verify=()=>{for(const [file,expected] of Object.entries(current))
 failUnless(blobHash(fs.readFileSync(file))===expected,'Unexpected Resolver business source: '+file)}
verify()
exec(process.execPath,['--experimental-strip-types','scripts/test-branch2-resolver-opposite-gender-20261021.mjs'])
exec(process.platform==='win32'?'npm.cmd':'npm',['run','typecheck'])
const copies=new Map()
try{
 if(spawnSync('git',['cat-file','-e',baseline+':worker/domains/catalog.ts'],{stdio:'ignore'}).status!==0)
   exec('git',['fetch','--no-tags','--depth=1','origin',baseline])
 for(const file of historicalFiles){
   const old=spawnSync('git',['show',baseline+':'+file],{encoding:null,maxBuffer:16*1024*1024})
   failUnless(!old.error&&old.status===0,'Immutable original source inaccessible: '+file)
   copies.set(file,fs.readFileSync(file))
   fs.writeFileSync(file,old.stdout)
 }
 exec(process.execPath,['scripts/catalog-integrity-branch2-preserved-gate.mjs'],
   {...process.env, RESOLVER_GENDER_FROZEN_REPLAY:'1'})
}finally{
 for(const [file,bytes] of copies)fs.writeFileSync(file,bytes)
}
verify()
exec(process.execPath,['--experimental-strip-types','scripts/test-branch2-resolver-opposite-gender-20261021.mjs'])
fs.rmSync('dist',{recursive:true,force:true})
exec(process.platform==='win32'?'npm.cmd':'npm',['run','build'])
failUnless(fs.existsSync('dist/client/assets'),'Current Resolver candidate frontend build missing')
console.log('BRANCH2_RESOLVER_GENDER_CURRENT_AND_FROZEN_HISTORY_PASSED')
