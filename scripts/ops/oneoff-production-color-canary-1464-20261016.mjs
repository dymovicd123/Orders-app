// Explicit single-SKU label-only canary. Never changes stock counts, reserved,
// inventory_stock rows, ids, order_items, inventory movements or finance.
// PR = read-only live preflight. main push = exactly one guarded UPDATE statement.
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import fs from 'node:fs'
import {createHash} from 'node:crypto'

const config=process.env.PROD_CANARY_CONFIG
assert(config&&fs.readFileSync(config,'utf8').includes('"database_id": "17e68a41-1d58-4a36-8a63-47c3e32443c4"'))
const isApply=process.env.APPLY_CANARY==='yes'
if(isApply){
  assert.equal(process.env.GITHUB_REF,'refs/heads/main','Only merged main may attempt this oneoff')
  assert.equal(process.env.GITHUB_EVENT_NAME,'push','Only merged push may attempt this oneoff')
}
function dbCall(sql,write=false){
 if(write)assert(isApply&&/^UPDATE catalog_variants SET color='СВЕТЛО-СЕРЫЙ'/.test(sql),'Forbidden write')
 else assert(/^SELECT\s/i.test(sql)&&!sql.includes(';'),'SELECT only')
 const raw=execFileSync('npx',['wrangler','d1','execute','orders_db_prod','--remote','--config',config,'--command='+sql,'--json'],{
   encoding:'utf8',maxBuffer:12*1024*1024,timeout:90000,stdio:['ignore','pipe','pipe'],
 })
 const res=JSON.parse(raw)
 assert(res.length===1&&res[0]?.success===true&&Array.isArray(res[0]?.results),'D1 reported error')
 return res[0]
}
const read=sql=>dbCall(sql).results
const variant=read("SELECT * FROM catalog_variants WHERE id=1464")[0]
assert(variant,'Canary SKU is absent')
const expected={id:1464,product_id:56,stock_position_id:110,is_active:1,color:'СВЕТЛО СЕРЫЙ',material:'СТАНДАРТ',length:'СТАНДАРТ',size_label:'СТАНДАРТ'}
if(variant.color==='СВЕТЛО-СЕРЫЙ'){
 assert(!isApply,'Already applied, protected against replay')
 console.log('CANARY_ALREADY_FIXED_READONLY=true')
 process.exit(0)
}
for(const [k,v] of Object.entries(expected))assert.equal(variant[k],v,'Canary data changed: '+k)
const keeper=read("SELECT id FROM reference_values WHERE kind='color' AND id=50419 AND is_active=1 AND value='СВЕТЛО-СЕРЫЙ'")
assert.equal(keeper.length,1,'Canonical target no longer active')
const normalize=s=>String(s??'').toUpperCase().replace(/[‐-‒–—-]+/g,' ').replace(/\s+/g,' ').trim()
const siblings=read("SELECT id,product_id,stock_position_id,category,gender,material,length,color,size_label FROM catalog_variants WHERE product_id=56 AND stock_position_id=110 ORDER BY id")
const collision=siblings.filter(v=>v.id!==1464&&
 (v.category||'adult')===(variant.category||'adult')&&
 (v.gender||'')===(variant.gender||'')&&
 (v.size_label||'')===(variant.size_label||'')&&
 normalize(v.color)===normalize('СВЕТЛО-СЕРЫЙ'))
assert.equal(collision.length,0,'Live SKU identity conflict (including inactive SKU)')
const stockBefore=read("SELECT id,inventory_source,variant_id,quantity,reserved_quantity,product_id,color_snapshot,updated_at FROM inventory_stock WHERE variant_id=1464 ORDER BY id")
assert(stockBefore.every(s=>s.quantity===0&&s.reserved_quantity===0),'Canary stock became nonzero, stop')
const reservationBefore=read("SELECT COUNT(*) n FROM inventory_reservations WHERE variant_id=1464 AND status='active'")[0]?.n
assert.equal(reservationBefore,0,'Canary now reserved: stop')
const itemBefore=read("SELECT id,order_id,product_id,variant_id,color_snapshot,product_name_snapshot,size_snapshot FROM order_items WHERE variant_id=1464 ORDER BY id")
const ftsCountBefore=read("SELECT COUNT(*) n FROM order_search_items_fts WHERE rowid IN (SELECT id FROM order_items WHERE variant_id=1464)")[0]?.n
assert.equal(ftsCountBefore,itemBefore.length,'Order-search index incomplete before rename')
const beforeHash=createHash('sha256').update(JSON.stringify({variant,stockBefore,reservationBefore,itemBefore})).digest('hex').slice(0,16)
console.log('CANARY_READONLY_PREFLIGHT='+JSON.stringify({
 id:1464,stockRows:stockBefore.length,quantity:0,reserved:0,historicalOrderItems:itemBefore.length,
 indexRows:ftsCountBefore,identityConflicts:0,fingerprint:beforeHash,
}))
if(!isApply){
 console.log('CANARY_NOT_APPLIED: validation only; no SQL UPDATE')
 process.exit(0)
}
const stamp=String(variant.updated_at).replace(/'/g,"''")
const sql="UPDATE catalog_variants SET color='СВЕТЛО-СЕРЫЙ',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')"+
" WHERE id=1464 AND product_id=56 AND stock_position_id=110 AND is_active=1"+
" AND color='СВЕТЛО СЕРЫЙ' AND updated_at='"+stamp+"'"+
" AND NOT EXISTS(SELECT 1 FROM inventory_stock s WHERE s.variant_id=1464 AND (s.quantity<>0 OR s.reserved_quantity<>0))"+
" AND NOT EXISTS(SELECT 1 FROM inventory_reservations r WHERE r.variant_id=1464 AND r.status='active')"+
" AND NOT EXISTS(SELECT 1 FROM catalog_variants t WHERE t.id<>1464 AND t.product_id=56"+
" AND t.stock_position_id=110 AND COALESCE(t.category,'adult')=COALESCE((SELECT category FROM catalog_variants WHERE id=1464),'adult')"+
" AND COALESCE(t.gender,'')=COALESCE((SELECT gender FROM catalog_variants WHERE id=1464),'')"+
" AND COALESCE(t.size_label,'')=COALESCE((SELECT size_label FROM catalog_variants WHERE id=1464),'')"+
" AND UPPER(REPLACE(REPLACE(TRIM(COALESCE(t.color,'')),'‐',' '),'-',' '))='СВЕТЛО СЕРЫЙ')"
const mutation=dbCall(sql,true)
assert.equal(mutation.meta?.changes,1,'One-off guard rejected mutation')
const vAfter=read("SELECT * FROM catalog_variants WHERE id=1464")[0]
assert.equal(vAfter.color,'СВЕТЛО-СЕРЫЙ')
for(const k of Object.keys(variant).filter(k=>!['color','updated_at'].includes(k)))
 assert.deepEqual(vAfter[k],variant[k],'Unexpected catalog metadata drift: '+k)
const sAfter=read("SELECT id,inventory_source,variant_id,quantity,reserved_quantity,product_id,color_snapshot,updated_at FROM inventory_stock WHERE variant_id=1464 ORDER BY id")
assert.deepEqual(sAfter,stockBefore,'Inventory stock rows changed unexpectedly')
assert.equal(read("SELECT COUNT(*) n FROM inventory_reservations WHERE variant_id=1464 AND status='active'")[0]?.n,0)
assert.deepEqual(read("SELECT id,order_id,product_id,variant_id,color_snapshot,product_name_snapshot,size_snapshot FROM order_items WHERE variant_id=1464 ORDER BY id"),itemBefore)
const ftsAfter=read("SELECT rowid,order_id,search_text FROM order_search_items_fts WHERE rowid IN (SELECT id FROM order_items WHERE variant_id=1464) ORDER BY rowid")
assert.equal(ftsAfter.length,itemBefore.length)
assert(ftsAfter.every(x=>x.search_text.includes('СВЕТЛО-СЕРЫЙ')),'FTS order search not updated')
console.log('CANARY_PRODUCTION_VERIFIED='+JSON.stringify({id:1464,newColor:vAfter.color,physical:0,reserved:0,
 stockRowsUntouched:true,orderItemsUntouched:true,orderSearchReindexed:true}))
