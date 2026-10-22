import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import {
  createCatalogCombinationV3, assertCatalogGenderAllowedForScope,
  resolveCatalogGenderForProduct,
} from '../worker/domains/catalog.ts'
import { resolveCatalogProductAndVariantV2 } from '../worker/domains/order-reservations.ts'

// Actual domain SQL against a disposable SQLite database, not a source-string
// substitute. One product scope is a default; concrete opposite-gender SKUs
// have separate canonical identities and no implicit inventory quantity.
const sql = new DatabaseSync(':memory:')
sql.exec(`
CREATE TABLE catalog_products (
  id INTEGER PRIMARY KEY, name TEXT, gender_scope TEXT, is_active INTEGER, updated_at TEXT
);
CREATE TABLE catalog_stock_positions (
  id INTEGER PRIMARY KEY, product_id INTEGER, is_active INTEGER
);
CREATE TABLE catalog_variants (
  id INTEGER PRIMARY KEY, external_id TEXT UNIQUE,
  product_id INTEGER, stock_position_id INTEGER, category TEXT,
  gender TEXT, color TEXT, material TEXT, length TEXT, size_label TEXT,
  is_active INTEGER, sort_order INTEGER, created_at TEXT, updated_at TEXT
);
CREATE TABLE inventory_stock (
  inventory_source TEXT, variant_id INTEGER, quantity INTEGER, reserved_quantity INTEGER
);
INSERT INTO catalog_products VALUES
  (11,'БАЯН СҰЛУ ШАПАН','female',1,'2026-10-20'),
  (12,'АЙ НАЗЫК ЖИЛЕТЫ','female',1,'2026-10-20'),
  (13,'САРДАР ШАПАН','unisex',1,'2026-10-20');
INSERT INTO catalog_stock_positions VALUES (21,11,1),(22,12,1),(23,13,1);
INSERT INTO catalog_variants VALUES
  (301,'W-301',11,21,'adult','ЖЕН','ОРАНЖЕВЫЙ','СТАНДАРТ','СТАНДАРТ','52',1,0,'2026-10-20','2026-10-20');
`)
const db = {
  prepare(text) {
    let args = []
    return {
      bind(...values) { args = values; return this },
      async first() { return sql.prepare(text).get(...args) || null },
      async all() { return {results:sql.prepare(text).all(...args)} },
      async run() {
        const r=sql.prepare(text).run(...args)
        return {meta:{last_row_id:Number(r.lastInsertRowid),changes:Number(r.changes)}}
      }
    }
  }
}
assert.equal(assertCatalogGenderAllowedForScope('female','МУЖ').gender,'МУЖ')
assert.equal(assertCatalogGenderAllowedForScope('male','ЖЕН').gender,'ЖЕН')
assert.equal(assertCatalogGenderAllowedForScope('female','').gender,'')
assert.throws(() => assertCatalogGenderAllowedForScope('female','НЕЯСНО'),/Неизвестный пол/)
assert.equal((await resolveCatalogGenderForProduct(db,11,'МУЖ')).gender,'МУЖ')
assert.equal((await resolveCatalogGenderForProduct(db,11,'')).gender,'ЖЕН')
await assert.rejects(resolveCatalogGenderForProduct(db,13,''),/выберите пол/i)
const timestamp='2026-10-21T15:00:00Z'
const input={
  productId:11, executionId:21, category:'adult',
  gender:'МУЖ',color:'ОРАНЖЕВЫЙ',material:'СТАНДАРТ',
  length:'СТАНДАРТ',sizeLabel:'52'
}
const created=await createCatalogCombinationV3(db,input,timestamp)
assert(created.id > 0 && created.created, 'Opposite-gender SKU must be allowed')
const created2=await createCatalogCombinationV3(db,input,timestamp)
assert.equal(created2.id,created.id,'Same canonical male SKU reused')
assert.equal(created2.created,false,'Identical subsequent request cannot create a duplicate')
const variants=sql.prepare('SELECT id,gender,size_label FROM catalog_variants WHERE product_id=11 ORDER BY id').all()
assert.deepEqual(variants.map(v=>v.gender),['ЖЕН','МУЖ'])
assert.equal(variants[0].id,301,'Existing female variant is preserved')
assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM inventory_stock').get().n,0,
  'Registering an SKU must not invent physical stock or a reservation')
await assert.rejects(createCatalogCombinationV3(db,{...input,gender:'НЕИЗВЕСТНО'},timestamp),/Не указан пол/)
await assert.rejects(createCatalogCombinationV3(db,{...input,gender:''},timestamp),/Не указан пол/)
assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM catalog_variants').get().n,2)
assert.equal(sql.prepare('SELECT gender_scope FROM catalog_products WHERE id=11').get().gender_scope,'female',
  'Do not silently rewrite product catalog metadata or historical meaning')
sql.exec('UPDATE catalog_stock_positions SET is_active=0 WHERE id=21')
await assert.rejects(createCatalogCombinationV3(db,{...input,color:'ЧЕРНЫЙ'},timestamp),/удалённого исполнения/)
// Exercise the actual order-to-catalog automatic Resolver, not only low-level
// SKU INSERT. An opposite-gender order must create/reuse one exact SKU, while
// blank/unknown dimensions stay unresolved and cannot create phantom stock.
sql.exec(`
ALTER TABLE catalog_products ADD COLUMN category TEXT DEFAULT 'adult';
ALTER TABLE catalog_products ADD COLUMN external_id TEXT;
ALTER TABLE catalog_stock_positions ADD COLUMN material TEXT DEFAULT 'СТАНДАРТ';
ALTER TABLE catalog_stock_positions ADD COLUMN length TEXT DEFAULT 'СТАНДАРТ';
CREATE TABLE catalog_identity_meta(key TEXT PRIMARY KEY,value TEXT);
CREATE TABLE reference_values(id INTEGER PRIMARY KEY,kind TEXT,value TEXT,is_active INTEGER);
INSERT INTO catalog_identity_meta VALUES('catalog_identity_v3','active');
INSERT INTO reference_values(kind,value,is_active)
 VALUES('material','СТАНДАРТ',1),('length','СТАНДАРТ',1),
       ('color','ОРАНЖЕВЫЙ',1),('size','52',1);
`)
const maleKnown={
 productName:'АЙ НАЗЫК ЖИЛЕТЫ',category:'adult',gender:'МУЖ',
 material:'СТАНДАРТ',length:'СТАНДАРТ',color:'ОРАНЖЕВЫЙ',size:'52'
}
const firstResolved=await resolveCatalogProductAndVariantV2(db,maleKnown,{timestamp})
assert.equal(firstResolved.matchStatus,'created_combination')
assert(firstResolved.variantId > 0)
assert.equal(sql.prepare('SELECT gender FROM catalog_variants WHERE id=?').get(firstResolved.variantId).gender,'МУЖ')
const secondResolved=await resolveCatalogProductAndVariantV2(db,maleKnown,{timestamp})
assert.equal(secondResolved.variantId,firstResolved.variantId)
assert.equal(secondResolved.matchStatus,'matched')
const countBefore=sql.prepare('SELECT COUNT(*) AS n FROM catalog_variants').get().n
const unknown=await resolveCatalogProductAndVariantV2(db,{...maleKnown,color:'НЕИЗВЕСТНЫЙ ЦВЕТ'},{timestamp})
assert.equal(unknown.matchStatus,'unresolved_attribute')
const missingSize=await resolveCatalogProductAndVariantV2(db,{...maleKnown,size:''},{timestamp})
assert.equal(missingSize.matchStatus,'unresolved_attribute')
const unisexMissingGender=await resolveCatalogProductAndVariantV2(db,{...maleKnown,productName:'САРДАР ШАПАН',gender:''},{timestamp})
assert.equal(unisexMissingGender.matchStatus,'unresolved_attribute')
assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM catalog_variants').get().n,countBefore)
assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM inventory_stock').get().n,0)
assert.equal(sql.prepare('SELECT gender_scope FROM catalog_products WHERE id=12').get().gender_scope,'female')

sql.close()

const orderResolver=readFileSync('worker/domains/order-reservations.ts','utf8')
const ui=readFileSync('src/features/orders/OrderCatalogResolutionModal.tsx','utf8')
const review=readFileSync('worker/domains/catalog-review.ts','utf8')
assert(!orderResolver.includes('enteredGender !== fixedProductGender'),
 'An explicitly entered male or female must not become catalog_unresolved due to the product default')
assert(orderResolver.includes("matchStatus: created.created ? 'created_combination' : 'matched'"),
 'Recognized new combinations must auto-materialize')
assert(!ui.includes('genderScopeConflict'), 'Resolver must not present the removed gender dead-end')
assert(ui.includes('Сохранить и продолжить') && ui.includes('Проверить снова'),
 'Resolver save and stale-result retry remain accessible')
assert(review.includes('const productGenderScope'), 'Human resolver must still inspect product defaults')
assert(review.includes("unknownFields.push('gender')"), 'Genuinely unknown gender must still ask')
console.log('MAIN_OPPOSITE_GENDER_REAL_SQL_AND_RESOLVER_CONTRACT_PASSED')
