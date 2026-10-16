// Fully independent production post-verification, SELECT-only. No customer/payment identifiers logged.
import {execFileSync} from 'node:child_process'
import assert from 'node:assert/strict'
import fs from 'node:fs'
assert.equal(process.env.GITHUB_EVENT_NAME,'pull_request')
assert.equal(process.env.GITHUB_BASE_REF,'main')
const cfg=process.env.PROD_READONLY_CONFIG
assert(cfg&&fs.readFileSync(cfg,'utf8').includes('"database_id": "17e68a41-1d58-4a36-8a63-47c3e32443c4"'))
const specs=[{"id":1287,"color":"ТЕМНО-СЕРЫЙ"},{"id":1310,"color":"ТЕМНО-СЕРЫЙ"},{"id":1311,"color":"ТЕМНО-СЕРЫЙ"},{"id":1346,"color":"ТЕМНО-СЕРЫЙ"},{"id":1347,"color":"ТЕМНО-СЕРЫЙ"},{"id":1348,"color":"ТЕМНО-СЕРЫЙ"},{"id":1353,"color":"ТЕМНО-СЕРЫЙ"},{"id":1357,"color":"ТЕМНО-СЕРЫЙ"},{"id":1429,"color":"ТЕМНО-СЕРЫЙ"},{"id":1506,"color":"ТЕМНО-СЕРЫЙ"},{"id":1590,"color":"ТЕМНО-СЕРЫЙ"},{"id":1592,"color":"ТЕМНО-СЕРЫЙ"},{"id":1603,"color":"ТЕМНО-СЕРЫЙ"},{"id":1757,"color":"ТЕМНО-СЕРЫЙ"},{"id":1766,"color":"ТЕМНО-СЕРЫЙ"},{"id":1767,"color":"ТЕМНО-СЕРЫЙ"},{"id":1775,"color":"ТЕМНО-СЕРЫЙ"},{"id":1776,"color":"ТЕМНО-СЕРЫЙ"},{"id":1554,"color":"ТЕМНО-БОРДОВЫЙ"},{"id":1555,"color":"ТЕМНО-БОРДОВЫЙ"},{"id":1556,"color":"ТЕМНО-БОРДОВЫЙ"},{"id":1557,"color":"ТЕМНО-БОРДОВЫЙ"},{"id":1558,"color":"ТЕМНО-БОРДОВЫЙ"}]
const ids=specs.map(x=>x.id),list=ids.join(',')
const read=q=>{
 assert(/^SELECT\s/i.test(q)&&!q.includes(';'),'SELECT only')
 const j=JSON.parse(execFileSync('npx',['wrangler','d1','execute','orders_db_prod','--remote','--config',cfg,'--command='+q,'--json'],{encoding:'utf8',maxBuffer:14*1024*1024,timeout:90000}))
 assert(j.length===1&&j[0].success===true&&Array.isArray(j[0].results))
 return j[0].results
}
const refs=read("SELECT id,kind,value,is_active FROM reference_values WHERE kind='color' ORDER BY id")
for(const name of ['ТЕМНО-СЕРЫЙ','ТЕМНО-БОРДОВЫЙ'])assert.equal(refs.filter(r=>r.kind==='color'&&r.value===name&&r.is_active===1).length,1,'Missing/duplicate new color '+name)
const asphalt=refs.find(r=>r.id===582)
assert(asphalt&&asphalt.value==='ТЕМНЫЙ МОКРЫЙ АСФАЛЬТ'&&asphalt.is_active===1,'Wet asphalt touched')
const variants=read('SELECT id,product_id,stock_position_id,gender,color,material,length,size_label,category,is_active FROM catalog_variants WHERE id IN ('+list+') ORDER BY id')
assert.equal(variants.length,23)
for(const v of variants)assert(specs.some(s=>s.id===v.id&&s.color===v.color)&&v.is_active===1,'Uncorrected SKU '+v.id)
const badLabels=read("SELECT color,COUNT(*) n FROM catalog_variants WHERE is_active=1 AND color IN ('ТЕМНО СЕРЫЙ','ТЕМНО БОРДОВЫЙ') GROUP BY color")
assert.deepEqual(badLabels,[],'Remaining source spellings')
const protectedIds=[1436,1438,1441,1473,1532,1533]
const blocked=read('SELECT id,color FROM catalog_variants WHERE id IN ('+protectedIds.join(',')+') ORDER BY id')
assert.equal(blocked.length,6)
assert(blocked.every(x=>x.color==='СВЕТЛО СЕРЫЙ'),'Unrelated collision SKU touched')
const stock=read('SELECT id,variant_id,inventory_source,quantity,reserved_quantity FROM inventory_stock WHERE variant_id IN ('+list+') ORDER BY id')
assert.equal(stock.length,26,'Expected original 26 inventory rows; investigate concurrent moves')
const physical=stock.reduce((a,b)=>a+b.quantity,0),reserved=stock.reduce((a,b)=>a+b.reserved_quantity,0)
assert.equal(physical,13,'Physical amount changed; investigate concurrent moves')
assert.equal(reserved,4,'Reserved amount changed; investigate concurrent moves')
const reservations=read("SELECT id,variant_id,inventory_source,quantity FROM inventory_reservations WHERE variant_id IN ("+list+") AND status='active' ORDER BY id")
assert.equal(reservations.length,4)
for(const st of stock)assert.equal(st.reserved_quantity,reservations.filter(r=>r.variant_id===st.variant_id&&r.inventory_source===st.inventory_source).reduce((a,b)=>a+b.quantity,0),'Active reserve mismatch '+st.id)
const items=read('SELECT id,order_id,variant_id FROM order_items WHERE variant_id IN ('+list+') ORDER BY id')
assert.equal(items.length,15,'Historical order lines changed')
const fts=read('SELECT rowid,order_id,search_text FROM order_search_items_fts WHERE rowid IN (SELECT id FROM order_items WHERE variant_id IN ('+list+')) ORDER BY rowid')
assert.equal(fts.length,items.length)
for(let i=0;i<items.length;i++){
 const oi=items[i],f=fts[i],expected=specs.find(x=>x.id===oi.variant_id)
 assert(f.rowid===oi.id&&f.order_id===oi.order_id,'FTS identity changed')
 assert(f.search_text.includes(expected.color),'FTS canonical color not updated for SKU '+oi.variant_id)
}
const orphanStock=read('SELECT COUNT(*) n FROM inventory_stock st LEFT JOIN catalog_variants v ON v.id=st.variant_id WHERE st.variant_id IS NOT NULL AND v.id IS NULL')[0].n
const reserveMismatch=read("SELECT COUNT(*) n FROM inventory_stock s WHERE s.reserved_quantity<>COALESCE((SELECT SUM(r.quantity) FROM inventory_reservations r WHERE r.variant_id=s.variant_id AND r.inventory_source=s.inventory_source AND r.status='active'),0)")[0].n
assert.equal(orphanStock,0)
assert.equal(reserveMismatch,0)
console.log('COLOR23_INDEPENDENT_PRODUCTION_VERIFIED='+JSON.stringify({ids,referenceColors:['ТЕМНО-СЕРЫЙ','ТЕМНО-БОРДОВЫЙ'],exact23:true,distinctAsphaltUntouched:true,physical,reserved,stockRows:stock.length,reservationRows:reservations.length,historicalOrderItems:items.length,ftsRows:fts.length,protectedCollisionsUntouched:true,orphanStock,reserveMismatch,noWrites:true}))
