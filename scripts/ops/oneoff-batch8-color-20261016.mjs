// One-off protected batch of 8 low-exposure catalog COLOR spelling corrections.
// PR: only SELECT. Main push after approval: one SQLite atomic UPDATE RETURNING.
// Explicitly never updates inventory_stock/reservations/order_items/stocktake/finance.
import {execFileSync} from 'node:child_process'
import assert from 'node:assert/strict'
import fs from 'node:fs'
const config=process.env.PROD_CANARY_CONFIG
assert(config&&fs.readFileSync(config,'utf8').includes('"database_id": "17e68a41-1d58-4a36-8a63-47c3e32443c4"'))
const apply=process.env.APPLY_COLOR_BATCH==='yes'
if(apply) {
 assert.equal(process.env.GITHUB_EVENT_NAME,'push')
 assert.equal(process.env.GITHUB_REF,'refs/heads/main')
}
const specs=[
 {id:1481,from:'СВЕТЛО БЕЖЕВЫЙ',to:'СВЕТЛО-БЕЖЕВЫЙ'},
 {id:1589,from:'СВЕТЛО БЕЖЕВЫЙ',to:'СВЕТЛО-БЕЖЕВЫЙ'},
 {id:1788,from:'СВЕТЛО БЕЖЕВЫЙ',to:'СВЕТЛО-БЕЖЕВЫЙ'},
 {id:1492,from:'ТЕМНО КОРИЧНЕВЫЙ',to:'ТЕМНО-КОРИЧНЕВЫЙ'},
 {id:1527,from:'ТЕМНО КОРИЧНЕВЫЙ',to:'ТЕМНО-КОРИЧНЕВЫЙ'},
 {id:1499,from:'ТЕМНО СИНИЙ',to:'ТЕМНО-СИНИЙ'},
 {id:1617,from:'ТЕМНО СИНИЙ',to:'ТЕМНО-СИНИЙ'},
 {id:1703,from:'СВЕТЛО БЕЖЕВЫЙ',to:'СВЕТЛО-БЕЖЕВЫЙ'},
]
const ids=specs.map(x=>x.id), list=ids.join(',')
const quote=x=>String(x).replaceAll("'","''")
function call(q,write=false) {
 if(write) assert(apply&&q.startsWith('WITH preflight(ok) AS MATERIALIZED')&&q.includes('RETURNING id,color'),'Only guarded one-statement catalog rename permitted')
 else assert(/^\s*SELECT\b/i.test(q)&&!q.includes(';'),'SELECT-only for all reads')
 const raw=execFileSync('npx',['wrangler','d1','execute','orders_db_prod','--remote','--config',config,'--command='+q,'--json'],{encoding:'utf8',maxBuffer:12*1024*1024,timeout:90000})
 const v=JSON.parse(raw)
 assert(v.length===1&&v[0]?.success===true&&Array.isArray(v[0].results),'D1 SQL execution failed')
 return v[0]
}
const read=q=>call(q).results
const canonical=[
 {id:576,value:'СВЕТЛО-БЕЖЕВЫЙ'},
 {id:580,value:'ТЕМНО-СИНИЙ'},
 {id:50415,value:'ТЕМНО-КОРИЧНЕВЫЙ'},
]
const refRows=read('SELECT id,kind,value,is_active FROM reference_values WHERE id IN (576,580,50415) ORDER BY id')
assert.equal(refRows.length,3)
for(const c of canonical)assert(refRows.some(x=>x.id===c.id&&x.kind==='color'&&x.is_active===1&&x.value===c.value),'Canonical reference changed')
const variants=read('SELECT * FROM catalog_variants WHERE id IN ('+list+') ORDER BY id')
assert.equal(variants.length,specs.length)
const byId=new Map(variants.map(x=>[x.id,x]))
const norm=x=>String(x??'').trim().toUpperCase().replace(/[‐‑‒–—-]+/g,' ').replace(/\s+/g,' ').trim()
const prodIds=[...new Set(variants.map(v=>v.product_id))]
const related=read('SELECT id,product_id,stock_position_id,category,gender,color,size_label,is_active FROM catalog_variants WHERE product_id IN ('+prodIds.join(',')+') ORDER BY id')
for(const plan of specs){
 const v=byId.get(plan.id)
 assert(v,'Missing '+plan.id)
 assert.equal(v.color,plan.from,'Expected source spelling changed for '+plan.id)
 assert.equal(v.is_active,1)
 assert(Number.isSafeInteger(v.stock_position_id)&&v.stock_position_id>0)
 assert(v.updated_at,'Missing updated_at')
 assert(!related.some(x=>x.id!==v.id&&x.product_id===v.product_id&&x.stock_position_id===v.stock_position_id
   &&(x.category||'adult')===(v.category||'adult')&&(x.gender||'')===(v.gender||'')
   &&(x.size_label||'')===(v.size_label||'')&&norm(x.color)===norm(plan.to)),
   'Another active or archived SKU matches '+plan.id)
}
const stockSql='SELECT * FROM inventory_stock WHERE variant_id IN ('+list+') ORDER BY id'
const stockBefore=read(stockSql)
const byStock=new Map()
for(const s of stockBefore){
 assert(ids.includes(s.variant_id),'Unexpected stock source')
 assert(s.quantity>=0&&s.quantity<=1&&s.reserved_quantity===0,'Stock exposure changed; abort')
 const n=byStock.get(s.variant_id)||0;byStock.set(s.variant_id,n+1)
}
assert(specs.every(x=>(byStock.get(x.id)||0)>=1),'Expected stock row absent')
const reserveSql='SELECT id,variant_id,inventory_source,quantity,status FROM inventory_reservations WHERE variant_id IN ('+list+') AND status=\'active\' ORDER BY id'
const reservesBefore=read(reserveSql)
assert.equal(reservesBefore.length,0,'Cannot touch SKUs with reservations')
const orderSql='SELECT id,order_id,product_id,variant_id,product_name_snapshot,gender_snapshot,color_snapshot,material_snapshot,length_snapshot,size_snapshot FROM order_items WHERE variant_id IN ('+list+') ORDER BY id'
const ordersBefore=read(orderSql)
const ftsSql='SELECT rowid,order_id,search_text FROM order_search_items_fts WHERE rowid IN (SELECT id FROM order_items WHERE variant_id IN ('+list+')) ORDER BY rowid'
const ftsBefore=read(ftsSql)
assert.equal(ordersBefore.length,ftsBefore.length,'Existing search rows incomplete')
console.log('BATCH8_READONLY_PREFLIGHT='+JSON.stringify({ids,physical:stockBefore.reduce((n,x)=>n+x.quantity,0),reserved:0,stockRows:stockBefore.length,orderItems:ordersBefore.length,collisions:0}))
// PR mode will dry-run the fully generated SQL against local ephemeral SQLite.
// All eight source variants must match simultaneously. Gate is MATERIALIZED
// before any target row update; if any reference/stock/reservation changed,
// SQLite returns zero rows and touches no target variant.
const variantWhere=specs.map(x=>{
 const v=byId.get(x.id)
 return '(v.id='+v.id+' AND v.product_id='+v.product_id+' AND v.stock_position_id='+v.stock_position_id
  +' AND v.is_active=1 AND v.color=\''+quote(x.from)+'\' AND v.updated_at=\''+quote(v.updated_at)+'\''
  +' AND COALESCE(v.category,\'adult\')=\''+quote(v.category||'adult')+'\''
  +' AND COALESCE(v.gender,\'\')=\''+quote(v.gender||'')+'\''
  +' AND COALESCE(v.size_label,\'\')=\''+quote(v.size_label||'')+'\')'
}).join(' OR ')
const stockWhere=stockBefore.map(s=>'('+['id','variant_id','quantity','reserved_quantity'].map(k=>'st.'+k+'='+Number(s[k])).join(' AND ')
  +' AND st.updated_at '+(s.updated_at==null?'IS NULL':'=\''+quote(s.updated_at)+'\'')+')').join(' OR ')
const sql="WITH preflight(ok) AS MATERIALIZED (SELECT CASE WHEN "+
"(SELECT COUNT(*) FROM catalog_variants v WHERE v.id IN ("+list+") AND ("+variantWhere+"))=8 "+
"AND (SELECT COUNT(*) FROM inventory_stock WHERE variant_id IN ("+list+"))="+stockBefore.length+" "+
"AND NOT EXISTS(SELECT 1 FROM inventory_stock st WHERE st.variant_id IN ("+list+") AND NOT ("+stockWhere+")) "+
"AND (SELECT COUNT(*) FROM inventory_reservations WHERE variant_id IN ("+list+") AND status='active')=0 "+
"AND (SELECT COUNT(*) FROM reference_values WHERE kind='color' AND is_active=1 AND ((id=576 AND value='СВЕТЛО-БЕЖЕВЫЙ') OR (id=580 AND value='ТЕМНО-СИНИЙ') OR (id=50415 AND value='ТЕМНО-КОРИЧНЕВЫЙ')))=3 "+
"AND NOT EXISTS(SELECT 1 FROM catalog_variants v JOIN catalog_variants other ON other.id<>v.id AND other.product_id=v.product_id AND other.stock_position_id=v.stock_position_id AND COALESCE(other.category,'adult')=COALESCE(v.category,'adult') AND COALESCE(other.gender,'')=COALESCE(v.gender,'') AND COALESCE(other.size_label,'')=COALESCE(v.size_label,'') WHERE v.id IN ("+list+") AND UPPER(REPLACE(REPLACE(TRIM(COALESCE(other.color,'')),'‐',' '),'-',' '))=UPPER(REPLACE(REPLACE(TRIM(v.color),'‐',' '),'-',' '))) "+
"THEN 1 ELSE 0 END) "+
"UPDATE catalog_variants SET color=CASE id "+specs.map(x=>"WHEN "+x.id+" THEN '"+quote(x.to)+"'").join(' ')+" END, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') "+
"WHERE id IN ("+list+") AND (SELECT ok FROM preflight)=1 RETURNING id,color"
if(!apply){
 const {DatabaseSync}=await import('node:sqlite')
 function fixture(){
  const t=new DatabaseSync(':memory:')
  t.exec("CREATE TABLE catalog_variants(id INTEGER PRIMARY KEY,product_id INTEGER,stock_position_id INTEGER,is_active INTEGER,color TEXT,updated_at TEXT,category TEXT,gender TEXT,size_label TEXT)")
  t.exec("CREATE TABLE reference_values(id INTEGER PRIMARY KEY,kind TEXT,is_active INTEGER,value TEXT)")
  t.exec("CREATE TABLE inventory_stock(id INTEGER PRIMARY KEY,variant_id INTEGER,quantity INTEGER,reserved_quantity INTEGER,updated_at TEXT)")
  t.exec("CREATE TABLE inventory_reservations(variant_id INTEGER,status TEXT)")
  const add=t.prepare("INSERT INTO catalog_variants VALUES (?,?,?,?,?,?,?,?,?)")
  for(const x of related){
   const v=byId.get(x.id)||x
   add.run(x.id,x.product_id,x.stock_position_id,x.is_active,x.color,String(v.updated_at??''),x.category,x.gender,x.size_label)
  }
  const pr=t.prepare("INSERT INTO reference_values VALUES (?,?,?,?)")
  for(const x of refRows)pr.run(x.id,x.kind,x.is_active,x.value)
  const st=t.prepare("INSERT INTO inventory_stock VALUES (?,?,?,?,?)")
  for(const x of stockBefore)st.run(x.id,x.variant_id,x.quantity,x.reserved_quantity,x.updated_at)
  return t
 }
 // Positive in-memory replay must update all 8. Negative replay must update none.
 const good=fixture()
 const out=good.prepare(sql).all()
 assert.deepEqual(out.map(x=>x.id).sort((a,b)=>a-b),[...ids].sort((a,b)=>a-b),'Atomic local SQL update did not return exact 8 SKU')
 assert.equal(good.prepare("SELECT COUNT(*) n FROM catalog_variants WHERE color LIKE '%-%' AND id IN ("+list+")").get().n,8)
 good.close()
 const bad=fixture()
 bad.prepare('UPDATE inventory_stock SET quantity=quantity+9 WHERE id=?').run(stockBefore[0].id)
 assert.equal(bad.prepare(sql).all().length,0,'Concurrent stock change must fail closed for all 8')
 assert.equal(bad.prepare("SELECT COUNT(*) n FROM catalog_variants WHERE color LIKE '%-%' AND id IN ("+list+")").get().n,0)
 bad.close()
 console.log('BATCH8_SQL_ATOMIC_LOCAL_VERIFIED='+JSON.stringify({count:ids.length,stockDriftAbort:true}))
 console.log('BATCH8_PREVIEW_ONLY_NO_MUTATION')
 process.exit(0)
}
const applied=call(sql,true).results
assert.deepEqual(applied.map(x=>x.id).sort((a,b)=>a-b),[...ids].sort((a,b)=>a-b),'Not exactly eight expected updated SKU IDs')
for(const a of applied)assert.equal(a.color,specs.find(x=>x.id===a.id).to)
const after=read('SELECT * FROM catalog_variants WHERE id IN ('+list+') ORDER BY id')
assert.equal(after.length,8)
for(const v of after){
 const orig=byId.get(v.id),plan=specs.find(x=>x.id===v.id)
 assert.equal(v.color,plan.to)
 for(const k of Object.keys(orig).filter(k=>k!=='color'&&k!=='updated_at'))assert.deepEqual(v[k],orig[k],'Variant unexpected change '+v.id+' '+k)
}
assert.deepEqual(read(stockSql),stockBefore,'Stock mutated')
assert.deepEqual(read(reserveSql),reservesBefore,'Reservation mutated')
assert.deepEqual(read(orderSql),ordersBefore,'Order item mutated')
const ftsAfter=read(ftsSql)
assert.equal(ftsAfter.length,ordersBefore.length)
for(let i=0;i<ordersBefore.length;i++){
 const oi=ordersBefore[i],f=ftsAfter[i],plan=specs.find(x=>x.id===oi.variant_id)
 assert.equal(f.rowid,oi.id)
 assert.equal(f.order_id,oi.order_id)
 assert(f.search_text.includes(plan.to),'FTS text not updated '+oi.variant_id)
}
console.log('BATCH8_PRODUCTION_VERIFIED='+JSON.stringify({ids,stockRowsUnchanged:stockBefore.length,activeReserves:0,historicalOrderItemsKept:ordersBefore.length,ftsRows:ftsAfter.length,variantIdsAndOtherFieldsUntouched:true}))
