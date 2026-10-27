// Builds a LOCAL disposable production-data mirror through SELECT-only D1 reads.
// No production export, mutations, branch2 modifications, downloads or artifacts.
// Logs only aggregate counts. Never log a business row, hash, or SQL INSERT.
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {DatabaseSync} from 'node:sqlite'
const PROD='17e68a41-1d58-4a36-8a63-47c3e32443c4'
const TEST='40065052-854e-44b8-bcd5-251bdd488301'
const account=process.env.CLOUDFLARE_ACCOUNT_ID
const token=process.env.CLOUDFLARE_API_TOKEN
const config=readFileSync('wrangler.jsonc','utf8')
assert(token&&account,'Credentials missing')
assert(config.includes('"name": "orders-app-branch2"')&&config.includes(TEST)&&!config.includes(PROD),'Invalid staging binding')
const root='https://api.cloudflare.com/client/v4/accounts/'+account+'/d1/database/'
let prodReads=0,testReads=0
async function readOnly(id,sql){
  assert(id===PROD||id===TEST,'Unexpected D1 database')
  assert(/^SELECT\b/i.test(sql.trim()),'Only SELECT SQL allowed')
  const response=await fetch(root+id+'/query',{method:'POST',headers:{
    Authorization:'Bearer '+token,'Content-Type':'application/json',
  },body:JSON.stringify({sql}),signal:AbortSignal.timeout(30000)})
  const json=await response.json()
  assert(response.ok&&json.success!==false,'Read-only D1 failed HTTP '+response.status)
  const groups=Array.isArray(json.result)?json.result:[json.result]
  const rows=groups.flatMap(x=>Array.isArray(x?.results)?x.results:[])
  if(id===PROD)prodReads++;else testReads++
  return rows
}
function ident(s){assert(/^[A-Za-z_][A-Za-z0-9_]*$/.test(s),'Unexpected identifier');return '"'+s+'"'}
const metaSql="SELECT name,type,sql FROM sqlite_schema WHERE type IN ('table','index','view','trigger') AND name NOT LIKE 'sqlite_%' AND name <> '_cf_KV' ORDER BY name"
const prodSchema=await readOnly(PROD,metaSql)
const stageSchema=await readOnly(TEST,metaSql)
const prodTables=prodSchema.filter(x=>x.type==='table')
const stageTables=stageSchema.filter(x=>x.type==='table')
assert(prodTables.length>=100&&stageTables.length>=100)
assert(prodTables.some(x=>x.name==='orders')&&prodTables.some(x=>x.name==='app_users'))
assert(stageTables.some(x=>x.name==='app_users'))
const admins=await readOnly(TEST,"SELECT * FROM app_users WHERE role = 'admin' AND is_active = 1")
assert(admins.length===1,'Preserve exactly one existing active Branch2 admin; no data copied')
const originalAdmin={...admins[0],manager_id:null}
const stageSettings=stageTables.some(x=>x.name==='app_settings')
 ? await readOnly(TEST,"SELECT * FROM app_settings") : []
const sourceSettings=prodTables.some(x=>x.name==='app_settings')
const skipData=new Set(['app_users','app_sessions','auth_audit_log','auth_login_throttle'])
const directory=mkdtempSync(join(tmpdir(),'orders-branch2-mirror-'))
const localFile=join(directory,'local-dryrun.sqlite')
let local=null
try{
  local=new DatabaseSync(localFile,{enableDoubleQuotedStringLiterals:true})
  local.exec('PRAGMA foreign_keys = OFF')
  // FTS-backed virtual tables cannot be safely mirrored with the D1 API.
  for(const table of prodTables){
    assert(typeof table.sql==='string','No CREATE SQL for '+table.name)
    assert(!/CREATE\s+VIRTUAL\s+TABLE/i.test(table.sql),'Virtual table needs separate plan: '+table.name)
    local.exec(table.sql)
  }
  const stageSettingMap=new Map(stageSettings.map(r=>[r.key,r]))
  let total=0,batchedReads=0
  const copiedCounts={}
  for(const table of prodTables){
    const name=table.name
    if(skipData.has(name)){copiedCounts[name]=0;continue}
    const columns=local.prepare('PRAGMA table_xinfo('+ident(name)+')').all()
      .filter(x=>Number(x.hidden||0)===0).map(x=>x.name)
    assert(columns.length>0,'Table without insert columns '+name)
    const cols=columns.map(ident)
    const tableName=ident(name)
    const insert=local.prepare('INSERT INTO '+tableName+' ('+cols.join(',')+') VALUES ('+cols.map(()=>'?').join(',')+')')
    const rowid=/WITHOUT\s+ROWID/i.test(table.sql) ? false : true
    let cursor=0,offset=0,n=0
    while(true){
      const statement=rowid
        ? 'SELECT rowid AS __mirror_cursor__, * FROM '+tableName+' WHERE rowid > '+cursor+' ORDER BY rowid LIMIT 100'
        : 'SELECT * FROM '+tableName+' LIMIT 100 OFFSET '+offset
      const rows=await readOnly(PROD,statement)
      batchedReads++
      if(!rows.length)break
      for(const raw of rows){
        const row={...raw}
        if(rowid){cursor=Number(row.__mirror_cursor__);assert(Number.isSafeInteger(cursor)&&cursor>0);delete row.__mirror_cursor__}
        if(name==='app_settings' && stageSettingMap.has(row.key)
             && /^(admin_mode_|require_stored_admin_password$|auth_|security_)/i.test(String(row.key))){
          Object.assign(row,stageSettingMap.get(row.key))
        }
        const foreignKeys=local.prepare('PRAGMA foreign_key_list('+tableName+')').all()
          .filter(x=>x.table==='app_users')
        for(const fk of foreignKeys){if(fk.from in row)row[fk.from]=null}
        const values=columns.map(col=>{
          let val=row[col]??null
          if(val!==null && typeof val==='object'){
            if(Array.isArray(val))val=Uint8Array.from(val)
            else throw Error('Unsupported binary/object SQLite column: '+name+'.'+col)
          }
          return val
        })
        insert.run(...values)
        n++
      }
      if(rows.length<100)break
      offset+=rows.length
      assert(n<1500000,'Unexpectedly large production table')
    }
    copiedCounts[name]=n
    total+=n
    // Re-read compact source count; a live table that changed DURING copy is not a snapshot.
    const source=await readOnly(PROD,'SELECT COUNT(*) AS n FROM '+tableName)
    assert(Number(source[0]?.n)===n,'Live source table changed while reading: '+name)
  }
  // Never import production credentials, logins, sessions or security locks.
  const tableSet=new Set(prodTables.map(x=>x.name))
  assert(tableSet.has('app_users'))
  const adminColumns=local.prepare('PRAGMA table_xinfo("app_users")').all().filter(c=>!c.hidden).map(c=>c.name)
  const adminFields=adminColumns.map(ident)
  local.prepare('INSERT INTO "app_users" ('+adminFields.join(',')+') VALUES ('+adminFields.map(()=>'?').join(',')+')')
    .run(...adminColumns.map(c=>originalAdmin[c]??null))
  // Branch2-only security keys survive if main doesn't have them.
  if(sourceSettings){
    const stmt=local.prepare('INSERT OR REPLACE INTO "app_settings" (key,value) VALUES (?,?)')
    for(const row of stageSettings){
      if(/^(admin_mode_|require_stored_admin_password$|auth_|security_)/i.test(String(row.key)))stmt.run(row.key,row.value)
    }
  }
  for(const obj of prodSchema.filter(x=>x.type==='index'&&x.sql))local.exec(obj.sql)
  for(const obj of prodSchema.filter(x=>(x.type==='trigger'||x.type==='view')&&x.sql))local.exec(obj.sql)
  local.exec('PRAGMA foreign_keys = ON')
  const fks=local.prepare('PRAGMA foreign_key_check').all()
  const integrity=local.prepare('PRAGMA quick_check').get()
  assert(Object.values(integrity)[0]==='ok','Offline SQLite is malformed')
  assert(fks.length===0,'Offline clone has '+fks.length+' broken foreign keys: '+[...new Set(fks.map(x=>x.table))].slice(0,15).join(','))
  const copyAdminCount=local.prepare("SELECT COUNT(*) AS n FROM app_users WHERE role='admin' AND is_active=1").get().n
  assert(copyAdminCount===1)
  assert(local.prepare("SELECT COUNT(*) AS n FROM app_users WHERE role='manager'").get().n===0)
  assert(local.prepare('SELECT COUNT(*) AS n FROM app_sessions').get().n===0)
  for(const table of ['orders','order_items','inventory_stock','inventory_reservations','inventory_movements','inventory_stock_checks','inventory_stocktake_items','catalog_variants']){
    assert(copiedCounts[table]>0,'No business data in '+table)
  }
  console.log('LOCAL_MIRROR_DRYRUN_PASSED '+JSON.stringify({
    productionTables:prodTables.length,stagingTables:stageTables.length,
    copiedBusinessRows:total,warehouseAndOrderCounts:Object.fromEntries(
      ['orders','order_items','inventory_stock','inventory_reservations','inventory_movements','inventory_stock_checks','inventory_stocktake_items','catalog_variants']
       .map(k=>[k,copiedCounts[k]])),
    activeStagingAdmin:1,managerAccounts:0,sessionAccounts:0,
    referentialIssues:fks.length,prodSelectQueries:prodReads,branch2SelectQueries:testReads
  }))
}finally{if(local)local.close();rmSync(directory,{recursive:true,force:true})}
