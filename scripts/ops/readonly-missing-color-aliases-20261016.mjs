// Live production investigation of missing color references and normalized aliases.
// Every remote SQL query is SELECT-only. No customer, order or financial data.
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import fs from 'node:fs'
assert.equal(process.env.GITHUB_EVENT_NAME,'pull_request','PR only')
assert.equal(process.env.GITHUB_BASE_REF,'main','Main-targeted read-only audit only')
assert.equal(process.env.GITHUB_ACTIONS,'true')
const config=process.env.PROD_READONLY_CONFIG
assert(config&&fs.readFileSync(config,'utf8').includes('"database_id": "17e68a41-1d58-4a36-8a63-47c3e32443c4"'))
function read(q) {
  assert(/^SELECT\s/i.test(q)&&!q.includes(';'),'Only single SELECT statements allowed')
  const raw=execFileSync('npx',['wrangler','d1','execute','orders_db_prod','--remote','--config',config,'--command='+q,'--json'],{encoding:'utf8',maxBuffer:24*1024*1024,timeout:90000})
  const v=JSON.parse(raw)
  assert(v.length===1&&v[0].success===true&&Array.isArray(v[0].results),'Remote D1 read failed')
  return v[0].results
}
let cursor=0,variants=[]
for(let i=0;i<30;i++){
 const page=read('SELECT v.id,v.product_id,v.stock_position_id,v.category,v.gender,v.color,v.material,v.length,v.size_label,v.is_active,p.name AS product,p.is_active AS product_active FROM catalog_variants v JOIN catalog_products p ON p.id=v.product_id WHERE v.id>'+cursor+' ORDER BY v.id LIMIT 401')
 assert(page.every((v,k)=>Number.isSafeInteger(v.id)&&v.id>(k===0?cursor:page[k-1].id)),'Pagination not ordered')
 variants.push(...page.slice(0,400))
 if(page.length<=400)break
 if(i===29)throw Error('Variant inventory scan incomplete')
 cursor=page[399].id
}
assert(variants.length>1700&&variants.length<5000,'Unexpected production catalog size')
const refs=read("SELECT id,value,is_active FROM reference_values WHERE kind='color' ORDER BY id")
const active=variants.filter(v=>v.is_active===1&&v.product_active===1)
const canon=v=>String(v??'').normalize('NFKC').toLocaleUpperCase('ru-RU').replace(/Ё/g,'Е').replace(/[‐‑‒–—−-]+/g,' ').replace(/\s+/g,' ').trim()
const display=v=>String(v??'').trim()
const refNorm=new Map()
for(const r of refs.filter(x=>x.is_active===1)){const k=canon(r.value);const group=refNorm.get(k)||[];group.push(r);refNorm.set(k,group)}
const byColor=new Map(),allByColor=new Map()
for(const v of active){const k=canon(v.color),group=byColor.get(k)||[];group.push(v);byColor.set(k,group)}
for(const v of variants){const k=canon(v.color),group=allByColor.get(k)||[];group.push(v);allByColor.set(k,group)}
const identity=v=>[v.product_id,v.stock_position_id??('legacy:'+canon(v.material)+'/'+canon(v.length)),canon(v.category||'adult'),canon(v.gender),canon(v.color),canon(v.size_label)].join('|')
const byIdentity=new Map()
for(const v of variants){const k=identity(v),xs=byIdentity.get(k)||[];xs.push(v);byIdentity.set(k,xs)}
const missing=[...byColor.entries()].filter(([key,xs])=>key&&!refNorm.has(key)).map(([key,xs])=>{
 const forms=[...new Set(xs.map(x=>display(x.color)))].sort((a,b)=>a.localeCompare(b,'ru'))
 const siblings=xs.flatMap(v=>(byIdentity.get(identity(v))||[]).filter(other=>other.id!==v.id).map(other=>({id:v.id,otherId:other.id,otherActive:other.is_active===1,product:v.product,size:v.size_label,material:v.material,length:v.length})))
 return {normalized:key,count:xs.length,forms,ids:xs.map(x=>x.id).sort((a,b)=>a-b),collisionPairs:siblings}
}).sort((a,b)=>b.count-a.count||a.normalized.localeCompare(b.normalized,'ru'))
const aliases=missing.filter(g=>g.forms.length>1)
const targetNames=['ТЕМНО СЕРЫЙ','ТЕМНО БОРДОВЫЙ']
const targets=targetNames.map(name=>{
 const k=canon(name),xs=byColor.get(k)||[],all=allByColor.get(k)||[]
 const identityCollisions=xs.flatMap(v=>(byIdentity.get(identity(v))||[]).filter(other=>other.id!==v.id).map(other=>({sourceId:v.id,collidesWith:other.id,otherActive:other.is_active===1})))
 return {requested:name,normalized:k,activeVariants:xs.length,exactSpaceWritten:xs.filter(v=>display(v.color)===name).length,
  existingCatalogSpellings:[...new Set(all.map(x=>display(x.color)))].sort((a,b)=>a.localeCompare(b,'ru')),
  activeSpellingCounts:[...new Set(xs.map(v=>display(v.color)))].map(color=>({color,count:xs.filter(x=>display(x.color)===color).length})),
  archivedVariantIds:all.filter(x=>x.is_active!==1||x.product_active!==1).map(x=>x.id),
  exactAndNormalizedActiveRefs:(refNorm.get(k)||[]).map(r=>({id:r.id,value:r.value})),
  inactiveReferenceMatches:refs.filter(r=>r.is_active!==1&&canon(r.value)===k).map(r=>({id:r.id,value:r.value})),
  identityCollisions,rows:xs.map(v=>({id:v.id,product:v.product,stock_position_id:v.stock_position_id,category:v.category,gender:v.gender,material:v.material,length:v.length,size:v.size_label,color:display(v.color)})).sort((a,b)=>a.id-b.id)}
})
assert(targets[0].activeVariants===18&&targets[1].activeVariants===5,'Expected 18+5 missing reference SKUs; no automated mutation allowed')
const ids=targets.flatMap(x=>x.rows.map(y=>y.id))
assert(ids.length===23&&new Set(ids).size===23)
const list=ids.join(',')
const stock=read('SELECT variant_id,inventory_source,SUM(quantity) AS physical,SUM(reserved_quantity) AS reserved,COUNT(*) AS stockRows FROM inventory_stock WHERE variant_id IN ('+list+') GROUP BY variant_id,inventory_source ORDER BY variant_id,inventory_source')
const reserves=read("SELECT variant_id,inventory_source,SUM(quantity) AS reserved,COUNT(*) AS reservationRows FROM inventory_reservations WHERE status='active' AND variant_id IN ("+list+") GROUP BY variant_id,inventory_source ORDER BY variant_id,inventory_source")
const key=(id,source)=>id+'|'+source
for(const s of stock){const r=reserves.find(r=>key(r.variant_id,r.inventory_source)===key(s.variant_id,s.inventory_source));assert.equal(s.reserved,r?.reserved||0,'Reservation mismatch '+s.variant_id+' '+s.inventory_source)}
for(const r of reserves)assert(stock.some(s=>key(s.variant_id,s.inventory_source)===key(r.variant_id,r.inventory_source)),'Reserve without stock '+r.variant_id)
for(const t of targets){
 const idSet=new Set(t.rows.map(r=>r.id)),st=stock.filter(x=>idSet.has(x.variant_id)),res=reserves.filter(x=>idSet.has(x.variant_id))
 t.physical=st.reduce((n,x)=>n+x.physical,0)
 t.reserved=st.reduce((n,x)=>n+x.reserved,0)
 t.stockRows=st.reduce((n,x)=>n+x.stockRows,0)
 t.reservationRows=res.reduce((n,x)=>n+x.reservationRows,0)
 t.rows=t.rows.map(row=>({...row,physical:st.filter(x=>x.variant_id===row.id).reduce((n,x)=>n+x.physical,0),reserved:st.filter(x=>x.variant_id===row.id).reduce((n,x)=>n+x.reserved,0)}))
}
const nearColors=[...new Set([...variants.map(v=>display(v.color)),...refs.map(r=>display(r.value))])]
  .filter(x=>/СЕР|БОРД|ТЕМН/i.test(canon(x))).sort((a,b)=>a.localeCompare(b,'ru'))
const stockIntegrity={
 orphanStock:read('SELECT COUNT(*) n FROM inventory_stock s LEFT JOIN catalog_variants v ON v.id=s.variant_id WHERE s.variant_id IS NOT NULL AND v.id IS NULL')[0].n,
 activeReserveMismatch:read("SELECT COUNT(*) n FROM inventory_stock s WHERE s.reserved_quantity<>COALESCE((SELECT SUM(r.quantity) FROM inventory_reservations r WHERE r.variant_id=s.variant_id AND r.inventory_source=s.inventory_source AND r.status='active'),0)")[0].n
}
console.log('MISSING_COLOR_ALIAS_AUDIT_JSON='+JSON.stringify({scanned:{variants:variants.length,active:active.length,colorReferences:refs.length},missingColorGroups:missing,missingColorAliasGroups:aliases,targets,nearColors,stockIntegrity,productionWrites:false}))
console.log('MISSING_COLOR_ALIAS_AUDIT_READONLY_SUCCESS')
