// P0 2026-10-30. Deliberately READ-ONLY. Never import database write helpers.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'

const MAIN = Object.freeze({id:'17e68a41-1d58-4a36-8a63-47c3e32443c4',name:'orders_db_prod'})
const BRANCH2 = Object.freeze({id:'0904a573-21ff-44d8-93b0-c9200f771702',name:'orders_db_branch2_mirror_20261027'})
const targets = Object.freeze([MAIN,BRANCH2])
const SQL = Object.freeze({
  schema:"SELECT type, name, sql FROM sqlite_schema WHERE type IN ('table','index','trigger','view') AND name NOT LIKE 'sqlite_%' AND name != '_cf_KV' ORDER BY type,name",
  orders:"SELECT name, type, pk FROM pragma_table_info('orders')",
  audit:"SELECT name, type, pk FROM pragma_table_info('order_manager_audit')",
  critical:"SELECT name, type, pk FROM pragma_table_info('critical_operations')",
  mapped:"SELECT name, type, pk FROM pragma_table_info('critical_operation_entities')",
  ordersCount:'SELECT COUNT(*) AS n FROM "orders"',
  auditCount:'SELECT COUNT(*) AS n FROM "order_manager_audit"',
  criticalCount:'SELECT COUNT(*) AS n FROM "critical_operations"',
  reserveCount:'SELECT COUNT(*) AS n FROM "inventory_reservations"',
  migrationsCount:'SELECT COUNT(*) AS n FROM "d1_migrations"',
})
const ALLOWED_SQL = new Set(Object.values(SQL))
const expectedAudit = [
  'id','order_id','external_id','previous_manager_id','previous_manager_name',
  'new_manager_id','new_manager_name','action','source','actor_role',
  'actor_label','details','created_at',
]
const tableExists = (schema,name) => schema.some(x => x.type === 'table' && x.name === name)
const colNames = rows => new Set(rows.map(x=>String(x.name||'')))
const fingerprint = sql => createHash('sha256').update(sql||'').digest('hex').slice(0,16)

function assertMainTargetConfig() {
  const content=readFileSync('wrangler.jsonc','utf8')
  const config=JSON.parse(content.replace(/\/\*[\s\S]*?\*\//g,'').replace(/^\s*\/\/.*$/gm,''))
  const bound=config.d1_databases?.filter(x=>x.binding==='DB')||[]
  assert.equal(config.name,'orders-app','Refusing unknown Worker')
  assert.equal(bound.length,1,'Refusing multiple DB bindings')
  assert.equal(bound[0].database_id,MAIN.id,'Main database ID changed')
  assert.equal(bound[0].database_name,MAIN.name,'Main database name changed')
  assert.notEqual(bound[0].database_id,BRANCH2.id,'Worker must not bind mirror')
}

function checkRequest(db,method,path,body) {
  assert(targets.some(x=>x.id===db.id && x.name===db.name),'Unknown D1 database identity')
  assert((method==='GET' && path==='' && body===undefined) ||
    (method==='POST' && path==='/query' && body &&
     ALLOWED_SQL.has(body.sql) && Object.keys(body).length===1),
    'Only exact allowlisted SELECT metadata queries are permitted')
}

async function request(db,method,path,body) {
  checkRequest(db,method,path,body)
  const token=process.env.CLOUDFLARE_API_TOKEN
  const account=process.env.CLOUDFLARE_ACCOUNT_ID
  assert(token && account,'Cloudflare read-only inspection credentials are unavailable')
  assert(/^[0-9a-f]{32}$/.test(account),'Cloudflare account ID format unexpected')
  const response=await fetch(
    'https://api.cloudflare.com/client/v4/accounts/'+account+'/d1/database/'+db.id+path,
    {
      method,
      headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
      ...(body ? {body:JSON.stringify(body)} : {}),
      signal:AbortSignal.timeout(25000),
    },
  )
  const payload=await response.json()
  if(!response.ok || payload.success===false) {
    // Do not log API bodies, auth, customer rows or request contents.
    throw new Error('D1 metadata read refused for '+db.name+' HTTP '+response.status)
  }
  return payload.result
}

async function select(db,query) {
  assert(ALLOWED_SQL.has(query),'Query must be an exact approved SELECT')
  const r=await request(db,'POST','/query',{sql:query})
  const parts=Array.isArray(r)?r:[r]
  return parts.flatMap(x=>Array.isArray(x?.results)?x.results:[])
}

async function inspect(db) {
  const info=await request(db,'GET','')
  assert.equal(info?.name,db.name,'Remote database name mismatch: inspection stopped')
  const schema=await select(db,SQL.schema)
  assert(tableExists(schema,'orders'),'Missing orders table; stop before further requests')
  const readCols=async (table,query) => tableExists(schema,table)?await select(db,query):[]
  const [orders,audit,critical,mapped]=await Promise.all([
    readCols('orders',SQL.orders),
    readCols('order_manager_audit',SQL.audit),
    readCols('critical_operations',SQL.critical),
    readCols('critical_operation_entities',SQL.mapped),
  ])
  const columns=colNames(orders)
  const auditNames=colNames(audit)
  const auditPk=audit.find(x=>x.name==='id')
  const missingAudit=tableExists(schema,'order_manager_audit')
    ? expectedAudit.filter(c=>!auditNames.has(c)) : [...expectedAudit]
  const criticalNames=colNames(critical), mappedNames=colNames(mapped)
  const issues=[]
  if(!columns.has('manager_snapshot_name'))issues.push('orders.manager_snapshot_name missing')
  if(missingAudit.length)issues.push('order_manager_audit missing/incompatible: '+missingAudit.join(','))
  if(tableExists(schema,'order_manager_audit') && Number(auditPk?.pk||0)!==1) issues.push('order_manager_audit.id primary key incompatible')
  for(const c of ['request_id','status','step','lease_token','target_id']) {
    if(!criticalNames.has(c)) issues.push('critical_operations.'+c+' missing')
  }
  for(const c of ['request_id','entity_type','entity_key','entity_id']) {
    if(!mappedNames.has(c)) issues.push('critical_operation_entities.'+c+' missing')
  }
  const countPairs=[['orders',SQL.ordersCount],['order_manager_audit',SQL.auditCount],
    ['critical_operations',SQL.criticalCount],['inventory_reservations',SQL.reserveCount],
    ['d1_migrations',SQL.migrationsCount]]
  const counts={}
  for(const [table,query] of countPairs) {
    counts[table]=tableExists(schema,table)?Number((await select(db,query))[0]?.n??0):null
  }
  const namedObjects=schema.map(x=>({key:x.type+':'+x.name,digest:fingerprint(x.sql)}))
  // Only structural metadata, aggregate counts and schema names; NEVER rows.
  const report={
    db:db.name, dbIdSuffix:db.id.slice(-6),
    schemaObjectCount:schema.length, tableCount:schema.filter(x=>x.type==='table').length,
    orderColumns:orders.map(x=>({name:x.name,type:x.type,pk:x.pk})),
    managerAuditColumns:audit.map(x=>({name:x.name,type:x.type,pk:x.pk})),
    criticalColumns:critical.map(x=>x.name),
    mappingColumns:mapped.map(x=>x.name),
    counts, issues,
  }
  console.log('P0_D1_READ_ONLY_SCHEMA '+JSON.stringify(report))
  return {namedObjects,issues}
}

function selfTest(){
  assertMainTargetConfig()
  assert.notEqual(MAIN.id,BRANCH2.id)
  for(const sql of ALLOWED_SQL){
    assert(sql.startsWith('SELECT '),'Only SELECT may reach the remote API')
    assert(!sql.includes(';'),'No compound SQL permitted')
  }
  checkRequest(MAIN,'GET','',undefined)
  checkRequest(BRANCH2,'POST','/query',{sql:SQL.orders})
  assert.throws(()=>checkRequest(MAIN,'POST','/query',{sql:'UPDATE orders SET id=0'}))
  assert.throws(()=>checkRequest(MAIN,'POST','/query',{sql:'SELECT * FROM orders'}))
  assert.throws(()=>checkRequest({...MAIN,id:BRANCH2.id},'GET','',undefined))
  console.log('P0_D1_READ_ONLY_PREFLIGHT_STATIC_PASSED')
}

if(process.argv.includes('--self-test')) {
  selfTest()
} else {
  assertMainTargetConfig()
  const main=await inspect(MAIN)
  const branch=await inspect(BRANCH2)
  const source=new Map(main.namedObjects.map(x=>[x.key,x.digest]))
  const target=new Map(branch.namedObjects.map(x=>[x.key,x.digest]))
  const mainOnly=[...source.keys()].filter(k=>!target.has(k))
  const branchOnly=[...target.keys()].filter(k=>!source.has(k))
  const differing=[...source.keys()].filter(k=>target.has(k)&&source.get(k)!==target.get(k))
  console.log('P0_D1_READ_ONLY_STRUCTURE_DIFF '+JSON.stringify({
    mainOnly,branchOnly,differing:differing.slice(0,100),differingTotal:differing.length,
  }))
  if(main.issues.length || branch.issues.length) {
    console.error('P0_D1_SCHEMA_RECONCILIATION_REQUIRED — no writes performed; release blocked')
    process.exitCode=2
  } else {
    console.log('P0_D1_SCHEMA_REQUIRED_OBJECTS_PRESENT — metadata read only; no writes performed')
  }
}
