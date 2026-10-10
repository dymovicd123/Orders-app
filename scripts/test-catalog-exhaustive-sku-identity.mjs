import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import {
 catalogColorIdentity,createCatalogCombinationV3,
 findCatalogCombinationV3,findRetiredCatalogCombinationV3
} from '../worker/domains/catalog.ts'

const sqlite=new DatabaseSync(':memory:')
sqlite.exec(`
 CREATE TABLE catalog_products(id INTEGER PRIMARY KEY,is_active INTEGER,gender_scope TEXT);
 CREATE TABLE catalog_stock_positions(id INTEGER PRIMARY KEY,product_id INTEGER,is_active INTEGER,material TEXT,length TEXT);
 CREATE TABLE catalog_variants(
 id INTEGER PRIMARY KEY,product_id INTEGER,stock_position_id INTEGER,category TEXT,
 gender TEXT,color TEXT,material TEXT,length TEXT,size_label TEXT,is_active INTEGER,
 external_id TEXT,sort_order INTEGER,created_at TEXT,updated_at TEXT
 );
 INSERT INTO catalog_products VALUES(11,1,'female'),(12,1,'female');
 INSERT INTO catalog_stock_positions VALUES(90,11,1,'СТАНДАРТ','СТАНДАРТ'),(91,12,1,'СТАНДАРТ','СТАНДАРТ');
 CREATE UNIQUE INDEX unique_variant_raw
 ON catalog_variants(stock_position_id,category,gender,color,size_label) WHERE is_active=1;
`)
const add=sqlite.prepare("INSERT INTO catalog_variants(id,product_id,stock_position_id,category,gender,color,material,length,size_label,is_active) VALUES(?,11,90,'adult','ЖЕН',?,'СТАНДАРТ','СТАНДАРТ','M',?)")
for(let id=1;id<=310;id++)add.run(id,'ЦВЕТ '+id,1)
add.run(311,'СВЕТЛО-СЕРЫЙ',1)
for(let id=401;id<=710;id++)add.run(id,'АРХИВ '+id,0)
add.run(711,'ТЁМНО-СИНИЙ',0)
const database={
 prepare(sql){
  const prepared=sqlite.prepare(sql)
  return {
   bind(...args){
    return {first:async()=>prepared.get(...args)??null,
      all:async()=>({results:prepared.all(...args)}),
      run:async()=>{const r=prepared.run(...args);return {meta:{last_row_id:Number(r.lastInsertRowid),changes:Number(r.changes)}}}}
   },
   first:async()=>prepared.get()??null
  }
 }
}
const before=sqlite.prepare('SELECT total_changes() AS n').get().n
assert.equal(catalogColorIdentity('СВЕТЛО—СЕРЫЙ'),'СВЕТЛО СЕРЫЙ')
const active=await findCatalogCombinationV3(database,90,'adult','ЖЕН','СВЕТЛО СЕРЫЙ','M')
assert.equal(active?.id,311,'Must find semantically equal active SKU AFTER the first 200')
assert.equal((await findCatalogCombinationV3(database,90,'adult','ЖЕН','СВЕТЛО-СЕРЫЙ','M'))?.id,311)
assert.equal((await findCatalogCombinationV3(database,90,'adult','ЖЕН','СВЕТЛО—СЕРЫЙ','M'))?.id,311)
assert.equal((await findRetiredCatalogCombinationV3(database,90,'adult','ЖЕН','ТЁМНО СИНИЙ','M'))?.id,711,
 'Must find same retired SKU beyond first 200')
assert.equal((await findCatalogCombinationV3(database,90,'adult','МУЖ','СВЕТЛО СЕРЫЙ','M')),null)
assert.equal((await findCatalogCombinationV3(database,90,'adult','ЖЕН','СВЕТЛО СЕРЫЙ','XL')),null)
assert.equal((await findCatalogCombinationV3(database,91,'adult','ЖЕН','СВЕТЛО СЕРЫЙ','M')),null)
assert.equal((await findCatalogCombinationV3(database,90,'adult','ЖЕН','НЕИЗВЕСТНЫЙ ЦВЕТ','M')),null)
assert.equal(sqlite.prepare('SELECT total_changes() AS n').get().n,before,'Identity preview must not write')
const reused=await createCatalogCombinationV3(database,{
 productId:11,executionId:90,category:'adult',gender:'ЖЕН',
 color:'СВЕТЛО СЕРЫЙ',material:'СТАНДАРТ',length:'СТАНДАРТ',sizeLabel:'M'
},'2026-10-10T11:00:00Z')
assert.deepEqual(reused,{id:311,created:false},'Must reuse old SKU instead of materializing a duplicate')
assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM catalog_variants WHERE is_active=1').get().n,311)
const newSku=await createCatalogCombinationV3(database,{
 productId:11,executionId:90,category:'adult',gender:'ЖЕН',
 color:'НОВЫЙ ЦВЕТ',material:'СТАНДАРТ',length:'СТАНДАРТ',sizeLabel:'M'
},'2026-10-10T11:00:00Z')
assert.equal(newSku.created,true,'Legitimately new SKU can still be created')
assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM catalog_variants WHERE is_active=1').get().n,312)
console.log('CATALOG EXHAUSTIVE SKU IDENTITY PASSED — active/retired match after >200 candidates, reuse before create, distinct identities and no false blocks')
sqlite.close()
