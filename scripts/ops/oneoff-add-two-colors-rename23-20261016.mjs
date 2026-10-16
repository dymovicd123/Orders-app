// Exact 23 source-SKU color rename plus creation of two genuinely missing color references.
// PR only reads production and rehearses both writes locally. Merge to main enables write.
// Explicitly never updates inventory_stock/reservations/order_items/stocktake/finance.
import {execFileSync} from 'node:child_process'
import assert from 'node:assert/strict'
import fs from 'node:fs'
const config=process.env.PROD_CANARY_CONFIG
assert(config&&fs.readFileSync(config,'utf8').includes('"database_id": "17e68a41-1d58-4a36-8a63-47c3e32443c4"'))
const apply=process.env.APPLY_NEW_COLOR23==='yes'
if(apply) {
 assert.equal(process.env.GITHUB_EVENT_NAME,'push')
 assert.equal(process.env.GITHUB_REF,'refs/heads/main')
}
const specs=[
 {id:1287,from:'ТЕМНО СЕРЫЙ',to:'ТЕМНО-СЕРЫЙ'},
 {id:1310,from:'ТЕМНО СЕРЫЙ',to:'ТЕМНО-СЕРЫЙ'},
 {id:1311,from:'ТЕМНО СЕРЫЙ',to:'ТЕМНО-СЕРЫЙ'},
 {id:1346,from:'ТЕМНО СЕРЫЙ',to:'ТЕМНО-СЕРЫЙ'},
 {id:1347,from:'ТЕМНО СЕРЫЙ',to:'ТЕМНО-СЕРЫЙ'},
 {id:1348,from:'ТЕМНО СЕРЫЙ',to:'ТЕМНО-СЕРЫЙ'},
 {id:1353,from:'ТЕМНО СЕРЫЙ',to:'ТЕМНО-СЕРЫЙ'},
 {id:1357,from:'ТЕМНО СЕРЫЙ',to:'ТЕМНО-СЕРЫЙ'},
 {id:1429,from:'ТЕМНО СЕРЫЙ',to:'ТЕМНО-СЕРЫЙ'},
 {id:1506,from:'ТЕМНО СЕРЫЙ',to:'ТЕМНО-СЕРЫЙ'},
 {id:1590,from:'ТЕМНО СЕРЫЙ',to:'ТЕМНО-СЕРЫЙ'},
 {id:1592,from:'ТЕМНО СЕРЫЙ',to:'ТЕМНО-СЕРЫЙ'},
 {id:1603,from:'ТЕМНО СЕРЫЙ',to:'ТЕМНО-СЕРЫЙ'},
 {id:1757,from:'ТЕМНО СЕРЫЙ',to:'ТЕМНО-СЕРЫЙ'},
 {id:1766,from:'ТЕМНО СЕРЫЙ',to:'ТЕМНО-СЕРЫЙ'},
 {id:1767,from:'ТЕМНО СЕРЫЙ',to:'ТЕМНО-СЕРЫЙ'},
 {id:1775,from:'ТЕМНО СЕРЫЙ',to:'ТЕМНО-СЕРЫЙ'},
 {id:1776,from:'ТЕМНО СЕРЫЙ',to:'ТЕМНО-СЕРЫЙ'},
 {id:1554,from:'ТЕМНО БОРДОВЫЙ',to:'ТЕМНО-БОРДОВЫЙ'},
 {id:1555,from:'ТЕМНО БОРДОВЫЙ',to:'ТЕМНО-БОРДОВЫЙ'},
 {id:1556,from:'ТЕМНО БОРДОВЫЙ',to:'ТЕМНО-БОРДОВЫЙ'},
 {id:1557,from:'ТЕМНО БОРДОВЫЙ',to:'ТЕМНО-БОРДОВЫЙ'},
 {id:1558,from:'ТЕМНО БОРДОВЫЙ',to:'ТЕМНО-БОРДОВЫЙ'},
]
const ids=specs.map(x=>x.id), list=ids.join(',')
const quote=x=>String(x).replaceAll("'","''")
function call(q,write=false) {
 if(write) assert(apply&&q.startsWith('WITH preflight(ok) AS MATERIALIZED')&&((q.includes('INSERT INTO reference_values')&&q.includes('RETURNING id,kind,value'))||(q.includes('UPDATE catalog_variants')&&q.includes('RETURNING id,color'))),'Only two guarded mutation statements permitted')
 else assert(/^\s*SELECT\b/i.test(q)&&!q.includes(';'),'SELECT-only for all reads')
 const raw=execFileSync('npx',['wrangler','d1','execute','orders_db_prod','--remote','--config',config,'--command='+q,'--json'],{encoding:'utf8',maxBuffer:12*1024*1024,timeout:90000})
 const v=JSON.parse(raw)
 assert(v.length===1&&v[0]?.success===true&&Array.isArray(v[0].results),'D1 SQL execution failed')
 return v[0]
}
const read=q=>call(q).results
const desired=['ТЕМНО-СЕРЫЙ','ТЕМНО-БОРДОВЫЙ']
const originalReferences=read("SELECT id,kind,value,is_active,sort_order,created_at,updated_at FROM reference_values WHERE kind='color' ORDER BY id")
const normRef=x=>String(x??'').normalize('NFKC').trim().toLocaleUpperCase('ru-RU').replace(/Ё/g,'Е').replace(/[‐‑‒–—−-]+/g,' ').replace(/\\s+/g,' ').trim()
const matchingRefs=originalReferences.filter(x=>desired.some(w=>normRef(x.value)===normRef(w)))
assert(matchingRefs.length===0 || (matchingRefs.length===2&&desired.every(w=>matchingRefs.some(x=>x.value===w&&x.is_active===1))),'Unexpected matching reference; stop')
const asphaltBefore=originalReferences.find(x=>x.id===582)
assert(asphaltBefore&&asphaltBefore.value==='ТЕМНЫЙ МОКРЫЙ АСФАЛЬТ'&&asphaltBefore.is_active===1,'Asphalt is distinct and must remain unchanged')
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
 assert(Number.isSafeInteger(s.quantity)&&Number.isSafeInteger(s.reserved_quantity)&&s.quantity>=0&&s.reserved_quantity>=0,'Invalid stock')
 const n=byStock.get(s.variant_id)||0;byStock.set(s.variant_id,n+1)
}
assert(stockBefore.length>0,'No stock snapshot')
const reserveSql='SELECT id,variant_id,inventory_source,quantity,status FROM inventory_reservations WHERE variant_id IN ('+list+') AND status=\'active\' ORDER BY id'
const reservesBefore=read(reserveSql)
const key=(id,source)=>id+'|'+source
const reserveTotals=new Map()
for(const res of reservesBefore){
 assert(ids.includes(res.variant_id)&&Number.isSafeInteger(res.quantity)&&res.quantity>0,'Invalid active reserve')
 const k=key(res.variant_id,res.inventory_source)
 reserveTotals.set(k,(reserveTotals.get(k)||0)+res.quantity)
}
for(const stock of stockBefore)assert.equal(stock.reserved_quantity,reserveTotals.get(key(stock.variant_id,stock.inventory_source))||0,'Stock/reserve mismatch '+stock.id)
assert.equal([...reserveTotals.values()].reduce((x,y)=>x+y,0),stockBefore.reduce((x,y)=>x+y.reserved_quantity,0),'Total reserve mismatch')
const orderSql='SELECT id,order_id,product_id,variant_id,product_name_snapshot,gender_snapshot,color_snapshot,material_snapshot,length_snapshot,size_snapshot FROM order_items WHERE variant_id IN ('+list+') ORDER BY id'
const ordersBefore=read(orderSql)
const ftsSql='SELECT rowid,order_id,search_text FROM order_search_items_fts WHERE rowid IN (SELECT id FROM order_items WHERE variant_id IN ('+list+')) ORDER BY rowid'
const ftsBefore=read(ftsSql)
assert.equal(ordersBefore.length,ftsBefore.length,'Existing search rows incomplete')
console.log('NEW_COLOR23_READONLY_PREFLIGHT='+JSON.stringify({ids,physical:stockBefore.reduce((n,x)=>n+x.quantity,0),reserved:stockBefore.reduce((n,x)=>n+x.reserved_quantity,0),stockRows:stockBefore.length,activeReservationRows:reservesBefore.length,orderItems:ordersBefore.length,collisions:0,referenceState:matchingRefs.length===0?'missing':'already-both-created'}))
// PR mode will dry-run the fully generated SQL against local ephemeral SQLite.
// All 23 source variants must match simultaneously. Gate is MATERIALIZED
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
const reserveWhere=reservesBefore.map(res=>'('+['id','variant_id','quantity'].map(k=>'r.'+k+'='+Number(res[k])).join(' AND ')
 + ' AND r.inventory_source '+(res.inventory_source==null?'IS NULL':"='"+quote(res.inventory_source)+"'")
 + " AND r.status='active')").join(' OR ')||'0'
const refGate="((id=50419 AND value='СВЕТЛО-СЕРЫЙ') OR (id=576 AND value='СВЕТЛО-БЕЖЕВЫЙ') OR (id=580 AND value='ТЕМНО-СИНИЙ') OR (id=50415 AND value='ТЕМНО-КОРИЧНЕВЫЙ'))"
const sql="WITH preflight(ok) AS MATERIALIZED (SELECT CASE WHEN "+
"(SELECT COUNT(*) FROM catalog_variants v WHERE v.id IN ("+list+") AND ("+variantWhere+"))="+specs.length+" "+
"AND (SELECT COUNT(*) FROM inventory_stock WHERE variant_id IN ("+list+"))="+stockBefore.length+" "+
"AND NOT EXISTS(SELECT 1 FROM inventory_stock st WHERE st.variant_id IN ("+list+") AND NOT ("+stockWhere+")) "+
"AND (SELECT COUNT(*) FROM inventory_reservations WHERE variant_id IN ("+list+") AND status='active')="+reservesBefore.length+" "+
"AND NOT EXISTS(SELECT 1 FROM inventory_reservations r WHERE r.variant_id IN ("+list+") AND r.status='active' AND NOT ("+reserveWhere+")) "+
"AND (SELECT COUNT(*) FROM reference_values WHERE kind='color' AND is_active=1 AND "+refGate+")=4 "+
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
  t.exec("CREATE TABLE inventory_reservations(id INTEGER,variant_id INTEGER,inventory_source TEXT,quantity INTEGER,status TEXT)")
  const add=t.prepare("INSERT INTO catalog_variants VALUES (?,?,?,?,?,?,?,?,?)")
  for(const x of related){
   const v=byId.get(x.id)||x
   add.run(x.id,x.product_id,x.stock_position_id,x.is_active,x.color,String(v.updated_at??''),x.category,x.gender,x.size_label)
  }
  const pr=t.prepare("INSERT INTO reference_values VALUES (?,?,?,?)")
  for(const x of refRows)pr.run(x.id,x.kind,x.is_active,x.value)
  const st=t.prepare("INSERT INTO inventory_stock VALUES (?,?,?,?,?)")
  for(const x of stockBefore)st.run(x.id,x.variant_id,x.quantity,x.reserved_quantity,x.updated_at)
  const ins=t.prepare('INSERT INTO inventory_reservations VALUES (?,?,?,?,?)')
  for(const res of reservesBefore)ins.run(res.id,res.variant_id,res.inventory_source,res.quantity,res.status)
  return t
 }
 // Positive replay must update 26, any stock or reservation drift must abort all.
 const good=fixture()
 const out=good.prepare(sql).all()
 assert.deepEqual(out.map(x=>x.id).sort((a,b)=>a-b),[...ids].sort((a,b)=>a-b),'Atomic local SQL update did not return exact 26 SKU')
 assert.equal(good.prepare("SELECT COUNT(*) n FROM catalog_variants WHERE color LIKE '%-%' AND id IN ("+list+")").get().n,26)
 good.close()
 const badReserve=fixture()
 if(reservesBefore.length){badReserve.prepare('UPDATE inventory_reservations SET quantity=quantity+1 WHERE id=?').run(reservesBefore[0].id);assert.equal(badReserve.prepare(sql).all().length,0,'Reserve drift must fail closed')}
 badReserve.close()
 const bad=fixture()
 bad.prepare('UPDATE inventory_stock SET quantity=quantity+9 WHERE id=?').run(stockBefore[0].id)
 assert.equal(bad.prepare(sql).all().length,0,'Concurrent stock change must fail closed for all 8')
 assert.equal(bad.prepare("SELECT COUNT(*) n FROM catalog_variants WHERE color LIKE '%-%' AND id IN ("+list+")").get().n,0)
 bad.close()
 console.log('REMAINING26_SQL_ATOMIC_LOCAL_VERIFIED='+JSON.stringify({count:ids.length,stockDriftAbort:true}))
 console.log('REMAINING26_PREVIEW_ONLY_NO_MUTATION')
 process.exit(0)
}
const applied=call(sql,true).results
assert.deepEqual(applied.map(x=>x.id).sort((a,b)=>a-b),[...ids].sort((a,b)=>a-b),'Not exactly 26 expected updated SKU IDs')
for(const a of applied)assert.equal(a.color,specs.find(x=>x.id===a.id).to)
const after=read('SELECT * FROM catalog_variants WHERE id IN ('+list+') ORDER BY id')
assert.equal(after.length,26)
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
console.log('REMAINING26_PRODUCTION_VERIFIED='+JSON.stringify({ids,stockRowsUnchanged:stockBefore.length,activeReserves:reservesBefore.length,reservedUnits:stockBefore.reduce((n,x)=>n+x.reserved_quantity,0),historicalOrderItemsKept:ordersBefore.length,ftsRows:ftsAfter.length,variantIdsAndOtherFieldsUntouched:true}))
