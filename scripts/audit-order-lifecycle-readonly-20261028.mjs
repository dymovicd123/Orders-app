// Read-only stock/lifecycle diagnostics on the isolated October 27 Branch2 mirror.
// This audit never changes orders, inventory, exchanges, refunds, or reservations.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const dbId='0904a573-21ff-44d8-93b0-c9200f771702'
const config=readFileSync('wrangler.jsonc','utf8')
assert(config.includes('"name": "orders-app-branch2"'))
assert(config.includes(dbId) && !config.includes('17e68a41-1d58-4a36-8a63-47c3e32443c4'))
const account=process.env.CLOUDFLARE_ACCOUNT_ID, token=process.env.CLOUDFLARE_API_TOKEN
assert(account&&token,'Readonly Branch2 connection missing')
const endpoint='https://api.cloudflare.com/client/v4/accounts/'+account+'/d1/database/'+dbId
const headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'}
const metadata=await fetch(endpoint,{headers,signal:AbortSignal.timeout(30000)})
assert(metadata.ok&&(await metadata.json()).result?.name==='orders_db_branch2_mirror_20261027')
async function select(sql){
  assert(/^\s*(SELECT|WITH)\b/i.test(sql) && !sql.includes(';'))
  assert(!/\b(INSERT|UPDATE|DELETE|REPLACE|DROP|CREATE|ALTER|ATTACH|PRAGMA|VACUUM)\b/i.test(sql))
  const response=await fetch(endpoint+'/query',{method:'POST',headers,body:JSON.stringify({sql}),signal:AbortSignal.timeout(30000)})
  const result=await response.json()
  if(!response.ok||!result.success)throw Error('Readonly SQL query rejected '+JSON.stringify((result.errors||[]).map(x=>({code:x.code,message:String(x.message||'').slice(0,150)}))))
  return result.result?.[0]?.results||[]
}
const queries=[
['partial_standalone_returns',`
  SELECT COUNT(*) AS item_lines, COUNT(DISTINCT oi.order_id) AS orders, COALESCE(SUM(returned.units),0) AS returned_units
  FROM order_items oi JOIN (
    SELECT ri.order_item_id, SUM(ri.quantity) AS units FROM return_items ri
    JOIN returns r ON r.id=ri.return_id AND COALESCE(r.status,'completed')<>'cancelled'
    WHERE NOT EXISTS(SELECT 1 FROM exchanges e WHERE e.refund_return_id=r.id AND COALESCE(e.status,'completed')<>'cancelled')
    GROUP BY ri.order_item_id
  ) returned ON returned.order_item_id=oi.id
  WHERE returned.units>0 AND oi.quantity>returned.units
`],
['exchanges_on_sent_orders',`
  SELECT COUNT(*) AS exchange_rows, COUNT(DISTINCT e.order_id) AS orders,
    COALESCE(SUM(CASE WHEN date(e.created_at)>date(o.shipping_date) THEN 1 ELSE 0 END),0) AS exchanges_later_day_than_initial_shipping
  FROM exchanges e JOIN orders o ON o.id=e.order_id
  WHERE COALESCE(e.status,'completed')<>'cancelled' AND o.shipping_status='sent'
`],
['exchange_new_immediate_outbound',`
  SELECT COUNT(*) AS applied_outbound_events,
    COALESCE(SUM(CASE WHEN o.shipping_status='sent' THEN 1 ELSE 0 END),0) AS on_sent_orders
  FROM inventory_lifecycle_events le
  JOIN exchanges e ON e.id=le.operation_id
  JOIN orders o ON o.id=le.order_id
  WHERE le.event_type='exchange_new_out' AND le.status='applied'
    AND COALESCE(e.status,'completed')<>'cancelled'
`],
['exchange_old_pending_receipt',`
  SELECT COUNT(*) AS item_lines, COALESCE(SUM(ei.quantity),0) AS units, COUNT(DISTINCT e.order_id) AS orders
  FROM exchange_items ei JOIN exchanges e ON e.id=ei.exchange_id
  WHERE ei.role='old' AND ei.physical_tracking=1 AND ei.physical_received_at IS NULL
    AND COALESCE(e.status,'completed')<>'cancelled'
`],
['return_pending_receipt',`
  SELECT COUNT(*) AS item_lines, COALESCE(SUM(ri.quantity),0) AS units, COUNT(DISTINCT r.order_id) AS orders
  FROM return_items ri JOIN returns r ON r.id=ri.return_id
  WHERE ri.physical_tracking=1 AND ri.physical_received_at IS NULL
    AND COALESCE(r.status,'completed')<>'cancelled'
`],
['returned_with_active_reservation',`
  SELECT COUNT(DISTINCT ri.order_item_id) AS item_lines, COUNT(DISTINCT r.order_id) AS orders
  FROM return_items ri JOIN returns r ON r.id=ri.return_id
  JOIN inventory_reservations ir ON ir.order_item_id=ri.order_item_id AND ir.status IN ('active','unresolved')
  WHERE COALESCE(r.status,'completed')<>'cancelled' AND ri.quantity>0
    AND NOT EXISTS(SELECT 1 FROM exchanges e WHERE e.refund_return_id=r.id AND COALESCE(e.status,'completed')<>'cancelled')
`],
['exchanged_workshop_on_sent_order',`
  SELECT COUNT(*) AS replacement_items, COUNT(DISTINCT e.order_id) AS orders
  FROM exchanges e JOIN orders o ON o.id=e.order_id
  JOIN order_items oi ON oi.id=e.new_order_item_id
  WHERE COALESCE(e.status,'completed')<>'cancelled'
    AND o.shipping_status='sent' AND oi.is_workshop=1 AND oi.quantity>0
`],
['exchanged_replacement_still_reserved',`
  SELECT COUNT(*) AS lines, COUNT(DISTINCT e.order_id) AS orders
  FROM exchanges e JOIN order_items oi ON oi.id=e.new_order_item_id
  JOIN inventory_reservations ir ON ir.order_item_id=oi.id
  WHERE COALESCE(e.status,'completed')<>'cancelled'
    AND oi.is_workshop=0 AND ir.status IN ('active','unresolved')
`],
['example_exchange_order_ids',`
  SELECT e.id AS exchange_id, e.order_id AS order_id, o.shipping_status,
    date(o.shipping_date) AS original_ship_date, date(e.created_at) AS exchange_created_date,
    oi.stock_writeoff_status AS replacement_status
  FROM exchanges e JOIN orders o ON o.id=e.order_id
  LEFT JOIN order_items oi ON oi.id=e.new_order_item_id
  WHERE COALESCE(e.status,'completed')<>'cancelled'
    AND o.shipping_status='sent'
  ORDER BY e.id DESC LIMIT 12
`],
]
for(const [label,sql] of queries) {
  const data=await select(sql)
  console.log('LIFECYCLE_READ_ONLY_'+label.toUpperCase()+' '+JSON.stringify(data))
}
console.log('BRANCH2_LIFECYCLE_MIRROR_READONLY_AUDIT_COMPLETE')
