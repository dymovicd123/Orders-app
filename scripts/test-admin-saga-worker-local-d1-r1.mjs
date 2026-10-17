// Integration proof: REAL production cancellation handler running inside a
// local workerd Worker with a real LOCAL Cloudflare D1 binding.
// The test-only Worker is never referenced by production worker/index.ts.
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const temp=mkdtempSync(join(tmpdir(),'orders-worker-d1-test-'))
const persist=join(temp,'db')
const config=join(temp,'wrangler.json')
const name='orders_admin_worker_ci_only'
const cli=resolve('node_modules/wrangler/bin/wrangler.js')
const url='http://127.0.0.1:8973'
mkdirSync(persist)
writeFileSync(config,JSON.stringify({
  name:'orders-admin-worker-ci-only',
  main:resolve('scripts/fixtures/admin-delete-local-d1-worker.ts'),
  compatibility_date:'2026-07-06',compatibility_flags:['nodejs_compat'],
  d1_databases:[{
    binding:'DB',database_name:name,
    database_id:'00000000-0000-4000-8000-000000000002'
  }]
}))
const env={...process.env,CI:'true',WRANGLER_SEND_METRICS:'false',
  CLOUDFLARE_API_TOKEN:'',CLOUDFLARE_ACCOUNT_ID:''}
function execute(file){
  const p=spawnSync(process.execPath,[cli,'d1','execute',name,
    '--config',config,'--local','--persist-to',persist,'--file',resolve(file)],{
    encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024,env,
  })
  if(p.error)throw p.error
  assert.equal(p.status,0,'Local D1 setup failed '+file+'\n'+p.stdout+'\n'+p.stderr)
}
let child=null
let log=''
const probe=async(path)=>{
  const response=await fetch(url+path,{
    headers:{'x-isolated-ci-fixture':'allow'},signal:AbortSignal.timeout(5000),
  })
  const data=await response.json()
  return {status:response.status,data}
}
try{
  const schema=join(temp,'schema.sql')
  writeFileSync(schema,[
    'PRAGMA foreign_keys=ON;',
    'CREATE TABLE orders(id INTEGER PRIMARY KEY,external_id TEXT,order_status TEXT,shipping_status TEXT,pricing_mode TEXT,total_amount INTEGER,received_amount INTEGER,return_amount INTEGER,debt_amount INTEGER,updated_at TEXT);',
    'CREATE TABLE order_items(id INTEGER PRIMARY KEY,order_id INTEGER,quantity INTEGER,unit_price INTEGER,line_total INTEGER);',
    'CREATE TABLE exchanges(id INTEGER PRIMARY KEY,order_id INTEGER,status TEXT,financial_action TEXT,financial_amount INTEGER,payment_id INTEGER,refund_return_id INTEGER);',
    'CREATE TABLE returns(id INTEGER PRIMARY KEY,order_id INTEGER,status TEXT,amount INTEGER,payment_method TEXT,cancelled_at TEXT,cancellation_comment TEXT);',
    'CREATE TABLE return_items(id INTEGER PRIMARY KEY,return_id INTEGER,order_item_id INTEGER,restocked INTEGER,inventory_source TEXT,product_name_snapshot TEXT,quantity INTEGER);',
    'CREATE TABLE return_workshop_task_reversals(id INTEGER PRIMARY KEY,return_id INTEGER,workshop_task_id INTEGER,previous_status TEXT,previous_quantity INTEGER);',
    'CREATE TABLE workshop_tasks(id INTEGER PRIMARY KEY,order_id INTEGER,order_item_id INTEGER,status TEXT,quantity INTEGER,updated_at TEXT);',
    'CREATE TABLE payments(id INTEGER PRIMARY KEY,order_id INTEGER,amount INTEGER);',
    'CREATE TABLE inventory_reservations(id INTEGER PRIMARY KEY,order_id INTEGER,status TEXT,inventory_source TEXT,variant_id INTEGER);',
    'CREATE TABLE inventory_stock(id INTEGER PRIMARY KEY,inventory_source TEXT,variant_id INTEGER,quantity INTEGER,reserved_quantity INTEGER);',
    'CREATE TABLE inventory_lifecycle_events(id INTEGER PRIMARY KEY,operation_type TEXT,operation_id INTEGER,operation_item_id INTEGER,order_id INTEGER,status TEXT);',
    'CREATE TABLE critical_operations(request_id TEXT PRIMARY KEY,operation_type TEXT,request_fingerprint TEXT,status TEXT,step TEXT,context_json TEXT,lease_token TEXT,lease_until_ms INTEGER,created_at TEXT,updated_at TEXT,response_json TEXT,completed_at TEXT,last_error TEXT,target_type TEXT,target_id INTEGER,target_ref TEXT);',
    "INSERT INTO orders(id,external_id,order_status,shipping_status,pricing_mode,total_amount,received_amount,return_amount,debt_amount) VALUES(42,'LOCAL-D1-42','active','not_sent','itemized_v1',20000,0,0,20000);",
    'INSERT INTO order_items VALUES(1,42,1,20000,20000);',
    "INSERT INTO returns(id,order_id,status,amount) VALUES(400,42,'completed',0);",
    "INSERT INTO inventory_reservations VALUES(1,42,'active','warehouse',10);",
    "INSERT INTO inventory_stock VALUES(1,'warehouse',10,5,1);",
    "INSERT INTO inventory_lifecycle_events VALUES(99,'return',400,NULL,42,'applied');",
  ].join('\n'))
  execute(schema)
  execute('migrations/0110_v72_exchange_order_item_price_correction_audit.sql')
  execute('migrations/0111_v72_admin_order_delete_saga_journal.sql')

  child=spawn(process.execPath,[cli,'dev','--local','--config',config,
    '--persist-to',persist,'--ip','127.0.0.1','--port','8973'],{
    env,stdio:['ignore','pipe','pipe']
  })
  for(const s of [child.stdout,child.stderr]){
    s.setEncoding('utf8')
    s.on('data',chunk=>{log=(log+chunk).slice(-20000)})
  }
  let ready=false
  for(let attempt=0;attempt<90;attempt++){
    if(child.exitCode!==null)throw Error('Local Worker exited '+child.exitCode+'\n'+log)
    try{
      const r=await probe('/health')
      if(r.status===200&&r.data.fixture==='isolated-local-d1'){ready=true;break}
    }catch{}
    await delay(500)
  }
  assert(ready,'Local Worker did not become ready:\n'+log)
  const blocked=await probe('/preflight')
  assert.equal(blocked.status,409,'An applied physical event must block the saga')
  assert.match(blocked.data.error,/проведённые физические складские движения/)
  const before=await probe('/facts')
  assert.equal(before.data.ret.status,'completed')
  assert.equal(before.data.count.n,0)
  assert.deepEqual(before.data.stock,{quantity:5,reserved_quantity:1})

  assert.equal((await probe('/clear-applied-fixture')).status,200)
  assert.equal((await probe('/preflight')).status,200)
  const responseLost=await probe('/cancel-drop-reply')
  assert.equal(responseLost.status,503,'Simulate caller losing an already committed reply')
  assert.equal(responseLost.data.simulatedResponseLost,true)
  const after=await probe('/facts')
  assert.equal(after.data.ret.status,'cancelled')
  assert.equal(after.data.op.status,'completed')
  assert.equal(after.data.op.target_type,'return')
  assert.equal(after.data.op.target_id,400)
  assert.equal(after.data.count.n,1)
  assert.equal((await probe('/preflight')).status,200)
  const replay=await probe('/cancel')
  assert.equal(replay.status,200,'Replay deterministic cancelRequestId')
  assert.equal(replay.data.ok,true)
  assert.deepEqual(await probe('/verify'),{status:200,data:{reconciled:true}})
  const final=await probe('/facts')
  assert.equal(final.data.count.n,1,'No second critical business operation')
  assert.deepEqual(final.data.order,{
    total_amount:20000,received_amount:0,return_amount:0,debt_amount:20000
  })
  assert.deepEqual(final.data.stock,{quantity:5,reserved_quantity:1})
  console.log('ACTUAL_WORKER_LOCAL_D1_RETURN_CANCEL_AND_LOST_RESPONSE_RETRY_PASSED')
}finally{
  if(child){
    child.kill('SIGTERM')
    await Promise.race([
      new Promise(resolve=>child.once('exit',resolve)),
      delay(3500)
    ])
    if(child.exitCode===null)child.kill('SIGKILL')
  }
  rmSync(temp,{recursive:true,force:true})
}
