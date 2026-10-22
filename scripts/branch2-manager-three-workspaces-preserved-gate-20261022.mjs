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
const teamPath = 'src/features/sections/TeamSection.tsx'
const oldTeamSha = 'c8d330aff9cd45468a448eb8c70e24d55cf1d198'
const newTeamSha = '92f5bdf6cdf2ccd12c1d2454648c434b0f8876b9'
const blob = bytes => crypto.createHash('sha1').update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex')
const assert = (pass,message) => {if(!pass)throw Error(message)}
const readSha = path => blob(fs.readFileSync(path))
const verifyCandidate=()=>{
 assert(readSha(appPath)===candidateApp,'Unreviewed App source in manager workspace gate')
 assert(readSha('src/app/managerWorkspaceAccess.ts')===helperSha,'Unreviewed manager access policy')
 assert(readSha(teamPath)===newTeamSha,'Unreviewed timesheet text modification')
}
const run=(command,args)=>{
 const p=spawnSync(command,args,{stdio:'inherit',shell:false,maxBuffer:16*1024*1024,timeout:40*60*1000,env:process.env})
 assert(!p.error && p.status===0,'Manager navigation/frozen release failed: '+command+' '+args.join(' ')+' ('+p.status+')')
}
verifyCandidate()
run(process.execPath,['--experimental-strip-types','scripts/test-manager-three-workspaces-20261022.mjs'])
run(process.platform==='win32'?'npm.cmd':'npm',['run','typecheck'])
const helperPath='src/app/managerWorkspaceAccess.ts'
const candidateBytes=fs.readFileSync(appPath)
const newHelperBytes=fs.readFileSync(helperPath)
const newTeamBytes=fs.readFileSync(teamPath)
try{
 if(spawnSync('git',['cat-file','-e',baseline+':'+appPath],{stdio:'ignore'}).status!==0)
   run('git',['fetch','--no-tags','--depth=1','origin',baseline])
 const previous=spawnSync('git',['show',baseline+':'+appPath],{encoding:null,maxBuffer:16*1024*1024})
 assert(!previous.error && previous.status===0 && blob(previous.stdout)===baselineApp,
   'Exact historical Branch2 App missing; refuse unchecked regression')
 fs.writeFileSync(appPath,previous.stdout)
 // The old App does not import this new helper. Remove it ONLY while
 // replaying the pristine historical src tree; legacy dead-code checks
 // would otherwise report a false unused module.
 fs.unlinkSync(helperPath)
 const previousTeam=spawnSync('git',['show',baseline+':'+teamPath],{encoding:null,maxBuffer:16*1024*1024})
 assert(!previousTeam.error && previousTeam.status===0 && blob(previousTeam.stdout)===oldTeamSha,
  'Old timesheet source unavailable for frozen release')
 fs.writeFileSync(teamPath,previousTeam.stdout)
 run(process.execPath,['scripts/branch2-unified-kaspi-preserved-gate.mjs'])
}finally{
 fs.writeFileSync(appPath,candidateBytes)
 fs.writeFileSync(helperPath,newHelperBytes)
 fs.writeFileSync(teamPath,newTeamBytes)
}
verifyCandidate()
run(process.execPath,['--experimental-strip-types','scripts/test-manager-three-workspaces-20261022.mjs'])
fs.rmSync('dist',{recursive:true,force:true})
run(process.platform==='win32'?'npm.cmd':'npm',['run','build'])
assert(fs.existsSync('dist/client/assets'),'Manager candidate frontend not built')
console.log('BRANCH2_MANAGER_THREE_WORKSPACES_AND_FROZEN_RELEASE_PASSED')
