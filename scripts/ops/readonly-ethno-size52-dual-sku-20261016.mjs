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
const checks=read('SELECT id,variant_id,inventory_source,check_type,reference_type,expected_quantity,counted_quantity,difference_quantity,created_at FROM inventory_stock_checks WHERE variant_id IN ('+list+') ORDER BY created_at,id');
const stocktake=read('SELECT i.id,i.variant_id,i.inventory_source,i.status AS item_status,i.stock_id,s.status AS session_status,s.id AS session_id,s.started_at,s.completed_at,s.cancelled_at FROM inventory_stocktake_items i JOIN inventory_stocktake_sessions s ON s.id=i.session_id WHERE i.variant_id IN ('+list+') ORDER BY i.created_at,i.id');
const transfers=read('SELECT i.id,i.variant_id,i.quantity,d.id AS transfer_id,d.status,d.created_at FROM inventory_transfer_items i JOIN inventory_transfer_documents d ON d.id=i.transfer_id WHERE i.variant_id IN ('+list+') ORDER BY i.id');
const lifecycle=read('SELECT id,variant_id,event_type,inventory_source,quantity,status,movement_id,created_at,updated_at FROM inventory_lifecycle_events WHERE variant_id IN ('+list+') ORDER BY id');
const orders=read('SELECT oi.id AS order_item_id,oi.variant_id,oi.quantity,oi.stock_writeoff_status,o.id AS order_id,o.order_status,o.shipping_status,o.order_date,CASE WHEN EXISTS (SELECT 1 FROM return_items ri WHERE ri.order_item_id=oi.id) THEN 1 ELSE 0 END AS linked_return,CASE WHEN EXISTS(SELECT 1 FROM exchanges e WHERE e.old_order_item_id=oi.id OR e.new_order_item_id=oi.id) THEN 1 ELSE 0 END AS linked_exchange,CASE WHEN EXISTS (SELECT 1 FROM exchange_items ei WHERE ei.order_item_id=oi.id) THEN 1 ELSE 0 END AS linked_exchange_items FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE oi.variant_id IN ('+list+') ORDER BY oi.id');
const activeWork=read("SELECT id,variant_id,status FROM workshop_tasks WHERE variant_id IN ("+list+") AND status='active' ORDER BY id");
const mergeReceipts=read('SELECT id,source_variant_id,target_variant_id,created_at,source_physical_quantity,source_reserved_quantity FROM catalog_variant_consolidations WHERE source_variant_id IN ('+list+') OR target_variant_id IN ('+list+') ORDER BY id');
const retired=read('SELECT id,source_variant_id,keeper_variant_id,status FROM catalog_semantic_variant_corrections WHERE source_variant_id IN ('+list+') OR keeper_variant_id IN ('+list+') ORDER BY id');
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
 currentCatalog:catalog,source1532:source,keeper1280:keeper,
 targetPairCurrentReasons:sourceFlags,reverseDirectionReasons:inverseFlags,
 reconciliation:stock.map(s=>({id:s.id,variantId:s.variant_id,location:s.inventory_source,qty:s.quantity,reserved:s.reserved_quantity,updatedAt:s.updated_at})),
 stockIssues,otherSize52Variants:related,consolidations:mergeReceipts,semanticCorrections:retired,
 priorSize54Merge:last52.length===1?last52[0]:null,
 globalIntegrity:read("SELECT (SELECT COUNT(*) FROM inventory_stock s LEFT JOIN catalog_variants v ON s.variant_id=v.id WHERE s.variant_id IS NOT NULL AND v.id IS NULL) orphanStock,(SELECT COUNT(*) FROM inventory_stock s WHERE s.reserved_quantity<>COALESCE((SELECT SUM(r.quantity) FROM inventory_reservations r WHERE r.variant_id=s.variant_id AND r.inventory_source=s.inventory_source AND r.status='active'),0)) stockReserveMismatch")[0],
 totalRefs:{movements:movements.length,openSourceReservations:reservations.filter(x=>x.variant_id===1532).length,sourceOrders:source.orders.length,keeperOrders:keeper.orders.length},
 productionWrites:0
};
console.log('ETHNO_SIZE52_FORENSIC_JSON='+JSON.stringify(proof));
console.log('ETHNO_SIZE52_READ_ONLY_SUCCESS');
