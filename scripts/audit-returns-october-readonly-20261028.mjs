// Strictly read-only aggregate of 2026-10 returns in the isolated Branch2 D1 snapshot.
// No client names, phones, addresses, raw comments, login material or writes.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const id='0904a573-21ff-44d8-93b0-c9200f771702'
const prod='17e68a41-1d58-4a36-8a63-47c3e32443c4'
const config=readFileSync('wrangler.jsonc','utf8')
assert(config.includes('"name": "orders-app-branch2"')&&config.includes(id)&&!config.includes(prod),
  'October audit may run only on the isolated Branch2 D1 mirror')
const token=process.env.CLOUDFLARE_API_TOKEN
const account=process.env.CLOUDFLARE_ACCOUNT_ID
assert(token&&account,'Cloudflare credentials not configured')
const root='https://api.cloudflare.com/client/v4/accounts/'+account+'/d1/database/'+id
const headers={Authorization:'Bearer '+token,'Content-Type':'application/json'}
const meta=await fetch(root,{headers,signal:AbortSignal.timeout(25000)})
assert(meta.ok&&(await meta.json()).result?.name==='orders_db_branch2_mirror_20261027')
async function select(sql){
  assert(/^\s*SELECT\b/i.test(sql),'Read-only SELECT only')
  const response=await fetch(root+'/query',{method:'POST',headers,
    body:JSON.stringify({sql}),signal:AbortSignal.timeout(30000)})
  const json=await response.json()
  assert(response.ok&&json.success,'D1 read-only aggregate failed')
  return json.result?.[0]?.results||[]
}
const header=[
 'WITH item_totals AS (',
 ' SELECT ri.return_id, SUM(ri.quantity) AS goods_qty,',
 ' SUM(CASE WHEN ri.physical_tracking=1 AND ri.physical_received_at IS NULL THEN ri.quantity ELSE 0 END) AS pending_qty,',
 ' SUM(CASE WHEN ri.physical_tracking=1 AND ri.physical_received_at IS NOT NULL AND ri.inventory_source IN (\'warehouse\',\'boutique\') THEN ri.quantity ELSE 0 END) AS stock_received_qty,',
 ' SUM(CASE WHEN ri.physical_tracking=1 AND ri.physical_received_at IS NOT NULL AND ri.inventory_source IS NULL THEN ri.quantity ELSE 0 END) AS received_no_stock_qty,',
 ' SUM(CASE WHEN COALESCE(ri.physical_tracking,0)=0 THEN ri.quantity ELSE 0 END) AS old_untracked_qty',
 ' FROM return_items ri GROUP BY ri.return_id',
 '), rows AS (',
 ' SELECT r.id AS return_id,r.amount,r.return_date,r.created_at, o.external_id,o.shipping_status,',
 ' COALESCE(t.goods_qty,0) AS goods_qty,COALESCE(t.pending_qty,0) AS pending_qty,',
 ' COALESCE(t.stock_received_qty,0) AS stock_received_qty,',
 ' COALESCE(t.received_no_stock_qty,0) AS received_no_stock_qty,',
 ' COALESCE(t.old_untracked_qty,0) AS old_untracked_qty',
 ' FROM returns r JOIN orders o ON o.id=r.order_id',
 ' LEFT JOIN item_totals t ON t.return_id=r.id',
 ' WHERE r.return_date >= \'2026-10-01\' AND r.return_date < \'2026-11-01\'',
 ' AND COALESCE(r.status,\'completed\')<>\'cancelled\'',
 ' AND NOT EXISTS(SELECT 1 FROM exchanges e WHERE e.refund_return_id=r.id',
 ' AND COALESCE(e.status,\'completed\')<>\'cancelled\')',
 ')',
].join('\n')
const [stats]=await select('SELECT * FROM ( '+header+
 ' SELECT COUNT(*) AS active_returns,',
 ' SUM(CASE WHEN amount>0 AND goods_qty=0 THEN 1 ELSE 0 END) AS money_only,',
 ' SUM(CASE WHEN amount>0 AND goods_qty>0 THEN 1 ELSE 0 END) AS money_and_goods,',
 ' SUM(CASE WHEN amount=0 AND goods_qty>0 THEN 1 ELSE 0 END) AS goods_only,',
 ' SUM(CASE WHEN amount>0 AND goods_qty=0 AND shipping_status=\'sent\' THEN 1 ELSE 0 END) AS shipped_money_only,',
 ' SUM(pending_qty) AS goods_pending_units,',
 ' SUM(stock_received_qty) AS physically_received_stock_destination_units,',
 ' SUM(received_no_stock_qty) AS received_no_stock_units,',
 ' SUM(old_untracked_qty) AS legacy_untracked_units,',
 ' SUM(CASE WHEN created_at < \'2026-10-01\' OR created_at >= \'2026-11-01\' THEN 1 ELSE 0 END) AS created_outside_return_month',
 ' FROM rows)')
console.log('OCT_2026_RETURN_AGGREGATE '+JSON.stringify(stats))
const flagged=await select(header+
 " SELECT return_id,external_id,return_date,amount,shipping_status FROM rows"+
 " WHERE goods_qty=0 AND amount>0 AND shipping_status='sent'"+
 ' ORDER BY amount DESC,return_id DESC LIMIT 12')
console.log('OCT_2026_SENT_MONEY_ONLY_REVIEW_IDS '+JSON.stringify(flagged))
// These records only establish a need to verify physical circumstances; nothing
// in them demonstrates missing goods or employee negligence.
console.log('READ_ONLY_OCTOBER_AUDIT_COMPLETE; no inventory or return rows were changed')
