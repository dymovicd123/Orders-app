import {execFileSync} from 'node:child_process'
function select(label,sql){
 if(!/^\s*SELECT\b/i.test(sql)||/;|\b(INSERT|UPDATE|DELETE|REPLACE|ALTER|DROP|CREATE|ATTACH|DETACH|PRAGMA|VACUUM)\b/i.test(sql))throw Error('Non-SELECT blocked '+label)
 const raw=execFileSync('npx',['--no-install','wrangler','d1','execute','orders_db_prod','--config','wrangler.jsonc','--remote','--json','--command',sql],{encoding:'utf8',maxBuffer:32*1024*1024,timeout:120000})
 const data=JSON.parse(raw);if(!Array.isArray(data)||data.some(x=>x.success!==true))throw Error('Failed SQL '+label)
 return data.flatMap(x=>x.results||[])
}
const largestAdjustments=select('largeCorrections',"SELECT substr(created_at,1,10) AS day,inventory_source,variant_id,quantity_delta,quantity_after,reference_type FROM inventory_movements WHERE movement_type='manual_set' AND created_at>='2026-10-25' AND created_at<'2026-11-16' ORDER BY ABS(quantity_delta) DESC LIMIT 18")
const anomaly=select('sentWithUnresolved',"SELECT o.id AS order_id,o.order_date,o.shipping_status,o.order_status,COUNT(oi.id) AS line_count,SUM(CASE WHEN oi.stock_writeoff_status='catalog_unresolved' THEN 1 ELSE 0 END) AS catalog_unresolved_lines,SUM(CASE WHEN oi.is_workshop=1 THEN 1 ELSE 0 END) AS workshop_lines, SUM(CASE WHEN r.status='unresolved' THEN 1 ELSE 0 END) AS unresolved_reserve_lines, SUM(CASE WHEN r.status='fulfilled' THEN 1 ELSE 0 END) AS fulfilled_lines,(SELECT COUNT(*) FROM order_dispatches d WHERE d.order_id=o.id) AS dispatch_headers FROM orders o LEFT JOIN order_items oi ON oi.order_id=o.id LEFT JOIN inventory_reservations r ON r.order_item_id=oi.id WHERE o.id=1616 GROUP BY o.id")
console.log('PICKER_IMPACT_OUTLIERS_MAIN_READONLY_JSON '+JSON.stringify({largestAdjustments,anomaly}))
console.log('PICKER_IMPACT_OUTLIERS_SELECT_ONLY_NO_WRITES_PASS')
