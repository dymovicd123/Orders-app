// Independent read-only production postcheck. Never calls a write query.
import {execFileSync} from 'node:child_process'
import assert from 'node:assert/strict'
import fs from 'node:fs'
const config=process.env.PROD_READONLY_CONFIG
assert(process.env.GITHUB_ACTIONS==='true')
assert(config&&fs.readFileSync(config,'utf8').includes('"database_id": "17e68a41-1d58-4a36-8a63-47c3e32443c4"'))
const specs=[{"id":1423,"color":"СВЕТЛО-СЕРЫЙ"},{"id":1431,"color":"СВЕТЛО-СЕРЫЙ"},{"id":1503,"color":"СВЕТЛО-СЕРЫЙ"},{"id":1514,"color":"СВЕТЛО-СЕРЫЙ"},{"id":1515,"color":"СВЕТЛО-СЕРЫЙ"},{"id":1718,"color":"СВЕТЛО-СЕРЫЙ"},{"id":1586,"color":"ТЕМНО-СИНИЙ"},{"id":1665,"color":"ТЕМНО-СИНИЙ"},{"id":1666,"color":"ТЕМНО-СИНИЙ"},{"id":1739,"color":"ТЕМНО-СИНИЙ"},{"id":1740,"color":"ТЕМНО-СИНИЙ"},{"id":1741,"color":"ТЕМНО-СИНИЙ"},{"id":1742,"color":"ТЕМНО-СИНИЙ"},{"id":1743,"color":"ТЕМНО-СИНИЙ"},{"id":1744,"color":"ТЕМНО-СИНИЙ"},{"id":1768,"color":"ТЕМНО-СИНИЙ"},{"id":1774,"color":"ТЕМНО-СИНИЙ"},{"id":1806,"color":"ТЕМНО-СИНИЙ"},{"id":1807,"color":"ТЕМНО-СИНИЙ"},{"id":1484,"color":"СВЕТЛО-БЕЖЕВЫЙ"},{"id":1498,"color":"СВЕТЛО-БЕЖЕВЫЙ"},{"id":1500,"color":"СВЕТЛО-БЕЖЕВЫЙ"},{"id":1794,"color":"СВЕТЛО-БЕЖЕВЫЙ"},{"id":1797,"color":"СВЕТЛО-БЕЖЕВЫЙ"},{"id":1680,"color":"ТЕМНО-КОРИЧНЕВЫЙ"},{"id":1681,"color":"ТЕМНО-КОРИЧНЕВЫЙ"}]
const ids=specs.map(x=>x.id)
const list=ids.join(',')
function read(sql){
 assert(/^SELECT\s/i.test(sql)&&!sql.includes(';'),'SELECT-only')
 const out=execFileSync('npx',['wrangler','d1','execute','orders_db_prod','--remote','--config',config,'--command='+sql,'--json'],{encoding:'utf8',timeout:90000,maxBuffer:14*1024*1024})
 const x=JSON.parse(out)
 assert(x.length===1&&x[0].success===true&&Array.isArray(x[0].results),'Read-only production query failed')
 return x[0].results
}
const variants=read('SELECT * FROM catalog_variants WHERE id IN ('+list+') ORDER BY id')
assert.equal(variants.length,26)
for(const v of variants){const expected=specs.find(x=>x.id===v.id);assert(expected&&v.color===expected.color&&v.is_active===1,'Variant color/identity mismatch '+v.id)}
const blocked=[1436,1438,1441,1473,1532,1533]
const blockedBefore=read('SELECT id,color,is_active FROM catalog_variants WHERE id IN ('+blocked.join(',')+') ORDER BY id')
assert.equal(blockedBefore.length,6)
for(const x of blockedBefore)assert.equal(x.color,'СВЕТЛО СЕРЫЙ','Protected collision was renamed '+x.id)
const remaining=read("SELECT color,COUNT(*) n FROM catalog_variants WHERE is_active=1 AND color IN ('СВЕТЛО СЕРЫЙ','ТЕМНО СИНИЙ','СВЕТЛО БЕЖЕВЫЙ','ТЕМНО КОРИЧНЕВЫЙ') GROUP BY color")
assert.deepEqual(remaining,[{color:'СВЕТЛО СЕРЫЙ',n:6}],'Unexpected remaining source labels')
const stock=read('SELECT id,variant_id,inventory_source,quantity,reserved_quantity FROM inventory_stock WHERE variant_id IN ('+list+') ORDER BY id')
assert.equal(stock.length,34,'Stock rows count drift (may be legitimate concurrent activity, investigate)')
assert(stock.every(x=>ids.includes(x.variant_id)&&x.quantity>=0&&x.reserved_quantity>=0))
const physical=stock.reduce((n,x)=>n+x.quantity,0)
const reserved=stock.reduce((n,x)=>n+x.reserved_quantity,0)
assert.equal(physical,76,'Physical quantity changed since preflight (investigate concurrent activity)')
assert.equal(reserved,13,'Reserved quantity changed since preflight (investigate concurrent activity)')
const reservations=read("SELECT id,variant_id,inventory_source,quantity FROM inventory_reservations WHERE status='active' AND variant_id IN ("+list+") ORDER BY id")
assert.equal(reservations.length,13,'Active reservation row count changed')
for(const st of stock){const q=reservations.filter(r=>r.variant_id===st.variant_id&&r.inventory_source===st.inventory_source).reduce((a,b)=>a+b.quantity,0);assert.equal(q,st.reserved_quantity,'Reservation/stock drift at stock ID '+st.id)}
assert.equal(reservations.reduce((a,b)=>a+b.quantity,0),13)
const items=read('SELECT id,order_id,variant_id FROM order_items WHERE variant_id IN ('+list+') ORDER BY id')
assert.equal(items.length,42,'Historical line count changed')
const fts=read('SELECT rowid,order_id,search_text FROM order_search_items_fts WHERE rowid IN (SELECT id FROM order_items WHERE variant_id IN ('+list+')) ORDER BY rowid')
assert.equal(fts.length,items.length,'FTS historical row loss')
for(let i=0;i<items.length;i++){
 const row=items[i],index=fts[i],expected=specs.find(x=>x.id===row.variant_id)
 assert.equal(index.rowid,row.id)
 assert.equal(index.order_id,row.order_id)
 assert(index.search_text.includes(expected.color),'Canonical color not searchable on '+row.variant_id)
}
const orphan=read('SELECT COUNT(*) n FROM inventory_stock s LEFT JOIN catalog_variants v ON v.id=s.variant_id WHERE v.id IS NULL')[0].n
const archivedStock=read('SELECT COUNT(*) n FROM inventory_stock s JOIN catalog_variants v ON v.id=s.variant_id WHERE v.is_active=0 AND (s.quantity<>0 OR s.reserved_quantity<>0)')[0].n
assert.equal(orphan,0,'Inventory stock orphan detected')
assert.equal(archivedStock,0,'Nonzero archived inventory detected')
console.log('REMAINING26_INDEPENDENT_PRODUCTION_VERIFIED='+JSON.stringify({ids,exactColors:true,physical,reserved,stockRows:stock.length,activeReservationRows:reservations.length,historicalOrderItems:items.length,ftsRows:fts.length,protectedCollisionsUntouched:blocked.length,orphanStock:orphan,archivedStock,remainingBadSpelling:remaining,noProductionWrites:true}))
