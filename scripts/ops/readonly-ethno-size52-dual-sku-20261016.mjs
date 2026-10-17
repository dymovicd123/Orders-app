// Production D1 forensic audit for the remaining size-52 semantic duplicate pair.
// STRICT SELECT only. Logs no customer name, phone, payment or other PII.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
assert.equal(process.env.GITHUB_EVENT_NAME,'pull_request');
assert.equal(process.env.GITHUB_BASE_REF,'main');
const cfg=process.env.PROD_READONLY_CONFIG;
assert(cfg && fs.readFileSync(cfg,'utf8').includes('"database_id": "17e68a41-1d58-4a36-8a63-47c3e32443c4"'));
const read=(sql)=>{
 assert(/^SELECT\s/i.test(sql)&&!sql.includes(';'),'No SQL mutations in this workflow');
 const result=JSON.parse(execFileSync('npx',['wrangler','d1','execute','orders_db_prod','--remote','--config',cfg,'--command='+sql,'--json'],{encoding:'utf8',timeout:90000,maxBuffer:18*1024*1024}));
 assert(result.length===1 && result[0].success===true && Array.isArray(result[0].results),'Failed D1 SELECT');
 return result[0].results;
};
const ids=[1280,1532], list=ids.join(',');
const catalog=read('SELECT id,product_id,stock_position_id,category,gender,color,material,length,size_label,is_active,created_at,updated_at FROM catalog_variants WHERE id IN ('+list+') ORDER BY id');
assert.equal(catalog.length,2,'Missing canonical or duplicate SKU');
const stock=read('SELECT id,variant_id,inventory_source,quantity,reserved_quantity,updated_at,last_action,last_source_ref FROM inventory_stock WHERE variant_id IN ('+list+') ORDER BY variant_id,inventory_source');
const reservations=read("SELECT id,variant_id,inventory_source,quantity,status,updated_at FROM inventory_reservations WHERE variant_id IN ("+list+") AND status='active' ORDER BY id");
const stockIssues=[];
for(const row of stock){
 const active=reservations.filter(r=>r.variant_id===row.variant_id&&r.inventory_source===row.inventory_source).reduce((a,b)=>a+b.quantity,0);
 if(active!==row.reserved_quantity)stockIssues.push({variantId:row.variant_id,source:row.inventory_source,stockReserved:row.reserved_quantity,actualActive:active});
}
const movements=read('SELECT m.id,m.variant_id,m.inventory_source,m.movement_type,m.quantity_delta,m.quantity_after,m.reference_type,m.created_at,CASE WHEN rv.original_movement_id IS NULL THEN 0 ELSE 1 END AS is_reversed FROM inventory_movements m LEFT JOIN inventory_movement_reversals rv ON rv.original_movement_id=m.id WHERE m.variant_id IN ('+list+') ORDER BY m.created_at,m.id');
const eligible=movements.filter(x=>['manual','transfer_in','transfer_out'].includes(String(x.reference_type||'').trim().toLowerCase())&&x.is_reversed===0);
const arrivalOperation4876=read('SELECT m.id,m.variant_id,m.quantity_delta,m.inventory_source,m.reference_type,m.created_at FROM inventory_movements m WHERE m.reference_id=(SELECT reference_id FROM inventory_movements WHERE id=4876) AND m.created_at=(SELECT created_at FROM inventory_movements WHERE id=4876) ORDER BY m.id');
const checks=read('SELECT id,variant_id,inventory_source,check_type,reference_type,expected_quantity,counted_quantity,difference_quantity,created_at FROM inventory_stock_checks WHERE variant_id IN ('+list+') ORDER BY created_at,id');
const stocktake=read('SELECT i.id,i.variant_id,i.inventory_source,i.status AS item_status,i.stock_id,s.status AS session_status,s.id AS session_id,s.started_at,s.completed_at,s.cancelled_at FROM inventory_stocktake_items i JOIN inventory_stocktake_sessions s ON s.id=i.session_id WHERE i.variant_id IN ('+list+') ORDER BY i.created_at,i.id');
const transfers=read('SELECT i.id,i.variant_id,i.quantity,d.id AS transfer_id,d.status,d.created_at FROM inventory_transfer_items i JOIN inventory_transfer_documents d ON d.id=i.transfer_id WHERE i.variant_id IN ('+list+') ORDER BY i.id');
const lifecycle=read('SELECT id,variant_id,event_type,inventory_source,quantity,status,movement_id,created_at,updated_at FROM inventory_lifecycle_events WHERE variant_id IN ('+list+') ORDER BY id');
const orders=read('SELECT oi.id AS order_item_id,oi.variant_id,oi.quantity,oi.stock_writeoff_status,o.id AS order_id,o.order_status,o.shipping_status,o.order_date,CASE WHEN EXISTS (SELECT 1 FROM return_items ri WHERE ri.order_item_id=oi.id) THEN 1 ELSE 0 END AS linked_return,CASE WHEN EXISTS(SELECT 1 FROM exchanges e WHERE e.old_order_item_id=oi.id OR e.new_order_item_id=oi.id) THEN 1 ELSE 0 END AS linked_exchange,CASE WHEN EXISTS (SELECT 1 FROM exchange_items ei WHERE ei.order_item_id=oi.id) THEN 1 ELSE 0 END AS linked_exchange_items FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE oi.variant_id IN ('+list+') ORDER BY oi.id');
const activeWork=read("SELECT id,variant_id,status FROM workshop_tasks WHERE variant_id IN ("+list+") AND status='active' ORDER BY id");
const mergeReceipts=read('SELECT id,source_variant_id,target_variant_id,created_at,source_physical_quantity,source_reserved_quantity FROM catalog_variant_consolidations WHERE source_variant_id IN ('+list+') OR target_variant_id IN ('+list+') ORDER BY id');
const retired=read('SELECT source_variant_id,keeper_variant_id,status FROM catalog_semantic_variant_corrections WHERE source_variant_id IN ('+list+') OR keeper_variant_id IN ('+list+') ORDER BY source_variant_id');
const related=read("SELECT id,color,size_label,is_active,product_id,stock_position_id FROM catalog_variants WHERE product_id=75 AND stock_position_id=146 AND size_label='52' ORDER BY id");
const last52=read('SELECT id,source_variant_id,target_variant_id FROM catalog_variant_consolidations WHERE source_variant_id=1533 ORDER BY id');
const activeStocktake=stocktake.filter(x=>x.session_status==='active');
const byId=(id)=>({
 id,variant:catalog.find(x=>x.id===id),
 stock:stock.filter(x=>x.variant_id===id),
 activeReserves:reservations.filter(x=>x.variant_id===id),
 movements:movements.filter(x=>x.variant_id===id),
 reversible:eligible.filter(x=>x.variant_id===id),
 checks:checks.filter(x=>x.variant_id===id),
 stocktakes:stocktake.filter(x=>x.variant_id===id),
 transfers:transfers.filter(x=>x.variant_id===id),
 lifecycle:lifecycle.filter(x=>x.variant_id===id),
 orders:orders.filter(x=>x.variant_id===id),
 activeWorkshop:activeWork.filter(x=>x.variant_id===id)
});
const source=byId(1532),keeper=byId(1280);
const sourceFlags={
 positivePhysical:source.stock.some(x=>x.quantity>0),
 reversibleMovements:source.reversible.length,
 appliedTransfers:source.transfers.filter(x=>x.status==='applied').length,
 pendingOrAppliedLifecycle:source.lifecycle.filter(x=>['pending','applied'].includes(x.status)).length,
 returnExchangeLinks:source.orders.filter(x=>x.linked_return||x.linked_exchange||x.linked_exchange_items).length,
 openOrders:source.orders.filter(x=>x.order_status==='active'&&x.shipping_status!=='sent').length,
 activeStocktakes:activeStocktake.filter(x=>x.variant_id===1532).length
};
const inverseFlags={
 positivePhysical:keeper.stock.some(x=>x.quantity>0),
 reversibleMovements:keeper.reversible.length,
 appliedTransfers:keeper.transfers.filter(x=>x.status==='applied').length,
 pendingOrAppliedLifecycle:keeper.lifecycle.filter(x=>['pending','applied'].includes(x.status)).length,
 returnExchangeLinks:keeper.orders.filter(x=>x.linked_return||x.linked_exchange||x.linked_exchange_items).length,
 openOrders:keeper.orders.filter(x=>x.order_status==='active'&&x.shipping_status!=='sent').length,
 activeStocktakes:activeStocktake.filter(x=>x.variant_id===1280).length
};
const proof={
 targetProduct:'ЭТНО КАРДИГАН/ДРАП/ЖЕН/52',
 currentCatalog:catalog,source1532:source,keeper1280:keeper,arrivalOperation4876,
 targetPairCurrentReasons:sourceFlags,reverseDirectionReasons:inverseFlags,
 reconciliation:stock.map(s=>({id:s.id,variantId:s.variant_id,location:s.inventory_source,qty:s.quantity,reserved:s.reserved_quantity,updatedAt:s.updated_at})),
 stockIssues,otherSize52Variants:related,consolidations:mergeReceipts,semanticCorrections:retired,
 priorSize54Merge:last52.length===1?last52[0]:null,
 globalIntegrity:read("SELECT (SELECT COUNT(*) FROM inventory_stock s LEFT JOIN catalog_variants v ON s.variant_id=v.id WHERE s.variant_id IS NOT NULL AND v.id IS NULL) orphanStock,(SELECT COUNT(*) FROM inventory_stock s WHERE s.reserved_quantity<>COALESCE((SELECT SUM(r.quantity) FROM inventory_reservations r WHERE r.variant_id=s.variant_id AND r.inventory_source=s.inventory_source AND r.status='active'),0)) stockReserveMismatch")[0],
 totalRefs:{movements:movements.length,openSourceReservations:reservations.filter(x=>x.variant_id===1532).length,sourceOrders:source.orders.length,keeperOrders:keeper.orders.length},
 productionWrites:0
};
console.log('ETHNO_SIZE52_FORENSIC_JSON='+JSON.stringify(proof));
const current=read("SELECT s.variant_id,s.inventory_source,s.quantity,s.reserved_quantity,s.updated_at FROM inventory_stock s WHERE s.variant_id IN (1280,1532) ORDER BY s.variant_id,s.inventory_source");
const arrival=read("SELECT m.id,m.variant_id,m.quantity_delta,m.quantity_after,m.created_at,rv.reversal_movement_id,rv.reversed_at FROM inventory_movements m LEFT JOIN inventory_movement_reversals rv ON rv.original_movement_id=m.id WHERE m.id=4876");
const postArrival=read("SELECT m.id,m.variant_id,m.inventory_source,m.quantity_delta,m.reference_type,m.created_at FROM inventory_movements m WHERE m.variant_id IN (1280,1532) AND m.created_at > '2026-10-13T10:34:52.190Z' ORDER BY m.created_at,m.id LIMIT 50");
console.log('ETHNO_SIZE52_FRESH_STATUS='+JSON.stringify({current,arrival,postArrival,activeSourceReserves:reservations.filter(r=>r.variant_id===1532).length,readOnly:true}));

// User-confirmed physical count=0: independent post-adjustment live verification.
// Checks official 'manual_set' with linked stock check; original arrival stays historical.
const pairStockNow=read("SELECT id,variant_id,inventory_source,quantity,reserved_quantity FROM inventory_stock WHERE variant_id IN (1280,1532) ORDER BY variant_id,inventory_source");
const currentSource=pairStockNow.find(x=>x.variant_id===1532&&x.inventory_source==='warehouse');
const currentKeeper=pairStockNow.filter(x=>x.variant_id===1280);
const recentSourceMovements=read("SELECT id,variant_id,inventory_source,movement_type,quantity_delta,quantity_after,reference_type,reference_id,created_at,CASE WHEN comment IS NOT NULL AND TRIM(comment)<>'' THEN 1 ELSE 0 END AS has_comment FROM inventory_movements WHERE variant_id=1532 AND created_at >= '2026-10-13T10:34:52' ORDER BY created_at,id");
const manualSets=recentSourceMovements.filter(x=>x.movement_type==='manual_set'&&x.reference_type==='manual');
const correction=manualSets.at(-1);
const associatedChecks=correction ? read("SELECT id,variant_id,inventory_source,expected_quantity,counted_quantity,difference_quantity,check_type,reference_type,reference_id,checked_at FROM inventory_stock_checks WHERE variant_id=1532 AND reference_type='manual' AND reference_id='"+correction.reference_id+"' ORDER BY id") : [];
const initialArrival=read("SELECT m.id,m.variant_id,m.quantity_delta,m.quantity_after,m.reference_type,m.created_at,rev.reversal_movement_id FROM inventory_movements m LEFT JOIN inventory_movement_reversals rev ON rev.original_movement_id=m.id WHERE m.id=4876");
const protectedVariants=read("SELECT id,color,is_active FROM catalog_variants WHERE id IN (1280,1532,1281,1533) ORDER BY id");
const mergerReceipts=read("SELECT id,source_variant_id,target_variant_id FROM catalog_variant_consolidations WHERE source_variant_id IN (1532,1533) ORDER BY id");
const outstandingReserves=read("SELECT id,variant_id,quantity FROM inventory_reservations WHERE status='active' AND variant_id IN (1280,1532)");
const orphaned=read("SELECT COUNT(*) AS n FROM inventory_stock s LEFT JOIN catalog_variants v ON v.id=s.variant_id WHERE s.variant_id IS NOT NULL AND v.id IS NULL")[0].n;
const reserveDrift=read("SELECT COUNT(*) AS n FROM inventory_stock s WHERE s.reserved_quantity<>COALESCE((SELECT SUM(r.quantity) FROM inventory_reservations r WHERE r.variant_id=s.variant_id AND r.inventory_source=s.inventory_source AND r.status='active'),0)")[0].n;
const verified={
 stock:pairStockNow,
 correction:correction||null,
 stockChecks:associatedChecks,
 arrival:initialArrival,
 protectedVariants,mergerReceipts,
 activeReserves:outstandingReserves.length,
 orphaned,reserveDrift,
 noWrites:true
};
console.log('ETHNO_SIZE52_POST_CORRECTION_JSON='+JSON.stringify(verified));
assert(currentSource&&currentSource.id===1411&&currentSource.quantity===0&&currentSource.reserved_quantity===0,'Source 1532 warehouse must be 0 after correction');
assert(currentKeeper.length===2&&currentKeeper.every(x=>x.quantity===0&&x.reserved_quantity===0),'Keeper 1280 stock not preserved');
assert.equal(manualSets.length,1,'Expected one official manual correction on source since Oct13');
assert(correction&&correction.quantity_delta===-1&&correction.quantity_after===0&&correction.inventory_source==='warehouse'&&correction.has_comment===1,'Correction movement not as expected');
assert(associatedChecks.length===1&&associatedChecks[0].check_type==='manual_set'&&associatedChecks[0].expected_quantity===1&&associatedChecks[0].counted_quantity===0&&associatedChecks[0].difference_quantity===-1,'Stock check receipt missing or wrong');
assert(initialArrival.length===1&&initialArrival[0].variant_id===1532&&initialArrival[0].quantity_delta===1&&initialArrival[0].reversal_movement_id==null,'Original arrival 4876 changed or was reversed');
assert(protectedVariants.find(x=>x.id===1532)?.is_active===1&&protectedVariants.find(x=>x.id===1280)?.is_active===1,'Size 52 was unexpectedly merged');
assert(mergerReceipts.some(x=>x.source_variant_id===1533&&x.target_variant_id===1281),'Previous size54 merge missing');
assert(!mergerReceipts.some(x=>x.source_variant_id===1532),'Size52 should not be merged without separate preview');
assert(outstandingReserves.length===0&&orphaned===0&&reserveDrift===0,'Stock/reservation consistency check failed');
console.log('ETHNO_SIZE52_CORRECTION_VERIFIED_SUCCESS');

console.log('ETHNO_SIZE52_READ_ONLY_SUCCESS');
