// Strict Branch2-only SELECT audit of stock, reservations and SKU identity.
// No SQL mutations, no customer details or sensitive rows in logs.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const cfg=JSON.parse(readFileSync('wrangler.jsonc','utf8').replace(/\/\*[\s\S]*?\*\//g,''))
const db=cfg.d1_databases?.filter(x=>x.binding==='DB')||[]
assert.equal(cfg.name,'orders-app-branch2')
assert.equal(db.length,1)
const id='0904a573-21ff-44d8-93b0-c9200f771702'
assert.equal(db[0].database_id,id)
assert.equal(db[0].database_name,'orders_db_branch2_mirror_20261027')
assert.equal(process.env.GITHUB_REF,'refs/heads/audit/branch2-warehouse-barcode-readiness-20261030')
const account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN
assert(/^[a-f0-9]{32}$/.test(account||'')&&token)
async function select(name,sql){
 assert(/^SELECT\s/i.test(sql.trim())&&!sql.includes(';')&&!/--/.test(sql),'Only one SELECT statement allowed')
 const r=await fetch('https://api.cloudflare.com/client/v4/accounts/'+account+'/d1/database/'+id+'/query',{
  method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
  body:JSON.stringify({sql}),signal:AbortSignal.timeout(30000)
 })
 const p=await r.json()
 if(!r.ok||p.success===false)throw Error('Branch2 D1 SELECT '+name+' failed HTTP '+r.status+
  ' codes='+(p.errors||[]).map(e=>e.code).join(','))
 const groups=Array.isArray(p.result)?p.result:[p.result]
 assert(groups.every(g=>g?.success!==false),'SQL query failed '+name)
 const rows=groups.flatMap(g=>g?.results||[])
 console.log('WAREHOUSE_D1_READONLY_'+name+' '+JSON.stringify(rows.slice(0,12)))
 return rows
}
const queries={
 TOTALS: "SELECT (SELECT COUNT(*) FROM inventory_stock) AS stock_rows,(SELECT COUNT(*) FROM inventory_reservations WHERE status='active') AS active_reservations,(SELECT COUNT(*) FROM catalog_variants WHERE is_active=1) AS active_variants,(SELECT COUNT(*) FROM inventory_stock WHERE variant_id IS NULL AND quantity>0) AS unidentified_positive,(SELECT COUNT(*) FROM inventory_stock WHERE quantity<0) AS negative_physical,(SELECT COUNT(*) FROM inventory_stock WHERE variant_id IS NOT NULL AND quantity<reserved_quantity) AS physical_below_reserved",
 DUPLICATE_STOCK: "SELECT inventory_source,variant_id,COUNT(*) AS rows,SUM(quantity) AS physical,SUM(reserved_quantity) AS cached_reserved FROM inventory_stock WHERE variant_id IS NOT NULL GROUP BY inventory_source,variant_id HAVING COUNT(*)>1 LIMIT 12",
 DUPLICATE_ACTIVE_SKU: "SELECT product_id,COALESCE(category,'adult') AS category,TRIM(COALESCE(gender,'')) AS gender,TRIM(COALESCE(color,'')) AS color,TRIM(COALESCE(material,'СТАНДАРТ')) AS material,TRIM(COALESCE(length,'СТАНДАРТ')) AS length,TRIM(COALESCE(size_label,'')) AS size,COUNT(*) AS rows FROM catalog_variants WHERE is_active=1 GROUP BY product_id,COALESCE(category,'adult'),TRIM(COALESCE(gender,'')),TRIM(COALESCE(color,'')),TRIM(COALESCE(material,'СТАНДАРТ')),TRIM(COALESCE(length,'СТАНДАРТ')),TRIM(COALESCE(size_label,'')) HAVING COUNT(*)>1 LIMIT 12",
 STOCK_SKU_MISMATCH: "SELECT COUNT(*) AS n FROM inventory_stock s LEFT JOIN catalog_variants v ON v.id=s.variant_id WHERE s.variant_id IS NOT NULL AND (v.id IS NULL OR v.product_id<>s.product_id)",
 STOCK_VARIANT_RETIRED: "SELECT COUNT(*) AS n FROM inventory_stock s JOIN catalog_variants v ON v.id=s.variant_id LEFT JOIN catalog_products p ON p.id=v.product_id WHERE (v.is_active<>1 OR p.is_active<>1) AND (s.quantity<>0 OR s.reserved_quantity<>0)",
 RESERVATION_SKU_MISSING: "SELECT COUNT(*) AS n FROM inventory_reservations r LEFT JOIN catalog_variants v ON v.id=r.variant_id WHERE r.status='active' AND (r.variant_id IS NULL OR v.id IS NULL)",
 RESERVATION_WITHOUT_STOCK: "SELECT COUNT(*) AS n FROM inventory_reservations r WHERE r.status='active' AND NOT EXISTS (SELECT 1 FROM inventory_stock s WHERE s.inventory_source=r.inventory_source AND s.variant_id=r.variant_id)",
 CACHED_RESERVATION_DRIFT: "SELECT COUNT(*) AS n FROM inventory_stock s WHERE s.variant_id IS NOT NULL AND COALESCE(s.reserved_quantity,0)<>COALESCE((SELECT SUM(r.quantity) FROM inventory_reservations r WHERE r.status='active' AND r.inventory_source=s.inventory_source AND r.variant_id=s.variant_id),0)",
 UNIDENTIFIED_STOCK: "SELECT inventory_source,COUNT(*) AS rows,SUM(quantity) AS physical,COALESCE(SUM(reserved_quantity),0) AS reserved FROM inventory_stock WHERE variant_id IS NULL AND quantity>0 GROUP BY inventory_source",
 UNIDENTIFIED_RESERVED: "SELECT COUNT(*) AS n FROM inventory_stock WHERE variant_id IS NULL AND COALESCE(reserved_quantity,0)>0",
 DEFICIT_SOURCE_TOTALS: "SELECT inventory_source,COUNT(*) AS affected_variants,SUM(reserved_quantity-quantity) AS shortage_units FROM inventory_stock WHERE variant_id IS NOT NULL AND quantity<reserved_quantity GROUP BY inventory_source",
 DEFICIT_EXACT_POSITIONS: "SELECT inventory_source,variant_id,quantity AS physical,reserved_quantity AS reserved,(reserved_quantity-quantity) AS shortage,COALESCE(last_action,'') AS last_action FROM inventory_stock WHERE variant_id IS NOT NULL AND quantity<reserved_quantity ORDER BY shortage DESC,inventory_source,variant_id LIMIT 20",
 PENDING_IDENTITY_LIFECYCLE: "SELECT status,direction,COUNT(*) AS n FROM inventory_lifecycle_events WHERE status='pending' GROUP BY status,direction",
 ACTIVE_RESERVATION_ITEM_IDENTITY: "SELECT COUNT(*) AS n FROM inventory_reservations r JOIN order_items oi ON oi.id=r.order_item_id WHERE r.status='active' AND (COALESCE(r.variant_id,0)<>COALESCE(oi.variant_id,0) OR COALESCE(r.inventory_source,'')<>COALESCE(oi.inventory_source,''))",
 ACTIVE_RESERVATION_VARIANT_EXAMPLES: "SELECT inventory_source,variant_id,COUNT(*) AS n,SUM(quantity) AS reserved FROM inventory_reservations WHERE status='active' GROUP BY inventory_source,variant_id ORDER BY n DESC LIMIT 8"
}
for(const [name,query] of Object.entries(queries))await select(name,query)
const variants=await select('ACTIVE_SKU_SEMANTIC_INPUT',"SELECT id,product_id,category,gender,color,material,length,size_label FROM catalog_variants WHERE is_active=1")
const canon=value=>String(value??'').trim().toUpperCase().replace(/\s+/g,' ')
const skuKey=row=>[
 row.product_id,canon(row.category||'adult'),
 canon(row.gender).includes('ЖЕН')?'ЖЕН':canon(row.gender).includes('МУЖ')?'МУЖ':canon(row.gender),
 canon(row.color||'БЕЗ ЦВЕТА').replace(/[‐‑‒–—-]+/g,' ').replace(/\s+/g,' '),
 canon(row.material||'СТАНДАРТ'),canon(row.length||'СТАНДАРТ'),
 ['БЕЗ РАЗМЕРА','БЕЗРАЗМЕРА','Б/Р'].includes(canon(row.size_label))?'':canon(row.size_label)
].join('||')
const byKey=new Map()
for(const row of variants){
 const k=skuKey(row); const ids=byKey.get(k)||[]; ids.push(row.id);byKey.set(k,ids)
}
const collisions=[...byKey.entries()].filter(([,ids])=>ids.length>1).map(([key,ids])=>({
 productId:Number(key.split('||')[0]),variantIds:ids,groupSize:ids.length
}))
console.log('WAREHOUSE_D1_READONLY_SEMANTIC_ACTIVE_SKU_COLLISIONS '+JSON.stringify({scanned:variants.length,collisions:collisions.length,examples:collisions.slice(0,20)}))
console.log('BRANCH2_BARCODE_INTEGRITY_READONLY_COMPLETE — only SELECT statements; no D1 writes')
