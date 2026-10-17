// Forensic sales cross-SKU audit of Ethno Drap female size52 after October 13 arrival.
// Read only. No personal details, prices, phone numbers, customer identifiers or writes.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {execFileSync} from 'node:child_process'
assert.equal(process.env.GITHUB_EVENT_NAME,'pull_request')
assert.equal(process.env.GITHUB_BASE_REF,'main')
assert.equal(process.env.GITHUB_ACTIONS,'true')
const cfg=process.env.PROD_READONLY_CONFIG
assert(cfg&&fs.readFileSync(cfg,'utf8').includes('"database_id": "17e68a41-1d58-4a36-8a63-47c3e32443c4"'))
function read(sql){
 assert(/^SELECT\s/i.test(sql)&&!sql.includes(';'),'Production SQL must be SELECT-only')
 const json=JSON.parse(execFileSync('npx',['wrangler','d1','execute','orders_db_prod','--remote','--config',cfg,'--command='+sql,'--json'],{encoding:'utf8',maxBuffer:16*1024*1024,timeout:90000}))
 assert(json.length===1&&json[0].success===true&&Array.isArray(json[0].results),'Production D1 SELECT failed')
 return json[0].results
}
const selectNames=read("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('order_items','orders','inventory_movements','inventory_stock','inventory_reservations','inventory_lifecycle_events','exchanges','exchange_items','return_items','inventory_transfer_items','inventory_transfer_documents','inventory_stocktake_items','inventory_stocktake_sessions','catalog_variants','catalog_products','inventory_movement_reversals') ORDER BY name").map(x=>x.name)
const names=new Set(selectNames)
function columns(name){
 assert(names.has(name),'Missing table '+name)
 return read("SELECT name FROM pragma_table_info('"+name+"')").map(x=>x.name)
}
const cs=Object.fromEntries(selectNames.map(n=>[n,columns(n)]))
const fields=(table,required,optional=[])=>{
 for(const x of required)assert(cs[table].includes(x),table+' missing '+x)
 return [...required,...optional.filter(x=>cs[table].includes(x))]
}
const pref=(alias,cols)=>cols.map(c=>alias+'.'+c+' AS '+alias+'_'+c).join(',')
const oiFields=fields('order_items',['id','order_id','variant_id','quantity','color_snapshot','size_snapshot'],['product_id','product_name_snapshot','gender_snapshot','material_snapshot','length_snapshot','stock_writeoff_status','created_at','updated_at'])
const oFields=fields('orders',['id','order_date','order_status','shipping_status'],['created_at','updated_at'])
const recentOrders=read('SELECT '+pref('oi',oiFields)+','+pref('o',oFields)+' FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE ((o.order_date >= \'2026-10-12\') OR (o.created_at >= \'2026-10-12\')) AND (oi.variant_id IN (SELECT id FROM catalog_variants WHERE product_id=75) OR oi.product_name_snapshot LIKE \'%ЭТНО КАРДИГАН%\') ORDER BY o.order_date,oi.id LIMIT 450')
const recentSize52=recentOrders.filter(x=>String(x.oi_size_snapshot??'').trim()==='52')
const drap52=recentSize52.filter(x=>String(x.oi_material_snapshot??'').toUpperCase().includes('ДРАП')&&String(x.oi_gender_snapshot??'').toUpperCase().includes('ЖЕН'))
const pairOrders=read("SELECT oi.id,oi.order_id,oi.variant_id,oi.quantity,oi.color_snapshot,oi.size_snapshot,oi.material_snapshot,oi.length_snapshot,oi.stock_writeoff_status,o.order_date,o.order_status,o.shipping_status FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE oi.variant_id IN (1280,1532) ORDER BY o.order_date,oi.id")
const movementFields=fields('inventory_movements',['id','variant_id','created_at','inventory_source','quantity_delta','reference_type'],['movement_type','reference_id','quantity_after','product_id','product_name_snapshot','color_snapshot','size_snapshot','material_snapshot','gender_snapshot','length_snapshot'])
const recentMovements=read('SELECT '+pref('m',movementFields)+' FROM inventory_movements m WHERE m.created_at >= \'2026-10-12T00:00:00\' AND (m.variant_id IN (SELECT id FROM catalog_variants WHERE product_id=75) OR m.product_id=75 OR m.product_name_snapshot LIKE \'%ЭТНО КАРДИГАН%\') ORDER BY m.created_at,m.id LIMIT 450')
const drap52Movements=recentMovements.filter(x=>String(x.m_size_snapshot??'')==='52'&&String(x.m_material_snapshot??'').toUpperCase().includes('ДРАП'))
const sourceMovement=read("SELECT m.id,m.variant_id,m.created_at,m.inventory_source,m.quantity_delta,m.reference_id,m.reference_type,m.quantity_after,r.reversal_movement_id,r.reversed_at FROM inventory_movements m LEFT JOIN inventory_movement_reversals r ON r.original_movement_id=m.id WHERE m.id=4876")
const stock=read("SELECT id,variant_id,inventory_source,quantity,reserved_quantity,updated_at FROM inventory_stock WHERE variant_id IN (SELECT id FROM catalog_variants WHERE product_id=75 AND stock_position_id=146 AND size_label='52') ORDER BY variant_id,inventory_source")
const sourceStock=stock.filter(x=>[1280,1532].includes(x.variant_id))
const relatedVariantCatalog=read("SELECT id,product_id,stock_position_id,color,material,length,gender,size_label,is_active FROM catalog_variants WHERE product_id=75 AND size_label='52' ORDER BY id")
const pendingReservations=read("SELECT variant_id,inventory_source,quantity,status,order_item_id FROM inventory_reservations WHERE variant_id IN (SELECT id FROM catalog_variants WHERE product_id=75 AND stock_position_id=146 AND size_label='52') AND status='active' ORDER BY variant_id,order_item_id LIMIT 120")
const lifecycle=read("SELECT id,variant_id,event_type,status,movement_id,inventory_source,quantity,created_at FROM inventory_lifecycle_events WHERE created_at>='2026-10-12T00:00:00' AND variant_id IN (SELECT id FROM catalog_variants WHERE product_id=75 AND stock_position_id=146 AND size_label='52') ORDER BY created_at,id")
const joinedItemIds=[...new Set(drap52.map(x=>x.oi_id))].filter(x=>Number.isSafeInteger(x))
const links={}
if(joinedItemIds.length){
 const ids=joinedItemIds.join(',')
 for(const table of ['return_items','exchange_items']){
  const cols=cs[table]
  const linkCols=cols.filter(x=>['order_item_id','old_order_item_id','new_order_item_id','source_order_item_id','target_order_item_id'].includes(x))
  if(!linkCols.length){links[table]={noColumns:cols};continue}
  const projection=['id','order_item_id','old_order_item_id','new_order_item_id','quantity','created_at','status'].filter(x=>cols.includes(x))
  links[table]=read('SELECT '+projection.join(',')+' FROM '+table+' WHERE '+linkCols.map(x=>x+' IN ('+ids+')').join(' OR ')+' ORDER BY '+(cols.includes('id')?'id':linkCols[0])+' LIMIT 150')
 }
}
const sampledOrderSourceSummary=recentOrders.reduce((acc,x)=>{const k=x.oi_variant_id??'snapshot_no_variant';acc[k]=(acc[k]||0)+1;return acc},{})
const result={readOnly:true,range:'2026-10-12 to 2026-10-16',currentPairStock:sourceStock,relatedSize52Stocks:stock,relatedVariants:relatedVariantCatalog,
 sourceArrival4876:sourceMovement,recentEthnoOrderItemCount:recentOrders.length,recentEthnoDrap52Items:drap52,recentEthnoSize52Items:recentSize52,recentEthnoAllItemVariantSummary:sampledOrderSourceSummary,
 pairHistoricalOrders:pairOrders,allRecentEthnoMovementsCount:recentMovements.length,recentDrap52Movements:drap52Movements,recentAllEthnoMovements:recentMovements,activeReservations:pendingReservations,recentLifecycle:lifecycle,linkedReturnsExchanges:links,
 tablesAndSelectedFields:{order_items:oiFields,orders:oFields,inventory_movements:movementFields}
}
console.log('ETHNO_52_SALE_CROSS_SKU_AUDIT='+JSON.stringify(result))
console.log('ETHNO_52_SALE_CROSS_SKU_READONLY_SUCCESS')
