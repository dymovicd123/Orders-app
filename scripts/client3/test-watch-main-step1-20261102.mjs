import assert from 'node:assert/strict'
import fs from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {createClient3WatchReference,updateClient3WatchReference,deleteClient3WatchReference,
  listClient3WatchReferences} from '../../worker/domains/client3-watch-references.ts'
import {registerWatchModel,registerWatchVariant} from '../../worker/domains/client3-watch-catalog.ts'
import {provisionClient3WatchSku} from '../../worker/domains/client3-watch-provision.ts'
import {previewClient3WatchDelete,deleteClient3WatchCatalog} from '../../worker/domains/client3-watch-catalog-delete.ts'

// The migration must preserve foreign keys from *existing* sold watch lines.
// This catches DROP/RENAME mistakes not visible on an empty third tenant.
const history=new DatabaseSync(':memory:')
history.exec(`PRAGMA foreign_keys=ON;
 CREATE TABLE managers(id INTEGER PRIMARY KEY);
 CREATE TABLE app_users(id INTEGER PRIMARY KEY);
 CREATE TABLE catalog_products(id INTEGER PRIMARY KEY);
 CREATE TABLE catalog_variants(id INTEGER PRIMARY KEY);
 CREATE TABLE orders(id INTEGER PRIMARY KEY);
 CREATE TABLE order_items(id INTEGER PRIMARY KEY);
`)
history.exec(fs.readFileSync('migrations/client3-watch/0002_client3_watch_foundation.sql','utf8'))
history.exec("INSERT INTO watch_products(brand_id,model_name) VALUES(1,'HISTORICAL WATCH')")
history.exec("INSERT INTO watch_variants(watch_product_id,gender,movement,bracelet_material,dial_color,bracelet_color) VALUES(1,'male','quartz','leather','black','ЧЁРНЫЙ')")
history.exec("INSERT INTO order_items(id) VALUES(1001)")
history.exec("INSERT INTO watch_order_item_details(order_item_id,watch_variant_id,engraving_text) VALUES(1001,1,'ИМЯ КЛИЕНТА')")
history.exec(fs.readFileSync('migrations/client3-watch/0004_client3_shared_reference_values.sql','utf8'))
history.exec(fs.readFileSync('migrations/client3-watch/0005_client3_editable_sku_references.sql','utf8'))
assert.equal(history.prepare('SELECT watch_variant_id FROM watch_order_item_details WHERE order_item_id=1001').get().watch_variant_id,1)
assert.equal(history.prepare('SELECT bracelet_color FROM watch_variants WHERE id=1').get().bracelet_color,'ЧЁРНЫЙ')
assert.deepEqual(history.prepare('PRAGMA foreign_key_check').all(),[],'Migration must retain existing watch order item links')
history.close()

const sql=new DatabaseSync(':memory:')
sql.exec('PRAGMA foreign_keys=ON')
for(const p of fs.readdirSync('migrations').filter(x=>/^\d+.*\.sql$/.test(x)).sort())
  sql.exec(fs.readFileSync('migrations/'+p,'utf8'))
for(const p of fs.readdirSync('migrations/client3-watch').filter(x=>/^\d+.*\.sql$/.test(x)).sort())
  sql.exec(fs.readFileSync('migrations/client3-watch/'+p,'utf8'))
const prepare=(query,args=[])=>({
  bind(...values){return prepare(query,values)},
  async first(){return sql.prepare(query).get(...args)||null},
  async all(){return {results:sql.prepare(query).all(...args)}},
  async run(){const r=sql.prepare(query).run(...args);return {meta:{last_row_id:Number(r.lastInsertRowid),changes:Number(r.changes)}}},
})
const db={prepare,async batch(statements){
  sql.exec('SAVEPOINT step1')
  try{const result=[];for(const s of statements)result.push(await s.run());sql.exec('RELEASE step1');return result}
  catch(e){sql.exec('ROLLBACK TO step1; RELEASE step1');throw e}
}}
const admin={id:1,role:'admin',managerId:null,employeeRole:'Администратор'}
const manager={id:2,role:'manager',managerId:1,employeeRole:'Менеджер'}
const parse=async p=>{const r=await p;return {status:r.status,...await r.json()}}
assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(),[])
// Characteristic values are shared across brands and include arbitrary inner spaces.
for(const [kind,value] of [
 ['movements','Механизм с автоподзаводом'],
 ['bracelets','Мягкая кожа'],['dials','Тёмно синий'],
 ['leatherColors','Тёмно-синий'],
]){
 const result=await parse(createClient3WatchReference(db,admin,{kind,value}))
 assert.equal(result.status,201,JSON.stringify(result))
}
const refRows=(await parse(listClient3WatchReferences(db,manager))).rows
assert(refRows.some(x=>x.value==='Механизм с автоподзаводом'))
assert(refRows.some(x=>x.value==='Мягкая кожа'))
assert(refRows.some(x=>x.value==='Тёмно синий'))
const renamed=refRows.find(x=>x.kind==='movements'&&x.value==='Механизм с автоподзаводом')
assert.equal((await parse(updateClient3WatchReference(db,admin,{
 id:renamed.id,kind:'movements',value:'Механизм  с  турбийоном',
}))).status,200)
assert((await parse(listClient3WatchReferences(db,manager))).rows.some(x=>x.value==='Механизм с турбийоном'))
const model=await parse(registerWatchModel(db,admin,1,{modelName:'Тест Часы Два Слова'}))
assert.equal(model.status,201)
const p=model.watchProductId
const options={watchProductId:p,gender:'male',movement:'Механизм с турбийоном',
 braceletMaterial:'Мягкая кожа',dialColor:'Тёмно синий',braceletColor:''}
const variant=await parse(registerWatchVariant(db,admin,1,options))
assert.equal(variant.status,201,JSON.stringify(variant))
const v=variant.watchVariantId
const linked=await parse(provisionClient3WatchSku(db,admin,1,v))
assert.equal(linked.status,200,JSON.stringify(linked))
const before=sql.prepare('SELECT * FROM watch_variants WHERE id=?').get(v)
assert.equal(before.movement,'Механизм с турбийоном')
assert.equal(before.dial_color,'Тёмно синий')
const used=await parse(deleteClient3WatchReference(db,admin,renamed.id))
assert.equal(used.status,409,'An active SKU protects its characteristic from removal')
let preview=await parse(previewClient3WatchDelete(db,admin,1,{kind:'variant',watchProductId:p,watchVariantId:v}))
assert.equal(preview.canDelete,true,JSON.stringify(preview))
let removed=await parse(deleteClient3WatchCatalog(db,admin,1,{kind:'variant',watchProductId:p,watchVariantId:v,expectedCount:1}))
assert.equal(removed.ok,true)
assert.equal(sql.prepare('SELECT is_active FROM watch_variants WHERE id=?').get(v).is_active,0)
assert.equal(sql.prepare('SELECT is_active FROM catalog_variants WHERE id=?').get(linked.canonicalVariantId).is_active,0)
assert.equal((await parse(deleteClient3WatchReference(db,admin,renamed.id))).ok,true)
assert.equal((await parse(updateClient3WatchReference(db,manager,{
 id:renamed.id,kind:'movements',value:'Нельзя',
}))).status,403)
// Whole product disappears without purging its historical canonical keys.
preview=await parse(previewClient3WatchDelete(db,admin,1,{kind:'product',watchProductId:p}))
assert.equal(preview.canDelete,true)
removed=await parse(deleteClient3WatchCatalog(db,admin,1,{kind:'product',watchProductId:p,expectedCount:0}))
assert.equal(removed.ok,true)
assert.equal(sql.prepare('SELECT is_active FROM watch_products WHERE id=?').get(p).is_active,0)
assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM watch_variants WHERE id=?').get(v).n,1)
assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(),[])
sql.close()
console.log('CLIENT3_MAIN_STEP1_PASS: editable multiword refs, custom canonical SKU, protected deletes, history intact')
