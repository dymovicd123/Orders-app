// Production forensic read-only: six remaining Ethno Cardigan duplicate SKU pairs.
// Never rewrite Catalog, physical stock, reservations, history or orders.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {execFileSync} from 'node:child_process'
assert.equal(process.env.GITHUB_EVENT_NAME,'pull_request')
assert.equal(process.env.GITHUB_BASE_REF,'main')
assert.equal(process.env.GITHUB_ACTIONS,'true')
const cfg=process.env.PROD_READONLY_CONFIG
assert(cfg&&fs.readFileSync(cfg,'utf8').includes('"database_id": "17e68a41-1d58-4a36-8a63-47c3e32443c4"'))
const ids=[1277,1438,1278,1436,1279,1441,1303,1473,1280,1532,1281,1533]
const pairs=[[1277,1438],[1278,1436],[1279,1441],[1303,1473],[1280,1532],[1281,1533]]
const list=ids.join(',')
function read(q){
 assert(/^SELECT\s/i.test(q)&&!q.includes(';'),'Only SELECT allowed to production')
 const json=JSON.parse(execFileSync('npx',['wrangler','d1','execute','orders_db_prod','--remote','--config',cfg,'--command='+q,'--json'],{encoding:'utf8',timeout:90000,maxBuffer:24*1024*1024}))
 assert(json.length===1&&json[0].success===true&&Array.isArray(json[0].results),'D1 SELECT failed')
 return json[0].results
}
const variants=read('SELECT v.id,v.product_id,v.stock_position_id,v.category,v.gender,v.color,v.material,v.length,v.size_label,v.is_active,v.created_at,v.updated_at,p.name AS product,p.is_active AS product_active FROM catalog_variants v JOIN catalog_products p ON p.id=v.product_id WHERE v.id IN ('+list+') ORDER BY v.id')
assert.equal(variants.length,12)
const stock=read('SELECT id,variant_id,inventory_source,quantity,reserved_quantity,updated_at FROM inventory_stock WHERE variant_id IN ('+list+') ORDER BY variant_id,id')
const reserves=read("SELECT id,variant_id,inventory_source,quantity,status FROM inventory_reservations WHERE variant_id IN ("+list+") AND status='active' ORDER BY variant_id,id")
for(const st of stock){
 const n=reserves.filter(r=>r.variant_id===st.variant_id&&r.inventory_source===st.inventory_source).reduce((a,b)=>a+b.quantity,0)
 assert.equal(st.reserved_quantity,n,'Reservation mismatch: '+st.id)
}
const linkedOrderStatus=read("SELECT oi.variant_id,COUNT(*) AS itemCount,COALESCE(SUM(oi.quantity),0) AS itemQty,MIN(o.order_date) AS earliestOrder,MAX(o.order_date) AS latestOrder,COALESCE(SUM(CASE WHEN o.order_status='active' AND COALESCE(o.shipping_status,'not_sent')<>'sent' THEN 1 ELSE 0 END),0) AS openUnsentLines,COALESCE(SUM(CASE WHEN COALESCE(o.shipping_status,'not_sent')='sent' THEN 1 ELSE 0 END),0) AS sentLines,COALESCE(SUM(CASE WHEN o.order_status='deleted' THEN 1 ELSE 0 END),0) AS deletedOrderLines FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE oi.variant_id IN ("+list+") GROUP BY oi.variant_id ORDER BY oi.variant_id")
const allTables=read("SELECT name,type FROM sqlite_master WHERE type IN ('table','view') AND (name LIKE '%catalog%' OR name LIKE '%inventory%' OR name LIKE '%stock%' OR name LIKE '%exchange%' OR name LIKE '%return%' OR name LIKE '%workshop%') ORDER BY name")
const tableLookup=new Map(allTables.map(x=>[x.name,x.type]))
const possible=[
 'catalog_semantic_variant_corrections','catalog_semantic_stock_correction_baseline','catalog_semantic_stock_recoveries',
 'catalog_variant_consolidations','catalog_variant_consolidation_stock_rows','catalog_variant_consolidation_stock_decisions',
 'catalog_variant_effective_merge_lineage','catalog_variant_aliases',
 'inventory_movements','inventory_movement_reversals','inventory_lifecycle_events',
 'inventory_transfer_items','inventory_transfer_documents','inventory_stock_checks',
 'inventory_stocktake_items','inventory_revisions','stocktake_items',
 'return_items','exchanges','exchange_items','workshop_tasks',
]
const tables=possible.filter(x=>tableLookup.has(x))
const columnsQuery=tables.map(t=>"SELECT '"+t+"' AS tbl,name FROM pragma_table_info('"+t+"')").join(' UNION ALL ')
const columns=columnsQuery?read(columnsQuery):[]
const byTable=new Map()
for(const t of tables)byTable.set(t,columns.filter(c=>c.tbl===t).map(c=>c.name))
const safeFields=new Set([
 'id','source_variant_id','keeper_variant_id','target_variant_id','original_variant_id','variant_id',
 'stock_position_id','correction_id','consolidation_id','movement_id','original_movement_id',
 'inventory_source','source','location','status','state','event_type','movement_type','reference_type',
 'quantity','quantity_delta','delta','reserved_quantity','before_quantity','after_quantity',
 'before_reserved','after_reserved','stock_row_id','stock_id','transfer_id','order_item_id',
 'is_active','created_at','updated_at','applied_at','effective_at','reversed_at',
 'event_date','movement_date','completed_at','source_color','keeper_color'
])
const associations={}
for(const t of tables){
 const cols=byTable.get(t)
 const linkColumns=['source_variant_id','keeper_variant_id','target_variant_id','original_variant_id','variant_id'].filter(c=>cols.includes(c))
 if(!linkColumns.length){associations[t]={columns:cols,matchedBySku:false};continue}
 const relevant=cols.filter(c=>safeFields.has(c))
 const where=linkColumns.map(c=>c+' IN ('+list+')').join(' OR ')
 const n=read('SELECT COUNT(*) AS n FROM '+t+' WHERE '+where)[0].n
 const rows=n<=300?read('SELECT '+relevant.join(',')+' FROM '+t+' WHERE '+where+' ORDER BY '+(cols.includes('id')?'id':'rowid')+' LIMIT 301'):[]
 assert(n>300||rows.length===n,'Incomplete linkage evidence '+t)
 const groups={}
 for(const x of rows){const k=linkColumns.filter(c=>ids.includes(x[c])).map(c=>c+':'+x[c]).join('|');groups[k]=(groups[k]||0)+1}
 associations[t]={columns:cols,linkColumns,total:n,truncated:n>300,groups,rows:n<=90?rows:rows.slice(0,90)}
}
const movements=associations.inventory_movements
const corrections=associations.catalog_semantic_variant_corrections
const pairsSummary=pairs.map(([oldId,newId])=>({
 source:variants.find(v=>v.id===oldId),keeper:variants.find(v=>v.id===newId),
 sourceStock:stock.filter(x=>x.variant_id===oldId),keeperStock:stock.filter(x=>x.variant_id===newId),
 sourceReservations:reserves.filter(x=>x.variant_id===oldId),keeperReservations:reserves.filter(x=>x.variant_id===newId),
 sourceOrder:linkedOrderStatus.find(x=>x.variant_id===oldId)||null,
 keeperOrder:linkedOrderStatus.find(x=>x.variant_id===newId)||null
}))
const integrity=read("SELECT (SELECT COUNT(*) FROM inventory_stock st LEFT JOIN catalog_variants v ON v.id=st.variant_id WHERE st.variant_id IS NOT NULL AND v.id IS NULL) AS orphanStock,(SELECT COUNT(*) FROM inventory_stock s WHERE s.reserved_quantity<>COALESCE((SELECT SUM(r.quantity) FROM inventory_reservations r WHERE r.variant_id=s.variant_id AND r.inventory_source=s.inventory_source AND r.status='active'),0)) AS reserveMismatch")
console.log('ETHNO_SIX_PAIRS_PROD_HISTORY_JSON='+JSON.stringify({timeScope:'current production read-only',pairs:pairsSummary,relatedTableNames:allTables.map(x=>x.name),associations,integrity:integrity[0],noWrites:true}))
console.log('ETHNO_SIX_PAIRS_READONLY_SUCCESS')
