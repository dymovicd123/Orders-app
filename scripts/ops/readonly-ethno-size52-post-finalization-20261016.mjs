// Read-only independent production verification, immediately after admin-clicked history finalization.
// NO SQL mutating statements, NO personal records displayed, exact pinned production D1.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {execFileSync} from 'node:child_process'
assert.equal(process.env.GITHUB_EVENT_NAME,'pull_request')
assert.equal(process.env.GITHUB_BASE_REF,'main')
const config=process.env.PROD_READONLY_CONFIG
assert(config&&fs.readFileSync(config,'utf8').includes('"database_id": "17e68a41-1d58-4a36-8a63-47c3e32443c4"'))
function read(sql){
 assert(/^SELECT\s/i.test(sql)&&!sql.includes(';'),'Must use SELECT-only')
 const out=JSON.parse(execFileSync('npx',['wrangler','d1','execute','orders_db_prod','--remote','--config',config,'--command='+sql,'--json'],{encoding:'utf8',maxBuffer:20*1024*1024,timeout:90000}))
 assert(out.length===1&&out[0].success===true&&Array.isArray(out[0].results),'D1 query failed')
 return out[0].results
}
const finalizations=read('SELECT movement_id,source_variant_id,keeper_variant_id,stock_check_id,movement_delta,reason,finalized_at FROM catalog_manual_movement_finalizations WHERE source_variant_id=1532 OR movement_id IN (4876,5400) ORDER BY movement_id')
const validations=read('SELECT source_variant_id,passed,checked_at FROM catalog_manual_finalization_validations WHERE source_variant_id=1532')
const variants=read('SELECT id,product_id,stock_position_id,color,material,length,gender,size_label,is_active FROM catalog_variants WHERE id IN (1280,1532) ORDER BY id')
const stock=read('SELECT id,variant_id,inventory_source,quantity,reserved_quantity FROM inventory_stock WHERE variant_id IN (1280,1532) ORDER BY id')
const moves=read('SELECT id,variant_id,inventory_source,movement_type,quantity_delta,quantity_after,reference_type,created_at FROM inventory_movements WHERE id IN (4876,5400) ORDER BY id')
const oldCheck=read('SELECT id,variant_id,inventory_source,expected_quantity,counted_quantity,difference_quantity,check_type FROM inventory_stock_checks WHERE id=3250')
const reverted=read('SELECT original_movement_id,reversal_movement_id FROM inventory_movement_reversals WHERE original_movement_id IN (4876,5400)')
const merged=read('SELECT id,source_variant_id,target_variant_id FROM catalog_variant_consolidations WHERE source_variant_id=1532')
const active=read("SELECT id,variant_id,quantity FROM inventory_reservations WHERE status='active' AND variant_id IN (1280,1532)")
const otherMovements=read("SELECT m.id FROM inventory_movements m WHERE m.variant_id=1532 AND LOWER(TRIM(COALESCE(m.reference_type,''))) IN ('manual','transfer_in','transfer_out') AND NOT EXISTS(SELECT 1 FROM inventory_movement_reversals r WHERE r.original_movement_id=m.id) AND NOT EXISTS(SELECT 1 FROM catalog_manual_movement_finalizations f WHERE f.movement_id=m.id) ORDER BY m.id")
const integrity=read("SELECT (SELECT COUNT(*) FROM inventory_stock s LEFT JOIN catalog_variants v ON v.id=s.variant_id WHERE s.variant_id IS NOT NULL AND v.id IS NULL) AS orphan_stock, (SELECT COUNT(*) FROM inventory_stock s WHERE s.reserved_quantity<>COALESCE((SELECT SUM(r.quantity) FROM inventory_reservations r WHERE r.variant_id=s.variant_id AND r.inventory_source=s.inventory_source AND r.status='active'),0)) AS reserve_mismatch")
const report={finalizationCount:finalizations.length,movementIds:finalizations.map(x=>x.movement_id),deltas:finalizations.map(x=>x.movement_delta),validation:validations.map(x=>x.passed),physicalStock:stock.map(x=>({id:x.id,variantId:x.variant_id,location:x.inventory_source,quantity:x.quantity,reserved:x.reserved_quantity})),sourceActive:variants.find(x=>x.id===1532)?.is_active,keeperActive:variants.find(x=>x.id===1280)?.is_active,untouchedOriginalMovements:moves.length,check3250:oldCheck.length,originalReversed:reverted.length,sourceConsolidations:merged.length,activeReserves:active.length,remainingSourceReversible:otherMovements.map(x=>x.id),integrity:integrity[0],readOnly:true}
console.log('ETHNO52_ADMIN_FINALIZATION_PRODUCTION_AUDIT='+JSON.stringify(report))
assert.equal(finalizations.length,2,'Expected exactly two closures')
for(const [id,delta] of [[4876,1],[5400,-1]]){
 const f=finalizations.find(x=>x.movement_id===id)
 assert(f&&f.source_variant_id===1532&&f.keeper_variant_id===1280&&f.stock_check_id===3250&&f.movement_delta===delta&&f.reason?.trim().length>=12&&f.finalized_at,'Wrong finalized row '+id)
 const m=moves.find(x=>x.id===id)
 assert(m&&m.variant_id===1532&&m.inventory_source==='warehouse'&&m.reference_type==='manual'&&m.quantity_delta===delta,'Original movement changed '+id)
}
assert(moves.find(x=>x.id===4876)?.quantity_after===1&&moves.find(x=>x.id===5400)?.quantity_after===0,'Quantity history changed')
assert.equal(validations.length,1)
assert.equal(validations[0].passed,1)
assert(validations[0].checked_at)
assert.equal(oldCheck.length,1)
assert(oldCheck[0].variant_id===1532&&oldCheck[0].inventory_source==='warehouse'&&oldCheck[0].expected_quantity===1&&oldCheck[0].counted_quantity===0&&oldCheck[0].difference_quantity===-1,'Count 3250 changed')
assert.equal(variants.length,2)
assert(variants.every(x=>x.product_id===75&&x.stock_position_id===146&&x.material==='ДРАП'&&x.size_label==='52'&&x.is_active===1),'Wrong SKU identity or unexpected archive')
assert(variants.find(x=>x.id===1532)?.color==='СВЕТЛО СЕРЫЙ'&&variants.find(x=>x.id===1280)?.color==='СВЕТЛО-СЕРЫЙ')
assert.equal(stock.length,3)
assert(stock.some(x=>x.id===1411&&x.variant_id===1532&&x.inventory_source==='warehouse'&&x.quantity===0&&x.reserved_quantity===0))
assert(stock.some(x=>x.id===1071&&x.variant_id===1280&&x.inventory_source==='warehouse'&&x.quantity===0&&x.reserved_quantity===0))
assert(stock.some(x=>x.id===1090&&x.variant_id===1280&&x.inventory_source==='boutique'&&x.quantity===0&&x.reserved_quantity===0))
assert.equal(reverted.length,0)
assert.equal(merged.length,0,'Pair already merged; audit premerge assumptions no longer true')
assert.equal(active.length,0)
assert.equal(otherMovements.length,0,'Additional source reversible movement')
assert.equal(integrity[0].orphan_stock,0)
assert.equal(integrity[0].reserve_mismatch,0)
console.log('ETHNO52_ADMIN_FINALIZATION_PRODUCTION_VERIFIED_SUCCESS')
