import assert from 'node:assert/strict'
import fs from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {previewCharacteristicSkuMapping} from '../worker/domains/reference-characteristic-sku-mapping.ts'
import {publicApiError} from '../worker/core/http.ts'
const sql=new DatabaseSync(':memory:')
sql.exec(`
 CREATE TABLE reference_values(id INTEGER PRIMARY KEY,kind TEXT,value TEXT,is_active INTEGER);
 CREATE TABLE catalog_products(id INTEGER PRIMARY KEY,name TEXT,is_active INTEGER);
 CREATE TABLE catalog_stock_positions(id INTEGER PRIMARY KEY,product_id INTEGER,material TEXT,length TEXT,is_active INTEGER);
 CREATE TABLE catalog_variants(id INTEGER PRIMARY KEY,product_id INTEGER,stock_position_id INTEGER,
 category TEXT,gender TEXT,color TEXT,material TEXT,length TEXT,size_label TEXT,is_active INTEGER);
 CREATE TABLE inventory_stock(id INTEGER PRIMARY KEY,variant_id INTEGER,inventory_source TEXT,quantity INTEGER,reserved_quantity INTEGER);
 CREATE TABLE inventory_reservations(id INTEGER PRIMARY KEY,variant_id INTEGER,status TEXT,quantity INTEGER);
 CREATE TABLE orders(id INTEGER PRIMARY KEY,order_status TEXT,shipping_status TEXT);
 CREATE TABLE order_items(id INTEGER PRIMARY KEY,order_id INTEGER,variant_id INTEGER);
 INSERT INTO reference_values VALUES
  (1,'color','ХАКИ',1),(2,'color','ЗЕЛЁНЫЙ',1),
  (3,'material','АЛЬПАКА',1),(4,'material','ШЕРСТЬ',1),
  (5,'child_age','1',1),(6,'child_age','2',1),
  (7,'size','M',1),(8,'size','L',1),
  (9,'color','ЧЁРНЫЙ',0),(10,'color','ХАКИ',1);
 INSERT INTO catalog_products VALUES(100,'КАФТАН',1),(200,'ПАЛЬТО',1),(300,'ДЕТСКИЙ ЖИЛЕТ',1);
 INSERT INTO catalog_stock_positions VALUES
  (11,100,'ДРАП','СТАНДАРТ',1),
  (19,200,'АЛЬПАКА','СТАНДАРТ',1),
  (20,200,'ШЕРСТЬ','СТАНДАРТ',1),
  (30,300,'СТАНДАРТ','СТАНДАРТ',1);
`)
const put=sql.prepare("INSERT INTO catalog_variants(id,product_id,stock_position_id,category,gender,color,material,length,size_label,is_active) VALUES(?,?,?,?,?,?,?,?,?,?)")
for(let i=1;i<=430;i++)put.run(i,100,11,'adult','ЖЕН','ХАКИ','ДРАП','СТАНДАРТ','SIZE-'+i,i===4?0:1)
put.run(9001,100,11,'adult','ЖЕН','ЗЕЛЁНЫЙ','ДРАП','СТАНДАРТ','SIZE-1',1)
put.run(9002,100,11,'adult','ЖЕН','ЗЕЛЁНЫЙ','ДРАП','СТАНДАРТ','SIZE-2',1)
put.run(9003,100,11,'adult','ЖЕН','ЗЕЛЁНЫЙ','ДРАП','СТАНДАРТ','SIZE-2',1)
put.run(9004,100,11,'adult','МУЖ','ЗЕЛЁНЫЙ','ДРАП','СТАНДАРТ','SIZE-3',1)
put.run(3001,200,19,'adult','ЖЕН','БЕЛЫЙ','АЛЬПАКА','СТАНДАРТ','M',1)
put.run(3002,200,20,'adult','ЖЕН','БЕЛЫЙ','ШЕРСТЬ','СТАНДАРТ','M',1)
put.run(3003,200,null,'adult','ЖЕН','БЕЛЫЙ','АЛЬПАКА','СТАНДАРТ','L',1)
put.run(4001,300,30,'child','ЖЕН','БЕЛЫЙ','СТАНДАРТ','СТАНДАРТ','1',1)
put.run(4002,300,30,'child','ЖЕН','БЕЛЫЙ','СТАНДАРТ','СТАНДАРТ','2',1)
sql.exec(`
 INSERT INTO inventory_stock VALUES
  (1,1,'warehouse',3,1),(2,1,'boutique',2,0),
  (3,9001,'warehouse',4,1),(4,2,'boutique',1,0),
  (5,9001,'boutique',0,2);
 INSERT INTO inventory_reservations VALUES(1,1,'active',1),(2,1,'released',2),(3,9001,'active',2);
 INSERT INTO orders VALUES(1,'active','not_sent'),(2,'active','sent'),(3,'active','not_sent');
 INSERT INTO order_items VALUES(1,1,1),(2,2,2),(3,3,9001);
`)
const db={prepare(query){
 const st=sql.prepare(query)
 return {bind(...args){return {first:async()=>st.get(...args)||null,
    all:async()=>({results:st.all(...args)})}}}
}}
const first=sql.prepare('SELECT total_changes() AS n').get().n
for(const args of [[0,2,0,20],[1,1,0,20],[1,9,0,20],[1,4,0,20],
 [1,2,-1,20],[1,2,0,0],[1,2,0,51],[1,2,0,1.5],
 [1,10,0,20]]){
 await assert.rejects(()=>previewCharacteristicSkuMapping(db,...args))
}
await assert.rejects(()=>previewCharacteristicSkuMapping(db,1,10,0,20),error=>{
 const response=publicApiError(error)
 assert.equal(response.status,400)
 assert.equal(response.code,'characteristic_mapping_indistinguishable')
 assert.match(response.message,/одинаковое название/)
 return true
})
assert.equal(sql.prepare('SELECT total_changes() AS n').get().n,first)
let cursor=0,ids=[],firstPage=null
for(let page=0;page<25;page++){
 const p=await previewCharacteristicSkuMapping(db,1,2,cursor,25)
 if(!firstPage)firstPage=p
 assert.equal(p.totalSourceVariants,430)
 assert.ok(p.rows.length<=25)
 assert.equal(p.canApply,false)
 assert.equal(p.noChangesApplied,true)
 ids.push(...p.rows.map(r=>r.sourceVariantId))
 if(!p.hasMore){assert.equal(p.nextCursor,null);break}
 assert.ok(p.nextCursor>cursor)
 cursor=p.nextCursor
}
assert.equal(ids.length,430)
assert.deepEqual(ids,Array.from({length:430},(_,i)=>i+1))
assert.equal(firstPage.rows[0].status,'unique_keeper')
assert.equal(firstPage.rows[0].proposedKeeperId,9001)
assert.equal(firstPage.rows[0].activeReservations,1)
assert.equal(firstPage.rows[0].activeOrderLines,1)
assert.equal(firstPage.rows[0].keeperActiveReservations,1)
assert.equal(firstPage.rows[0].keeperActiveOrderLines,1)
assert.deepEqual(firstPage.rows[0].places.map(x=>[x.location,x.sourcePhysical,x.keeperPhysical,x.sourceReserved,x.keeperReserved]),
 [['warehouse',3,4,1,1],['boutique',2,0,0,2]])
assert.deepEqual(firstPage.rows[0].places.map(p=>[p.location,p.sourceShortage,p.keeperShortage]),
 [['warehouse',0,0],['boutique',0,2]],'Keeper boutique shortage must not be hidden')
assert.ok(firstPage.rows[0].reviewReasons.some(x=>x.includes('исходного варианта')))
assert.ok(firstPage.rows[0].reviewReasons.some(x=>x.includes('основного варианта')))
assert.ok(firstPage.rows[0].reviewReasons.some(x=>x.includes('дефицита')))
assert.equal(firstPage.rows[1].status,'ambiguous_keepers')
assert.equal(firstPage.rows[1].candidateCount,2)
assert.deepEqual(firstPage.rows[1].possibleKeeperIds,[9002,9003])
assert.equal(firstPage.rows[1].proposedKeeperId,null)
assert.equal(firstPage.rows[1].keeperActiveReservations,null)
assert.equal(firstPage.rows[1].keeperActiveOrderLines,null)
assert.equal(firstPage.rows[1].places[0].keeperShortage,null)
assert.equal(firstPage.rows[2].status,'no_keeper','Wrong-gender keeper cannot be selected')
assert.equal(firstPage.rows[3].status,'historical')
assert.ok(firstPage.rows.every(x=>x.canAutomaticallyMerge===false))
const mat=await previewCharacteristicSkuMapping(db,3,4,0,20)
assert.equal(mat.rows.length,2)
assert.equal(mat.rows.find(x=>x.sourceVariantId===3001)?.status,'unique_keeper')
assert.equal(mat.rows.find(x=>x.sourceVariantId===3001)?.proposedKeeperId,3002,
 'Different material corresponds to a different execution, never direct stock mixing')
assert.equal(mat.rows.find(x=>x.sourceVariantId===3003)?.status,'needs_execution_review',
 'Missing execution cannot be treated as a safe keeper')
const age=await previewCharacteristicSkuMapping(db,5,6,0,20)
assert.equal(age.rows.length,1)
assert.equal(age.rows[0].sourceVariantId,4001)
assert.equal(age.rows[0].proposedKeeperId,4002)
assert.equal(age.rows[0].canAutomaticallyMerge,false)
const nothing=await previewCharacteristicSkuMapping(db,7,8)
assert.equal(nothing.totalSourceVariants,2)
assert.equal(nothing.rows[0].status,'no_keeper')
assert.equal(sql.prepare('SELECT total_changes() AS n').get().n,first,'Preview must never modify business data')
const router=fs.readFileSync('worker/index.ts','utf8')
assert.ok(router.includes('/api/reference-values/characteristic-sku-plan'))
assert.ok(router.includes('previewCharacteristicSkuMapping('))
assert.ok(router.includes('Сопоставление характеристик доступно только администратору'))
console.log('CHARACTERISTIC SKU PAGE MAPPING PASSED — 430 source SKUs without truncation, one/many/no keeper, missing execution, warehouse+boutique reserves, material/child age, no writes')
sql.close()
