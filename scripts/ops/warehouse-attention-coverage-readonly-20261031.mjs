// Run CURRENT warehouse attention implementation against real Branch2 via D1 SELECT only.
// Never expose customer names or order contact details in CI logs.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {getWarehouseAttentionSummary} from '../../worker/domains/warehouse-attention.ts'
assert.equal(process.env.GITHUB_REF,'refs/heads/audit/branch2-activation-readonly-20261031')
const c=JSON.parse(readFileSync('wrangler.jsonc','utf8').replace(/\/\*[\s\S]*?\*\//g,''))
const dbId='0904a573-21ff-44d8-93b0-c9200f771702'
assert.equal(c.name,'orders-app-branch2')
assert.equal(c.d1_databases?.length,1)
assert.equal(c.d1_databases[0].database_id,dbId)
const account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN
assert(/^[0-9a-f]{32}$/.test(account||'')&&token)
let reads=0
async function select(sql,params=[]){
 const trimmed=sql.trim()
 assert(/^(SELECT|WITH)\b/i.test(trimmed)&&!trimmed.includes(';')&&!/\b(INSERT|UPDATE|DELETE|REPLACE|DROP|ALTER|CREATE|ATTACH|DETACH|PRAGMA|VACUUM)\b/i.test(trimmed),'Only read-only SELECT or WITH SELECT')
 const r=await fetch('https://api.cloudflare.com/client/v4/accounts/'+account+'/d1/database/'+dbId+'/query',{
  method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
  body:JSON.stringify({sql,params}),signal:AbortSignal.timeout(60000)
 })
 const p=await r.json()
 if(!r.ok||p.success===false)throw Error('D1 query HTTP '+r.status+' ('+(p.errors||[]).map(e=>e.code).join(',')+')')
 const v=Array.isArray(p.result)?p.result:[p.result]
 assert(v.every(x=>x?.success!==false),'D1 SQL failed')
 reads++
 return v.flatMap(x=>x?.results||[])
}
const db={prepare(sql){return {
 bind(...params){return {
  all:async()=>({results:await select(sql,params)}),
  first:async()=>((await select(sql,params))[0]||null)
 }},
 all:async()=>({results:await select(sql,[])}),
 first:async()=>((await select(sql,[]))[0]||null)
}}}
const raw=await select("SELECT inventory_source AS source,variant_id AS variantId,quantity AS physical,reserved_quantity AS reserved FROM inventory_stock WHERE variant_id IS NOT NULL AND reserved_quantity>quantity")
const summary=await getWarehouseAttentionSummary(db)
const detailed=await getWarehouseAttentionSummary(db,new URL('https://read-only.invalid/?details=1&limit=50'))
const items=detailed.items||{}
const shortages=items.shortages||[],handover=items.handover||[]
const key=x=>String(x.source)+':'+Number(x.variantId)
const shown=new Set([...shortages,...handover].map(key))
const missing=raw.map(x=>key(x)).filter(x=>!shown.has(x))
const data={
 rawDeficitKeys:raw.map(key).sort(),
 summaryCounts:summary.counts,detailCounts:detailed.counts,
 displayedShortageKeys:shortages.map(key).sort(),
 displayedHandoverKeys:[...new Set(handover.map(key))].sort(),
 hiddenDeficits:missing,readQueries:reads,
 noCustomerInformationPrinted:true,d1Writes:0
}
console.log('BRANCH2_WAREHOUSE_ATTENTION_REAL_D1_COVERAGE '+JSON.stringify(data))
assert.equal(missing.length,0,'Real deficit SKU missing from both Problems and Handover lists')
assert.equal(summary.counts.shortage,detailed.counts.shortage,'Warehouse counts differ between summary and detail')
assert.equal(summary.counts.handover,detailed.counts.handover,'Handover counts differ between summary and detail')
console.log('BRANCH2_WAREHOUSE_ATTENTION_REAL_D1_COVERAGE_PASSED')
