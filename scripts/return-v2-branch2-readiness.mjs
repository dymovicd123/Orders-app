// Read-only Return V2 staging preflight.
// Default: validate the full migration chain in a temporary in-memory SQLite DB.
// --remote: run ONLY a SELECT/pragma_table_info query on the configured Branch2 D1.
// No schema/data writes to remote D1, Worker deploy, or feature flag changes.
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {spawnSync} from 'node:child_process'
import fs from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {
  RETURN_V2_REQUIRED_TABLES,RETURN_V2_REQUIRED_COLUMNS,
  returnV2SchemaReadinessSql
} from '../worker/routes/order-return-v2.ts'

const required=[
 '0124_return_v2_prepared_journal.sql',
 '0125_return_v2_contract_quantity_marker.sql',
 '0126_return_v2_posting_prototype.sql',
 '0127_return_v2_cancellation_prototype.sql',
 '0128_return_v2_unified_posting_prototype.sql',
 '0129_return_v2_unified_receipt_intent.sql',
 '0130_return_v2_unified_cancel_prototype.sql',
 '0131_return_v2_metadata_edits.sql',
 '0132_return_v2_resumed_dispatch_prototype.sql'
]
const args=process.argv.slice(2)
assert(args.length<=1 && (!args.length||args[0]==='--remote'),
 'Only the optional read-only --remote argument is supported.')
const remote=args[0]==='--remote'
const cfg=JSON.parse(fs.readFileSync('wrangler.jsonc','utf8'))
const dbConfig=cfg.d1_databases?.find(x=>x.binding==='DB')
assert.equal(cfg.name,'orders-app-branch2','Never inspect Main using this test command.')
assert.equal(dbConfig?.database_name,'orders_db_branch2_mirror_20261027',
 'Unexpected D1 target; stop before inspecting the wrong database.')
assert.equal(dbConfig?.database_id,'0904a573-21ff-44d8-93b0-c9200f771702',
 'D1 database ID changed. Require explicit review before using the script.')
assert.equal(cfg.vars?.RETURN_V2_ENABLED,'true',
 'Branch2 must explicitly enable Return V2 in its versioned Worker configuration.')
assert.equal(cfg.keep_vars,true,
 'Branch2 deploys must preserve other Worker variables and secrets.')
const missing=required.filter(file=>!fs.existsSync('migrations/'+file))
assert.equal(missing.length,0,'Missing Return V2 migrations: '+missing.join(', '))
const fingerprint=createHash('sha256')
for(const file of required)fingerprint.update(file+'\0'+fs.readFileSync('migrations/'+file,'utf8')+'\0')
const expected={
 expectedTables:RETURN_V2_REQUIRED_TABLES.length,
 expectedColumns:RETURN_V2_REQUIRED_COLUMNS.length
}
function evaluate(row){
 assert(row && typeof row==='object','D1 did not return a schema row.')
 const tableCount=Number(row.table_count)
 const columnCount=Number(row.column_count)
 const workshopActionCount=Number(row.workshop_action_count)
 assert(Number.isSafeInteger(tableCount)&&Number.isSafeInteger(columnCount),
   'D1 returned non-integer schema capability counts.')
 return {ready:tableCount===expected.expectedTables &&
   columnCount===expected.expectedColumns && workshopActionCount===2,
   foundTables:tableCount,foundColumns:columnCount,...expected}
}
const sql=returnV2SchemaReadinessSql()
let status
if(!remote){
 const db=new DatabaseSync(':memory:')
 try{
  for(const filename of fs.readdirSync('migrations').filter(x=>/^\d{4}.*\.sql$/.test(x)).sort())
    db.exec(fs.readFileSync('migrations/'+filename,'utf8'))
  status=evaluate(db.prepare(sql).get())
  assert(status.ready,'The migration sequence does not produce a usable V2 schema.')
  assert.equal(db.prepare('PRAGMA quick_check').get().quick_check,'ok',
    'The fresh migrated in-memory database failed SQLite quick_check.')
 }finally{db.close()}
}else{
 const wrangler=process.platform==='win32'?'npx.cmd':'npx'
 const call=spawnSync(wrangler,[
  '--no-install','wrangler','d1','execute',
  dbConfig.database_name,'--config','wrangler.jsonc','--remote',
  '--command',sql,'--json'
 ],{encoding:'utf8',maxBuffer:1024*1024*3,timeout:90000})
 if(call.error)throw call.error
 if(call.status!==0){
   process.stderr.write(call.stderr||call.stdout||'Read-only Wrangler query failed.\n')
   process.exit(call.status||1)
 }
 let payload
 try{
  payload=JSON.parse(call.stdout.trim())
 }catch{
  // Older Wrangler versions can print banners before JSON; never infer
  // a successful schema check from unparsed human-readable output.
  const offset=call.stdout.indexOf('[{')
  if(offset<0)throw new Error('Unable to parse Wrangler --json output.')
  payload=JSON.parse(call.stdout.slice(offset))
 }
 const statements=Array.isArray(payload)?payload:[payload]
 const first=statements[0]?.results?.[0]||statements[0]?.result?.[0]
 status=evaluate(first)
}
console.log(JSON.stringify({
 mode:remote?'remote-read-only':'local-in-memory',
 target:'orders-app-branch2',database:dbConfig.database_name,
 migrations:{first:'0124',last:'0132',count:required.length,
   fingerprintSha256:fingerprint.digest('hex')},
 schema:status,
 featureFlag:'ON in Branch2 source config; active Worker version still requires verification',
 remoteMigrationPerformed:false,remoteDeploymentPerformed:false,
 note:status.ready
  ?'Schema capability only; this is NOT employee/browser acceptance or Main release approval.'
  :'Schema incomplete. Do NOT enable Return V2. Backup then stage missing migrations safely.'
},null,2))
if(!status.ready)process.exitCode=2
