import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { listInventory } from '../worker/domains/inventory-read.ts'
import { loadCompleteInventorySnapshot } from '../src/features/inventory/loadCompleteInventorySnapshot.ts'

const sql = new DatabaseSync(':memory:')
sql.exec(`
 CREATE TABLE catalog_products (id INTEGER PRIMARY KEY, name TEXT, is_active INTEGER);
 CREATE TABLE catalog_variants (id INTEGER PRIMARY KEY, product_id INTEGER, category TEXT,
   gender TEXT, color TEXT, material TEXT, length TEXT, size_label TEXT, is_active INTEGER);
 CREATE TABLE inventory_stock (id INTEGER PRIMARY KEY, inventory_source TEXT, product_id INTEGER,
   variant_id INTEGER, product_name_snapshot TEXT, gender_snapshot TEXT, color_snapshot TEXT,
   material_snapshot TEXT, length_snapshot TEXT, size_snapshot TEXT,
   quantity INTEGER, reserved_quantity INTEGER, last_action TEXT, last_source_ref TEXT,
   updated_at TEXT, created_at TEXT);
 CREATE TABLE inventory_model_meta (key TEXT PRIMARY KEY, value TEXT);
 INSERT INTO inventory_model_meta VALUES ('human_inventory_v2','active');
 INSERT INTO catalog_products VALUES (1,'АЛЬФА ТОВАР',1),(22,'ҚОЗЫ КӨРПЕШ ШАПАН',1);
`)
const v = sql.prepare('INSERT INTO catalog_variants (id,product_id,category,gender,color,material,length,size_label,is_active) VALUES (?,?,?,?,?,?,?,?,1)')
const s = sql.prepare('INSERT INTO inventory_stock (id,inventory_source,product_id,variant_id,product_name_snapshot,gender_snapshot,color_snapshot,material_snapshot,length_snapshot,size_snapshot,quantity,reserved_quantity) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
for (let id=1;id<=1022;id++) {
  const chocolate=id>1016
  v.run(id,chocolate?22:1,'adult','МУЖ',chocolate?'ШОКОЛАД':'БЕЖЕВЫЙ','ЗАМША ВЕЛЮР','СТАНДАРТ',String(chocolate?40+2*(id-1016):id),1)
  s.run(id,'warehouse',chocolate?22:1,id,chocolate?'ҚОЗЫ КӨРПЕШ ШАПАН':'АЛЬФА ТОВАР',
    'МУЖ',chocolate?'ШОКОЛАД':'БЕЖЕВЫЙ','ЗАМША ВЕЛЮР','СТАНДАРТ',
    String(chocolate?40+2*(id-1016):id),chocolate?(id===1020?12:id===1021?4:2):1,chocolate&&id===1020?1:0)
}
// Simulate the D1 API using real SQLite, including actual SQL binding and stock query.
const d1={
  prepare(query) {
    let bindings=[]
    return {
      bind(...args){bindings=args;return this},
      async all(){return {results:sql.prepare(query).all(...bindings)}},
      async first(){return sql.prepare(query).get(...bindings)||null},
    }
  },
}
const read=async(cursor,includeMovements=false,q='')=>{
  const params=new URLSearchParams({source:'warehouse',limit:'1000',cursor:String(cursor),includeMovements:includeMovements?'1':'0',q})
  return listInventory(d1,new URL('https://test.local/api/inventory?'+params))
}
const first=await read(0)
assert.equal(first.count,1000)
assert.equal(first.pageInfo.hasMore,true)
assert.equal(first.pageInfo.nextCursor,1000)
assert.equal(first.items.find(x=>x.color==='ШОКОЛАД'),undefined)
const next=await read(1000)
assert.equal(next.count,22)
assert.equal(next.pageInfo.hasMore,false)
assert.equal(next.items.find(x=>x.id===1020)?.quantity,12)
const result=await loadCompleteInventorySnapshot(cursor=>read(cursor),false)
assert.equal(result.count,1022)
assert.equal(result.items.length,1022)
assert.equal(result.items.find(x=>x.id===1020)?.quantity,12)
assert.equal(result.items.find(x=>x.id===1021)?.quantity,4)
assert.equal(result.items.filter(x=>x.color==='ШОКОЛАД').length,6)
assert.equal(result.total,1016+12+4+2*4)
assert.equal(result.reservedTotal,1)
assert.equal(result.availableTotal,result.total-1)
assert.equal(result.pageInfo.hasMore,false)
// The paged query must retain server search filtering.
const search=await loadCompleteInventorySnapshot(cursor=>read(cursor,false,'ШОКОЛАД'),false)
assert.equal(search.count,6)
assert.equal(search.items.every(x=>x.color==='ШОКОЛАД'),true)
// A broken second page must never silently return the first 1000 as full stock.
assert.equal(await loadCompleteInventorySnapshot(async(cursor)=>cursor===0?first:null,false),null)
await assert.rejects(
  ()=>loadCompleteInventorySnapshot(async()=>first,false),
  /не смог продолжить|неполную|пересеклись/,
)
const stale=await loadCompleteInventorySnapshot(async(cursor)=>{
  const data=await read(cursor)
  if(cursor>0) data.pageInfo.cursor=0
  return data
},false).then(()=>null,error=>error)
assert.ok(stale instanceof Error)
const old=await listInventory(d1,new URL('https://test.local/api/inventory?source=warehouse&limit=1000&includeMovements=0'))
assert.equal(old.count,1000)
assert.equal(old.pageInfo,undefined,'Existing one-page clients remain compatible')
console.log('INVENTORY COMPLETE PAGINATION PASSED — real SQLite 1022 rows, chocolate after 1000, cursor replay, totals, search, safe partial failure, legacy clients')
