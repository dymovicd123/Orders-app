// READ-ONLY inventory/schema preflight for test-data mirror. NO customer data in logs.
// Executed on a disposable GitHub Actions runner. NEVER runs a D1 write.
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { planOrderManagerSchemaReconciliation } from './order-manager-schema-reconciliation-20261030.mjs'

const MAIN_ID='17e68a41-1d58-4a36-8a63-47c3e32443c4'
const EXPECTED_TEST_ID='0904a573-21ff-44d8-93b0-c9200f771702'
const wrangler=JSON.parse(
  readFileSync('wrangler.jsonc','utf8').replace(/\/\*[\s\S]*?\*\//g,'')
)
const target=wrangler?.d1_databases?.find(entry=>entry.binding==='DB')
const TEST_ID=target?.database_id
assert(wrangler.name==='orders-app-branch2','Unexpected Worker target')
assert(target?.database_name==='orders_db_branch2_mirror_20261027','Unknown Branch2 mirror; do not inspect')
assert(TEST_ID===EXPECTED_TEST_ID,'Branch2 D1 target changed; review and update preflight explicitly')
assert.notEqual(MAIN_ID,TEST_ID,'Production D1 must not be bound as Branch2')
const token=process.env.CLOUDFLARE_API_TOKEN
const account=process.env.CLOUDFLARE_ACCOUNT_ID
assert(token && account,'Cloudflare Actions credentials unavailable; no database was accessed')
assert(/^[a-f0-9]{32}$/.test(account),'Invalid account identifier')
const root='https://api.cloudflare.com/client/v4/accounts/'+account+'/d1/database/'
async function request(id,method,endpoint,body){
  assert([MAIN_ID,TEST_ID].includes(id),'Unexpected database identifier')
  // Production calls are GET metadata or POST SELECT-only. This script has no
  // import, restore, update, delete or SQL mutation entrypoint.
  assert((method==='GET' && endpoint==='') || (
    method==='POST' && endpoint==='/query' && typeof body?.sql==='string'
    && /^SELECT\b/i.test(body.sql.trim()) && !body.sql.includes(';')
  ), 'D1 read-only preflight: only one SELECT allowed for either database')
  const r=await fetch(root+id+endpoint,{
    method,
    headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
    ...(body?{body:JSON.stringify(body)}:{}),
    signal:AbortSignal.timeout(30000),
  })
  const json=await r.json()
  if(!r.ok||json.success===false)throw new Error('D1 API '+method+' '+(id===MAIN_ID?'main':'branch2')+' '+endpoint+' HTTP '+r.status+' '+(json.errors||[]).map(x=>x.code).join(','))
  return json.result
}
const sqlRead=async(id,sql)=>{
  assert(/^SELECT\b/i.test(sql.trim()),'Only SELECT is allowed')
  const result=await request(id,'POST','/query',{sql})
  const items=Array.isArray(result)?result:[result]
  const all=items.flatMap(item=>Array.isArray(item?.results)?item.results:[])
  return all
}
const [mainInfo,testInfo]=await Promise.all([request(MAIN_ID,'GET',''),request(TEST_ID,'GET','')])
console.log('D1_IDS_SEPARATE_AND_BRANCH2_CONFIG_ISOLATED')
console.log('DATABASE_METADATA '+JSON.stringify({
  main:{name:mainInfo?.name,version:mainInfo?.version,size:mainInfo?.file_size||mainInfo?.num_bytes||null},
  branch2:{name:testInfo?.name,version:testInfo?.version,size:testInfo?.file_size||testInfo?.num_bytes||null}
}))
assert(mainInfo?.name==='orders_db_prod' && testInfo?.name==='orders_db_branch2_mirror_20261027','Remote databases have unexpected names; abort')
const schemaSql="SELECT name, type, sql FROM sqlite_schema WHERE type IN ('table','index','trigger','view') AND name NOT LIKE 'sqlite_%' AND name != '_cf_KV' ORDER BY type,name"
const [mainSchema,testSchema]=await Promise.all([sqlRead(MAIN_ID,schemaSql),sqlRead(TEST_ID,schemaSql)])

// SELECT from table-valued SQLite PRAGMAs is read-only and permitted by the
// strict API guard above. Do not query private order rows, only schema names.
// Report all required steps but never execute a D1 mutation here.
async function readOrderManagerPlan(label,id,schemaRows) {
  const hasTable=schemaRows.some(row=>row.type==='table' && row.name==='order_manager_audit')
  const ordersColumns=await sqlRead(id,"SELECT name, pk FROM pragma_table_info('orders')")
  const auditColumns=hasTable
    ? await sqlRead(id,"SELECT name, pk FROM pragma_table_info('order_manager_audit')")
    : []
  const plan=planOrderManagerSchemaReconciliation({ordersColumns,auditTableExists:hasTable,auditColumns})
  console.log('ORDER_MANAGER_SCHEMA_'+label+' '+JSON.stringify({
    needsReconciliation:plan.needsReconciliation,
    missingObjects:plan.steps.map(step=>step.object),
  }))
  return plan
}
const [mainOrderPlan,branchOrderPlan]=await Promise.all([
  readOrderManagerPlan('MAIN',MAIN_ID,mainSchema),
  readOrderManagerPlan('BRANCH2',TEST_ID,testSchema),
])
assert(!mainOrderPlan.needsReconciliation && !branchOrderPlan.needsReconciliation,
  'Release blocked: D1 order manager schema requires approved additive reconciliation (#648)')

const userTables=items=>items.filter(x=>x.type==='table').map(x=>x.name)
const sourceTables=userTables(mainSchema),targetTables=userTables(testSchema)
assert(sourceTables.includes('orders') && sourceTables.includes('inventory_stock') && sourceTables.includes('app_users'),'Unexpected main schema')
assert(targetTables.includes('orders') && targetTables.includes('inventory_stock') && targetTables.includes('app_users'),'Unexpected branch2 schema')
const mainOnly=sourceTables.filter(x=>!targetTables.includes(x))
const branchOnly=targetTables.filter(x=>!sourceTables.includes(x))
const sourceMap=new Map(mainSchema.map(x=>[x.type+':'+x.name,x.sql]))
const divergent=testSchema.filter(x=>sourceMap.has(x.type+':'+x.name) && sourceMap.get(x.type+':'+x.name)!==x.sql).map(x=>x.type+':'+x.name)
console.log('STRUCTURE '+JSON.stringify({mainTables:sourceTables.length,testTables:targetTables.length,mainOnly,branchOnly,divergent:divergent.slice(0,100),divergentTotal:divergent.length}))
const countTables=['orders','order_items','inventory_stock','inventory_reservations','inventory_movements','inventory_stock_checks','inventory_stocktake_sessions','inventory_stocktake_items','catalog_products','catalog_variants','returns','return_items','exchanges','managers','app_users','app_sessions','app_settings','product_kpis']
const counts={}
for(const name of countTables){
  counts[name]={}
  for(const [label,id,tables] of [['main',MAIN_ID,sourceTables],['branch2',TEST_ID,targetTables]]){
    if(!tables.includes(name)){counts[name][label]=null;continue}
    assert(/^[a-z][a-z0-9_]*$/.test(name))
    const rows=await sqlRead(id,'SELECT COUNT(*) AS n FROM "'+name+'"')
    counts[name][label]=Number(rows[0]?.n||0)
  }
}
console.log('ROW_COUNTS '+JSON.stringify(counts))
for(const [label,id,tables] of [['main',MAIN_ID,sourceTables],['branch2',TEST_ID,targetTables]]){
  if(tables.includes('app_users')){
    const rows=await sqlRead(id,"SELECT role, COUNT(*) AS n FROM app_users GROUP BY role ORDER BY role")
    console.log('ACCOUNT_ROLES_'+label.toUpperCase()+' '+JSON.stringify(rows.map(r=>({role:r.role,count:r.n}))))
    if(label==='branch2'){
      const a=await sqlRead(id,"SELECT COUNT(*) AS n FROM app_users WHERE role='admin' AND is_active=1")
      assert(Number(a[0]?.n||0)>=1,'Branch2 has no active admin; must not overwrite anything')
      console.log('BRANCH2_ACTIVE_ADMIN_PRESENT (credentials will be preserved, no import occurred)')
    }
  }
}
console.log('READ_ONLY_D1_REPLICA_PREFLIGHT_PASSED; no SQL exported and NO writes performed')
