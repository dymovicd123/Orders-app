// One-off READ-ONLY production reference/catalog duplicate inventory.
// No credentials or customer/order-specific data are logged.
import {execFileSync} from 'node:child_process'
const db='orders_db_prod'
function read(sql) {
  if (!/^\s*SELECT\b/i.test(sql)) throw Error('READ-ONLY SELECT required')
  const raw=execFileSync('npx',['wrangler','d1','execute',db,'--remote','--config','wrangler.jsonc','--command='+sql,'--json'],
    {encoding:'utf8',maxBuffer:12*1024*1024,timeout:60000})
  const page=JSON.parse(raw)
  if (!Array.isArray(page)||!page[0]||!Array.isArray(page[0].results)||page[0].success!==true)
    throw Error('Unexpected production D1 query response')
  return page[0].results
}
function pages(query,max=12000) {
 const all=[];let cursor=0;let more=true
 while(more) {
  const result=read(query.replaceAll('__CURSOR__',String(cursor)).replaceAll('__LIMIT__','401'))
  if(result.some((r,i)=>!Number.isSafeInteger(r.id)||r.id<=(i===0?cursor:result[i-1].id)))throw Error('Unexpected cursor order')
  all.push(...result.slice(0,400))
  more=result.length>400
  if(more)cursor=result[399].id
  if(all.length>=max&&more)throw Error('Scan INCOMPLETE; refused to claim duplicates are exhausted')
 }
 return all
}
const upper=v=>String(v??'').trim().toLocaleUpperCase('ru-RU').replace(/\s+/g,' ')
const key=v=>upper(v).replace(/[‐‑‒–—-]+/g,' ').replace(/\s+/g,' ').trim()
const refs=pages("SELECT id,kind,value,is_active,updated_at FROM reference_values WHERE id>__CURSOR__ ORDER BY id LIMIT __LIMIT__")
const variants=pages(`SELECT v.id,v.product_id,v.stock_position_id,v.category,v.gender,v.color,v.size_label,v.material,v.length,v.is_active,p.name AS product_name,p.is_active AS product_active,
 COALESCE(SUM(s.quantity),0) AS physical,COALESCE(SUM(s.reserved_quantity),0) AS reserved
 FROM catalog_variants v JOIN catalog_products p ON p.id=v.product_id
 LEFT JOIN inventory_stock s ON s.variant_id=v.id
 WHERE v.id>__CURSOR__ GROUP BY v.id ORDER BY v.id LIMIT __LIMIT__`)
const products=pages("SELECT id,name,is_active FROM catalog_products WHERE id>__CURSOR__ ORDER BY id LIMIT __LIMIT__")
const groups=new Map()
for(const r of refs){const k=r.kind+'|'+key(r.value);const xs=groups.get(k)||[];xs.push(r);groups.set(k,xs)}
const duplicates=[...groups.entries()].filter(([k,x])=>x.filter(r=>r.is_active===1).length>1)
 .map(([k,x])=>({kind:x[0].kind,identity:k.split('|').slice(1).join('|'),
  values:x.map(r=>({id:r.id,value:r.value,active:r.is_active===1}))}))
const skuGroups=new Map()
for(const v of variants.filter(v=>v.is_active===1&&v.product_active===1)){
 const pos=v.stock_position_id==null?'legacy:'+key(v.material)+'/'+key(v.length):'position:'+v.stock_position_id
 const k=[v.product_id,pos,key(v.category||'adult'),key(v.gender),key(v.color),key(v.size_label)].join('|')
 const xs=skuGroups.get(k)||[];xs.push(v);skuGroups.set(k,xs)
}
const skuDupes=[...skuGroups.values()].filter(x=>x.length>1).map(x=>({
 productId:x[0].product_id,product:x[0].product_name,material:x[0].material,length:x[0].length,color:x[0].color,size:x[0].size_label,
 variants:x.map(v=>({id:v.id,physical:v.physical,reserved:v.reserved}))
}))
const productDupes=new Map()
for(const p of products.filter(x=>x.is_active===1)){let k=key(p.name);const xs=productDupes.get(k)||[];xs.push(p);productDupes.set(k,xs)}
const activeProductDupes=[...productDupes.values()].filter(xs=>xs.length>1)
 .map(xs=>xs.map(x=>({id:x.id,name:x.name})))
const categories=[...new Set(refs.map(r=>r.kind))].sort()
const activeCounts=categories.map(kind=>({kind,total:refs.filter(x=>x.kind===kind).length,
 active:refs.filter(x=>x.kind===kind&&x.is_active===1).length}))
const refCatalogueUsage=new Map()
for(const v of variants.filter(v=>v.is_active===1&&v.product_active===1)){
 for(const [kind,column] of [['color','color'],['material','material'],['length','length'],['size','size_label']]){
  const k=kind+'|'+key(v[column]);refCatalogueUsage.set(k,(refCatalogueUsage.get(k)||0)+1)
 }
}
const currentMonth=read(`SELECT 'city' AS kind, city AS val, COUNT(*) AS uses FROM orders
 WHERE order_status<>'deleted' AND order_date>='2026-10-01' AND order_date<'2026-11-01' GROUP BY city
 UNION ALL SELECT 'delivery_type',delivery_type,COUNT(*) FROM orders
 WHERE order_status<>'deleted' AND order_date>='2026-10-01' AND order_date<'2026-11-01' GROUP BY delivery_type
 UNION ALL SELECT 'payment_method',order_payment_method,COUNT(*) FROM orders
 WHERE order_status<>'deleted' AND order_date>='2026-10-01' AND order_date<'2026-11-01' GROUP BY order_payment_method`)
const liveUses=new Map()
for(const x of currentMonth){const k=x.kind+'|'+key(x.val);liveUses.set(k,(liveUses.get(k)||0)+x.uses)}
const values=refs.filter(r=>r.is_active===1).map(r=>({
 id:r.id,kind:r.kind,value:r.value,
 variantCount:refCatalogueUsage.get(r.kind+'|'+key(r.value))||0,
 currentOrderCount:liveUses.get(r.kind+'|'+key(r.value))||0
}))
const summary={
 scanned:{referenceValues:refs.length,variants:variants.length,products:products.length},
 byKind:activeCounts,
 equivalentReferenceDuplicateGroups:duplicates,
 skuDuplicateGroups:skuDupes,
 productExactDuplicateGroups:activeProductDupes,
 activeValues:values,
 incomplete:false
}
// Second-stage targeted **read-only** preflight: only those exact duplicate IDs.
const skuImpact=read(`SELECT v.id,v.product_id,v.stock_position_id,v.color,v.size_label,v.is_active,v.updated_at,
 (SELECT COALESCE(SUM(st.quantity),0) FROM inventory_stock st WHERE st.variant_id=v.id) AS physical,
 (SELECT COALESCE(SUM(st.reserved_quantity),0) FROM inventory_stock st WHERE st.variant_id=v.id) AS reserved,
 (SELECT COUNT(*) FROM inventory_reservations ir WHERE ir.variant_id=v.id AND ir.status='active') AS activeReservations,
 (SELECT COUNT(*) FROM order_items oi JOIN orders o ON o.id=oi.order_id
  WHERE oi.variant_id=v.id AND o.order_status='active' AND COALESCE(o.shipping_status,'not_sent')<>'sent' AND oi.quantity>0) AS openOrders,
 (SELECT COUNT(*) FROM order_items oi WHERE oi.variant_id=v.id) AS historicOrderItems,
 (SELECT COUNT(*) FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE oi.variant_id=v.id AND oi.quantity>0
   AND o.order_status='active' AND COALESCE(o.shipping_status,'not_sent')<>'sent'
   AND (o.order_date<'2026-10-01' OR o.order_date>='2026-11-01')) AS outsideMonthActiveOrders,
 (SELECT COUNT(*) FROM inventory_lifecycle_events le WHERE le.variant_id=v.id AND le.status IN ('applied','pending')) AS pendingOrAppliedLifecycle,
 (SELECT COUNT(*) FROM inventory_transfer_items ti JOIN inventory_transfer_documents td ON td.id=ti.transfer_id WHERE ti.variant_id=v.id AND td.status='applied') AS appliedTransfers,
 (SELECT COUNT(*) FROM inventory_movements im WHERE im.variant_id=v.id AND LOWER(TRIM(COALESCE(im.reference_type,''))) IN ('manual','transfer_in','transfer_out')
   AND NOT EXISTS (SELECT 1 FROM inventory_movement_reversals rev WHERE rev.original_movement_id=im.id)) AS reversibleMovements,
 (SELECT COUNT(*) FROM order_items oi WHERE oi.variant_id=v.id AND
  (EXISTS(SELECT 1 FROM return_items ri WHERE ri.order_item_id=oi.id)
  OR EXISTS(SELECT 1 FROM exchanges e WHERE e.old_order_item_id=oi.id OR e.new_order_item_id=oi.id)
  OR EXISTS(SELECT 1 FROM exchange_items ei WHERE ei.order_item_id=oi.id))) AS linkedReturnsOrExchanges,
 (SELECT COUNT(*) FROM workshop_tasks wt WHERE wt.variant_id=v.id AND wt.status='active') AS activeWorkshop
 FROM catalog_variants v WHERE v.id IN (1280,1281,1532,1533) ORDER BY v.id`)
const skuStocks=read("SELECT id,variant_id,inventory_source,quantity,reserved_quantity,updated_at FROM inventory_stock WHERE variant_id IN (1280,1281,1532,1533) ORDER BY variant_id,inventory_source")
const colorUsage=read(`SELECT v.color,COUNT(*) AS activeVariants,
 (SELECT COUNT(*) FROM inventory_stock st JOIN catalog_variants cv ON cv.id=st.variant_id WHERE cv.color=v.color AND (st.quantity<>0 OR st.reserved_quantity<>0)) AS nonzeroStockPositions
 FROM catalog_variants v WHERE v.is_active=1 AND (v.color='СВЕТЛО СЕРЫЙ' OR v.color='СВЕТЛО-СЕРЫЙ') GROUP BY v.color`)
const paymentImpact=read(`SELECT 'orders' AS kind,COUNT(*) AS count,0 AS amount,
  0 AS outside_month_financial FROM orders o
  WHERE o.order_date>='2026-10-01' AND o.order_date<'2026-11-01'
    AND o.order_status<>'deleted' AND o.order_payment_method='ТЕРМИНАЛ'
 UNION ALL SELECT 'payments',COUNT(*),COALESCE(SUM(p.amount),0),
   COALESCE(SUM(CASE WHEN p.payment_date<'2026-10-01' OR p.payment_date IS NULL THEN 1 ELSE 0 END),0)
 FROM payments p JOIN orders o ON o.id=p.order_id
 WHERE o.order_date>='2026-10-01' AND o.order_date<'2026-11-01'
   AND o.order_status<>'deleted' AND p.method='ТЕРМИНАЛ'
 UNION ALL SELECT 'financial_events',COUNT(*),COALESCE(SUM(fe.amount_delta),0),
   COALESCE(SUM(CASE WHEN fe.event_date<'2026-10-01' OR fe.event_date IS NULL THEN 1 ELSE 0 END),0)
 FROM financial_events fe JOIN orders o ON o.id=fe.order_id
 WHERE o.order_date>='2026-10-01' AND o.order_date<'2026-11-01'
   AND o.order_status<>'deleted' AND fe.payment_method='ТЕРМИНАЛ'
 UNION ALL SELECT 'returns',COUNT(*),COALESCE(SUM(rt.amount),0),
   COALESCE(SUM(CASE WHEN rt.return_date<'2026-10-01' OR rt.return_date IS NULL THEN 1 ELSE 0 END),0)
 FROM returns rt JOIN orders o ON o.id=rt.order_id
 WHERE o.order_date>='2026-10-01' AND o.order_date<'2026-11-01'
   AND o.order_status<>'deleted' AND rt.payment_method='ТЕРМИНАЛ'
 UNION ALL SELECT 'exchanges',COUNT(*),COALESCE(SUM(ex.financial_amount),0),
   COALESCE(SUM(CASE WHEN ex.exchange_date<'2026-10-01' OR ex.exchange_date IS NULL THEN 1 ELSE 0 END),0)
 FROM exchanges ex JOIN orders o ON o.id=ex.order_id
 WHERE o.order_date>='2026-10-01' AND o.order_date<'2026-11-01'
   AND o.order_status<>'deleted' AND ex.payment_method='ТЕРМИНАЛ'`)
const paymentGuards=read(`SELECT
 (SELECT COUNT(*) FROM cash_register_entries c JOIN orders o ON o.id=c.order_id
 WHERE o.order_date>='2026-10-01' AND o.order_date<'2026-11-01'
 AND o.order_status<>'deleted' AND c.payment_method='ТЕРМИНАЛ') AS cashClassifications,
 (SELECT COUNT(*) FROM reference_payment_method_merges WHERE source_reference_id=532) AS priorMerges,
 (SELECT COUNT(*) FROM reference_values WHERE id=532 AND kind='payment_method' AND is_active=1 AND value='ТЕРМИНАЛ') AS sourceLive,
 (SELECT COUNT(*) FROM reference_values WHERE id=534 AND kind='payment_method' AND is_active=1 AND value='KASPI PAY') AS keeperLive`)
console.log('REF_IMPACT_JSON='+JSON.stringify({skuImpact,skuStocks,colorUsage,paymentImpact,paymentGuards}))

// Restore the full 14 Oct report: inactive/active characteristics and their real SKU identities.
const canonical = new Map([['СВЕТЛО СЕРЫЙ','СВЕТЛО-СЕРЫЙ'],['ТЕМНО СИНИЙ','ТЕМНО-СИНИЙ']])
const candidates = variants.filter(v => v.is_active===1 && canonical.has(upper(v.color)))
const skuIdentity = v => [v.product_id, v.stock_position_id??('legacy:'+key(v.material)+'/'+key(v.length)), upper(v.category||'adult'), upper(v.gender), key(v.color), upper(v.size_label)].join('|')
const candidatesWithCollisions = candidates.map(v => ({id:v.id,productId:v.product_id,product:v.product_name,color:v.color,canonical:canonical.get(upper(v.color)),size:v.size_label,material:v.material,length:v.length,stockPositionId:v.stock_position_id,physical:v.physical,reserved:v.reserved,otherSameIdentity:variants.filter(t=>t.is_active===1 && t.id!==v.id && skuIdentity(t)===skuIdentity(v)).map(t=>({id:t.id,color:t.color,physical:t.physical,reserved:t.reserved}))}))
const colorCounts = [...new Set(variants.filter(v=>v.is_active===1).map(v=>v.color))].map(color=>({color,variants:variants.filter(v=>v.is_active===1&&v.color===color).length})).sort((a,b)=>a.color.localeCompare(b.color))
const special1718 = variants.find(v=>v.id===1718)||null
console.log('CHARACTERISTIC_REPORT_JSON='+JSON.stringify({candidates:candidatesWithCollisions,colorCounts,special1718,summary:{count:candidatesWithCollisions.length,physical:candidatesWithCollisions.reduce((a,v)=>a+Number(v.physical||0),0),reserved:candidatesWithCollisions.reduce((a,v)=>a+Number(v.reserved||0),0),collisions:candidatesWithCollisions.filter(v=>v.otherSameIdentity.length>0).length}}))
console.log('REF_AUDIT_JSON='+JSON.stringify(summary))
console.log('READ ONLY. No updates, deletions, merges or catalog changes.')
