// Production READ-ONLY exhaustive catalog/reference report. No customer/payment details.
import {execFileSync} from 'node:child_process'
import fs from 'node:fs'
import assert from 'node:assert/strict'
const config=process.env.PROD_READONLY_CONFIG
assert(process.env.GITHUB_EVENT_NAME==='pull_request')
assert(config&&fs.readFileSync(config,'utf8').includes('"database_id": "17e68a41-1d58-4a36-8a63-47c3e32443c4"'))
function sql(q) {
 assert(/^\s*SELECT\b/i.test(q)&&!q.includes(';'),'SELECT-only')
 const output=execFileSync('npx',['wrangler','d1','execute','orders_db_prod','--remote','--config',config,'--command='+q,'--json'],{encoding:'utf8',timeout:90000,maxBuffer:16*1024*1024})
 const j=JSON.parse(output)
 assert(j.length===1&&j[0]?.success===true&&Array.isArray(j[0].results),'D1 read failed')
 return j[0].results
}
function all(q,limit=400){
 let cursor=0,rows=[],done=false
 for(let n=0;n<30;n++){
  const out=sql(q.replace('__CURSOR__',String(cursor)).replace('__LIMIT__',String(limit+1)))
  assert(out.every((v,i)=>Number.isSafeInteger(v.id)&&v.id>(i===0?cursor:out[i-1].id)),'Unstable query paging')
  rows.push(...out.slice(0,limit))
  if(out.length<=limit){done=true;break}
  cursor=out[limit-1].id
 }
 assert(done,'Incomplete scan')
 return rows
}
const norm=v=>String(v??'').trim().toLocaleUpperCase('ru-RU').replace(/\s+/g,' ')
const idn=v=>norm(v).replace(/[‐‑‒–—-]+/g,' ').replace(/\s+/g,' ').trim()
const refs=all("SELECT id,kind,value,is_active FROM reference_values WHERE id>__CURSOR__ ORDER BY id LIMIT __LIMIT__")
const variants=all("SELECT v.id,v.product_id,v.stock_position_id,v.category,v.gender,v.color,v.material,v.length,v.size_label,v.is_active,p.name AS product,p.is_active AS product_active,COALESCE(SUM(st.quantity),0) AS physical,COALESCE(SUM(st.reserved_quantity),0) AS reserved FROM catalog_variants v JOIN catalog_products p ON p.id=v.product_id LEFT JOIN inventory_stock st ON st.variant_id=v.id WHERE v.id>__CURSOR__ GROUP BY v.id ORDER BY v.id LIMIT __LIMIT__")
const stockPositions=all("SELECT id,product_id,material,length,is_active FROM catalog_stock_positions WHERE id>__CURSOR__ ORDER BY id LIMIT __LIMIT__")
const active=variants.filter(v=>v.is_active===1&&v.product_active===1)
const refIndex=new Map()
for(const r of refs.filter(r=>r.is_active===1)){
 const k=r.kind+'|'+idn(r.value),xs=refIndex.get(k)||[];xs.push(r);refIndex.set(k,xs)
}
const skuIdentity=v=>[v.product_id,v.stock_position_id??('legacy:'+idn(v.material)+'/'+idn(v.length)),norm(v.category||'adult'),norm(v.gender),idn(v.color),norm(v.size_label)==='БЕЗ РАЗМЕРА'?'':norm(v.size_label)].join('|')
const skuGroups=new Map()
for(const v of variants){const k=skuIdentity(v),xs=skuGroups.get(k)||[];xs.push(v);skuGroups.set(k,xs)}
const dims=[['color','color'],['material','material'],['length','length'],['adult_size','size_label'],['child_age','size_label']]
const observed=[]
for(const [kind,column] of dims)for(const v of active){
 if(column==='size_label'&&(kind==='adult_size')===(v.category==='child'))continue
 const value=norm(v[column]);if(!value)continue
 const refKind=kind==='adult_size'?'size':kind
 const ref=refIndex.get(refKind+'|'+idn(value))||[]
 const match=ref.some(x=>norm(x.value)===value)
 const siblings=(skuGroups.get(skuIdentity(v))||[]).filter(x=>x.id!==v.id)
 observed.push({id:v.id,product:v.product,kind,from:value,
  status:!ref.length?'MISSING_REFERENCE':match?'EXACT_REFERENCE':'SPELLING_EQUIVALENT',
  refs:ref.map(x=>({id:x.id,value:x.value})),physical:v.physical,reserved:v.reserved,
  siblings:siblings.map(x=>({id:x.id,active:x.is_active,physical:x.physical,reserved:x.reserved})),
 })
}
const grouped=new Map()
for(const row of observed.filter(x=>x.status!=='EXACT_REFERENCE')){
 const k=row.kind+'|'+row.status+'|'+row.from,xs=grouped.get(k)||[];xs.push(row);grouped.set(k,xs)
}
const mismatches=[...grouped.values()].map(xs=>({
 kind:xs[0].kind,from:xs[0].from,status:xs[0].status,
 refs:xs[0].refs,count:xs.length,
 physical:xs.reduce((n,x)=>n+Number(x.physical||0),0),
 reserved:xs.reduce((n,x)=>n+Number(x.reserved||0),0),
 collisions:xs.filter(x=>x.siblings.length>0).length,
 candidates:xs.map(x=>({id:x.id,product:x.product,physical:x.physical,reserved:x.reserved,conflictingIds:x.siblings.map(s=>s.id)}))
})).sort((a,b)=>a.kind.localeCompare(b.kind)||b.count-a.count)
const dupSku=[...skuGroups.values()].filter(xs=>xs.filter(x=>x.is_active===1&&x.product_active===1).length>=1&&xs.length>1).map(xs=>({
 type:xs.filter(x=>x.is_active===1).length>1?'ACTIVE_ACTIVE':'ACTIVE_ARCHIVED',product:xs[0].product,
 variants:xs.map(v=>({id:v.id,active:v.is_active,physical:v.physical,reserved:v.reserved,color:v.color,material:v.material,length:v.length,size:v.size_label}))
}))
const dupRefs=[...refIndex.entries()].filter(([k,xs])=>xs.length>1).map(([k,xs])=>({identity:k,values:xs.map(x=>({id:x.id,value:x.value}))}))
const refUsed=new Set(observed.map(x=>(x.kind==='adult_size'?'size':x.kind)+'|'+idn(x.from)))
const unusedRefs=refs.filter(r=>r.is_active===1&&['color','material','length','size','child_age'].includes(r.kind)&&!refUsed.has(r.kind+'|'+idn(r.value))).map(r=>({id:r.id,kind:r.kind,value:r.value}))
const orphanStock=sql("SELECT COUNT(*) n FROM inventory_stock s LEFT JOIN catalog_variants v ON v.id=s.variant_id WHERE s.variant_id IS NOT NULL AND v.id IS NULL")[0].n
const archivedStock=sql("SELECT COUNT(*) n FROM inventory_stock s JOIN catalog_variants v ON v.id=s.variant_id LEFT JOIN catalog_products p ON p.id=v.product_id WHERE (s.quantity<>0 OR s.reserved_quantity<>0) AND (v.is_active<>1 OR p.is_active<>1)")[0].n
const reserveMismatch=sql("SELECT COUNT(*) n FROM inventory_stock s WHERE s.reserved_quantity<>COALESCE((SELECT SUM(r.quantity) FROM inventory_reservations r WHERE r.variant_id=s.variant_id AND r.inventory_source=s.inventory_source AND r.status='active'),0)")[0].n
console.log('FULL_CHARACTERISTIC_AUDIT_JSON='+JSON.stringify({
 scanned:{variants:variants.length,active:active.length,refs:refs.length,stockPositions:stockPositions.length},
 mismatches,duplicates:dupSku,referenceDuplicates:dupRefs,unusedReferences:unusedRefs,
 inventoryIntegrity:{orphanStock,archivedStock,reserveMismatch}
}))
console.log('FULL_CHARACTERISTIC_AUDIT_READONLY_SUCCESS')
