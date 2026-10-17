// Exercise the actual Wrangler LOCAL D1 engine. No Cloudflare credentials or
// remote database; both config and persistent store are disposable OS temp files.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const temporary=mkdtempSync(join(tmpdir(),'orders-admin-saga-d1-'))
const persist=join(temporary,'db')
const cfg=join(temporary,'wrangler.json')
const name='orders_admin_delete_ci_only'
const cli=resolve('node_modules/wrangler/bin/wrangler.js')
mkdirSync(persist)
writeFileSync(cfg,JSON.stringify({
  name:'orders-admin-delete-ci-only',compatibility_date:'2026-07-06',
  d1_databases:[{
    binding:'DB',database_name:name,
    database_id:'00000000-0000-4000-8000-000000000001'
  }]
}))
let n=0
function d1(file,{expectError=null}={}){
  const r=spawnSync(process.execPath,[cli,'d1','execute',name,'--local',
    '--config',cfg,'--persist-to',persist,'--file',resolve(file),'--json'],{
    encoding:'utf8',timeout:120000,maxBuffer:16*1024*1024,
    env:{...process.env,CLOUDFLARE_ACCOUNT_ID:'',CLOUDFLARE_API_TOKEN:''},
  })
  if(r.error)throw r.error
  const output=String(r.stdout||'')+'\n'+String(r.stderr||'')
  if(expectError){
    assert.notEqual(r.status,0,'Expected D1 error but query succeeded: '+file+'\n'+output)
    assert.match(output,expectError)
  }else assert.equal(r.status,0,'D1 rejected '+file+'\n'+output)
  return output
}
function sql(query,options={}){
  const file=join(temporary,'sql-'+(++n)+'.sql')
  writeFileSync(file,query)
  return d1(file,options)
}
function rows(query){
  const output=sql(query).trim()
  for(const i of [output.indexOf('[{'),output.indexOf('[\n'),output.indexOf('{"results"')].filter(x=>x>=0)){
    try{
      const value=JSON.parse(output.slice(i))
      const batches=Array.isArray(value)?value:[value]
      return batches.flatMap(b=>b.results||[])
    }catch{}
  }
  throw new Error('Unparseable local D1 --json output: '+output.slice(0,4000))
}
function assertRows(query,expected){assert.deepEqual(rows(query),expected)}
const fingerprint='a'.repeat(64)
try{
  sql([
    'PRAGMA foreign_keys=ON;',
    'CREATE TABLE orders(id INTEGER PRIMARY KEY,total_amount INTEGER,received_amount INTEGER);',
    'CREATE TABLE order_items(id INTEGER PRIMARY KEY,order_id INTEGER REFERENCES orders(id),quantity INTEGER,line_total INTEGER);',
    'CREATE TABLE exchanges(id INTEGER PRIMARY KEY,order_id INTEGER REFERENCES orders(id),status TEXT);',
    'CREATE TABLE inventory_stock(id INTEGER PRIMARY KEY,quantity INTEGER,reserved_quantity INTEGER);',
    'INSERT INTO orders VALUES(42,80000,0);',
    'INSERT INTO order_items VALUES(7,42,2,80000);',
    "INSERT INTO exchanges VALUES(11,42,'completed');",
    'INSERT INTO inventory_stock VALUES(1,9,3);',
  ].join('\n'))
  const migrations=[
    'migrations/0110_v72_exchange_order_item_price_correction_audit.sql',
    'migrations/0111_v72_admin_order_delete_saga_journal.sql'
  ]
  for(const file of migrations)d1(file)
  for(const file of migrations)d1(file)
  assertRows("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('exchange_order_item_price_corrections','admin_order_delete_sagas','admin_order_delete_saga_steps') ORDER BY name;",[
    {name:'admin_order_delete_saga_steps'},
    {name:'admin_order_delete_sagas'},
    {name:'exchange_order_item_price_corrections'}
  ])
  sql("INSERT INTO exchange_order_item_price_corrections (request_id,order_id,order_item_id,exchange_id,role,original_exchange_unit_price,old_unit_price,new_unit_price,quantity_at_correction,actor_label,corrected_at) VALUES('D1_PRICE',42,7,11,'new',40000,40000,39000,2,'admin','2026-10-17');")
  sql("UPDATE exchange_order_item_price_corrections SET new_unit_price=1 WHERE request_id='D1_PRICE';",
    {expectError:/immutable/i})
  sql("DELETE FROM exchange_order_item_price_corrections WHERE request_id='D1_PRICE';",
    {expectError:/immutable/i})
  sql("INSERT INTO exchange_order_item_price_corrections (request_id,order_id,order_item_id,exchange_id,role,original_exchange_unit_price,old_unit_price,new_unit_price,quantity_at_correction,actor_label,corrected_at) VALUES('BAD_FK',42,9999,11,'new',40000,40000,39000,2,'admin','2026-10-17');",
    {expectError:/FOREIGN KEY/i})
  sql("INSERT INTO admin_order_delete_sagas(request_id,order_id,status,preview_fingerprint,plan_json,next_step,created_at,updated_at) VALUES('SAGA_1',42,'planned','"+fingerprint+"','[]',0,'2026-10-17','2026-10-17');")
  sql("INSERT INTO admin_order_delete_sagas(request_id,order_id,status,preview_fingerprint,plan_json,next_step,created_at,updated_at) VALUES('SAGA_2',42,'planned','"+fingerprint+"','[]',0,'2026-10-17','2026-10-17');",
    {expectError:/UNIQUE/i})
  sql("INSERT INTO admin_order_delete_saga_steps(saga_request_id,step_index,operation_type,operation_id,cancel_request_id) VALUES('SAGA_1',0,'exchange',11,'CANCEL_11');")
  sql("INSERT INTO admin_order_delete_saga_steps(saga_request_id,step_index,operation_type,operation_id,cancel_request_id) VALUES('SAGA_1',1,'return',12,'CANCEL_11');",
    {expectError:/UNIQUE/i})
  sql("INSERT INTO admin_order_delete_saga_steps(saga_request_id,step_index,operation_type,operation_id,cancel_request_id) VALUES('SAGA_1',1,'bad',12,'CANCEL_12');",
    {expectError:/CHECK/i})
  assertRows('SELECT total_amount AS total,received_amount AS received FROM orders WHERE id=42;',[{total:80000,received:0}])
  assertRows('SELECT quantity AS physical,reserved_quantity AS reserved FROM inventory_stock WHERE id=1;',[{physical:9,reserved:3}])
  assertRows('SELECT quantity AS qty,line_total AS line FROM order_items WHERE id=7;',[{qty:2,line:80000}])
  assertRows("SELECT status FROM exchanges WHERE id=11;",[{status:'completed'}])
  for(const table of ['admin_order_delete_sagas','admin_order_delete_saga_steps','exchange_order_item_price_corrections'])
    assertRows('SELECT COUNT(*) AS n FROM '+table+';',[{n:1}])
  console.log('LOCAL_CLOUDFLARE_D1_0110_0111_MIGRATIONS_SAFE_PASSED')
}finally{
  rmSync(temporary,{recursive:true,force:true})
}
