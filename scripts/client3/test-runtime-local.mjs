import assert from 'node:assert/strict'
import fs from 'node:fs'
import { spawn,spawnSync } from 'node:child_process'
import { prepareMigrations,renderConfig } from './prepare.mjs'

const db='orders_db_client3_smoke',worker='orders-app-client3-smoke'
const id='e7c30000-0000-4000-8000-00000000c1e3'
const secret='Client3LocalSmokeBootstrapSecret2026-NotForProduction'
const config='wrangler.client3.json',migrations='.client3-migrations',state='.client3-local-state'
const url='http://127.0.0.1:8799'
const npx=process.platform==='win32'?'npx.cmd':'npx'
let dev=null,log=''
const remove=()=>{for(const p of [config,migrations,state])fs.rmSync(p,{recursive:true,force:true})}
function run(label,args,timeout=240000){
 const r=spawnSync(npx,['wrangler',...args],{encoding:'utf8',timeout,maxBuffer:48*1024*1024})
 if(r.error||r.status!==0)throw Error(label+' failed '+(r.status??r.error)+'\n'+((r.stdout||'')+'\n'+(r.stderr||'')).slice(-5500))
 console.log('PASSED '+label+' '+(r.stdout||'').slice(-500))
 return r
}
async function get(urlPath,opts={}){
 const response=await fetch(url+urlPath,{...opts,signal:AbortSignal.timeout(15000)})
 const body=await response.text()
 return {status:response.status,body,cookie:response.headers.get('set-cookie')||''}
}
const pause=t=>new Promise(ok=>setTimeout(ok,t))
try{
 for(const p of [config,migrations,state])assert(!fs.existsSync(p),'Refusing to overwrite existing third-tenant resource '+p)
 prepareMigrations(migrations)
 fs.writeFileSync(config,renderConfig(worker,db,id),{flag:'wx',mode:0o600})
 run('local clean Client3 migrations',['d1','migrations','apply',db,'--local','--config',config,'--persist-to',state],360000)
 dev=spawn(npx,['wrangler','dev','--config',config,'--local','--port','8799','--persist-to',state,'--var','ADMIN_MODE_PASSWORD:'+secret],{detached:process.platform!=='win32',stdio:['ignore','pipe','pipe'],env:{...process.env,CI:'true'}})
 dev.stdout?.on('data',x=>{log=(log+String(x)).slice(-16000)})
 dev.stderr?.on('data',x=>{log=(log+String(x)).slice(-16000)})
 let live=false
 for(let i=0;i<80;i++){
   if(dev.exitCode!==null)throw Error('Worker exited at startup: '+log)
   try{const h=await get('/api/health');if(h.status===200){live=true;break}}catch{}
   await pause(400)
 }
 assert(live,'Local Client3 Worker did not start: '+log)
 assert.equal((await get('/api/orders')).status,401,'Public Orders must be denied')
 assert.equal((await get('/api/catalog')).status,401,'Public Catalog must be denied')
 const headers={'Content-Type':'application/json'}
 const call=body=>get('/api/auth/setup',{method:'POST',headers,body:JSON.stringify(body)})
 const setup={login:'client3admin',password:'LocalTestOnlyAdminPassword2026!',displayName:'Third smoke admin',bootstrapLogin:'admin'}
 const wrong=await call({...setup,bootstrapPassword:'admin'})
 assert.equal(wrong.status,401,'Default bootstrap password must be rejected: '+wrong.body)
 const created=await call({...setup,bootstrapPassword:secret})
 assert.equal(created.status,201,'First admin setup failed: '+created.body)
 assert(created.cookie.includes('orders_session'),'Auth setup must return cookie')
 const repeated=await call({...setup,bootstrapPassword:secret})
 assert.equal(repeated.status,409,'Second admin bootstrap must not create another admin: '+repeated.body)
 const authenticated={headers:{Cookie:created.cookie.split(';')[0]}}
 for(const urlPath of ['/api/orders','/api/catalog','/api/reference-data']){
   const r=await get(urlPath,authenticated)
   assert.equal(r.status,200,'Authorized initial '+urlPath+' did not work: '+r.body.slice(0,350)+' | Worker logs: '+log.slice(-5000))
 }
 const denied=await get('/api/orders',{method:'POST',headers,body:'{}'})
 assert.equal(denied.status,401,'Anonymous new order must never be permitted')
 console.log('CLIENT3_LOCAL_D1_LIVE_WORKER_AUTH_AND_FRESH_READS_PASSED: consolidated Client3 baseline, admin bootstrap guarded, authenticated APIs healthy')
}finally{
 if(dev){
   try{if(process.platform==='win32')dev.kill('SIGTERM');else process.kill(-dev.pid,'SIGTERM')}catch{}
   await pause(550)
   try{if(process.platform!=='win32')process.kill(-dev.pid,'SIGKILL')}catch{}
 }
 remove()
}
