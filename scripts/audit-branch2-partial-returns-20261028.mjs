import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const config=readFileSync('wrangler.jsonc','utf8')
const dbId='0904a573-21ff-44d8-93b0-c9200f771702'
assert(config.includes('orders-app-branch2')&&config.includes(dbId))
assert(!config.includes('17e68a41-1d58-4a36-8a63-47c3e32443c4'))
const account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN
assert(account&&token,'Staging-only readonly audit requires Cloudflare secrets')
const headers={Authorization:'Bearer '+token,'Content-Type':'application/json'}
const root='https://api.cloudflare.com/client/v4/accounts/'+account+'/d1/database/'+dbId
const meta=await fetch(root,{headers,signal:AbortSignal.timeout(30000)})
assert(meta.ok && (await meta.json()).result?.name==='orders_db_branch2_mirror_20261027')
async function sql(query) {
 assert(/^\s*(SELECT|WITH)\b/i.test(query)&& !query.includes(';'), 'Only read-only SELECT statements allowed')
 assert(!/\b(INSERT|UPDATE|DELETE|REPLACE|DROP|ALTER|CREATE|ATTACH|PRAGMA|VACUUM|MERGE)\b/i.test(query))
 const r=await fetch(root+'/query',{method:'POST',headers,body:JSON.stringify({sql:query}),signal:AbortSignal.timeout(35000)})
 const j=await r.json()
 if(!r.ok||!j.success)throw Error('Read-only SQL error '+JSON.stringify(j.errors))
 return j.result?.[0]?.results || []
}
const base=`WITH returned AS (
 SELECT ri.order_item_id, SUM(ri.quantity) AS returned_quantity,
        COUNT(DISTINCT ri.return_id) AS return_records
 FROM return_items ri
 JOIN returns r ON r.id=ri.return_id AND COALESCE(r.status,'completed')<>'cancelled'
 WHERE NOT EXISTS(
   SELECT 1 FROM exchanges e
   WHERE e.refund_return_id=r.id AND COALESCE(e.status,'completed')<>'cancelled'
 )
 GROUP BY ri.order_item_id
)
SELECT
 SUM(CASE WHEN returned.returned_quantity > oi.quantity THEN 1 ELSE 0 END) AS over_returned_lines,
 SUM(CASE WHEN returned.returned_quantity > 0 AND returned.returned_quantity < oi.quantity THEN 1 ELSE 0 END) AS partial_return_lines,
 SUM(CASE WHEN returned.return_records > 1 THEN 1 ELSE 0 END) AS multiple_return_record_lines,
 COALESCE(SUM(CASE WHEN returned.returned_quantity > oi.quantity THEN returned.returned_quantity - oi.quantity ELSE 0 END),0) AS excess_units
FROM returned JOIN order_items oi ON oi.id=returned.order_item_id`
console.log('PARTIAL_RETURN_AUDIT_QTY',JSON.stringify(await sql(base)))
console.log('PARTIAL_RETURN_AUDIT_OVER_RETURNED_IDS',JSON.stringify(await sql(`
WITH returned AS (
 SELECT ri.order_item_id,SUM(ri.quantity) AS returned_quantity
 FROM return_items ri JOIN returns r ON r.id=ri.return_id
 WHERE COALESCE(r.status,'completed')<>'cancelled'
 AND NOT EXISTS(SELECT 1 FROM exchanges e WHERE e.refund_return_id=r.id AND COALESCE(e.status,'completed')<>'cancelled')
 GROUP BY ri.order_item_id)
SELECT oi.order_id,oi.id AS order_item_id,oi.quantity AS ordered_units,returned.returned_quantity
FROM returned JOIN order_items oi ON oi.id=returned.order_item_id
WHERE returned.returned_quantity>oi.quantity ORDER BY oi.order_id LIMIT 25`)))
console.log('PARTIAL_RETURN_AUDIT_PENDING_RECEIPT',JSON.stringify(await sql(`
SELECT COUNT(*) AS receipt_lines,COALESCE(SUM(ri.quantity),0) AS receipt_units
FROM return_items ri JOIN returns r ON r.id=ri.return_id
WHERE ri.physical_tracking=1 AND ri.physical_received_at IS NULL
AND COALESCE(r.status,'completed')<>'cancelled'
AND NOT EXISTS(SELECT 1 FROM exchanges e WHERE e.refund_return_id=r.id AND COALESCE(e.status,'completed')<>'cancelled')
`)))
console.log('PARTIAL_RETURN_AUDIT_PHYSICAL_MISMATCH',JSON.stringify(await sql(`
SELECT COUNT(*) AS return_lines,COUNT(DISTINCT r.order_id) AS orders
FROM return_items ri JOIN returns r ON r.id=ri.return_id
WHERE ri.physical_tracking=1 AND ri.physical_received_at IS NOT NULL
 AND ri.inventory_source IN ('warehouse','boutique')
 AND COALESCE(r.status,'completed')<>'cancelled'
 AND NOT EXISTS(SELECT 1 FROM inventory_lifecycle_events le WHERE le.operation_type='return'
 AND le.operation_id=ri.return_id AND le.operation_item_id=ri.id AND le.event_type='return_in'
 AND le.status IN ('applied','cancelled'))
`)))
console.log('PARTIAL_RETURN_AUDIT_ACTIVE_RESERVE',JSON.stringify(await sql(`
SELECT COUNT(DISTINCT ri.order_item_id) AS item_lines,COUNT(DISTINCT r.order_id) AS orders
FROM return_items ri JOIN returns r ON r.id=ri.return_id
JOIN inventory_reservations res ON res.order_item_id=ri.order_item_id AND res.status IN ('active','unresolved')
WHERE COALESCE(r.status,'completed')<>'cancelled' AND ri.quantity>0
AND NOT EXISTS(SELECT 1 FROM exchanges e WHERE e.refund_return_id=r.id AND COALESCE(e.status,'completed')<>'cancelled')
`)))
console.log('PARTIAL_RETURN_AUDIT_COMPLETE_READ_ONLY')
