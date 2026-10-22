// Current manager-only navigation runs first; replay the byte-identical
// accepted Branch2 source for EVERY existing historical release regression.
// No Cloudflare credentials or D1 actions are involved.
import fs from 'node:fs'
import crypto from 'node:crypto'
import {spawnSync} from 'node:child_process'
const baseline = 'bc5a0b4dd73e8ba1961fea34793dba5610380735'
const appPath = 'src/App.tsx'
const candidateApp = 'ba551623ff7ea49bf25dd6e6db964d300e9a8315'
const baselineApp = 'de474a96c837294c409ea134b4d5d4cac82995e5'
const helperSha = '37db94598dfeec57a3f9eea8058f9955256a51aa'
const blob = bytes => crypto.createHash('sha1').update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex')
const assert = (pass,message) => {if(!pass)throw Error(message)}
const readSha = path => blob(fs.readFileSync(path))
const verifyCandidate=()=>{
 assert(readSha(appPath)===candidateApp,'Unreviewed App source in manager workspace gate')
 assert(readSha('src/app/managerWorkspaceAccess.ts')===helperSha,'Unreviewed manager access policy')
}
const run=(command,args)=>{
 const p=spawnSync(command,args,{stdio:'inherit',shell:false,maxBuffer:16*1024*1024,timeout:40*60*1000,env:process.env})
 assert(!p.error && p.status===0,'Manager navigation/frozen release failed: '+command+' '+args.join(' ')+' ('+p.status+')')
}
verifyCandidate()
run(process.execPath,['--experimental-strip-types','scripts/test-manager-three-workspaces-20261022.mjs'])
run(process.platform==='win32'?'npm.cmd':'npm',['run','typecheck'])
const candidateBytes=fs.readFileSync(appPath)
try{
 if(spawnSync('git',['cat-file','-e',baseline+':'+appPath],{stdio:'ignore'}).status!==0)
   run('git',['fetch','--no-tags','--depth=1','origin',baseline])
 const previous=spawnSync('git',['show',baseline+':'+appPath],{encoding:null,maxBuffer:16*1024*1024})
 assert(!previous.error && previous.status===0 && blob(previous.stdout)===baselineApp,
   'Exact historical Branch2 App missing; refuse unchecked regression')
 fs.writeFileSync(appPath,previous.stdout)
 run(process.execPath,['scripts/branch2-unified-kaspi-preserved-gate.mjs'])
}finally{
 fs.writeFileSync(appPath,candidateBytes)
}
verifyCandidate()
run(process.execPath,['--experimental-strip-types','scripts/test-manager-three-workspaces-20261022.mjs'])
fs.rmSync('dist',{recursive:true,force:true})
run(process.platform==='win32'?'npm.cmd':'npm',['run','build'])
assert(fs.existsSync('dist/client/assets'),'Manager candidate frontend not built')
console.log('BRANCH2_MANAGER_THREE_WORKSPACES_AND_FROZEN_RELEASE_PASSED')
