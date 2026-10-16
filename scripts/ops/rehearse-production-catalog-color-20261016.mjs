// READ-ONLY production D1 -> ephemeral SQLite REPLICA. No production writes.
// Also never writes to branch2 D1. Run only under GH Actions, approved D1 ID.
import { DatabaseSync } from 'node:sqlite'
import { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'

const databaseName='orders_db_prod'
const config=process.env.PROD_READONLY_CONFIG
assert(config && fs.readFileSync(config,'utf8').includes('"database_id": "17e68a41-1d58-4a36-8a63-47c3e32443c4"'),
  'Explicit production read-only identity is required')
assert(process.env.GITHUB_ACTIONS==='true','Use isolated GitHub Actions runner only')

function read(sql) {
  assert(/^SELECT\s/i.test(sql), 'Only a SELECT may reach production')
  assert(!/;/.test(sql), 'Single read-only statement only')
  const raw=execFileSync('npx',['wrangler','d1','execute',databaseName,'--remote','--config',config,'--command='+sql,'--json'],{
    encoding:'utf8',maxBuffer:32*1024*1024,timeout:90000,stdio:['ignore','pipe','pipe'],
  })
  const r=JSON.parse(raw)
  assert(Array.isArray(r)&&r.length===1&&r[0].success===true&&Array.isArray(r[0].results),'D1 read failed')
  return r[0].results
}
const all=[]
let cursor=0
for(let pass=0;pass<30;pass++){
  const page=read('SELECT * FROM catalog_variants WHERE id>'+cursor+' ORDER BY id LIMIT 401')
  assert(page.every((v,i)=>Number.isSafeInteger(v.id)&&v.id>(i===0?cursor:page[i-1].id)),'Cursor changed during scan')
  all.push(...page.slice(0,400))
  if(page.length<=400)break
  cursor=page[399].id
  if(pass===29)throw Error('Incomplete variant scan')
}
assert(all.length>1700&&all.length<12000,'Unexpected catalog variant inventory size')
const candidates=all.filter(v=>v.is_active===1&&['СВЕТЛО СЕРЫЙ','ТЕМНО СИНИЙ'].includes(v.color))
assert(candidates.length>=28&&candidates.length<=50,'Live candidates changed; review again')
const targetNames=new Map([['СВЕТЛО СЕРЫЙ','СВЕТЛО-СЕРЫЙ'],['ТЕМНО СИНИЙ','ТЕМНО-СИНИЙ']])
const refs=read("SELECT id,value,is_active FROM reference_values WHERE kind='color' AND id IN(50419,580)")
assert(refs.length===2&&refs.every(r=>r.is_active===1),'Missing live keeper reference')
assert(refs.some(x=>x.id===50419&&x.value==='СВЕТЛО-СЕРЫЙ'))
assert(refs.some(x=>x.id===580&&x.value==='ТЕМНО-СИНИЙ'))
const catalogDDL=read("SELECT sql FROM sqlite_master WHERE type='table' AND name='catalog_variants'")[0]?.sql
assert(catalogDDL?.startsWith('CREATE TABLE'),'Missing actual production DDL')
const triggers=read("SELECT name,sql FROM sqlite_master WHERE type='trigger' AND tbl_name='catalog_variants' ORDER BY name")
assert.equal(triggers.length,0,'Production has catalog_variants UPDATE triggers not yet reproduced in rehearsal; STOP')
const indexes=read("SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name='catalog_variants' AND sql IS NOT NULL")
  .map(x=>x.sql).filter(x=>/CREATE UNIQUE INDEX/i.test(x))
const fixture=new DatabaseSync(':memory:')
// Parent rows are deliberately not imported: no customer/order data and no cross-DB merge.
// The operation never changes foreign-key columns, so the replica enforces real
// production UNIQUE indexes while omitting unrelated FK parent tables.
fixture.exec('PRAGMA foreign_keys=OFF')
fixture.exec(catalogDDL)
const keys=Object.keys(all[0])
assert(keys.every(k=>/^[a-z_]+$/i.test(k)),'Unexpected identifier in snapshot')
const add=fixture.prepare('INSERT INTO catalog_variants ('+keys.join(',')+') VALUES ('+keys.map(()=>'?').join(',')+')')
for(const row of all)add.run(...keys.map(k=>row[k]))
for(const sql of indexes)fixture.exec(sql) // reproduce real production UNIQUE constraints
const ids=candidates.map(v=>v.id)
const stock=read('SELECT id,variant_id,inventory_source,quantity,reserved_quantity,color_snapshot,updated_at FROM inventory_stock WHERE variant_id IN ('+ids.join(',')+') ORDER BY id')
const reservations=read("SELECT variant_id,inventory_source,COALESCE(SUM(quantity),0) AS qty FROM inventory_reservations WHERE status='active' AND variant_id IN ("+ids.join(',')+") GROUP BY variant_id,inventory_source")
fixture.exec('CREATE TABLE inventory_stock (id INTEGER PRIMARY KEY,variant_id INTEGER,inventory_source TEXT,quantity INTEGER,reserved_quantity INTEGER,color_snapshot TEXT,updated_at TEXT)')
const put=fixture.prepare('INSERT INTO inventory_stock VALUES (?,?,?,?,?,?,?)')
for(const s of stock)put.run(s.id,s.variant_id,s.inventory_source,s.quantity,s.reserved_quantity,s.color_snapshot,s.updated_at)
const stamp='2026-10-16T00:00:00.000Z'
const normColor=x=>String(x??'').toUpperCase().replace(/[‐-‒–—-]+/g,' ').replace(/\s+/g,' ').trim()
const variantKey=v=>[v.product_id,v.stock_position_id??('legacy:'+v.material+'/'+v.length),v.category||'adult',v.gender||'',normColor(v.color),v.size_label||''].join('|')
const byKey=new Map()
for(const v of all){const k=variantKey(v),xs=byKey.get(k)||[];xs.push(v);byKey.set(k,xs)}
const collisions=[],safe=[]
for(const v of candidates){
 const same=(byKey.get(variantKey(v))||[]).filter(x=>x.id!==v.id)
 if(same.length){collisions.push({id:v.id,conflictingIds:same.map(x=>x.id)});continue}
 // Source in old foreign key / snapshot tables remains same ID. No re-pointing.
 safe.push(v)
}
assert(collisions.some(x=>x.id===1532)&&collisions.some(x=>x.id===1533),'Missing known DRAP duplicate isolation')
const beforeStock=fixture.prepare('SELECT * FROM inventory_stock ORDER BY id').all()
const beforeColor=fixture.prepare('SELECT COUNT(*) n FROM catalog_variants WHERE is_active=1 AND color IN (\'СВЕТЛО СЕРЫЙ\',\'ТЕМНО СИНИЙ\')').get().n
let predictedReserved=0,measuredReserved=0,stockQty=0
for(const v of safe){
 for(const s of stock.filter(x=>x.variant_id===v.id)){
   measuredReserved+=s.reserved_quantity
   stockQty+=s.quantity
   predictedReserved+=reservations.find(r=>r.variant_id===v.id&&r.inventory_source===s.inventory_source)?.qty||0
 }
}
fixture.exec('BEGIN')
try{
 const update=fixture.prepare('UPDATE catalog_variants SET color=?, updated_at=? WHERE id=? AND is_active=1 AND color=?')
 for(const v of safe){
   const r=update.run(targetNames.get(v.color),stamp,v.id,v.color)
   assert.equal(r.changes,1,'CAS rename failed')
 }
 // Simulate actual inventory read API: active catalog SKU provides current working label,
 // inventory_stock provides exact physical quantity and reservation and remains untouched.
 const afterStock=fixture.prepare('SELECT * FROM inventory_stock ORDER BY id').all()
 assert.deepEqual(afterStock,beforeStock,'Inventory stock itself MUST remain byte-for-byte identical')
 for(const v of safe){
   const newV=fixture.prepare('SELECT * FROM catalog_variants WHERE id=?').get(v.id)
   assert.equal(newV.id,v.id)
   assert.equal(newV.color,targetNames.get(v.color))
   for(const k of keys.filter(x=>x!=='color'&&x!=='updated_at'))assert.deepEqual(newV[k],v[k],k+' drifted')
   for(const s of stock.filter(x=>x.variant_id===v.id)){
     const joined=fixture.prepare("SELECT s.id,s.variant_id,s.quantity,s.reserved_quantity,COALESCE(NULLIF(v.color,''),s.color_snapshot) AS working_color FROM inventory_stock s JOIN catalog_variants v ON v.id=s.variant_id WHERE s.id=?").get(s.id)
     assert.equal(joined.variant_id,v.id)
     assert.equal(joined.id,s.id)
     assert.equal(joined.quantity,s.quantity)
     assert.equal(joined.reserved_quantity,s.reserved_quantity)
     assert.equal(joined.working_color,targetNames.get(v.color))
   }
 }
 const remaining=fixture.prepare("SELECT COUNT(*) n FROM catalog_variants WHERE is_active=1 AND color IN ('СВЕТЛО СЕРЫЙ','ТЕМНО СИНИЙ')").get().n
 assert.equal(remaining,beforeColor-safe.length)
 fixture.exec('ROLLBACK') // This is a REHEARSAL ONLY, even on the replica.
 const snapHash=rows=>createHash('sha256').update(JSON.stringify(rows)).digest('hex').slice(0,16)
 console.log('SAFE_REHEARSAL_JSON='+JSON.stringify({
  prodSourceReadOnly:true,runnerReplicaOnly:true,originalVariants:all.length,originalCandidates:candidates.length,
  rehearsedSafeRenames:safe.length,blockedCollisionCount:collisions.length,blockedIds:collisions,
  stockRowsCovered:stock.length,stockQuantityForSafeCandidates:stockQty,
  reservedForSafeCandidates:measuredReserved,activeReservationUnitsForSafeCandidates:predictedReserved,
  inventoryUnchanged:true,idsAndOtherSkuFieldsUnchanged:true,
  workingLabelsUpdated:true, beforeStockHash:snapHash(beforeStock),afterStockHash:snapHash(afterStock),
 }))
}finally{fixture.close()}
