// Single guarded two-SKU catalog COLOR-only correction. No inventory, orders or reservations writes.
// PR runs SELECT only. An explicit main push runs exactly one atomic UPDATE
// against production D1, including updated_at CAS and inside-statement guards.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'

const config=process.env.PROD_CANARY_CONFIG
assert(config&&fs.readFileSync(config,'utf8').includes('"database_id": "17e68a41-1d58-4a36-8a63-47c3e32443c4"'), 'Unexpected D1 config')
const apply=process.env.APPLY_CANARY==='yes'
if(apply){
 assert.equal(process.env.GITHUB_REF,'refs/heads/main')
 assert.equal(process.env.GITHUB_EVENT_NAME,'push')
}
const defs=[
 {id:1469,product_id:75,stock_position_id:146,category:'adult',gender:'ЖЕН',material:'ДРАП',length:'СТАНДАРТ',size_label:'58'},
 {id:1584,product_id:75,stock_position_id:147,category:'adult',gender:'ЖЕН',material:'ШЕРСТЬ',length:'СТАНДАРТ',size_label:'48'},
]
const ids=defs.map(x=>x.id)
const from='СВЕТЛО СЕРЫЙ',to='СВЕТЛО-СЕРЫЙ'
function execute(sql,write=false){
 if(write)assert(apply&&sql.startsWith("UPDATE catalog_variants SET color='СВЕТЛО-СЕРЫЙ', updated_at=")&&sql.includes('id IN (1469,1584)'), 'Forbidden mutation')
 else assert(/^SELECT\s/i.test(sql)&&!sql.includes(';'),'Non-SELECT forbidden')
 const raw=execFileSync('npx',['wrangler','d1','execute','orders_db_prod','--remote','--config',config,'--command='+sql,'--json'],{
   encoding:'utf8',maxBuffer:12*1024*1024,timeout:90000,stdio:['ignore','pipe','pipe'],
 })
 const r=JSON.parse(raw)
 assert(r.length===1&&r[0]?.success===true&&Array.isArray(r[0].results),'D1 operation not successful')
 return r[0]
}
const read=sql=>execute(sql).results
const token=read("SELECT id,value,is_active FROM reference_values WHERE kind='color' AND id=50419")[0]
assert.deepEqual({id:token?.id,value:token?.value,is_active:token?.is_active},{id:50419,value:to,is_active:1},'Keeper color ref drifted')
const initial=read('SELECT * FROM catalog_variants WHERE id IN (1469,1584) ORDER BY id')
assert.equal(initial.length,2,'Target variants missing')
const normalize=s=>String(s??'').toUpperCase().replace(/[‐-‒–—-]+/g,' ').replace(/\s+/g,' ').trim()
for(const [i,d] of defs.entries()){
 const v=initial[i]
 for(const [k,x] of Object.entries(d))assert.equal(v[k],x,'SKU '+d.id+' changed: '+k)
 assert.equal(v.is_active,1,'SKU has become inactive')
 assert.equal(v.color,from,'Source color changed since audit')
}
const sibling=read('SELECT id,product_id,stock_position_id,category,gender,color,size_label,is_active FROM catalog_variants WHERE product_id=75 AND stock_position_id IN (146,147) ORDER BY id')
for(const v of initial){
 const equals=sibling.filter(s=>s.id!==v.id && s.stock_position_id===v.stock_position_id &&
 (s.category||'adult')===(v.category||'adult') && (s.gender||'')===(v.gender||'') &&
 (s.size_label||'')===(v.size_label||'') && normalize(s.color)===normalize(to))
 assert.equal(equals.length,0,'Historical/active semantic SKU identity collision for '+v.id)
}
const stockSql='SELECT id,inventory_source,product_id,variant_id,quantity,reserved_quantity,color_snapshot,updated_at FROM inventory_stock WHERE variant_id IN (1469,1584) ORDER BY id'
const initialStock=read(stockSql)
assert(initialStock.every(s=>s.quantity===0&&s.reserved_quantity===0),'Stock or reserves changed: stop')
const reserveSql="SELECT id,order_id,variant_id,inventory_source,quantity,status FROM inventory_reservations WHERE variant_id IN (1469,1584) AND status='active' ORDER BY id"
const initialReserves=read(reserveSql)
assert.equal(initialReserves.length,0,'New reservations attached: stop')
const orderSql='SELECT id,order_id,product_id,variant_id,product_name_snapshot,gender_snapshot,color_snapshot,material_snapshot,length_snapshot,size_snapshot FROM order_items WHERE variant_id IN (1469,1584) ORDER BY id'
const orderItems=read(orderSql)
const ftsBefore=read('SELECT rowid,order_id FROM order_search_items_fts WHERE rowid IN (SELECT id FROM order_items WHERE variant_id IN (1469,1584)) ORDER BY rowid')
assert.equal(ftsBefore.length,orderItems.length,'FTS row before rename missing')
const digest=createHash('sha256').update(JSON.stringify({initial,initialStock,initialReserves,orderItems,ftsBefore})).digest('hex').slice(0,20)
console.log('PAIR_READONLY_PREFLIGHT='+JSON.stringify({skuIds:ids,stockRows:initialStock.length,totalQuantity:0,totalReserved:0,orderItemCount:orderItems.length,identityCollisions:0,digest}))
if(!apply){console.log('PAIR_NOT_APPLIED: PR is SELECT-only');process.exit(0)}
// Both SKUs are modified in a single SQL UPDATE statement (SQLite statement atomicity).
// Reject changed source timestamps and changed stock/reserves at time of write.
const quote=s=>String(s).replaceAll("'","''")
const cases=initial.map(v=>"(id="+v.id+" AND updated_at='"+quote(v.updated_at)+"')").join(' OR ')
const stmt="UPDATE catalog_variants SET color='СВЕТЛО-СЕРЫЙ', updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')"+
" WHERE id IN (1469,1584) AND ("+cases+") AND is_active=1 AND color='СВЕТЛО СЕРЫЙ'"+
" AND EXISTS(SELECT 1 FROM reference_values rv WHERE rv.id=50419 AND rv.is_active=1 AND rv.kind='color' AND rv.value='СВЕТЛО-СЕРЫЙ')"+
" AND NOT EXISTS(SELECT 1 FROM inventory_stock st WHERE st.variant_id=catalog_variants.id AND (st.quantity<>0 OR st.reserved_quantity<>0))"+
" AND NOT EXISTS(SELECT 1 FROM inventory_reservations ir WHERE ir.variant_id=catalog_variants.id AND ir.status='active')"+
" AND NOT EXISTS(SELECT 1 FROM catalog_variants other WHERE other.id<>catalog_variants.id"+
" AND other.product_id=catalog_variants.product_id AND other.stock_position_id=catalog_variants.stock_position_id"+
" AND COALESCE(other.category,'adult')=COALESCE(catalog_variants.category,'adult')"+
" AND COALESCE(other.gender,'')=COALESCE(catalog_variants.gender,'')"+
" AND COALESCE(other.size_label,'')=COALESCE(catalog_variants.size_label,'')"+
" AND UPPER(REPLACE(REPLACE(TRIM(COALESCE(other.color,'')),'‐',' '),'-',' '))='СВЕТЛО СЕРЫЙ')"
const applied=execute(stmt,true)
assert.equal(applied.meta?.changes,2,'Did not update both exact variants. Stop further changes.')
const after=read('SELECT * FROM catalog_variants WHERE id IN (1469,1584) ORDER BY id')
assert.equal(after.length,2)
for(let i=0;i<2;i++){
 assert.equal(after[i].id,initial[i].id)
 assert.equal(after[i].color,to,'Color update missing')
 for(const k of Object.keys(initial[i]).filter(k=>k!=='color'&&k!=='updated_at'))assert.deepEqual(after[i][k],initial[i][k],'Unexpected SKU field changed: '+k)
}
assert.deepEqual(read(stockSql),initialStock,'Inventory stock changed')
assert.deepEqual(read(reserveSql),initialReserves,'Reservations changed')
assert.deepEqual(read(orderSql),orderItems,'Order snapshots changed')
const ftsAfter=read('SELECT rowid,order_id,search_text FROM order_search_items_fts WHERE rowid IN (SELECT id FROM order_items WHERE variant_id IN (1469,1584)) ORDER BY rowid')
assert.equal(ftsAfter.length,orderItems.length)
assert.deepEqual(ftsAfter.map(x=>({rowid:x.rowid,order_id:x.order_id})),ftsBefore)
assert(ftsAfter.every(row=>row.search_text.includes(to)),'FTS did not refresh canonical color')
console.log('PAIR_PRODUCTION_VERIFIED='+JSON.stringify({skuIds:ids,newColor:to,stockRowsUntouched:true,reservationsUntouched:true,orderItemsUntouched:true,orderSearchReindexed:true}))
