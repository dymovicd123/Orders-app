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
console.log('REF_AUDIT_JSON='+JSON.stringify(summary))
console.log('READ ONLY. No updates, deletions, merges or catalog changes.')
