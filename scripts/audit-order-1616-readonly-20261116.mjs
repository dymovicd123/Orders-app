import {execFileSync} from 'node:child_process'
function select(label,sql){
 if(!/^\s*SELECT\b/i.test(sql)||/;|\b(INSERT|UPDATE|DELETE|REPLACE|ALTER|DROP|CREATE|ATTACH|DETACH|PRAGMA|VACUUM)\b/i.test(sql))throw Error('Only read-only SELECT permitted: '+label)
 const raw=execFileSync('npx',['--no-install','wrangler','d1','execute','orders_db_prod','--config','wrangler.jsonc','--remote','--json','--command',sql],{encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024})
 const v=JSON.parse(raw);if(!Array.isArray(v)||v.some(x=>x.success!==true))throw Error('D1 query failed: '+label)
 return v.flatMap(x=>x.results||[])
}
const order=select('order',"SELECT id,order_date,substr(created_at,1,19) AS created_at,substr(updated_at,1,19) AS updated_at,order_status,shipping_status,source_type,workshop_status FROM orders WHERE id=1616")
const items=select('items',"SELECT id,substr(created_at,1,19) AS created_at,variant_id,product_id,quantity,is_workshop,source_type,stock_writeoff_status,stock_quantity_before,stock_quantity_after FROM order_items WHERE order_id=1616 ORDER BY id")
const reserves=select('reserves',"SELECT id,order_item_id,inventory_source,variant_id,quantity,status,unresolved_reason,substr(created_at,1,19) AS created_at,substr(updated_at,1,19) AS updated_at,substr(fulfilled_at,1,19) AS fulfilled_at,substr(released_at,1,19) AS released_at FROM inventory_reservations WHERE order_id=1616 ORDER BY id")
const activity=select('activity',"SELECT id,event_type,entity_type,entity_id,substr(created_at,1,19) AS at,CASE WHEN LOWER(COALESCE(title,'')) LIKE '%отправ%' OR LOWER(COALESCE(title,'')) LIKE '%выда%' THEN 'shipping' WHEN LOWER(COALESCE(title,'')) LIKE '%резерв%' THEN 'reservation' WHEN LOWER(COALESCE(title,'')) LIKE '%редакт%' THEN 'edit' WHEN LOWER(COALESCE(title,'')) LIKE '%возврат%' THEN 'return' WHEN LOWER(COALESCE(title,'')) LIKE '%обмен%' THEN 'exchange' ELSE 'other' END AS title_class FROM activity_log WHERE order_id=1616 ORDER BY id LIMIT 80")
const dispatch=select('dispatch',"SELECT id,substr(created_at,1,19) AS created_at,status,(SELECT COUNT(*) FROM order_dispatch_items i WHERE i.dispatch_id=d.id) AS lines FROM order_dispatches d WHERE order_id=1616")
const movements=select('movements',"SELECT m.id,m.inventory_source,m.movement_type,m.variant_id,m.quantity_delta,m.reference_type,substr(m.created_at,1,19) AS at FROM inventory_movements m WHERE m.reference_id = '1616' OR m.reference_id = 'order:1616' OR m.reference_id=(SELECT external_id FROM orders WHERE id=1616) OR m.reference_id LIKE (SELECT external_id||':%' FROM orders WHERE id=1616) ORDER BY m.created_at LIMIT 50")
const lifecycle=select('lifecycle',"SELECT id,event_type,direction,inventory_source,variant_id,quantity,status,substr(created_at,1,19) AS at FROM inventory_lifecycle_events WHERE order_id=1616 ORDER BY id")
const returns=select('returns',"SELECT COUNT(*) AS total FROM returns WHERE order_id=1616")
const exchanges=select('exchanges',"SELECT COUNT(*) AS total FROM exchanges WHERE order_id=1616")
console.log('ORDER1616_MAIN_READONLY_JSON '+JSON.stringify({order,items,reserves,activity,dispatch,movements,lifecycle,returns,exchanges}))
console.log('ORDER1616_MAIN_SELECT_ONLY_PASS_NO_WRITES')
