// Current production Resolver with real in-memory SQLite statements, no mocks of SKU matching.
// Existing catalog values remain valid even if auxiliary reference_values is incomplete.
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {resolveCatalogProductAndVariantV2} from '../worker/domains/order-reservations.ts'
const sql=new DatabaseSync(':memory:')
sql.exec(`
 CREATE TABLE catalog_identity_meta(key TEXT PRIMARY KEY,value TEXT);
 CREATE TABLE catalog_products(id INTEGER PRIMARY KEY,name TEXT,external_id TEXT,category TEXT,gender_scope TEXT,is_active INTEGER);
 CREATE TABLE catalog_stock_positions(id INTEGER PRIMARY KEY,product_id INTEGER,material TEXT,length TEXT,is_active INTEGER);
 CREATE TABLE catalog_variants(id INTEGER PRIMARY KEY,product_id INTEGER,stock_position_id INTEGER,category TEXT,gender TEXT,color TEXT,material TEXT,length TEXT,size_label TEXT,is_active INTEGER);
 CREATE TABLE reference_values(id INTEGER PRIMARY KEY,kind TEXT,value TEXT,is_active INTEGER);
 CREATE TABLE inventory_stock(id INTEGER PRIMARY KEY,inventory_source TEXT,variant_id INTEGER,quantity INTEGER,reserved_quantity INTEGER);
 INSERT INTO catalog_identity_meta VALUES('catalog_identity_v3','active');
 INSERT INTO catalog_products VALUES(75,'ЭТНО КАРДИГАН',NULL,'adult','female',1);
 INSERT INTO catalog_stock_positions VALUES(81,75,'ШЕРСТЬ','СТАНДАРТ',1);
 INSERT INTO catalog_variants VALUES(1498,75,81,'adult','ЖЕН','ТЕМНО СЕРЫЙ','ШЕРСТЬ','СТАНДАРТ','46',1);
 -- color and size intentionally MISSING from auxiliary references; they exist in the Catalog.
 INSERT INTO reference_values(kind,value,is_active) VALUES('material','ШЕРСТЬ',1),('length','СТАНДАРТ',1);
 `)
const db={prepare(query){let args=[];return{
 bind(...v){args=v;return this},
 async first(){return sql.prepare(query).get(...args)??null},
 async all(){return {results:sql.prepare(query).all(...args)}},
 async run(){const r=sql.prepare(query).run(...args);return{meta:{changes:r.changes,last_row_id:Number(r.lastInsertRowid)}}},
}}}
const item={productName:'ЭТНО КАРДИГАН',category:'adult',gender:'ЖЕН',material:'ШЕРСТЬ',length:'СТАНДАРТ',color:'ТЕМНО-СЕРЫЙ',size:'46'}
const first=await resolveCatalogProductAndVariantV2(db,item)
assert.equal(first.variantId,1498,'Known active SKU and formatting-equivalent color must be reused')
assert.equal(first.matchStatus,'matched')
const spaced=await resolveCatalogProductAndVariantV2(db,{...item,color:'ТЕМНО СЕРЫЙ'})
assert.equal(spaced.variantId,1498)
const unknown=await resolveCatalogProductAndVariantV2(db,{...item,color:'НЕСУЩЕСТВУЮЩИЙ'})
assert.equal(unknown.matchStatus,'unresolved_attribute','Unknown color must NOT silently create stock/catalog')
const mismatchedSize=await resolveCatalogProductAndVariantV2(db,{...item,size:'48'})
assert.equal(mismatchedSize.matchStatus,'unresolved_attribute')
assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM catalog_variants').get().n,1)
assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM inventory_stock').get().n,0)
console.log('MAIN_RESOLVER_EXISTING_REFERENCES_REAL_SQLITE_PASS — catalog-backed color, hyphen aliases and matching size reuse exact SKU; wrong facts never mutate stock')
sql.close()
