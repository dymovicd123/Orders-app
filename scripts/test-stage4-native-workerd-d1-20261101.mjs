// REAL local Cloudflare workerd + native D1. Disposable database and Worker.
// Historical final schema is derived by applying real migrations in disposable
// SQLite; new Stage4 migrations 0117/0118 are executed directly on native D1.
// The ONLY Wrangler commands below have --local and an isolated temp config;
// never pass production/Branch2 credentials, endpoints or database identifiers.
import assert from 'node:assert/strict'
import {spawn,spawnSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {DatabaseSync} from 'node:sqlite'
import {mkdtempSync,mkdirSync,readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {setTimeout as delay} from 'node:timers/promises'

const temp=mkdtempSync(join(tmpdir(),'stage4-native-d1-only-'))
const persist=join(temp,'persist')
const config=join(temp,'wrangler.json')
const schemaPaths=[]
const seedPath=join(temp,'seed.sql')
const database='stage4_local_d1_fixture_only'
const cli=resolve('node_modules/wrangler/bin/wrangler.js')
const port=8987
const base='http://127.0.0.1:'+port
const sessionToken='only-local-stage4-test-cookie'
const actorName='Тест Завсклад'
const env={
 ...process.env,CI:'true',WRANGLER_SEND_METRICS:'false',
 CLOUDFLARE_API_TOKEN:'',CLOUDFLARE_ACCOUNT_ID:'',
}
mkdirSync(persist)
writeFileSync(config,JSON.stringify({
 name:'stage4-local-worker-only',
 main:resolve('worker/index.ts'),
 compatibility_date:'2026-07-06',
 compatibility_flags:['nodejs_compat'],
 assets:{directory:resolve('dist/client'),not_found_handling:'single-page-application',run_worker_first:['/api/*']},
 d1_databases:[{
  binding:'DB',database_name:database,
  database_id:'00000000-0000-4000-8000-000000000046',
 }],
}))
const migrations=readdirSync('migrations').filter(name=>/^\d{4}.*\.sql$/.test(name)).sort()
assert(migrations.includes('0117_v72_inventory_manual_operation_receipts.sql'))
assert(migrations.includes('0118_v72_inventory_operation_attempts.sql'))
// Historical catalog migrations use CREATE TEMP TABLE, disallowed by Wrangler's
// native local D1 execute authorizer. Derive the EXACT persistent final schema
// from running all older real migrations in SQLite (as existing HTTP tests do),
// then bootstrap those DDL statements into local D1. Apply the NEW 0117/0118
// migrations directly on native local D1 to verify their real compatibility.
const snapshot=new DatabaseSync(':memory:')
for(const name of migrations.filter(x=>x<'0117_')) {
 try {snapshot.exec(readFileSync('migrations/'+name,'utf8'))}
 catch(e){throw Error('Cannot derive final schema from '+name+': '+String(e))}
}
const ddl=snapshot.prepare(`SELECT type,name,sql FROM sqlite_master
 WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
 AND name NOT GLOB '*_fts_*'
 AND type IN ('table','index','view','trigger')
 ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 WHEN 'view' THEN 2 ELSE 3 END,name`).all()
assert(ddl.length>100,'Expected actual comprehensive persistent D1 table/index schema')
let schemaBatch=''
for(const row of ddl){
 const part='-- '+row.type+' '+row.name+'\n'+row.sql+';\n'
 if(schemaBatch && schemaBatch.length+part.length>28000){
  const filename=join(temp,'schema-'+schemaPaths.length+'.sql')
  writeFileSync(filename,schemaBatch);schemaPaths.push(filename);schemaBatch=''
 }
 schemaBatch+=part
}
if(schemaBatch){
 const filename=join(temp,'schema-'+schemaPaths.length+'.sql')
 writeFileSync(filename,schemaBatch);schemaPaths.push(filename)
}
snapshot.close()
const tokenHash=createHash('sha256').update(sessionToken).digest('base64url')
writeFileSync(seedPath,[
 "INSERT INTO managers(id,name,role,is_active) VALUES(9781,'Тест Завсклад','Завсклад',1);",
 "INSERT INTO app_users(id,login,email,password_hash,role,manager_id,display_name,is_active,must_change_password) VALUES(9781,'stage4native','native@invalid','test-only','manager',9781,'"+actorName+"',1,0);",
 "INSERT INTO app_sessions(user_id,token_hash,expires_at) VALUES(9781,'"+tokenHash+"','2099-01-01T00:00:00.000Z');",
 "INSERT INTO catalog_products(id,name,category,is_active) VALUES(9782,'STAGE4 NATIVE TEST SKU','adult',1);",
 "INSERT INTO catalog_stock_positions(product_id,category,gender_scope,material,length,is_default,is_active,sort_order,created_at,updated_at) VALUES(9782,'adult','unisex','СТАНДАРТ','СТАНДАРТ',0,1,0,'2026-11-01T00:00:00Z','2026-11-01T00:00:00Z');",
 "INSERT INTO catalog_variants(id,product_id,gender,color,material,length,size_label,category,is_active,stock_position_id) SELECT 9783,9782,'МУЖ','БЕЖ','СТАНДАРТ','СТАНДАРТ','50','adult',1,id FROM catalog_stock_positions WHERE product_id=9782;",
 "INSERT INTO inventory_stock(id,inventory_source,product_id,variant_id,product_name_snapshot,gender_snapshot,color_snapshot,material_snapshot,length_snapshot,size_snapshot,quantity,reserved_quantity) VALUES(9784,'warehouse',9782,9783,'STAGE4 NATIVE TEST SKU','МУЖ','БЕЖ','СТАНДАРТ','СТАНДАРТ','50',2,0);",
 "INSERT INTO inventory_stock(id,inventory_source,product_id,variant_id,product_name_snapshot,gender_snapshot,color_snapshot,material_snapshot,length_snapshot,size_snapshot,quantity,reserved_quantity) VALUES(9785,'boutique',9782,9783,'STAGE4 NATIVE TEST SKU','МУЖ','БЕЖ','СТАНДАРТ','СТАНДАРТ','50',8,0);",
 "INSERT INTO catalog_identity_meta(key,value,updated_at) VALUES('catalog_identity_v3','active','2026-11-01T00:00:00Z') ON CONFLICT(key) DO UPDATE SET value='active';",
 "INSERT INTO inventory_model_meta(key,value,updated_at) VALUES('human_inventory_v2','active','2026-11-01T00:00:00Z') ON CONFLICT(key) DO UPDATE SET value='active';",
 "INSERT INTO orders(id,external_id,order_date,created_at,shipping_status,order_status) VALUES(9790,'STAGE4-NATIVE-RESERVE','2026-10-31','2026-10-31T08:00:00Z','not_sent','active');",
 "INSERT INTO order_items(id,order_id,quantity,is_workshop,created_at,inventory_obligation_origin_at,product_name_snapshot,gender_snapshot,color_snapshot,material_snapshot,length_snapshot,size_snapshot,source_type,stock_writeoff_status,product_id,variant_id) VALUES(9791,9790,3,0,'2026-10-31T08:00:00Z','2026-10-31T08:00:00Z','STAGE4 NATIVE TEST SKU','МУЖ','БЕЖ','СТАНДАРТ','СТАНДАРТ','50','warehouse','reserved',9782,9783);",
 "INSERT INTO inventory_reservations(id,inventory_source,variant_id,quantity,status,order_id,order_item_id,created_at,updated_at) VALUES(9792,'warehouse',9783,3,'active',9790,9791,'2026-10-31T08:00:00Z','2026-10-31T08:00:00Z');",
 "UPDATE inventory_stock SET reserved_quantity=3 WHERE inventory_source='warehouse' AND variant_id=9783;",
].join('\n'))
function localD1(file){
 const result=spawnSync(process.execPath,[cli,'d1','execute',database,
  '--config',config,'--local','--persist-to',persist,'--file',file],{
  encoding:'utf8',timeout:180000,maxBuffer:24*1024*1024,env,
 })
 if(result.error)throw result.error
 assert.equal(result.status,0,
  'Native isolated D1 failed to execute '+file+'\n'+result.stdout+'\n'+result.stderr)
}
let child=null
let logs=''
async function api(method,path,body,cookie=true){
 const headers={}
 if(cookie)headers.cookie='orders_session='+sessionToken
 if(body!==undefined)headers['content-type']='application/json'
 const res=await fetch(base+path,{
  method,headers,...(body===undefined?{}:{body:JSON.stringify(body)}),
  signal:AbortSignal.timeout(13000),
 })
 const text=await res.text()
 let data;try{data=JSON.parse(text)}catch{data={raw:text.slice(0,500)}}
 return {status:res.status,data}
}
async function ready(){
 for(let n=0;n<110;n++){
  if(child.exitCode!==null)throw Error('Local workerd stopped early: '+logs.slice(-10000))
  try {
   const r=await api('GET','/api/auth/me')
   if(r.status===200)return
  }catch{}
  await delay(450)
 }
 throw Error('Real local Worker never became ready: '+logs.slice(-10000))
}
const item={
 productId:9782,variantId:9783,productName:'STAGE4 NATIVE TEST SKU',
 category:'adult',gender:'МУЖ',color:'БЕЖ',material:'СТАНДАРТ',
 length:'СТАНДАРТ',size:'50',quantity:2,expectedQuantity:2,
}
try{
 for(const sqlFile of schemaPaths)localD1(sqlFile)
 localD1(resolve('migrations/0117_v72_inventory_manual_operation_receipts.sql'))
 localD1(resolve('migrations/0118_v72_inventory_operation_attempts.sql'))
 localD1(seedPath)
 child=spawn(process.execPath,[cli,'dev','--local','--config',config,
  '--persist-to',persist,'--ip','127.0.0.1','--port',String(port)],{
  env,stdio:['ignore','pipe','pipe'],
 })
 for(const stream of [child.stdout,child.stderr]){
  stream.setEncoding('utf8')
  stream.on('data',chunk=>{logs=(logs+chunk).slice(-24000)})
 }
 await ready()
 assert.equal((await api('GET','/api/inventory/operation-attempts?source=warehouse&variantId=9783',undefined,false)).status,401)
 const path='/api/inventory/movements?returnInventory=0'
 const attempts='/api/inventory/operation-attempts?source=warehouse&variantId=9783'
 const other='/api/inventory/operation-attempts?source=boutique&variantId=9783'
 const history='/api/inventory/history?source=warehouse&variantId=9783'
 const attention=await api('GET','/api/inventory/attention?details=1&limit=10')
 assert.equal(attention.status,200,'Native D1 real Problems query: '+JSON.stringify(attention)+' '+logs.slice(-2000))
 assert((attention.data.items?.shortages||[]).some(x=>x.source==='warehouse'&&Number(x.variantId)===9783),
  'Native D1 must expose one actual linked-order shortage before receipt')
 let browserAcceptance=null
 if(process.argv.includes('--browser')){
  const {startStage4Browser}=await import('./test-stage4-browser-problems-history-20261101.mjs')
  browserAcceptance=await startStage4Browser({origin:base,sessionToken,variantId:9783})
  await browserAcceptance.beforeReceipt()
 }
 const rejected=await api('POST',path,{
  requestId:'native-stage4-rejected',inventorySource:'warehouse',
  movementType:'arrival',items:[{...item,color:'НЕВЕРНЫЙ'}],
 })
 assert.equal(rejected.status,409,'Canonical wrong color must be a business rejection: '+JSON.stringify(rejected))
 const failedHistory=await api('GET',history)
 assert.equal(failedHistory.status,200,JSON.stringify(failedHistory))
 assert(!(failedHistory.data.movements||[]).some(x=>x.referenceId==='native-stage4-rejected'),
  'Rejected native D1 action cannot mutate stock')
 const failedAttempts=await api('GET',attempts)
 assert.equal(failedAttempts.status,200,JSON.stringify(failedAttempts))
 assert(failedAttempts.data.attempts.some(x=>x.requestId==='native-stage4-rejected'&&x.outcome==='rejected'),
  'Rejected request must leave only request evidence')
 const movement={requestId:'native-stage4-arrival',inventorySource:'warehouse',
  movementType:'arrival',comment:'Накладная NATIVE-E2E',items:[item]}
 const applied=await api('POST',path,movement)
 assert.equal(applied.status,201,'Native D1 Arrival failed: '+JSON.stringify(applied)+'\n'+logs.slice(-3500))
 assert.equal(applied.data.operationId,'native-stage4-arrival')
 const recorded=await api('GET',history)
 assert.equal(recorded.status,200,JSON.stringify(recorded))
 const evidence=(recorded.data.movements||[]).filter(x=>x.referenceId==='native-stage4-arrival')
 assert.equal(evidence.length,1,'Exactly one physical movement written')
 assert.equal(evidence[0].performedBy,actorName,'Real Cyrillic authenticated actor must survive headers and native D1')
 assert.equal(Number(evidence[0].quantityDelta),2)
 assert.equal(Number(evidence[0].quantityAfter),4)
 const currentAttention=await api('GET','/api/inventory/attention?details=1&limit=10')
 assert.equal(currentAttention.status,200,JSON.stringify(currentAttention))
 assert(!(currentAttention.data.items?.shortages||[]).some(x=>x.source==='warehouse'&&Number(x.variantId)===9783),
  'Confirmed native D1 receipt must remove the live shortage without touching reservation')
 const liveReserve=await api('GET','/api/inventory/reservations?source=warehouse&variantId=9783')
 assert.equal(liveReserve.status,200,JSON.stringify(liveReserve))
 if(browserAcceptance){
  try { await browserAcceptance.afterReceipt() }
  finally { await browserAcceptance.close() }
 }
 const replay=await api('POST',path,movement)
 assert.equal(replay.status,200,'Native D1 retry must replay, not move: '+JSON.stringify(replay))
 assert.equal(replay.data.duplicate,true)
 const afterReplay=await api('GET',history)
 assert.equal((afterReplay.data.movements||[]).filter(x=>x.referenceId==='native-stage4-arrival').length,1)
 const events=await api('GET',attempts)
 assert(events.data.attempts.some(x=>x.requestId==='native-stage4-arrival'&&x.outcome==='replayed'))
 assert.equal((await api('GET',other)).data.attempts.length,0,'No cross-location evidence leak')
 console.log('STAGE4_NATIVE_WORKER_D1_ACCEPTANCE_PASS: actual migrations, Cyrillic authorized staff, native D1 arrival, rejected audit, immutable movement, replay and exact source/SKU')
}finally{
 if(child&&child.exitCode===null){child.kill('SIGTERM');await delay(300);if(child.exitCode===null)child.kill('SIGKILL')}
 rmSync(temp,{recursive:true,force:true})
}
