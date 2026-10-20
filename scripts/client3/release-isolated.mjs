#!/usr/bin/env node
// One-time release helper for the former client. This is NEVER run by CI.
// Explicit --deploy and an authenticated Wrangler session are required.
// No existing tenant database/Worker is ever used, updated, or deleted.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {spawnSync} from 'node:child_process'
import {prepareMigrations,renderConfig,PROTECTED_DATABASE_IDS} from './prepare.mjs'

const BRANCH='client3/isolated-stabilization-20261020'
const DATABASE='orders_db_client3_old_client'
const WORKER='orders-app-client3-old-client'
const CONFIG='wrangler.client3.json'
const MIGRATIONS='.client3-migrations'
const npx=process.platform==='win32'?'npx.cmd':'npx'

function run(command,args,opts={}){
  const r=spawnSync(command,args,{encoding:'utf8',stdio:opts.inherit?'inherit':'pipe',
    maxBuffer:24*1024*1024,timeout:opts.timeout??600000})
  if(r.error||r.status!==0)throw Error('Failed: '+[command,...args].join(' ')+
    (opts.inherit?'':'\n'+((r.stderr||'')+'\n'+(r.stdout||'')).slice(-1500)))
  return r.stdout||''
}
function wrangler(args,opts){return run(npx,['wrangler',...args],opts)}
function jsonFromStdout(out,label){
  try{return JSON.parse(out.trim())}
  catch{throw Error(label+' did not return pure JSON; STOP without guessing.')}
}
function remoteDatabases(){
  const raw=jsonFromStdout(wrangler(['d1','list','--json']),'wrangler d1 list')
  const rows=Array.isArray(raw)?raw:(Array.isArray(raw.result)?raw.result:null)
  assert(rows,'Unexpected Wrangler D1 list format; abort.')
  return rows
}
function namedDb(row){return String(row.name||row.database_name||'')}
function dbId(row){return String(row.uuid||row.database_id||row.id||'')}
function remoteSelect(sql){
  const raw=jsonFromStdout(wrangler(['d1','execute',DATABASE,'--remote','--config',CONFIG,
    '--command',sql,'--json','--yes']), 'Client3 SELECT')
  const query=Array.isArray(raw)?raw[0]:raw
  assert(query && Array.isArray(query.results),'Unexpected D1 query response; STOP.')
  return query.results
}
const countSql='SELECT '+
  ['managers','catalog_products','catalog_variants','orders','order_items','customers',
   'payments','returns','exchanges','inventory_stock','inventory_reservations','app_users']
  .map(t=>'(SELECT COUNT(*) FROM '+t+') AS '+t).join(', ')
function verifyFreshRemote(){
  const data=remoteSelect(countSql)
  assert.equal(data.length,1,'Expected exactly one count row.')
  for(const [table,n] of Object.entries(data[0])){
    assert.equal(Number(n),0,'Remote third DB is NOT empty: '+table+'='+n)
  }
  assert.equal(remoteSelect('PRAGMA foreign_key_check').length,0,'Remote third DB has broken FK.')
  console.log('Verified remote third DB: zero business data and no broken foreign keys.')
}
function main(){
  assert(process.argv.slice(2).join(' ')==='--deploy',
    'Use only: node scripts/client3/release-isolated.mjs --deploy')
  const branch=run('git',['branch','--show-current']).trim()
  assert.equal(branch,BRANCH,'Wrong branch. Never deploy main or branch2.')
  assert.equal(run('git',['status','--porcelain']).trim(),'','Uncommitted work present; abort.')
  assert(!fs.existsSync(CONFIG) && !fs.existsSync(MIGRATIONS),
    'Client3 config/migrations already exist: refusing to overwrite or reuse.')
  console.log('Checking fresh Client3 schema and building this isolated checkout...')
  run(process.execPath,['scripts/client3/test-fresh.mjs'],{inherit:true})
  run(npx,['run','build'],{inherit:true})
  const before=remoteDatabases()
  assert(!before.some(x=>namedDb(x)===DATABASE),
    'Third D1 name already exists. Refusing to reuse any database.')
  console.log('Creating independent Cloudflare D1 '+DATABASE)
  wrangler(['d1','create',DATABASE],{inherit:true})
  const after=remoteDatabases()
  const matches=after.filter(x=>namedDb(x)===DATABASE)
  assert.equal(matches.length,1,'Cannot verify exactly one newly created third database.')
  const id=dbId(matches[0])
  assert(/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id),'Invalid new D1 UUID.')
  assert(!PROTECTED_DATABASE_IDS.has(id.toLowerCase()),'Protected D1 ID: abort.')
  assert(!before.some(x=>dbId(x)===id),'Database ID predated this installation: abort.')
  prepareMigrations(MIGRATIONS)
  fs.writeFileSync(CONFIG,renderConfig(WORKER,DATABASE,id),{flag:'wx',mode:0o600})
  console.log('Applying only Client3 migrations to '+DATABASE+' ('+id+')...')
  wrangler(['d1','migrations','apply',DATABASE,'--remote','--config',CONFIG,'--yes'],
    {inherit:true,timeout:900000})
  verifyFreshRemote()
  console.log('Deploying independent Worker '+WORKER+'...')
  wrangler(['deploy','--config',CONFIG],{inherit:true,timeout:900000})
  // Worker bootstrap is fail-closed until its unique secret is configured.
  // Do not copy credentials from main/branch2, print secrets, or commit them.
  if(process.stdin.isTTY && process.stdout.isTTY){
    console.log('\nEnter a NEW strong bootstrap secret (16+ chars) at Wrangler prompt.')
    wrangler(['secret','put','ADMIN_MODE_PASSWORD','--config',CONFIG],{inherit:true})
    console.log('\nClient3 installed. Open its Worker URL to create the first administrator.')
  }else{
    console.log('\nClient3 Worker deployed but first-admin setup remains LOCKED.')
    console.log('Run interactively: npx wrangler secret put ADMIN_MODE_PASSWORD --config '+CONFIG)
  }
  console.log('Before handoff: verify browser login, operations and clear only Client3 fixtures.')
  console.log('NEVER merge this Client3 branch to main.')
}
try{main()}catch(error){console.error(String(error));process.exitCode=1}
