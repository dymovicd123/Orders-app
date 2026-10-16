// Independent production D1 verification AFTER the one-statement SKU renaming attempt.
// SELECT-only. Never call any SQL modification; do not retry mutation PR #417.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import assert from 'node:assert/strict'

const config=process.env.PROD_READONLY_CONFIG
assert(process.env.GITHUB_EVENT_NAME==='pull_request','Inspection must run in PR only')
assert(config&&fs.readFileSync(config,'utf8').includes('"database_id": "17e68a41-1d58-4a36-8a63-47c3e32443c4"'))
function read(sql){
 assert(/^SELECT\s/i.test(sql)&&!sql.includes(';'),'Only a single SELECT permitted')
 const raw=execFileSync('npx',['wrangler','d1','execute','orders_db_prod','--remote','--config',config,'--command='+sql,'--json'],{encoding:'utf8',maxBuffer:12*1024*1024,timeout:90000})
 const p=JSON.parse(raw)
 assert(p.length===1&&p[0]?.success===true&&Array.isArray(p[0]?.results),'Unexpected production response')
 return p[0].results
}
const defs=[
 {id:1469,product_id:75,stock_position_id:146,material:'ДРАП',length:'СТАНДАРТ',size_label:'58'},
 {id:1584,product_id:75,stock_position_id:147,material:'ШЕРСТЬ',length:'СТАНДАРТ',size_label:'48'}
]
const variants=read("SELECT id,product_id,stock_position_id,category,gender,color,material,length,size_label,is_active,updated_at FROM catalog_variants WHERE id IN(1469,1584) ORDER BY id")
const stock=read("SELECT id,variant_id,inventory_source,quantity,reserved_quantity FROM inventory_stock WHERE variant_id IN(1469,1584) ORDER BY variant_id,id")
const activeRes=read("SELECT id,variant_id,quantity FROM inventory_reservations WHERE variant_id IN(1469,1584) AND status='active' ORDER BY id")
const items=read("SELECT id,order_id,product_id,variant_id,color_snapshot FROM order_items WHERE variant_id IN(1469,1584) ORDER BY id")
const index=read("SELECT rowid,order_id,search_text FROM order_search_items_fts WHERE rowid IN (SELECT id FROM order_items WHERE variant_id IN(1469,1584)) ORDER BY rowid")
const siblings=read("SELECT id,stock_position_id,category,gender,color,size_label,is_active FROM catalog_variants WHERE product_id=75 AND stock_position_id IN(146,147) ORDER BY id")
const report={variantRows:variants.map(v=>({id:v.id,color:v.color,isActive:v.is_active,updatedAt:v.updated_at,productId:v.product_id,stockPositionId:v.stock_position_id,size:v.size_label,material:v.material})),stock:stock.map(s=>({id:s.id,variantId:s.variant_id,source:s.inventory_source,quantity:s.quantity,reserved:s.reserved_quantity})),activeReservations:activeRes.length,historicalOrderItems:items.length,ftsRows:index.length,ftsCanonical:index.filter(x=>x.search_text.includes('СВЕТЛО-СЕРЫЙ')).length}
console.log('PAIR_POSTCHECK_OBSERVED='+JSON.stringify(report))
assert.equal(variants.length,2)
for(let i=0;i<2;i++){
 const v=variants[i],d=defs[i]
 for(const [k,val] of Object.entries(d))assert.equal(v[k],val,'Variant metadata drift: '+k)
 assert.equal(v.is_active,1)
 assert.equal(v.color,'СВЕТЛО-СЕРЫЙ','Color was not updated')
 assert.equal(v.category,'adult')
 assert.equal(v.gender,'ЖЕН')
}
assert.equal(stock.length,2)
assert(stock.every(s=>s.quantity===0&&s.reserved_quantity===0&&[1469,1584].includes(s.variant_id)),'Stock count/reserv changed')
assert.equal(activeRes.length,0,'New active reserves')
assert.equal(items.length,3,'Historical order links count changed')
assert.equal(index.length,items.length,'Search index items lost')
assert(index.every((x,i)=>x.rowid===items[i].id&&x.order_id===items[i].order_id&&x.search_text.includes('СВЕТЛО-СЕРЫЙ')),'FTS ref or new label incorrect')
const norm=x=>String(x??'').toUpperCase().replace(/[‐-‒–—-]+/g,' ').replace(/\s+/g,' ').trim()
for(const v of variants){
 assert(!siblings.some(t=>t.id!==v.id&&t.stock_position_id===v.stock_position_id&&
 (t.category||'adult')===(v.category||'adult')&&(t.gender||'')===(v.gender||'')&&(t.size_label||'')===(v.size_label||'')&&norm(t.color)===norm(v.color)),
 'Canonical SKU duplicated, including historical variant')
}
console.log('PAIR_INDEPENDENT_PRODUCTION_VERIFIED='+JSON.stringify({variants:[1469,1584],color:'СВЕТЛО-СЕРЫЙ',warehouseOrBoutiqueStockPhysical:0,stockReserved:0,skuIdStable:true,historicalOrderItemsStable:3,ftsUpToDate:true,otherVariantsColliding:false}))
