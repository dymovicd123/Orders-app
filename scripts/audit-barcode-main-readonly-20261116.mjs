import { execFileSync } from 'node:child_process'

const run = sql => {
  if (!/^\s*SELECT\b/i.test(sql) || /;|\b(INSERT|UPDATE|DELETE|REPLACE|ALTER|DROP|CREATE|ATTACH|DETACH|PRAGMA|VACUUM)\b/i.test(sql))
    throw new Error('Non-read-only SQL rejected')
  const raw=execFileSync('npx',['--no-install','wrangler','d1','execute','orders_db_prod','--config','wrangler.jsonc','--remote','--json','--command',sql],{encoding:'utf8',maxBuffer:32*1024*1024,timeout:120000})
  const data=JSON.parse(raw)
  if(!Array.isArray(data)||data.some(x=>x.success!==true))throw new Error('D1 query failed')
  return data.flatMap(x=>x.results||[])
}
const variants=run("SELECT v.id,v.product_id,v.stock_position_id,v.category,v.gender,v.color,v.material,v.length,v.size_label,p.is_active AS product_active FROM catalog_variants v LEFT JOIN catalog_products p ON p.id=v.product_id WHERE v.is_active=1")
const stocks=run("SELECT s.id AS stock_id,s.inventory_source,s.product_id,s.variant_id,s.quantity,s.reserved_quantity,v.is_active AS sku_active,v.product_id AS catalog_product_id,p.is_active AS product_active FROM inventory_stock s LEFT JOIN catalog_variants v ON v.id=s.variant_id LEFT JOIN catalog_products p ON p.id=v.product_id")
const reservations=run("SELECT r.id,r.order_item_id,r.inventory_source,r.variant_id,r.quantity,r.status,oi.id AS matched_item_id,oi.variant_id AS item_variant_id,oi.source_type AS item_source,oi.quantity AS item_quantity,oi.stock_writeoff_status,o.id AS matched_order_id,o.order_status,o.shipping_status FROM inventory_reservations r LEFT JOIN order_items oi ON oi.id=r.order_item_id LEFT JOIN orders o ON o.id=r.order_id WHERE r.status IN ('active','unresolved')")
const pending=run("SELECT id,inventory_source,variant_id,direction,is_workshop,status,pending_reason FROM inventory_lifecycle_events WHERE status='pending'")
const stocktakes=run("SELECT id,inventory_source,status,started_at FROM inventory_stocktake_sessions WHERE status='active'")
const num=x=>Number(x||0)
const norm=x=>String(x??'').normalize('NFKC').trim().toLocaleUpperCase('ru-RU').replace(/\s+/g,' ')
const gender=x=>{const v=norm(x);return ['М','МУЖ','МУЖСКОЙ','МУЖЧИНА'].includes(v)?'МУЖ':['Ж','ЖЕН','ЖЕНСКИЙ','ЖЕНЩИНА'].includes(v)?'ЖЕН':v}
const size=x=>{const v=norm(x);return ['','БЕЗ РАЗМЕРА','БЕЗРАЗМЕРА','Б/Р'].includes(v)?'':v}
const key=(v,semantic)=>[num(v.product_id),norm(v.category)||'ADULT',semantic?gender(v.gender):norm(v.gender),norm(v.color),norm(v.material)||'СТАНДАРТ',norm(v.length)||'СТАНДАРТ',semantic?size(v.size_label):norm(v.size_label)].join('|')
const duplicates=semantic=>{
  const groups=new Map()
  for(const v of variants){const k=key(v,semantic),arr=groups.get(k)||[];arr.push(num(v.id));groups.set(k,arr)}
  return [...groups.values()].filter(ids=>ids.length>1).map(ids=>ids.sort((a,b)=>a-b))
}
const exactDuplicates=duplicates(false),semanticDuplicates=duplicates(true)
const stockGroups=new Map(),stockByKey=new Map(),unidentified=[],invalidStock=[]
for(const s of stocks){
  const k=s.inventory_source+':'+num(s.variant_id)
  if(num(s.variant_id)>0){const arr=stockGroups.get(k)||[];arr.push(num(s.stock_id));stockGroups.set(k,arr);stockByKey.set(k,s)}
  if(num(s.quantity)<0||num(s.reserved_quantity)<0||!['warehouse','boutique'].includes(s.inventory_source))
    invalidStock.push({stockId:num(s.stock_id),source:s.inventory_source,sku:num(s.variant_id),physical:num(s.quantity),reserved:num(s.reserved_quantity)})
  if((num(s.quantity)>0||num(s.reserved_quantity)>0)&&(!num(s.variant_id)||num(s.sku_active)!==1||num(s.product_active)!==1||num(s.catalog_product_id)!==num(s.product_id)))
    unidentified.push({stockId:num(s.stock_id),source:s.inventory_source,sku:num(s.variant_id),physical:num(s.quantity),reserved:num(s.reserved_quantity),reason:!num(s.variant_id)?'unidentified':num(s.sku_active)!==1?'inactive_or_missing_sku':num(s.product_active)!==1?'inactive_product':'product_mismatch'})
}
const stockDuplicates=[...stockGroups.entries()].filter(([k,ids])=>ids.length>1).map(([key,stockIds])=>({key,stockIds}))
const active=reservations.filter(r=>r.status==='active')
const sums=new Map(),reservationIssues=[]
for(const r of active){
  const k=r.inventory_source+':'+num(r.variant_id);sums.set(k,(sums.get(k)||0)+num(r.quantity))
  if(!r.matched_item_id||!r.matched_order_id||num(r.item_variant_id)!==num(r.variant_id)||r.item_source!==r.inventory_source||['archived','deleted'].includes(String(r.order_status).toLowerCase())||r.shipping_status==='sent')
    reservationIssues.push({id:num(r.id),source:r.inventory_source,sku:num(r.variant_id),reason:!r.matched_item_id||!r.matched_order_id?'orphan':num(r.item_variant_id)!==num(r.variant_id)?'sku_mismatch':r.item_source!==r.inventory_source?'source_mismatch':'closed_or_sent'})
}
const cachedDrift=stocks.filter(s=>num(s.variant_id)>0 && num(s.reserved_quantity)!==(sums.get(s.inventory_source+':'+num(s.variant_id))||0)).map(s=>({stockId:num(s.stock_id),source:s.inventory_source,sku:num(s.variant_id),cached:num(s.reserved_quantity),active:sums.get(s.inventory_source+':'+num(s.variant_id))||0}))
const missingStock=[...sums.entries()].filter(([k])=>!stockByKey.has(k)).map(([key,qty])=>({key,reserved:qty}))
const short=stocks.filter(s=>num(s.reserved_quantity)>num(s.quantity)).map(s=>({stockId:num(s.stock_id),source:s.inventory_source,sku:num(s.variant_id),physical:num(s.quantity),reserved:num(s.reserved_quantity),deficit:num(s.reserved_quantity)-num(s.quantity)})).sort((a,b)=>b.deficit-a.deficit)
const output={
  checkpoint:'2026-11-16',environment:'main',mode:'SELECT-ONLY',
  counts:{activeSku:variants.length,stockRows:stocks.length,activeReservations:active.length,unresolvedReservations:reservations.length-active.length,pendingLifecycle:pending.length,activeStocktakes:stocktakes.length},
  duplicateExactSku:{count:exactDuplicates.length,samples:exactDuplicates.slice(0,20)},
  duplicateSemanticSku:{count:semanticDuplicates.length,samples:semanticDuplicates.slice(0,20)},
  duplicateSourceVariantStock:{count:stockDuplicates.length,samples:stockDuplicates.slice(0,20)},
  invalidStock:{count:invalidStock.length,samples:invalidStock.slice(0,20)},
  unidentifiedOrInactiveStock:{count:unidentified.length,samples:unidentified.slice(0,25)},
  reservationCachedMismatch:{count:cachedDrift.length,samples:cachedDrift.slice(0,25)},
  missingStockForReservations:{count:missingStock.length,samples:missingStock.slice(0,25)},
  reservationIdentityIssues:{count:reservationIssues.length,samples:reservationIssues.slice(0,25)},
  physicalBelowReserved:{count:short.length,units:short.reduce((s,v)=>s+v.deficit,0),samples:short.slice(0,30)},
  pendingLifecycle:{count:pending.length,samples:pending.slice(0,20).map(r=>({id:num(r.id),source:r.inventory_source,sku:num(r.variant_id),direction:r.direction,workshop:num(r.is_workshop)}))},
  activeStocktakes:stocktakes.map(r=>({id:r.id,source:r.inventory_source}))
}
console.log('BARCODE_MAIN_READONLY_AUDIT_JSON '+JSON.stringify(output))
console.log('BARCODE_MAIN_D1_SELECT_ONLY_NO_WRITES_PASS')
