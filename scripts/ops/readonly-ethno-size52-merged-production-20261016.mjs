// Verify admin SKU consolidation 1532 → 1280 after physically counted zero.
// SELECT-only: NO production writes, no private customer data.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {execFileSync} from 'node:child_process'
assert.equal(process.env.GITHUB_EVENT_NAME,'pull_request')
assert.equal(process.env.GITHUB_BASE_REF,'main')
assert.equal(process.env.GITHUB_ACTIONS,'true')
const cfg=process.env.PROD_READONLY_CONFIG
assert(cfg&&fs.readFileSync(cfg,'utf8').includes('"database_id": "17e68a41-1d58-4a36-8a63-47c3e32443c4"'))
const read=(sql)=>{
 assert(/^SELECT\s/i.test(sql)&&!sql.includes(';'),'SELECT only')
 const raw=JSON.parse(execFileSync('npx',['wrangler','d1','execute','orders_db_prod','--remote','--config',cfg,'--command='+sql,'--json'],{encoding:'utf8',timeout:90000,maxBuffer:20*1024*1024}))
 assert(raw.length===1&&raw[0].success===true&&Array.isArray(raw[0].results),'SELECT failed')
 return raw[0].results
}
const variants=read('SELECT id,product_id,stock_position_id,category,gender,color,material,length,size_label,is_active FROM catalog_variants WHERE id IN (1280,1281,1532,1533) ORDER BY id')
const stock=read('SELECT id,variant_id,inventory_source,quantity,reserved_quantity FROM inventory_stock WHERE variant_id IN (1280,1281,1532,1533) ORDER BY id')
const merges=read('SELECT id,source_variant_id,target_variant_id,product_id,source_color,target_color,material,length,gender,size_label,source_physical_quantity,source_reserved_quantity,created_at FROM catalog_variant_consolidations WHERE source_variant_id IN (1532,1533) ORDER BY source_variant_id')
const merged=merges.find(x=>x.source_variant_id===1532)
assert(merged,'No consolidation receipt for source 1532')
const close=read('SELECT movement_id,source_variant_id,keeper_variant_id,stock_check_id,movement_delta,finalized_at FROM catalog_manual_movement_finalizations WHERE source_variant_id=1532 ORDER BY movement_id')
const finish=read('SELECT source_variant_id,passed,checked_at FROM catalog_manual_finalization_validations WHERE source_variant_id=1532')
const movements=read('SELECT id,variant_id,inventory_source,quantity_delta,quantity_after,reference_type FROM inventory_movements WHERE id IN (4876,5400) ORDER BY id')
const checks=read('SELECT id,variant_id,inventory_source,expected_quantity,counted_quantity,difference_quantity FROM inventory_stock_checks WHERE id=3250')
const reversals=read('SELECT original_movement_id FROM inventory_movement_reversals WHERE original_movement_id IN (4876,5400)')
const adjustment=read("SELECT COUNT(*) n FROM inventory_movements WHERE reference_type='catalog_stock_finalization' AND reference_id='"+merged.id+"'")[0].n
const physicalValidation=read('SELECT consolidation_id,passed,checked_at FROM catalog_variant_consolidation_validations WHERE consolidation_id='+merged.id)
const reserveValidation=read('SELECT consolidation_id,passed,checked_at FROM catalog_variant_consolidation_reservation_validations WHERE consolidation_id='+merged.id)
const lineStock=read('SELECT * FROM catalog_variant_consolidation_stock_rows WHERE consolidation_id='+merged.id)
const decision=read('SELECT * FROM catalog_variant_consolidation_stock_decisions WHERE consolidation_id='+merged.id)
const activeRes=read("SELECT id,variant_id,quantity FROM inventory_reservations WHERE variant_id IN (1280,1532) AND status='active'")
const oldOrders=read('SELECT variant_id,COUNT(*) n FROM order_items WHERE variant_id IN (1280,1532) GROUP BY variant_id ORDER BY variant_id')
const stocktake=read('SELECT i.variant_id,s.status,COUNT(*) n FROM inventory_stocktake_items i JOIN inventory_stocktake_sessions s ON s.id=i.session_id WHERE i.variant_id IN (1280,1532) GROUP BY i.variant_id,s.status ORDER BY i.variant_id,s.status')
const integrity=read("SELECT (SELECT COUNT(*) FROM inventory_stock s LEFT JOIN catalog_variants v ON v.id=s.variant_id WHERE s.variant_id IS NOT NULL AND v.id IS NULL) orphan_stock,(SELECT COUNT(*) FROM inventory_stock s WHERE s.reserved_quantity<>COALESCE((SELECT SUM(r.quantity) FROM inventory_reservations r WHERE r.variant_id=s.variant_id AND r.inventory_source=s.inventory_source AND r.status='active'),0)) reserve_mismatch")[0]
const report={
 mergers:merges.map(x=>({id:x.id,from:x.source_variant_id,to:x.target_variant_id,physical:x.source_physical_quantity,reserved:x.source_reserved_quantity})),
 variants:variants.map(x=>({id:x.id,active:x.is_active,color:x.color,size:x.size_label})),
 stock:stock.map(x=>({id:x.id,variantId:x.variant_id,source:x.inventory_source,quantity:x.quantity,reserved:x.reserved_quantity})),
 closureIds:close.map(x=>x.movement_id),closureValidation:finish.map(x=>x.passed),
 newStockValidation:physicalValidation.map(x=>x.passed),newReserveValidation:reserveValidation.map(x=>x.passed),
 newStockRows:lineStock.length,newStockDecisions:decision.length,
 preservedOriginalMovements:movements.map(x=>({id:x.id,variantId:x.variant_id,delta:x.quantity_delta})),
 originalStocktakeCount:stocktake,olderOrderReferences:oldOrders,
 artificialAdjustments:adjustment,reversedHistory:reversals.length,
 activeReserves:activeRes.length,integrity,readOnly:true
}
console.log('ETHNO52_AFTER_SKU_MERGE_PRODUCTION_JSON='+JSON.stringify(report))
assert.equal(variants.length,4)
for(const [id,active,color,size] of [[1280,1,'СВЕТЛО-СЕРЫЙ','52'],[1532,0,'СВЕТЛО СЕРЫЙ','52'],[1281,1,'СВЕТЛО-СЕРЫЙ','54'],[1533,0,'СВЕТЛО СЕРЫЙ','54']]){
 const v=variants.find(x=>x.id===id)
 assert(v&&v.is_active===active&&v.color===color&&v.size_label===size&&v.product_id===75&&v.stock_position_id===146&&v.gender==='ЖЕН'&&v.material==='ДРАП'&&v.length==='СТАНДАРТ','Wrong variant '+id)
}
assert.equal(merges.length,2,'Unexpected number of source consolidation receipts')
assert.equal(merges.find(x=>x.source_variant_id===1533)?.target_variant_id,1281,'Historical size54 merge changed')
assert(merged.target_variant_id===1280&&merged.product_id===75&&merged.source_color==='СВЕТЛО СЕРЫЙ'&&merged.target_color==='СВЕТЛО-СЕРЫЙ'&&merged.size_label==='52','Wrong newly consolidated SKU')
assert.equal(merged.source_physical_quantity,0)
assert.equal(merged.source_reserved_quantity,0)
assert(merged.created_at)
assert.equal(stock.length,6,'Inventory rows for both sizes unexpectedly removed/created')
for(const [id,v,source] of [[1071,1280,'warehouse'],[1090,1280,'boutique'],[1411,1532,'warehouse'],[1072,1281,'warehouse'],[1091,1281,'boutique'],[1412,1533,'warehouse']]){
 const x=stock.find(r=>r.id===id)
 assert(x&&x.variant_id===v&&x.inventory_source===source&&x.quantity===0&&x.reserved_quantity===0,'Incorrect stock row '+id)
}
assert.deepEqual(close.map(x=>x.movement_id),[4876,5400])
assert(close.every(x=>x.source_variant_id===1532&&x.keeper_variant_id===1280&&x.stock_check_id===3250))
assert.deepEqual(close.map(x=>x.movement_delta),[1,-1])
assert.equal(finish.length,1)
assert.equal(finish[0].passed,1)
assert.deepEqual(movements.map(x=>x.id),[4876,5400])
assert(movements[0].variant_id===1532&&movements[0].quantity_delta===1&&movements[0].quantity_after===1)
assert(movements[1].variant_id===1532&&movements[1].quantity_delta===-1&&movements[1].quantity_after===0)
assert.equal(checks.length,1)
assert(checks[0].variant_id===1532&&checks[0].expected_quantity===1&&checks[0].counted_quantity===0&&checks[0].difference_quantity===-1)
assert.equal(reversals.length,0)
assert.equal(adjustment,0)
assert.equal(physicalValidation.length,1)
assert.equal(reserveValidation.length,1)
assert(physicalValidation[0].passed===1&&reserveValidation[0].passed===1)
assert.equal(lineStock.length,1)
assert.equal(decision.length,1)
assert.equal(lineStock[0].source_quantity_before,0)
assert.equal(lineStock[0].target_quantity_before,0)
assert.equal(lineStock[0].source_reserved_before,0)
assert.equal(lineStock[0].target_reserved_before,0)
assert.equal(lineStock[0].combined_quantity_after,0)
assert.equal(decision[0].final_quantity,0)
assert.equal(decision[0].adjustment_quantity,0)
assert.equal(activeRes.length,0)
assert(!oldOrders.some(x=>x.variant_id===1532))
assert.equal(oldOrders.find(x=>x.variant_id===1280)?.n,2,'Historic order rows disappeared')
assert.equal(stocktake.filter(x=>x.variant_id===1532&&x.status==='completed').reduce((n,x)=>n+x.n,0),2)
assert.equal(stocktake.filter(x=>x.variant_id===1532&&x.status==='cancelled').reduce((n,x)=>n+x.n,0),1)
assert.equal(integrity.orphan_stock,0)
assert.equal(integrity.reserve_mismatch,0)
console.log('ETHNO52_AFTER_SKU_MERGE_PRODUCTION_VERIFIED_SUCCESS')
