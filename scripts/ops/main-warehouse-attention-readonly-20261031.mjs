// Run CURRENT warehouse attention implementation against real Main via D1 SELECT only.
// Never expose customer names or order contact details in CI logs.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {getWarehouseAttentionSummary} from '../../worker/domains/warehouse-attention.ts'
import {catalogReviewBasePredicate,catalogReviewOperationalPredicate} from '../../worker/domains/catalog-review.ts'
assert.equal(process.env.GITHUB_REF,'refs/heads/audit/main-warehouse-actionability-readonly-20261031')
const conf=readFileSync('wrangler.jsonc','utf8')
const dbId='17e68a41-1d58-4a36-8a63-47c3e32443c4'
assert(conf.includes('"name": "orders-app"'))
assert(conf.includes('"database_name": "orders_db_prod"'))
assert(conf.includes(dbId))
assert(!conf.includes('orders_db_branch2'))
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
console.log('MAIN_WAREHOUSE_ATTENTION_REAL_D1_COVERAGE '+JSON.stringify(data))
assert.equal(missing.length,0,'Real deficit SKU missing from both Problems and Handover lists')
assert.equal(summary.counts.shortage,detailed.counts.shortage,'Warehouse counts differ between summary and detail')
assert.equal(summary.counts.handover,detailed.counts.handover,'Handover counts differ between summary and detail')
console.log('MAIN_WAREHOUSE_ATTENTION_REAL_D1_COVERAGE_PASSED')
const base=catalogReviewBasePredicate('oi','o'),operational=catalogReviewOperationalPredicate('oi','o')
const unresolved=await select(`SELECT r.id AS reservation_id,r.order_item_id,r.unresolved_reason,
  r.inventory_source,r.variant_id,r.quantity,o.order_status,o.shipping_status,
  oi.stock_writeoff_status,oi.created_at,
  CASE WHEN ${base} AND ${operational} THEN 1 ELSE 0 END AS in_current_catalog_attention,
  CASE WHEN datetime(COALESCE(NULLIF(oi.created_at,''),o.created_at))<datetime('now','-30 days') THEN 1 ELSE 0 END AS older_than_30_days
 FROM inventory_reservations r
 JOIN orders o ON o.id=r.order_id
 JOIN order_items oi ON oi.id=r.order_item_id AND oi.order_id=r.order_id
 WHERE r.status='unresolved' ORDER BY r.id ASC LIMIT 50`)
console.log('MAIN_UNRESOLVED_RESERVATIONS_VISIBILITY '+JSON.stringify({
 total:unresolved.length,
 rows:unresolved.map(x=>({
  reservationId:x.reservation_id,orderItemId:x.order_item_id,
  reason:x.unresolved_reason,stockStatus:x.stock_writeoff_status,
  orderStatus:x.order_status,shipping:x.shipping_status,
  inCatalogAttention:Boolean(x.in_current_catalog_attention),
  olderThan30Days:Boolean(x.older_than_30_days),
 })),
 hiddenFromCurrentCatalogAttention:unresolved.filter(x=>!x.in_current_catalog_attention).length,
 d1Writes:0,noCustomerData:true
}))


const recentReserve=await select("SELECT r.id AS reservation_id,r.order_id,r.order_item_id,r.quantity AS reserved_units,r.created_at AS reservation_created,r.status,oi.stock_writeoff_status,oi.created_at AS item_created,o.order_date,o.shipping_status,o.order_status,s.quantity AS physical,s.reserved_quantity,s.updated_at AS last_stock_update,s.last_action FROM inventory_reservations r JOIN orders o ON o.id=r.order_id JOIN order_items oi ON oi.id=r.order_item_id LEFT JOIN inventory_stock s ON s.inventory_source=r.inventory_source AND s.variant_id=r.variant_id WHERE r.status='active' AND r.inventory_source='boutique' AND r.variant_id=1784 ORDER BY r.id LIMIT 8")
const recentChecks=await select("SELECT id,checked_at,counted_quantity,check_type FROM inventory_stock_checks WHERE inventory_source='boutique' AND variant_id=1784 ORDER BY checked_at DESC LIMIT 5")
const recentMovements=await select("SELECT id,movement_type,quantity,created_at FROM inventory_movements WHERE inventory_source='boutique' AND variant_id=1784 ORDER BY id DESC LIMIT 8")
console.log('MAIN_NEW_BOUTIQUE_1784_READONLY_PROVENANCE '+JSON.stringify({reservations:recentReserve,checks:recentChecks,movements:recentMovements,customerData:false,D1Writes:0}))
