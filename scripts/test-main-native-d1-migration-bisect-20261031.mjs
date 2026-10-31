// Workerd/D1 only, synthetic empty local DBs. Bisect historical migration authorizer
// failures without touching production credentials, migrations, or Main data.
import assert from 'node:assert/strict'
import {mkdtempSync,writeFileSync,readdirSync,readFileSync} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {spawnSync} from 'node:child_process'
assert(!process.env.CLOUDFLARE_API_TOKEN && !process.env.CLOUDFLARE_ACCOUNT_ID)
const files=readdirSync('migrations').filter(x=>/^\d+.*\.sql$/.test(x)).sort()
assert(files.length>=110)
const root=mkdtempSync(path.join(os.tmpdir(),'orders-app-d1-migration-bisect-'))
const sql=files.map(file=>{
 const raw=readFileSync(path.join('migrations',file),'utf8')
 // D1 has an authorizer: these SQLite PRAGMAs are not accepted as user SQL.
 // Ignore them ONLY in this disposable smoke fixture, never in real migrations.
 return raw.replace(/^\s*PRAGMA\s+foreign_keys\s*=\s*(?:ON|OFF)\s*;\s*$/gmi,'')
})
let attempts=0
function tryPrefix(n){
 const file=path.join(root,'prefix-'+n+'.sql')
 const persist=path.join(root,'persistence-'+n)
 writeFileSync(file,sql.slice(0,n).join('\n\n'))
 const command=['d1','execute','orders_db_prod','--local','--persist-to',persist,'--file',file]
 const r=spawnSync(path.join('node_modules','.bin','wrangler'),command,{encoding:'utf8',timeout:45000,maxBuffer:5*1024*1024,env:{...process.env,WRANGLER_SEND_METRICS:'false'}})
 attempts++
 const output=(r.stdout||'')+'\n'+(r.stderr||'')
 return {ok:r.status===0,error:output.slice(-950).replace(/\x1b\[[0-9;]*m/g,''),exit:r.status,code:r.error?.code}
}
const first=tryPrefix(1)
console.log('D1_MIGRATION_PREFIX_1',JSON.stringify({pass:first.ok,file:files[0],error:first.ok?'':first.error.slice(-400)}))
if(!first.ok){
 console.log('D1_MIGRATION_AUTHORIZE_BLOCKED_FIRST_FILE',files[0])
 process.exitCode=1
} else {
 let good=1,bad=files.length+1
 const all=tryPrefix(files.length)
 if(all.ok){console.log('D1_ALL_CHECKED_IN_MIGRATIONS_SANITIZED_PASS',files.length);process.exit(0)}
 bad=files.length
 while(bad-good>1) {
  const mid=Math.floor((bad+good)/2),r=tryPrefix(mid)
  console.log('D1_MIGRATION_BISECT',JSON.stringify({prefix:mid,pass:r.ok,near:files[mid-1],error:r.ok?'':r.error.slice(-270)}))
  if(r.ok)good=mid
  else bad=mid
 }
 const failing=tryPrefix(bad)
 console.log('D1_MIGRATION_AUTHORIZE_FIRST_FAIL',JSON.stringify({goodPrefix:good,firstFailed:files[bad-1],attempts,error:failing.error.slice(-950)}))
 process.exitCode=1
}
