// Selective production P0 guard acceptance.
// Current runtime is tested first, immutable PRE-P0 production is replayed
// on exact original bytes, then the current candidate is restored and built.
// Never connects to D1, Cloudflare, production endpoints, or client secrets.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {spawnSync} from 'node:child_process'
import {createHash} from 'node:crypto'
const baseline='b2648e849dbeed9730650848823449cfecb72ce5'
const versions={
 'worker/domains/returns-exchanges.ts':['c10b1e68928efe742940499e5b4c9b4375ece72e','7e1ab1f6587943ed8b540c36a48a4e3065c17fc0'],
 'worker/domains/order-reservations.ts':['00d18e4d2e0964bcd9f912aade1fd285399076a0','14a8445bd28dc4d293ad93411887c381083afc80'],
}
const blob=(bytes)=>createHash('sha1').update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex')
const sha=file=>blob(fs.readFileSync(file))
const check=(condition,message)=>{if(!condition)throw Error(message)}
const run=(exe,args)=>{
 const result=spawnSync(exe,args,{stdio:'inherit',shell:false,maxBuffer:32*1024*1024})
 check(!result.error&&result.status===0,'Production P0 release acceptance failed: '+exe+' '+args.join(' ')+', status='+result.status)
}
const npm=process.platform==='win32'?'npm.cmd':'npm'
const wrangler=fs.readFileSync('wrangler.jsonc','utf8')
check(wrangler.includes('"name": "orders-app"')
 &&wrangler.includes('"database_name": "orders_db_prod"')
 &&!wrangler.includes('orders_db_branch2'),'STOP: incorrect production Worker/D1 binding')
for(const [file,[,candidate]] of Object.entries(versions))
 check(sha(file)===candidate,'Unreviewed production P0 candidate bytes: '+file)

run(process.execPath,['--experimental-strip-types','scripts/test-return-active-reserve-p0-20261021.mjs'])
run(npm,['run','typecheck'])
run(npm,['run','build'])
const originalPackageSha='9867683a1a5733244ff70abfd4b8a2881fca94dd'
const currentPackageSha='37023f33f1588fb7d0f3ab1370a49c3602e0f3ec'
const pkg='package.json'
check(sha(pkg)===currentPackageSha,'Unreviewed main release script mapping')
const saved=new Map()
const root=fs.mkdtempSync(path.join(os.tmpdir(),'orders-main-p0-frozen-'))
const newTest='scripts/test-return-active-reserve-p0-20261021.mjs'
try{
 let exists=spawnSync('git',['cat-file','-e',baseline+':worker/domains/returns-exchanges.ts'],{stdio:'ignore'})
 if(exists.status!==0)run('git',['fetch','--no-tags','--depth=1','origin',baseline])
 // Current Cloudflare release:check points here. For the old unchanged
 // historical gate, restore the original package script and modules.
 const priorPkg=spawnSync('git',['show',baseline+':'+pkg],{encoding:null,maxBuffer:2*1024*1024})
 check(!priorPkg.error&&priorPkg.status===0&&blob(priorPkg.stdout)===originalPackageSha,
   'Original main package release script drift')
 saved.set(pkg,fs.readFileSync(pkg))
 fs.writeFileSync(pkg,priorPkg.stdout)
 for(const [file,[historic,candidate]] of Object.entries(versions)){
   check(sha(file)===candidate,'Candidate changed before frozen replay: '+file)
   const old=spawnSync('git',['show',baseline+':'+file],{encoding:null,maxBuffer:32*1024*1024})
   check(!old.error&&old.status===0&&blob(old.stdout)===historic,'Frozen main pre-P0 code drift: '+file)
   saved.set(file,fs.readFileSync(file))
   fs.writeFileSync(file,old.stdout)
 }
 // A historical source/file-count test must run against the original inventory.
 const moved=path.join(root,'new-p0-test.mjs')
 fs.renameSync(newTest,moved)
 saved.set(newTest,moved)
 // Direct invocation makes the historical entry explicit and prevents
 // recursive dispatch into the current P0 release wrapper.
 run(process.execPath,['scripts/main-stage04-safe-release-gate.mjs'])
}finally{
 for(const [file,bytes] of saved){
   if(typeof bytes==='string'){if(fs.existsSync(bytes))fs.renameSync(bytes,file)}
   else fs.writeFileSync(file,bytes)
 }
 fs.rmSync(root,{recursive:true,force:true})
}
for(const [file,[,candidate]] of Object.entries(versions))
 check(sha(file)===candidate,'P0 candidate not restored after frozen main replay: '+file)
check(fs.existsSync(newTest),'P0 test script not restored')
check(sha(pkg)===currentPackageSha,'Current main build/release script not restored')
run(process.execPath,['--experimental-strip-types',newTest])
run(npm,['run','build'])
console.log('MAIN_P0_RETURN_RESERVATION_PREVENTION_AND_IMMUTABLE_HISTORICAL_RELEASE_PASSED')
