// Orders-app main PRODUCTION read-only investigation of the specific
// historical #1563 Return #43 reserve conflict. STRICT SELECT only.
// No customer contacts, names, addresses, payment methods or secrets in logs.
import { execFileSync } from 'node:child_process'

const run=sql=>{
  const clean=sql.trim()
  if(!/^(SELECT|WITH)\b/i.test(clean)
    ||/\b(UPDATE|DELETE|INSERT|ALTER|DROP|CREATE|REPLACE|PRAGMA|ATTACH|DETACH|VACUUM|REINDEX)\b/i.test(clean)
    ||clean.includes(';')) throw Error('Only single SELECT is permitted')
  const raw=execFileSync('npx',['wrangler','d1','execute','orders_db_prod',
    '--remote','--config','wrangler.jsonc','--command',clean,'--json'],
    {encoding:'utf8',maxBuffer:12*1024*1024,timeout:120000})
  const parsed=JSON.parse(raw)
  if(parsed.some(x=>x.success!==true)) throw Error('Read-only production query failed')
  return parsed.flatMap(x=>x.results||[])
}
const descriptions=[
 {table:'orders',where:'id = 1563',
  fields:['id','order_date','order_status','shipping_status','shipping_date','created_at','updated_at']},
 {table:'order_items',where:'order_id = 1563',
  fields:['id','order_id','product_id','variant_id','quantity','stock_writeoff_status','source_type','is_workshop','created_at','inventory_obligation_origin_at']},
 {table:'inventory_reservations',where:'order_id = 1563',
  fields:['id','order_id','order_item_id','inventory_source','product_id','variant_id','quantity','status','reference_type','reference_id','created_at','updated_at','fulfilled_at','released_at']},
 {table:'returns',where:'order_id = 1563 OR id = 43',
  fields:['id','order_id','return_date','status','created_at','cancelled_at','updated_at']},
 {table:'return_items',where:'return_id IN (SELECT id FROM returns WHERE order_id = 1563 OR id = 43)',
  fields:['id','return_id','order_item_id','quantity','restocked','inventory_source','physical_tracking','physical_received_at','created_at']},
 {table:'exchanges',where:'order_id = 1563',
  fields:['id','order_id','status','old_order_item_id','new_order_item_id','old_quantity','old_return_source','created_at','cancelled_at']},
 {table:'exchange_items',where:'exchange_id IN (SELECT id FROM exchanges WHERE order_id=1563)',
  fields:['id','exchange_id','role','order_item_id','quantity','inventory_source','physical_tracking','physical_received_at']},
 {table:'inventory_lifecycle_events',where:"order_id = 1563 OR (operation_type = 'return' AND operation_id = 43)",
  fields:['id','event_type','operation_type','operation_id','operation_item_id','order_id','order_item_id','variant_id','inventory_source','quantity','status','created_at','applied_at','cancelled_at','movement_id','reversal_movement_id']},
 {table:'inventory_movements',where:"(reference_type = 'return' AND reference_id = '43') OR (variant_id IN (212,853,1444) AND created_at >= '2026-10-09')",
  fields:['id','reference_type','reference_id','movement_type','inventory_source','variant_id','quantity_delta','quantity_after','created_at','reversed_at']},
 {table:'inventory_handover_reviews',where:'order_id = 1563',
  fields:['id','order_id','order_item_id','reservation_id','decision','checkpoint_id','checkpoint_at','reviewed_at']},
 {table:'inventory_stock',where:'variant_id IN (212,853,1444)',
  fields:['id','inventory_source','variant_id','quantity','reserved_quantity','updated_at','last_action']},
]
const present=run("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
const tables=new Set(present.map(x=>x.name))
for(const d of descriptions){
 if(!tables.has(d.table)){console.log('MISSING_TABLE '+d.table);continue}
 const available=new Set(run("SELECT name FROM pragma_table_info('"+d.table+"')").map(x=>x.name))
 const fields=d.fields.filter(x=>available.has(x))
 if(!fields.length)throw Error('Schema unsupported '+d.table)
 const query='SELECT '+fields.join(', ')+' FROM '+d.table+' WHERE '+d.where+' LIMIT 150'
 const rows=run(query)
 console.log('FORENSIC_1563_'+d.table.toUpperCase()+' count='+rows.length+' data='+JSON.stringify(rows))
}
console.log('FORENSIC_1563_READ_ONLY_DONE')
