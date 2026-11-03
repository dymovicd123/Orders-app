import assert from 'node:assert/strict'
import fs from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {createClient3WatchReference,updateClient3WatchReference,deleteClient3WatchReference,
  listClient3WatchReferences} from '../../worker/domains/client3-watch-references.ts'
import {registerWatchModel,registerWatchVariant} from '../../worker/domains/client3-watch-catalog.ts'
import {editClient3WatchModel,editClient3WatchVariant} from '../../worker/domains/client3-watch-catalog-edit.ts'
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
assert(refRows.some(x=>x.value==='МЕХАНИЗМ С АВТОПОДЗАВОДОМ'))
assert(refRows.some(x=>x.value==='МЯГКАЯ КОЖА'))
assert(refRows.some(x=>x.value==='ТЁМНО СИНИЙ'))
const renamed=refRows.find(x=>x.kind==='movements'&&x.value==='МЕХАНИЗМ С АВТОПОДЗАВОДОМ')
assert.equal((await parse(updateClient3WatchReference(db,admin,{
 id:renamed.id,kind:'movements',value:'Механизм  с  турбийоном',
}))).status,200)
assert((await parse(listClient3WatchReferences(db,manager))).rows.some(x=>x.value==='МЕХАНИЗМ С ТУРБИЙОНОМ'))
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
const effective=sql.prepare('SELECT * FROM watch_variant_attributes_v5 WHERE watch_variant_id=?').get(v)
assert(effective,'Custom SKU must keep a 1:1 extension without changing its historical row')
assert.equal(effective.movement,'Механизм с турбийоном')
assert.equal(effective.dial_color,'Тёмно синий')
assert.equal(before.movement,'quartz','Original CHECK-backed legacy anchor is unchanged')
// Main delete preflight must not silently write off physical watches.
sql.prepare(`INSERT INTO inventory_stock(
 inventory_source,product_id,variant_id,product_name_snapshot,quantity,reserved_quantity
) VALUES('warehouse',?,?,'WATCH TEST STOCK',2,0)`).run(linked.canonicalProductId,linked.canonicalVariantId)
const blockedPreview=await parse(previewClient3WatchDelete(db,admin,1,{
 kind:'variant',watchProductId:p,watchVariantId:v,
}))
assert.equal(blockedPreview.canDelete,false,'Physical stock blocks SKU removal')
assert.equal((await parse(deleteClient3WatchCatalog(db,admin,1,{
 kind:'variant',watchProductId:p,watchVariantId:v,expectedCount:1,
}))).status,409)
assert.equal(sql.prepare('SELECT quantity FROM inventory_stock WHERE variant_id=?').get(linked.canonicalVariantId).quantity,2)
sql.prepare('UPDATE inventory_stock SET quantity=0 WHERE variant_id=?').run(linked.canonicalVariantId)
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
// Group/execution deletion is granular: remove only matching movement+material.
const groupedModel=await parse(registerWatchModel(db,admin,1,{modelName:'Тест Групповое Исполнение'}))
assert.equal(groupedModel.status,201)
const gId=groupedModel.watchProductId
const gAttrs={watchProductId:gId,gender:'female',movement:'quartz',braceletMaterial:'steel',braceletColor:''}
for(const dialColor of ['black','white']){
 const vi=await parse(registerWatchVariant(db,admin,1,{...gAttrs,dialColor}))
 assert.equal(vi.status,201,JSON.stringify(vi))
 assert.equal((await parse(provisionClient3WatchSku(db,admin,1,vi.watchVariantId))).status,200)
}
const alternative=await parse(registerWatchVariant(db,admin,1,{
 ...gAttrs,movement:'mechanical',dialColor:'black',
}))
assert.equal(alternative.status,201)
assert.equal((await parse(provisionClient3WatchSku(db,admin,1,alternative.watchVariantId))).status,200)
preview=await parse(previewClient3WatchDelete(db,admin,1,{
 kind:'execution',watchProductId:gId,movement:'quartz',braceletMaterial:'steel',
}))
assert.equal(preview.count,2)
removed=await parse(deleteClient3WatchCatalog(db,admin,1,{
 kind:'execution',watchProductId:gId,movement:'quartz',braceletMaterial:'steel',expectedCount:2,
}))
assert.equal(removed.ok,true,JSON.stringify(removed))
assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM watch_variants WHERE watch_product_id=? AND is_active=1").get(gId).n,1)
assert.equal(sql.prepare("SELECT is_active FROM watch_variants WHERE id=?").get(alternative.watchVariantId).is_active,1)
assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM catalog_retirement_history_events WHERE event_type='variant'").get().n,3)
// Whole product disappears without purging its historical canonical keys.
preview=await parse(previewClient3WatchDelete(db,admin,1,{kind:'product',watchProductId:p}))
assert.equal(preview.canDelete,true)
removed=await parse(deleteClient3WatchCatalog(db,admin,1,{kind:'product',watchProductId:p,expectedCount:0}))
assert.equal(removed.ok,true)
assert.equal(sql.prepare('SELECT is_active FROM watch_products WHERE id=?').get(p).is_active,0)
assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM watch_variants WHERE id=?').get(v).n,1)
// The earlier reference deletion test removed this example from active choices.
assert.equal((await parse(createClient3WatchReference(db,admin,{
  kind:'movements',value:'Механизм с турбийоном',
}))).ok,true)
// Main editing parity: model rename is presentation-only, with optimistic locking.
const editable=await parse(registerWatchModel(db,admin,1,{modelName:'Тест Редактируемая Модель'}))
assert.equal(editable.status,201)
const editableId=editable.watchProductId
const rename=await parse(editClient3WatchModel(db,admin,1,{
 watchProductId:editableId,expectedName:'Тест Редактируемая Модель',
 modelName:'Часы   с   пробелами',
}))
assert.equal(rename.ok,true,JSON.stringify(rename))
assert.equal(sql.prepare('SELECT model_name FROM watch_products WHERE id=?').get(editableId).model_name,'Часы с пробелами')
assert.equal((await parse(editClient3WatchModel(db,admin,1,{
 watchProductId:editableId,expectedName:'Тест Редактируемая Модель',modelName:'Опоздавший запрос',
}))).status,409)
assert.equal((await parse(editClient3WatchModel(db,manager,1,{
 watchProductId:editableId,expectedName:'Часы с пробелами',modelName:'Нельзя',
}))).status,403)
// Brand scope: a matching ID in another brand cannot be renamed from brand 1.
assert.equal((await parse(editClient3WatchModel(db,admin,2,{
 watchProductId:editableId,expectedName:'Часы с пробелами',modelName:'Чужой',
}))).status,404)
const oldDraft={gender:'female',movement:'quartz',braceletMaterial:'steel',dialColor:'black',braceletColor:''}
const savedDraft=await parse(registerWatchVariant(db,admin,1,{watchProductId:editableId,...oldDraft}))
assert.equal(savedDraft.status,201)
const draftId=savedDraft.watchVariantId
const updatedDraft={gender:'female',movement:'Механизм с турбийоном',
 braceletMaterial:'Мягкая кожа',dialColor:'Тёмно синий',braceletColor:''}
const changedDraft=await parse(editClient3WatchVariant(db,admin,1,{
 watchProductId:editableId,watchVariantId:draftId,expected:oldDraft,...updatedDraft,
}))
assert.equal(changedDraft.ok,true,JSON.stringify(changedDraft))
const rowDraft=sql.prepare('SELECT * FROM watch_variant_attributes_v5 WHERE watch_variant_id=?').get(draftId)
assert.equal(rowDraft.movement,'Механизм с турбийоном')
assert.equal(rowDraft.bracelet_material,'Мягкая кожа')
assert.equal(sql.prepare('SELECT catalog_variant_id FROM watch_variants WHERE id=?').get(draftId).catalog_variant_id,null)
assert.equal((await parse(editClient3WatchVariant(db,admin,1,{
 watchProductId:editableId,watchVariantId:draftId,expected:oldDraft,...oldDraft,
}))).status,409,'Stale edit cannot overwrite a prior draft')
assert.equal((await parse(editClient3WatchVariant(db,manager,1,{
 watchProductId:editableId,watchVariantId:draftId,expected:updatedDraft,...oldDraft,
}))).status,403)
assert.equal((await parse(editClient3WatchVariant(db,admin,2,{
 watchProductId:editableId,watchVariantId:draftId,expected:updatedDraft,...oldDraft,
}))).status,404)
const secondDraft=await parse(registerWatchVariant(db,admin,1,{watchProductId:editableId,...oldDraft}))
assert.equal(secondDraft.status,201)
assert.equal((await parse(editClient3WatchVariant(db,admin,1,{
 watchProductId:editableId,watchVariantId:secondDraft.watchVariantId,expected:oldDraft,...updatedDraft,
}))).status,409,'Duplicate SKU prevention works across extension and legacy representations')
const preparedDraft=await parse(provisionClient3WatchSku(db,admin,1,draftId))
assert.equal(preparedDraft.status,200,JSON.stringify(preparedDraft))
// Main permits rewriting a linked canonical SKU only BEFORE ANY operational use.
// A catalog price set before correcting an unused SKU must remain available.
const oldStockPosition=sql.prepare('SELECT stock_position_id FROM catalog_variants WHERE id=?')
 .get(preparedDraft.canonicalVariantId).stock_position_id
sql.prepare(`INSERT INTO catalog_execution_prices(stock_position_id,category,cost_price,sale_price,created_at,updated_at)
 VALUES(?,'adult',15000,25000,'2026-11-02','2026-11-02')`).run(oldStockPosition)
const unusedLinkedNext={gender:'female',movement:'mechanical',braceletMaterial:'steel',dialColor:'white',braceletColor:''}
const existingCanonicalId=preparedDraft.canonicalVariantId
const linkedEdit=await parse(editClient3WatchVariant(db,admin,1,{
 watchProductId:editableId,watchVariantId:draftId,expected:updatedDraft,...unusedLinkedNext,
}))
assert.equal(linkedEdit.ok,true,JSON.stringify(linkedEdit))
assert.equal(linkedEdit.canonicalVariantId,existingCanonicalId)
assert.equal(sql.prepare('SELECT catalog_variant_id FROM watch_variants WHERE id=?').get(draftId).catalog_variant_id,existingCanonicalId)
assert.equal(sql.prepare('SELECT movement FROM watch_variant_attributes_v5 WHERE watch_variant_id=?').get(draftId).movement,'mechanical')
const canonicalAfterEdit=sql.prepare('SELECT gender,color,material,stock_position_id FROM catalog_variants WHERE id=?').get(existingCanonicalId)
assert.equal(canonicalAfterEdit.gender,'ЖЕН')
assert.equal(canonicalAfterEdit.color,'WATCH_DIAL_WHITE')
assert.equal(canonicalAfterEdit.material,'WATCH_MECHANICAL_STEEL')
const editedPrice=sql.prepare('SELECT cost_price,sale_price FROM catalog_execution_prices WHERE stock_position_id=? AND category=?')
 .get(canonicalAfterEdit.stock_position_id,'adult')
assert.equal(editedPrice.sale_price,25000,'Catalog price must survive correction')
assert.equal(editedPrice.cost_price,15000,'Cost price must survive correction')
// Now record real inventory usage; a further identity rewrite must be rejected.
sql.prepare(`INSERT INTO inventory_stock(
 inventory_source,product_id,variant_id,product_name_snapshot,quantity,reserved_quantity
) VALUES('warehouse',?,?,'LINKED WATCH',1,0)`).run(preparedDraft.canonicalProductId,existingCanonicalId)
const usedLinked=await parse(editClient3WatchVariant(db,admin,1,{
 watchProductId:editableId,watchVariantId:draftId,expected:unusedLinkedNext,...updatedDraft,
}))
assert.equal(usedLinked.status,409,'Main blocks identity changes with physical/operational history')
assert.equal(sql.prepare('SELECT quantity FROM inventory_stock WHERE variant_id=?').get(existingCanonicalId).quantity,1)
assert.equal(sql.prepare('SELECT material FROM catalog_variants WHERE id=?').get(existingCanonicalId).material,'WATCH_MECHANICAL_STEEL')
assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(),[])
sql.close()
console.log('CLIENT3_MAIN_STEP1_PASS: editable multiword refs, custom canonical SKU, protected deletes, history intact')
