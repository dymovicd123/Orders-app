// Independent production D1 postcheck after four keeper color-only corrections; SELECT-only.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {execFileSync} from 'node:child_process'
assert.equal(process.env.GITHUB_EVENT_NAME,'pull_request')
assert.equal(process.env.GITHUB_BASE_REF,'main')
const cfg=process.env.PROD_READONLY_CONFIG
assert(cfg&&fs.readFileSync(cfg,'utf8').includes('"database_id": "17e68a41-1d58-4a36-8a63-47c3e32443c4"'))
const pairs=[[1277,1438,'46'],[1278,1436,'48'],[1279,1441,'50'],[1303,1473,'56']]
const ids=pairs.flatMap(x=>[x[0],x[1]]),list=ids.join(',')
const keepers=pairs.map(x=>x[1]),keepList=keepers.join(',')
const archived=pairs.map(x=>x[0]),archList=archived.join(',')
const read=q=>{
 assert(/^SELECT\s/i.test(q)&&!q.includes(';'),'Only SELECT allowed')
 const j=JSON.parse(execFileSync('npx',['wrangler','d1','execute','orders_db_prod','--remote','--config',cfg,'--command='+q,'--json'],{encoding:'utf8',maxBuffer:14*1024*1024,timeout:90000}))
 assert(j.length===1&&j[0].success===true&&Array.isArray(j[0].results),'D1 read failed')
 return j[0].results
}
const refs=read('SELECT id,kind,value,is_active FROM reference_values WHERE id IN (50418,50419) ORDER BY id')
assert(refs.length===2&&refs.some(x=>x.id===50418&&x.value==='СВЕТЛО СЕРЫЙ'&&x.is_active===1)&&refs.some(x=>x.id===50419&&x.value==='СВЕТЛО-СЕРЫЙ'&&x.is_active===1))
const rows=read('SELECT * FROM catalog_variants WHERE id IN ('+list+') ORDER BY id')
assert.equal(rows.length,8)
for(const [source,keeper,size] of pairs){
 const old=rows.find(x=>x.id===source),active=rows.find(x=>x.id===keeper)
 assert(old&&old.color==='СВЕТЛО-СЕРЫЙ'&&old.is_active===0&&old.size_label===size,'Archived lineage wrong')
 assert(active&&active.color==='СВЕТЛО-СЕРЫЙ'&&active.is_active===1&&active.size_label===size,'Keeper rename missing')
 assert(active.product_id===75&&active.stock_position_id===146&&old.product_id===75&&old.stock_position_id===146)
}
const ledger=read('SELECT source_variant_id,keeper_variant_id,status,completed_at FROM catalog_semantic_variant_corrections WHERE source_variant_id IN ('+archList+') ORDER BY source_variant_id')
assert.equal(ledger.length,4)
for(const [oldId,newId] of pairs)assert(ledger.some(x=>x.source_variant_id===oldId&&x.keeper_variant_id===newId&&x.status==='completed'&&x.completed_at),'Correction receipt damaged')
const stock=read('SELECT id,variant_id,inventory_source,quantity,reserved_quantity FROM inventory_stock WHERE variant_id IN ('+list+') ORDER BY id')
assert.equal(stock.length,12,'Expected original 5 keeper + 7 archived stock rows')
assert(stock.every(x=>x.quantity===0&&x.reserved_quantity===0),'Unexpected physical stock change since preflight')
const reserves=read("SELECT id,variant_id,quantity FROM inventory_reservations WHERE variant_id IN ("+list+") AND status='active'")
assert.equal(reserves.length,0)
const items=read('SELECT id,order_id,variant_id FROM order_items WHERE variant_id IN ('+list+') ORDER BY id')
assert.equal(items.length,7,'Expected seven history order lines')
const fts=read('SELECT rowid,order_id,search_text FROM order_search_items_fts WHERE rowid IN (SELECT id FROM order_items WHERE variant_id IN ('+list+')) ORDER BY rowid')
assert.equal(fts.length,items.length)
for(let i=0;i<items.length;i++){
 const item=items[i],search=fts[i]
 assert(search.rowid===item.id&&search.order_id===item.order_id,'FTS order identity mismatch')
 assert(search.search_text.includes('СВЕТЛО-СЕРЫЙ'),'Updated canonical keeper not reflected in FTS')
 assert(keepers.includes(item.variant_id),'Archived order unexpectedly references retired SKU')
}
const untouched52_54=read('SELECT id,product_id,stock_position_id,color,size_label,is_active FROM catalog_variants WHERE id IN (1280,1281,1532,1533) ORDER BY id')
const expected=[[1280,'СВЕТЛО-СЕРЫЙ','52'],[1281,'СВЕТЛО-СЕРЫЙ','54'],[1532,'СВЕТЛО СЕРЫЙ','52'],[1533,'СВЕТЛО СЕРЫЙ','54']]
assert.equal(untouched52_54.length,4)
for(const [id,color,size] of expected){
 const r=untouched52_54.find(x=>x.id===id)
 assert(r&&r.product_id===75&&r.stock_position_id===146&&r.color===color&&r.size_label===size&&r.is_active===1,'Live 52/54 unexpectedly changed')
}
const impactedStock=read('SELECT variant_id,inventory_source,quantity,reserved_quantity FROM inventory_stock WHERE variant_id IN (1280,1281,1532,1533) ORDER BY variant_id,inventory_source')
assert.equal(impactedStock.filter(x=>x.quantity!==0).length,1)
assert(impactedStock.some(x=>x.variant_id===1532&&x.inventory_source==='warehouse'&&x.quantity===1&&x.reserved_quantity===0),'13 October 1-unit arrival missing')
const orphan=read('SELECT COUNT(*) n FROM inventory_stock s LEFT JOIN catalog_variants v ON v.id=s.variant_id WHERE s.variant_id IS NOT NULL AND v.id IS NULL')[0].n
const mismatch=read("SELECT COUNT(*) n FROM inventory_stock s WHERE s.reserved_quantity<>COALESCE((SELECT SUM(r.quantity) FROM inventory_reservations r WHERE r.variant_id=s.variant_id AND r.inventory_source=s.inventory_source AND r.status='active'),0)")[0].n
assert.equal(orphan,0)
assert.equal(mismatch,0)
console.log('ETHNO_FOUR_INDEPENDENT_PRODUCTION_VERIFIED='+JSON.stringify({updatedKeeperIds:keepers,archivedIds:archived,originalCorrections:ledger.length,physical:0,reserved:0,stockRows:stock.length,historicalOrderItems:items.length,ftsRows:fts.length,untouched52_54:expected.map(x=>x[0]),october13UnitPreserved:true,orphanStock:orphan,reserveMismatch:mismatch,readOnly:true}))
