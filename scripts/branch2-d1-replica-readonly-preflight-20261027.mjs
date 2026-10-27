// READ-ONLY inventory/schema preflight for test-data mirror. NO customer data in logs.
// Executed on a disposable GitHub Actions runner. NEVER runs a D1 write.
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'

const MAIN_ID='17e68a41-1d58-4a36-8a63-47c3e32443c4'
const TEST_ID='40065052-854e-44b8-bcd5-251bdd488301'
assert.notEqual(MAIN_ID,TEST_ID)
const wrangler=readFileSync('wrangler.jsonc','utf8')
assert(wrangler.includes('"name": "orders-app-branch2"'))
assert(wrangler.includes('"database_name": "orders_db_branch2"'))
assert(wrangler.includes(TEST_ID))
assert(!wrangler.includes(MAIN_ID))
const token=process.env.CLOUDFLARE_API_TOKEN
const account=process.env.CLOUDFLARE_ACCOUNT_ID
assert(token && account,'Cloudflare Actions credentials unavailable; no database was accessed')
assert(/^[a-f0-9]{32}$/.test(account),'Invalid account identifier')
const root='https://api.cloudflare.com/client/v4/accounts/'+account+'/d1/database/'
async function request(id,method,endpoint,body){
  assert([MAIN_ID,TEST_ID].includes(id),'Unexpected database identifier')
  // Production calls are GET metadata or POST SELECT-only. This script has no
  // import, restore, update, delete or SQL mutation entrypoint.
  if (id===MAIN_ID) assert(method==='GET'||(method==='POST' && endpoint==='/query' && typeof body?.sql==='string' && /^SELECT\b/i.test(body.sql.trim())),'Production cannot be written')
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
assert(mainInfo?.name==='orders_db_prod' && testInfo?.name==='orders_db_branch2','Remote databases have unexpected names; abort')
const schemaSql="SELECT name, type, sql FROM sqlite_schema WHERE type IN ('table','index','trigger','view') AND name NOT LIKE 'sqlite_%' AND name != '_cf_KV' ORDER BY type,name"
const [mainSchema,testSchema]=await Promise.all([sqlRead(MAIN_ID,schemaSql),sqlRead(TEST_ID,schemaSql)])
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
