// Minimal four-tab navigation change. Test new policy, replay the exact
// previous release with the old policy/test restored, then build new assets.
// This gate never connects to either D1 database.
import fs from 'node:fs'
import crypto from 'node:crypto'
import {spawnSync} from 'node:child_process'
const baseline="4c2e3d5791b06f439dfb9aacecd59d521848c745"
const pins={
  "src/app/managerWorkspaceAccess.ts": [
    "fd6f6d32bb675a3439c497892daea65280da20b7",
    "37db94598dfeec57a3f9eea8058f9955256a51aa"
  ],
  "scripts/test-main-manager-three-workspaces-20261022.mjs": [
    "cd3e3f070bd6866fc0e36238dc1fbb8e75df8829",
    "4b804273252893c0870eb233982ece3e3df9f8f7"
  ]
}
const previousEntrypoint="scripts/main-resolver-selective-release-20261022.mjs"
const testFile="scripts/test-main-manager-three-workspaces-20261022.mjs"
const blob=bytes=>crypto.createHash('sha1').update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex')
const check=(ok,msg)=>{if(!ok)throw Error(msg)}
const run=(cmd,args)=>{
 const x=spawnSync(cmd,args,{stdio:'inherit',shell:false,maxBuffer:32*1024*1024,timeout:44*60*1000})
 check(!x.error&&x.status===0,'Manager Reports release failed: '+cmd+' '+args.join(' ')+' ('+x.status+')')
}
const npm=process.platform==='win32'?'npm.cmd':'npm'
const verify=()=>{for(const [p,[sha]] of Object.entries(pins))check(blob(fs.readFileSync(p))===sha,'Unexpected candidate policy or test: '+p)}
verify()
run(process.execPath,['--experimental-strip-types',testFile])
run(npm,['run','typecheck'])
const saved=new Map()
try{
 const first=Object.keys(pins)[0]
 if(spawnSync('git',['cat-file','-e',baseline+':'+first],{stdio:'ignore'}).status!==0)
   run('git',['fetch','--no-tags','--depth=1','origin',baseline])
 for(const [p,[,oldSha]] of Object.entries(pins)){
   const old=spawnSync('git',['show',baseline+':'+p],{encoding:null,maxBuffer:8*1024*1024})
   check(!old.error&&old.status===0&&blob(old.stdout)===oldSha,'Missing immutable previous release: '+p)
   saved.set(p,fs.readFileSync(p))
   fs.writeFileSync(p,old.stdout)
 }
 // The old entrypoint's source-pinned manager tests remain unchanged.
 run(process.execPath,[previousEntrypoint])
}finally{for(const [p,data] of saved)fs.writeFileSync(p,data)}
verify()
run(process.execPath,['--experimental-strip-types',testFile])
fs.rmSync('dist',{recursive:true,force:true})
run(npm,['run','build'])
check(fs.existsSync('dist/client/assets'),'Current frontend missing after build')
console.log('MANAGER_REPORTS_MAIN_FOUR_SECTIONS_AND_FULL_HISTORICAL_RELEASE_PASSED')
