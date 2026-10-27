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
  // SQLite FTS5 creates auxiliary shadow tables automatically. Recreating
  // those separately would corrupt the derived search index. Copy canonical
  // content tables, create the virtual FTS table, then rebuild its index.
  const virtualTables=prodTables.filter(t=>/CREATE\s+VIRTUAL\s+TABLE/i.test(t.sql||''))
  const shadowNames=new Set(prodTables.filter(t=>virtualTables.some(v=>t.name.startsWith(v.name+'_'))).map(t=>t.name))
  const dataTables=prodTables.filter(t=>!virtualTables.includes(t)&&!shadowNames.has(t.name))
  console.log('DERIVED_SEARCH_SCHEMAS '+JSON.stringify({
    virtualTables:virtualTables.map(t=>t.name),
    shadowCount:shadowNames.size,
    virtualDefinitions:virtualTables.map(t=>t.sql),
  }))
  for(const table of [...dataTables,...virtualTables]){
    assert(typeof table.sql==='string','No CREATE SQL for '+table.name)
    local.exec(table.sql)
  }
  const stageSettingMap=new Map(stageSettings.map(r=>[r.key,r]))
  let total=0,batchedReads=0
  const copiedCounts={}
  for(const table of dataTables){
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
        ? 'SELECT rowid AS __mirror_cursor__, * FROM '+tableName+' WHERE rowid > '+cursor+' ORDER BY rowid LIMIT 400'
        : 'SELECT * FROM '+tableName+' LIMIT 400 OFFSET '+offset
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
      if(rows.length<400)break
      offset+=rows.length
      assert(n<1500000,'Unexpectedly large production table')
    }
    copiedCounts[name]=n
    total+=n
    // Re-read compact source count; a live table that changed DURING copy is not a snapshot.
    const source=await readOnly(PROD,'SELECT COUNT(*) AS n FROM '+tableName)
    assert(Number(source[0]?.n)===n,'Live source table changed while reading: '+name)
  }
  // Populate virtual search from canonical rows, not from FTS shadow pages.
  for(const virtual of virtualTables){
    assert(/\bfts5\s*\(/i.test(virtual.sql),'Unsupported virtual table engine: '+virtual.name)
    if(/\bcontent\s*=\s*['"][^'"]+['"]/i.test(virtual.sql)){
      const name=ident(virtual.name)
      local.exec('INSERT INTO '+name+' ('+name+') VALUES (\'rebuild\')')
    }else{
      // The production FTS5 indexes are self-contained, not external-content
      // indexes. Their virtual rows hold order_id and searchable text; FTS
      // shadow tables are generated automatically from those same rows.
      const name=ident(virtual.name)
      const fields=local.prepare('PRAGMA table_xinfo('+name+')').all().filter(c=>!c.hidden).map(c=>c.name)
      assert(fields.includes('order_id')&&fields.includes('search_text'),
        'Unexpected FTS schema; cannot safely recreate '+virtual.name)
      const copy=local.prepare('INSERT INTO '+name+' (rowid,order_id,search_text) VALUES (?,?,?)')
      let cursor=0,totalFts=0
      while(true){
        const rows=await readOnly(PROD,'SELECT rowid AS __mirror_cursor__,order_id,search_text FROM '+name+
          ' WHERE rowid > '+cursor+' ORDER BY rowid LIMIT 400')
        if(!rows.length)break
        for(const row of rows){
          const id=Number(row.__mirror_cursor__)
          assert(Number.isSafeInteger(id)&&id>cursor,'Invalid FTS row cursor')
          copy.run(id,row.order_id,row.search_text)
          cursor=id
          totalFts++
        }
        if(rows.length<400)break
      }
      const rowCount=await readOnly(PROD,'SELECT COUNT(*) AS n FROM '+name)
      assert(totalFts===Number(rowCount[0]?.n||0),'FTS row count changed during copy: '+virtual.name)
      copiedCounts[virtual.name]=totalFts
    }
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

  // Keep *all* staging feature/security settings. Production settings can
  // enable unwanted live workflows and must not be imported into Branch2.
  if(sourceSettings){
    local.exec('DELETE FROM "app_settings"')
    const cols=local.prepare('PRAGMA table_xinfo("app_settings")').all()
      .filter(c=>!c.hidden).map(c=>c.name)
    const put=local.prepare('INSERT INTO "app_settings" ('+cols.map(ident).join(',')+
      ') VALUES ('+cols.map(()=>'?').join(',')+')')
    for(const row of stageSettings)put.run(...cols.map(c=>row[c]??null))
  }
  assert(local.prepare('PRAGMA foreign_key_check').all().length===0,'Staging settings damaged foreign keys')
  const quoteValue=v=>{
    if(v===null||v===undefined)return 'NULL'
    if(typeof v==='string')return "'"+v.replaceAll("'","''")+"'"
    if(typeof v==='number'){
      assert(Number.isFinite(v),'Cannot serialize non-finite SQLite numeric')
      return String(v)
    }
    if(typeof v==='bigint')return String(v)
    if(v instanceof Uint8Array)return "X'"+Buffer.from(v).toString('hex')+"'"
    throw Error('Unsupported SQLite value during staging import generation')
  }
  const statements=['PRAGMA defer_foreign_keys = ON;']
  const quoteName=s=>{assert(/^[A-Za-z_][A-Za-z0-9_]*$/.test(s));return '"'+s+'"'}
  // Remove existing branch2 virtual FTS index first; it removes its own
  // SQLite-generated shadow tables. Never DROP _cf_KV or SQLite internals.
  const stageVirtual=stageTables.filter(t=>/CREATE\s+VIRTUAL\s+TABLE/i.test(t.sql||''))
  const shadowStage=new Set(stageTables.filter(t=>stageVirtual.some(v=>t.name.startsWith(v.name+'_'))).map(t=>t.name))
  for(const o of stageSchema.filter(t=>t.type==='view'||t.type==='trigger'))
    statements.push('DROP '+o.type.toUpperCase()+' IF EXISTS '+quoteName(o.name)+';')
  for(const o of stageVirtual)statements.push('DROP TABLE IF EXISTS '+quoteName(o.name)+';')
  for(const o of stageTables.filter(t=>!stageVirtual.includes(t)&&!shadowStage.has(t.name)))
    statements.push('DROP TABLE IF EXISTS '+quoteName(o.name)+';')
  const dropEnd=statements.length
  for(const table of [...dataTables,...virtualTables])statements.push(table.sql.trim().replace(/;$/,'')+';')
  const createEnd=statements.length
  // Topologically order data by foreign-key dependencies. D1 commits each
  // imported chunk separately, so parents must exist before child inserts.
  const tableMap=new Map(dataTables.map(t=>[t.name,t]))
  const parents=new Map(dataTables.map(t=>[
    t.name,[...new Set(local.prepare('PRAGMA foreign_key_list('+quoteName(t.name)+')').all()
      .map(f=>f.table).filter(n=>tableMap.has(n)&&n!==t.name))]
  ]))
  const visited=new Set(),visiting=new Set(),orderedDataTables=[]
  function visit(name){
    if(visited.has(name))return
    assert(!visiting.has(name),'Cross-table FK cycle needs a single explicit import group: '+name)
    visiting.add(name)
    for(const p of parents.get(name)||[])visit(p)
    visiting.delete(name)
    visited.add(name)
    orderedDataTables.push(tableMap.get(name))
  }
  for(const t of dataTables)visit(t.name)
  function dumpRows(name,fields,includeRowid=false){
    const quoted=fields.map(quoteName)
    const colSql=(includeRowid?['rowid',...quoted]:quoted).join(',')
    const nameSql=quoteName(name)
    const select=(includeRowid?'rowid,':'')+quoted.join(',')
    const stmt=local.prepare('SELECT '+select+' FROM '+nameSql)
    let written=0
    for(const row of stmt.iterate()){
      const vals=(includeRowid?[row.rowid,...fields.map(k=>row[k])]:fields.map(k=>row[k]))
      statements.push('INSERT INTO '+nameSql+' ('+colSql+') VALUES ('+vals.map(quoteValue).join(',')+');')
      written++
    }
    return written
  }
  for(const table of orderedDataTables){
    const fields=local.prepare('PRAGMA table_xinfo('+quoteName(table.name)+')').all()
      .filter(c=>!c.hidden).map(c=>c.name)
    dumpRows(table.name,fields)
  }
  for(const table of virtualTables)dumpRows(table.name,['order_id','search_text'],true)
  const dataEnd=statements.length
  for(const idx of prodSchema.filter(s=>s.type==='index'&&s.sql))
    statements.push(idx.sql.trim().replace(/;$/,'')+';')
  for(const item of prodSchema.filter(s=>(s.type==='trigger'||s.type==='view')&&s.sql))
    statements.push(item.sql.trim().replace(/;$/,'')+';')
  // SQL is built only inside an Actions runner, protected from command echo.
  const sqlFile=join(directory,'branch2-restore.sql')
  writeFileSync(sqlFile,statements.join('\n')+'\n',{mode:0o600})
  const scriptSql=readFileSync(sqlFile,'utf8')
  assert(scriptSql.includes('DROP TABLE IF EXISTS "orders";'))
  assert(!scriptSql.includes('DROP TABLE IF EXISTS "_cf_KV";'))
  assert(!/\bDROP\s+DATABASE\b|\bATTACH\s+DATABASE\b/i.test(scriptSql))
  const checkFile=join(directory,'import-validation.sqlite')
  const verifyDb=new DatabaseSync(checkFile,{enableDoubleQuotedStringLiterals:true})
  try{
    // Cloudflare imports a SQL file as one implicit transaction. The local
    // validator must exercise the same transaction boundary: otherwise
    // deferred foreign keys would be checked after each individual INSERT.
    verifyDb.exec('BEGIN TRANSACTION')
    verifyDb.exec(scriptSql)
    verifyDb.exec('COMMIT')
    verifyDb.exec('PRAGMA foreign_keys = ON')
    assert(verifyDb.prepare('PRAGMA foreign_key_check').all().length===0,'Generated SQL violates foreign keys')
    for(const name of ['orders','order_items','inventory_stock','inventory_reservations','inventory_movements','inventory_stock_checks']){
      const expected=local.prepare('SELECT COUNT(*) AS n FROM '+quoteName(name)).get().n
      const actual=verifyDb.prepare('SELECT COUNT(*) AS n FROM '+quoteName(name)).get().n
      assert.equal(actual,expected,'Generated staging SQL changed '+name)
    }
    assert.equal(verifyDb.prepare("SELECT COUNT(*) AS n FROM app_users WHERE role='admin' AND is_active=1").get().n,1)
    assert.equal(verifyDb.prepare("SELECT COUNT(*) AS n FROM app_users WHERE role='manager'").get().n,0)
    assert.equal(verifyDb.prepare('SELECT COUNT(*) AS n FROM app_sessions').get().n,0)
  }finally{verifyDb.close()}
  // Exercise the exact Wrangler D1 SQL importer locally (same worker config,
  // never --remote) before touching real Branch2 data.
  const {spawnSync}=await import('node:child_process')
  const localImport=spawnSync('npx',['wrangler','d1','execute','orders_db_branch2',
    '--local','--persist-to='+join(directory,'d1-emulator'),
    '--file='+sqlFile,'--yes'],{
    cwd:process.cwd(),env:process.env,encoding:'utf8',timeout:8*60*1000,
    maxBuffer:16*1024*1024
  })
  assert(localImport.status===0&&!localImport.error,
    'Wrangler local D1 importer rejected staging SQL; no remote database touched')
  console.log('MIRROR_WRANGLER_LOCAL_D1_IMPORT_PASSED')
  console.log('MIRROR_STAGE_SQL_VALIDATED '+JSON.stringify({
    sqlBytes:Buffer.byteLength(scriptSql),tables:prodTables.length,
    sourceRows:total,mainReadQueries:prodReads,adminPreserved:true,
    newManagerLogins:0,stagingSettingsPreserved:true
  }))
  // One large (39 MB / 65k-statement) D1 import is rejected by Cloudflare.
  // Instead use independent small D1 import transactions: reset, schema,
  // parent-before-child data, and finally indexes/views/triggers.
  const chunks=[]
  const limitBytes=1024*1024
  for(const phase of [
    {name:'reset',sql:statements.slice(0,dropEnd)},
    {name:'schema',sql:statements.slice(dropEnd,createEnd)},
    {name:'data',sql:statements.slice(createEnd,dataEnd)},
    {name:'indexes',sql:statements.slice(dataEnd)},
  ]){
    let bucket=[],bytes=0,part=0
    function flush(){
      if(!bucket.length)return
      const sql='PRAGMA defer_foreign_keys = ON;\n'+bucket.join('\n')+'\n'
      chunks.push({name:phase.name+'-'+(++part),sql})
      bucket=[];bytes=0
    }
    for(const stmt of phase.sql){
      const len=Buffer.byteLength(stmt)+1
      assert(len<limitBytes,'An individual staging SQL statement is too large')
      if(bytes+len>limitBytes)flush()
      bucket.push(stmt)
      bytes+=len
    }
    flush()
  }
  assert(chunks.length>4&&chunks.length<120,'Unexpected staging chunk count')
  // Verify committed chunk boundaries as well as the original full SQL file.
  // An FK crossing a chunk boundary without its parent must fail BEFORE any
  // Cloudflare staging write, not midway through the production mirror.
  const chunkCheck=new DatabaseSync(join(directory,'chunk-boundary-check.sqlite'),{
    enableDoubleQuotedStringLiterals:true
  })
  try{
    chunkCheck.exec('PRAGMA foreign_keys=ON')
    for(const [i,chunk] of chunks.entries()){
      chunkCheck.exec('BEGIN')
      try{
        chunkCheck.exec(chunk.sql)
        chunkCheck.exec('COMMIT')
      }catch(err){
        try{chunkCheck.exec('ROLLBACK')}catch{}
        throw Error('Offline staging import chunk '+i+' ('+chunk.name+') invalid: '+String(err?.message||'unknown').replace(/(['"]).*?\1/g,'[literal]'))
      }
    }
    assert(chunkCheck.prepare('PRAGMA foreign_key_check').all().length===0,
      'Staged chunk replay has foreign-key violations')
    assert(Object.values(chunkCheck.prepare('PRAGMA quick_check').get())[0]==='ok',
      'Staged chunk replay failed integrity check')
    for(const name of ['orders','order_items','inventory_stock','inventory_reservations','inventory_movements','inventory_stock_checks','inventory_stocktake_items','catalog_variants']){
      const original=local.prepare('SELECT COUNT(*) AS n FROM '+quoteName(name)).get().n
      const replayed=chunkCheck.prepare('SELECT COUNT(*) AS n FROM '+quoteName(name)).get().n
      assert.equal(replayed,original,'Staged chunk replay count mismatch: '+name)
    }
  }finally{chunkCheck.close()}
  console.log('BRANCH2_CHUNKED_SQL_OFFLINE_VERIFIED '+JSON.stringify({
    chunks:chunks.length,maxBytes:Math.max(...chunks.map(x=>Buffer.byteLength(x.sql))),
    stages:[...new Set(chunks.map(x=>x.name.split('-')[0]))],
  }))

  // Main is never a target: remote writes are only allowed through the exact
  // stage binding after validating the UUID and remote DB name one more time.
  const metadata=await fetch(root+TEST,{
    headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(30000)
  })
  assert(metadata.ok,'Unable to confirm target D1 metadata')
  const target=(await metadata.json()).result
  assert(target?.name==='orders_db_branch2','Staging remote identity changed')
  const bookmarkResponse=await fetch(root+TEST+'/time_travel/bookmark',{
    headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(30000)
  })
  assert(bookmarkResponse.ok,'Cannot obtain staging restore bookmark; import refused')
  const bookmark=(await bookmarkResponse.json()).result?.bookmark
  assert(typeof bookmark==='string'&&bookmark.length>20,'No valid staging bookmark; import refused')
  console.log('STAGING_BACKUP_BOOKMARK_CONFIRMED '+bookmark)
  // Re-check the staging admin has not changed since its local capture.
  const currentAdmins=await readOnly(TEST,"SELECT * FROM app_users WHERE role='admin' AND is_active=1")
  assert(currentAdmins.length===1&&currentAdmins[0].id===originalAdmin.id
    &&currentAdmins[0].password_hash===originalAdmin.password_hash,
    'Staging administrator changed during copy; abort without import')
  // Build/release must NOT use --config pointing to production.
  assert(config.includes(TEST)&&!config.includes(PROD),'Staging configuration no longer safe')
  let importStarted=false
  try{
    importStarted=true
    // Use the published D1 import API directly: Wrangler hides server-side
    // import errors behind a generic CLI failure for large SQL files.
    // Every API action below is scoped to the exact staging database UUID.
    const {createHash}=await import('node:crypto')
    const endpoint=root+TEST+'/import'
    const safeError=unknown=>{
      if(unknown===null||unknown===undefined)return ''
      const value=typeof unknown==='string'?unknown:JSON.stringify(unknown)
      const trimmed=value.slice(0,1500)
      const keyword=trimmed.search(/\b(?:INSERT|UPDATE|DELETE|DROP|CREATE|SELECT|VALUES|REPLACE)\b/i)
      return (keyword>=0?trimmed.slice(0,keyword):trimmed)
        .replace(/(['"]).*?\1/g,'[redacted literal]').slice(0,320)
    }
    async function importAction(payload){
      const res=await fetch(endpoint,{
        method:'POST',
        headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
        body:JSON.stringify(payload),
        signal:AbortSignal.timeout(90000)
      })
      const data=await res.json()
      if(!res.ok||data.success===false||!data.result){
        console.error('STAGING_D1_CHUNK_API_FAILURE '+JSON.stringify({
          action:payload.action,http:res.status,
          errorCodes:(data.errors||[]).map(e=>e.code),
          reason:(data.errors||[]).map(e=>safeError(e.message)).slice(0,3)
        }))
        throw Error('Staging D1 chunk API '+payload.action+' rejected')
      }
      return data.result
    }
    for(const [i,chunk] of chunks.entries()){
      const sql='-- unique stage import '+new Date().toISOString()+' phase '+i+'\n'+chunk.sql
      const etag=createHash('md5').update(sql).digest('hex')
      const init=await importAction({action:'init',etag})
      assert(init.filename&&init.upload_url,'D1 chunk init did not provide fresh upload URL')
      const upload=await fetch(init.upload_url,{
        method:'PUT',body:sql,signal:AbortSignal.timeout(90000)
      })
      assert(upload.ok,'D1 chunk '+i+' upload rejected HTTP '+upload.status)
      assert((upload.headers.get('etag')||'').replaceAll('"','')===etag,
        'D1 chunk upload ETag mismatch')
      let result=await importAction({action:'ingest',filename:init.filename,etag})
      if(result.success===false||result.error){
        console.error('STAGING_D1_CHUNK_INGEST_FAILURE '+JSON.stringify({
          index:i,phase:chunk.name,error:safeError(result.error)
        }))
        throw Error('D1 rejected staging chunk '+i+' '+chunk.name)
      }
      let polls=0
      while(result.status!=='complete'&&result.status!=='error'){
        assert(typeof result.at_bookmark==='string','D1 chunk missing status bookmark')
        assert(polls++<180,'D1 chunk poll timed out')
        await new Promise(ok=>setTimeout(ok,1000))
        result=await importAction({action:'poll',current_bookmark:result.at_bookmark})
        if(result.success===false||result.error)break
      }
      if(result.status!=='complete'||result.success===false||result.error){
        console.error('STAGING_D1_CHUNK_FINAL_FAILURE '+JSON.stringify({
          index:i,phase:chunk.name,status:result.status,error:safeError(result.error)
        }))
        throw Error('D1 staging chunk '+i+' '+chunk.name+' did not finish')
      }
      console.log('BRANCH2_CHUNK_COMMITTED '+JSON.stringify({
        position:i+1,total:chunks.length,phase:chunk.name
      }))
    }
    console.log('BRANCH2_CHUNKED_IMPORT_ALL_COMMITTED')
    // No production reads here. Verify targeted tables and staging logins.
    for(const name of ['orders','order_items','inventory_stock','inventory_reservations','inventory_movements','inventory_stock_checks','inventory_stocktake_items','catalog_variants']){
      const rows=await readOnly(TEST,'SELECT COUNT(*) AS n FROM '+quoteName(name))
      assert(Number(rows[0]?.n)===Number(copiedCounts[name]),'Staging import mismatch for '+name)
    }
    const accounts=await readOnly(TEST,"SELECT role,COUNT(*) AS n FROM app_users GROUP BY role")
    assert(accounts.length===1&&accounts[0].role==='admin'&&Number(accounts[0].n)===1,
      'Staging auth accounts do not contain exactly one admin')
    const sessions=await readOnly(TEST,'SELECT COUNT(*) AS n FROM app_sessions')
    assert(Number(sessions[0]?.n)===0,'Staging sessions not reset')
    console.log('BRANCH2_PRODUCTION_DATA_MIRROR_COMPLETE: real business data, staging-only admin, production untouched')
  }catch(err){
    console.error('BRANCH2_IMPORT_FAILURE_REASON '+String(err instanceof Error ? err.message : err).replace(/(['"]).*?\1/g,'[quoted value redacted]').slice(0,270))
    if(importStarted){
      // Time Travel can revert partial staging imports. NEVER restore main.
      try{
        const restoreUrl=new URL(root+TEST+'/time_travel/restore')
        restoreUrl.searchParams.set('bookmark',bookmark)
        const response=await fetch(restoreUrl,{
          method:'POST',headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(180000)
        })
        const data=await response.json()
        if(!response.ok||data.success===false)throw Error('Cloudflare rejected staging rollback')
        console.error('BRANCH2_ROLLED_BACK_TO_PREIMPORT_BOOKMARK')
      }catch(restoreError){
        console.error('CRITICAL: Branch2 rollback failed; manual staging-only restore bookmark '+bookmark)
      }
    }
    throw Error('Branch2 import/postcheck failed: no changes were attempted on production')
  }

}finally{if(local)local.close();rmSync(directory,{recursive:true,force:true})}
