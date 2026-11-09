// Main ONLY: verify new manager navigation and timesheet text change.
// Re-run the immutable accepted Main release with both old UI files restored.
// No Cloudflare credentials or D1 mutations.
import fs from 'node:fs'
import crypto from 'node:crypto'
import {spawnSync} from 'node:child_process'
const app='src/App.tsx',team='src/features/sections/TeamSection.tsx',policy='src/app/managerWorkspaceAccess.ts'
const pins={
 [app]:['56e40249a7fc03d2bfdb6b7723382c703cc108c8','9d9987b976aa3e5844ed8c968d46f97e3e7d004b'],
 [team]:['92f5bdf6cdf2ccd12c1d2454648c434b0f8876b9','c8d330aff9cd45468a448eb8c70e24d55cf1d198'],
 [policy]:['37db94598dfeec57a3f9eea8058f9955256a51aa',null],
}
const base='5270d289288719276ad84a87615f8aa7f90e58e4'
const blob=bytes=>crypto.createHash('sha1').update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex')
const check=(value,msg)=>{if(!value)throw Error(msg)}
const verify=()=>{for(const [path,[expected]] of Object.entries(pins))check(blob(fs.readFileSync(path))===expected,'Unreviewed main UI source: '+path)}
const run=(command,args)=>{
 const x=spawnSync(command,args,{stdio:'inherit',shell:false,maxBuffer:32*1024*1024,timeout:45*60*1000})
 check(!x.error&&x.status===0,'Main manager-only routing regression failed: '+command+' '+args.join(' ')+' ('+x.status+')')
}
const npm=process.platform==='win32'?'npm.cmd':'npm'
verify()
run(process.execPath,['--experimental-strip-types','scripts/test-main-manager-three-workspaces-20261022.mjs'])
run(npm,['run','typecheck'])
run(npm,['run','build'])
const saved=new Map()
try{
 if(spawnSync('git',['cat-file','-e',base+':'+app],{stdio:'ignore'}).status!==0)
   run('git',['fetch','--no-tags','--depth=1','origin',base])
 for(const path of [app,team]){
   const original=spawnSync('git',['show',base+':'+path],{encoding:null,maxBuffer:32*1024*1024})
   check(!original.error&&original.status===0&&blob(original.stdout)===pins[path][1],'Frozen Main source missing: '+path)
   saved.set(path,fs.readFileSync(path))
   fs.writeFileSync(path,original.stdout)
 }
 saved.set(policy,fs.readFileSync(policy))
 fs.unlinkSync(policy)
 // The original Main release entrypoint is byte-identical and checks every
 // previously approved production transaction/finance/stock invariant.
 run(process.execPath,['scripts/main-resolver-selective-release-20261022.mjs'])
}finally{
 for(const [path,bytes] of saved)fs.writeFileSync(path,bytes)
}
verify()
run(process.execPath,['--experimental-strip-types','scripts/test-main-manager-three-workspaces-20261022.mjs'])
fs.rmSync('dist',{recursive:true,force:true})
run(npm,['run','build'])
check(fs.existsSync('dist/client/assets'),'Main current frontend assets missing')
console.log('MAIN_MANAGER_THREE_WORKSPACES_AND_FROZEN_RELEASE_PASSED')
