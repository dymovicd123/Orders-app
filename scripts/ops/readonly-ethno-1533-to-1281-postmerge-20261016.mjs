// Independent read-only production verification of one admin-authorized SKU merge.
// No D1 write, no order mutation, no client data logged.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {execFileSync} from 'node:child_process'
assert.equal(process.env.GITHUB_EVENT_NAME,'pull_request')
assert.equal(process.env.GITHUB_BASE_REF,'main')
assert.equal(process.env.GITHUB_ACTIONS,'true')
const cfg=process.env.PROD_READONLY_CONFIG
assert(cfg&&fs.readFileSync(cfg,'utf8').includes('"database_id": "17e68a41-1d58-4a36-8a63-47c3e32443c4"'))
function read(sql){
 assert(/^SELECT\s/i.test(sql)&&!sql.includes(';'),'Production MUST stay read-only')
 const json=JSON.parse(execFileSync('npx',['wrangler','d1','execute','orders_db_prod','--remote','--config',cfg,'--command='+sql,'--json'],{encoding:'utf8',maxBuffer:20*1024*1024,timeout:90000}))
 assert(json.length===1&&json[0].success===true&&Array.isArray(json[0].results),'Production SELECT failed')
 return json[0].results
}
const sourceId=1533,keeperId=1281
const variants=read('SELECT id,product_id,stock_position_id,category,gender,color,material,length,size_label,is_active,created_at,updated_at FROM catalog_variants WHERE id IN (1280,1281,1532,1533) ORDER BY id')
assert.equal(variants.length,4)
const from=variants.find(x=>x.id===1533),to=variants.find(x=>x.id===1281)
assert(from&&to)
assert.equal(from.is_active,0,'Source 1533 should now be archived')
assert.equal(to.is_active,1,'Canonical 1281 must stay active')
for(const x of [from,to]){
 assert.equal(x.product_id,75,'Incorrect product')
 assert.equal(x.stock_position_id,146,'Incorrect execution')
 assert.equal(x.size_label,'54','Incorrect size')
 assert.equal(x.gender,'ЖЕН')
 assert.equal(x.category,'adult')
 assert.equal(x.material,'ДРАП')
 assert.equal(x.length,'СТАНДАРТ')
}
assert.equal(from.color,'СВЕТЛО СЕРЫЙ','Preserve original source color in archived history')
assert.equal(to.color,'СВЕТЛО-СЕРЫЙ','Canonical source of truth altered')
const merged=read('SELECT id,source_variant_id,target_variant_id,product_id,source_color,target_color,material,length,category,gender,size_label,source_physical_quantity,source_reserved_quantity,created_at FROM catalog_variant_consolidations WHERE source_variant_id=1533 ORDER BY id')
assert.equal(merged.length,1,'Missing or duplicated consolidation receipt')
const record=merged[0]
assert.equal(record.target_variant_id,1281,'Wrong keeper in merge receipt')
assert.equal(record.product_id,75)
assert.equal(record.source_color,'СВЕТЛО СЕРЫЙ')
assert.equal(record.target_color,'СВЕТЛО-СЕРЫЙ')
assert.equal(record.size_label,'54')
assert.equal(record.source_physical_quantity,0)
assert.equal(record.source_reserved_quantity,0)
assert(record.created_at,'Missing consolidation timestamp')
const allConsolidations=read('SELECT id,source_variant_id,target_variant_id FROM catalog_variant_consolidations WHERE source_variant_id IN (1280,1281,1532,1533) ORDER BY id')
assert.equal(allConsolidations.length,1,'Unexpected merge on size 52 or a repeat merge')
const decisions=read('SELECT * FROM catalog_variant_consolidation_stock_decisions WHERE consolidation_id='+record.id+' ORDER BY inventory_source')
const lineItems=read('SELECT * FROM catalog_variant_consolidation_stock_rows WHERE consolidation_id='+record.id+' ORDER BY inventory_source')
assert.equal(decisions.length,1,'One documented source stock location expected')
assert.equal(lineItems.length,1,'One source stock location must have matching before/after evidence')
assert(decisions.every(x=>x.inventory_source==='warehouse'&&x.source_quantity_before===0&&x.keeper_quantity_before===0&&x.final_quantity===0&&x.adjustment_quantity===0),'Unexpected stock decision or invented quantity')
assert(lineItems.every(x=>x.inventory_source==='warehouse'&&x.source_quantity_before===0&&x.target_quantity_before===0&&x.source_reserved_before===0&&x.target_reserved_before===0&&x.combined_quantity_after===0),'Stock receipt inconsistencies')
const validation=read('SELECT consolidation_id,passed,checked_at FROM catalog_variant_consolidation_validations WHERE consolidation_id='+record.id)
const reservationValidation=read('SELECT consolidation_id,passed,checked_at FROM catalog_variant_consolidation_reservation_validations WHERE consolidation_id='+record.id)
assert(validation.length===1&&validation[0].passed===1&&validation[0].checked_at,'Missing inventory atomic batch validation')
assert(reservationValidation.length===1&&reservationValidation[0].passed===1&&reservationValidation[0].checked_at,'Missing reservation atomic batch validation')
const reservationReceipts=read('SELECT COUNT(*) n FROM catalog_variant_consolidation_reservation_rows WHERE consolidation_id='+record.id)[0].n
assert.equal(reservationReceipts,0,'No active reservations were expected to be transferred')
const stock=read('SELECT id,variant_id,inventory_source,quantity,reserved_quantity,product_id FROM inventory_stock WHERE variant_id IN (1280,1281,1532,1533) ORDER BY variant_id,inventory_source')
assert.equal(stock.filter(x=>x.variant_id===1533).length,1,'Source original stock row lost')
assert.equal(stock.filter(x=>x.variant_id===1281).length,2,'Keeper original warehouse/boutique stock rows lost')
const size54=stock.filter(x=>x.variant_id===1533||x.variant_id===1281)
assert.equal(size54.length,3)
assert(size54.every(x=>x.quantity===0&&x.reserved_quantity===0&&x.product_id===75),'Size54 stock/reserve changed')
assert(stock.some(x=>x.variant_id===1533&&x.inventory_source==='warehouse'&&x.id===1412),'Source warehouse stock row identity changed')
assert(stock.some(x=>x.variant_id===1281&&x.inventory_source==='warehouse'&&x.id===1072),'Keeper warehouse stock row identity changed')
assert(stock.some(x=>x.variant_id===1281&&x.inventory_source==='boutique'&&x.id===1091),'Keeper boutique stock row identity changed')
const size52a=variants.find(x=>x.id===1280),size52b=variants.find(x=>x.id===1532)
assert(size52a&&size52a.is_active===1&&size52a.color==='СВЕТЛО-СЕРЫЙ'&&size52a.size_label==='52')
assert(size52b&&size52b.is_active===1&&size52b.color==='СВЕТЛО СЕРЫЙ'&&size52b.size_label==='52')
assert(stock.some(x=>x.variant_id===1532&&x.inventory_source==='warehouse'&&x.id===1411&&x.quantity===1&&x.reserved_quantity===0),'13 October 1-unit arrival on size52 must survive')
assert(stock.filter(x=>x.variant_id===1280||x.variant_id===1532).every(x=>x.reserved_quantity===0))
const activeReservations=read("SELECT id,variant_id,inventory_source,quantity FROM inventory_reservations WHERE variant_id IN (1280,1281,1532,1533) AND status='active'")
assert.equal(activeReservations.length,0)
const orders=read('SELECT variant_id,COUNT(*) AS n FROM order_items WHERE variant_id IN (1280,1281,1532,1533) GROUP BY variant_id ORDER BY variant_id')
assert(!orders.some(x=>x.variant_id===1533||x.variant_id===1281),'Size54 source/keeper should have no historical order rows')
assert(orders.some(x=>x.variant_id===1280&&x.n===2),'Size52 two historical order items missing')
assert(!orders.some(x=>x.variant_id===1532),'Unexpected size52 recent order activity')
const counts=read("SELECT i.variant_id,s.status AS session_status,COUNT(*) AS n FROM inventory_stocktake_items i JOIN inventory_stocktake_sessions s ON s.id=i.session_id WHERE i.variant_id IN (1281,1533) GROUP BY i.variant_id,s.status ORDER BY i.variant_id,s.status")
assert.equal(counts.filter(x=>x.variant_id===1533&&x.session_status==='completed').reduce((n,x)=>n+x.n,0),2,'Two completed source stocktakes lost')
assert.equal(counts.filter(x=>x.variant_id===1533&&x.session_status==='cancelled').reduce((n,x)=>n+x.n,0),1,'Cancelled source stocktake lost')
const moves=read('SELECT variant_id,COUNT(*) n FROM inventory_movements WHERE variant_id IN (1281,1533) GROUP BY variant_id ORDER BY variant_id')
assert((moves.find(x=>x.variant_id===1281)?.n||0)>=8,'Keeper movement history missing')
const unintendedFinalizations=read("SELECT COUNT(*) n FROM inventory_movements WHERE reference_type='catalog_stock_finalization' AND reference_id='"+record.id+"'")[0].n
assert.equal(unintendedFinalizations,0,'Zero-quantity merge must not create adjusting stock movement')
const orphanStock=read('SELECT COUNT(*) n FROM inventory_stock s LEFT JOIN catalog_variants v ON v.id=s.variant_id WHERE s.variant_id IS NOT NULL AND v.id IS NULL')[0].n
const reserveMismatch=read("SELECT COUNT(*) n FROM inventory_stock s WHERE s.reserved_quantity<>COALESCE((SELECT SUM(r.quantity) FROM inventory_reservations r WHERE r.variant_id=s.variant_id AND r.inventory_source=s.inventory_source AND r.status='active'),0)")[0].n
const activeSourceReservations=read("SELECT COUNT(*) n FROM inventory_reservations WHERE variant_id=1533 AND status='active'")[0].n
const activeSourceOrderItems=read("SELECT COUNT(*) n FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE oi.variant_id=1533 AND o.order_status='active' AND COALESCE(o.shipping_status,'not_sent')<>'sent'")[0].n
assert.equal(orphanStock,0,'Orphan inventory rows')
assert.equal(reserveMismatch,0,'Inventory/reservations mismatch')
assert.equal(activeSourceReservations,0,'Active source reservation after retirement')
assert.equal(activeSourceOrderItems,0,'Open order still linked to retired source')
const result={consolidationId:record.id,sourceId,keeperId,sourceInactive:true,keeperActive:true,stockSourceUnits:0,stockKeeperUnits:0,reservedUnits:0,stockRowsSize54:size54.length,stockDecisionRows:decisions.length,stockReceiptRows:lineItems.length,stockValidation:validation[0].passed,reserveValidation:reservationValidation[0].passed,sourceStocktakeSessions:{completed:2,cancelled:1},historicalMovementRows:moves,unchanged52WarehouseUnit:1,sourceActiveOrders:0,sourceActiveReservations:0,orphanStock,reserveMismatch,noWrites:true}
console.log('ETHNO_SIZE54_INDEPENDENT_PRODUCTION_VERIFIED='+JSON.stringify(result))
