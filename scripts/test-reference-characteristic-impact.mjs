import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import { previewCharacteristicImpact } from '../worker/domains/reference-characteristic-impact.ts'

const sql=new DatabaseSync(':memory:')
sql.exec(`
  CREATE TABLE catalog_products(id INTEGER PRIMARY KEY,name TEXT,is_active INTEGER);
  CREATE TABLE catalog_stock_positions(id INTEGER PRIMARY KEY,material TEXT,length TEXT,is_active INTEGER);
  CREATE TABLE catalog_variants(
    id INTEGER PRIMARY KEY,product_id INTEGER,stock_position_id INTEGER,
    category TEXT,gender TEXT,color TEXT,material TEXT,length TEXT,size_label TEXT,is_active INTEGER
  );
  CREATE TABLE inventory_stock(id INTEGER PRIMARY KEY,variant_id INTEGER,inventory_source TEXT,quantity INTEGER,reserved_quantity INTEGER);
  CREATE TABLE inventory_reservations(id INTEGER PRIMARY KEY,variant_id INTEGER,status TEXT,quantity INTEGER);
  CREATE TABLE workshop_tasks(id INTEGER PRIMARY KEY,variant_id INTEGER,status TEXT);
  CREATE TABLE orders(id INTEGER PRIMARY KEY,order_date TEXT,order_status TEXT,shipping_status TEXT);
  CREATE TABLE order_items(id INTEGER PRIMARY KEY,order_id INTEGER,variant_id INTEGER,quantity INTEGER);
  INSERT INTO catalog_products VALUES(1,'КАРДИГАН',1),(2,'ДЕТСКИЙ ЖИЛЕТ',1);
  INSERT INTO catalog_stock_positions VALUES
   (1,'ДРАП','СТАНДАРТ',1),(2,'ШЕРСТЬ','СТАНДАРТ',1);
  INSERT INTO catalog_variants VALUES
   (10,1,1,'adult','','СВЕТЛО СЕРЫЙ','ДРАП','СТАНДАРТ','52',1),
   (11,1,1,'adult','','СЕРЫЙ','ДРАП','СТАНДАРТ','52',1),
   (12,1,2,'adult','','СВЕТЛО СЕРЫЙ','ДРАП','СТАНДАРТ','54',1),
   (13,2,NULL,'child','','СВЕТЛО СЕРЫЙ','','','1',1),
   (14,1,1,'adult','','СВЕТЛО СЕРЫЙ','ДРАП','СТАНДАРТ','54',0);
  INSERT INTO inventory_stock VALUES
   (1,10,'warehouse',3,1),(2,10,'boutique',2,0),
   (3,11,'warehouse',5,1),(4,13,'warehouse',1,0);
  INSERT INTO inventory_reservations VALUES (1,10,'active',1),(2,11,'active',1),(3,10,'cancelled',3);
  INSERT INTO workshop_tasks VALUES (1,10,'active'),(2,11,'completed');
  INSERT INTO orders VALUES
   (101,'2026-10-08','active','not_sent'),
   (102,'2026-09-15','archived','sent'),
   (103,'2026-10-09','active','sent'),
   (104,'2026-10-09','deleted','not_sent');
  INSERT INTO order_items VALUES (1,101,10,1),(2,102,10,2),(3,103,11,1),(4,104,10,1);
`)
const db={prepare(query){return {bind(...args){return {
  async first(){return sql.prepare(query).get(...args)||null},
  async all(){return {results:sql.prepare(query).all(...args)}},
}}}}}
const month={from:'2026-10-01',toExclusive:'2026-11-01'}
const before={
  variants:sql.prepare('SELECT * FROM catalog_variants ORDER BY id').all(),
  stocks:sql.prepare('SELECT * FROM inventory_stock ORDER BY id').all(),
  reservations:sql.prepare('SELECT * FROM inventory_reservations ORDER BY id').all(),
  orders:sql.prepare('SELECT * FROM orders ORDER BY id').all(),
}
const colors=await previewCharacteristicImpact(
  db,{kind:'color',value:'СВЕТЛО СЕРЫЙ'},{kind:'color',value:'СЕРЫЙ'},month)
assert.equal(colors.source.variants,4)
assert.equal(colors.source.activeVariants,3)
assert.equal(colors.source.physical,6,'Warehouse, boutique, and child stock remain distinct')
assert.equal(colors.source.reserved,1)
assert.equal(colors.source.activeReservations,1)
assert.equal(colors.source.activeWorkshopTasks,1)
assert.equal(colors.source.currentOrderLines,1,'Exclude deleted order lines')
assert.equal(colors.source.olderOrderLines,1)
assert.equal(colors.source.activeUnsentLines,1)
assert.equal(colors.target.variants,1)
assert.equal(colors.target.physical,5)
assert.equal(colors.target.currentOrderLines,1)
assert.equal(colors.byLocation.find(x=>x.side==='source'&&x.location==='boutique')?.physical,2)
assert.ok(colors.warnings.some(x=>x.includes('остатки')))
assert.equal(colors.canAutomaticallyConsolidate,false)
assert.equal(colors.sampleTruncated,false)
assert.equal(colors.sampleVariants.length,5)
const material=await previewCharacteristicImpact(
  db,{kind:'material',value:'ДРАП'},{kind:'material',value:'ШЕРСТЬ'},month)
assert.equal(material.sourceExecutions,1)
assert.equal(material.source.variants,4,'Execution identity participates in material reference use')
assert.equal(material.target.variants,0)
assert.ok(material.warnings.some(x=>x.includes('исполнени')))
assert.ok(material.warnings.some(x=>x.includes('характеристик')))
const adult=await previewCharacteristicImpact(
  db,{kind:'size',value:'52'},{kind:'size',value:'54'},month)
assert.equal(adult.source.variants,2)
assert.equal(adult.target.variants,2)
const child=await previewCharacteristicImpact(
  db,{kind:'child_age',value:'1'},{kind:'child_age',value:'2'},month)
assert.equal(child.source.variants,1)
assert.equal(child.target.variants,0)
const ambiguity=await previewCharacteristicImpact(
  db,{kind:'color',value:'СВЕТЛО СЕРЫЙ'},{kind:'color',value:'светло серый'},month)
assert.equal(ambiguity.indistinguishable,true)
assert.ok(ambiguity.warnings.some(x=>x.includes('одинаковое написание')))
assert.equal(ambiguity.canAutomaticallyConsolidate,false)
await assert.rejects(
  ()=>previewCharacteristicImpact(db,{kind:'color',value:'A'},{kind:'material',value:'B'},month),
  /другая проверка/,
)
assert.deepEqual(sql.prepare('SELECT * FROM catalog_variants ORDER BY id').all(),before.variants)
assert.deepEqual(sql.prepare('SELECT * FROM inventory_stock ORDER BY id').all(),before.stocks)
assert.deepEqual(sql.prepare('SELECT * FROM inventory_reservations ORDER BY id').all(),before.reservations)
assert.deepEqual(sql.prepare('SELECT * FROM orders ORDER BY id').all(),before.orders)

// A deliberately equivalent spelling can point to an existing keeper SKU.
// Both variants must belong to the same physical execution and audience.
sql.exec(`
 INSERT INTO catalog_variants VALUES
  (15,1,1,'adult','','СВЕТЛО-СЕРЫЙ','ДРАП','СТАНДАРТ','52',1),
  (16,1,2,'adult','','СВЕТЛО-СЕРЫЙ','ДРАП','СТАНДАРТ','52',1),
  (17,1,1,'adult','','СВЕТЛО-СЕРЫЙ','ДРАП','СТАНДАРТ','56',1);
 INSERT INTO inventory_stock VALUES (5,15,'warehouse',7,0);
`)
const synonyms=await previewCharacteristicImpact(
 db,{kind:'color',value:'СВЕТЛО-СЕРЫЙ'},{kind:'color',value:'СВЕТЛО СЕРЫЙ'},month)
assert.deepEqual(synonyms.skuPairs.map(p=>[p.sourceVariantId,p.targetVariantId]),[[15,10]],
 'Only matching execution, size, and product can share existing SKU consolidation')
assert.equal(synonyms.skuPairsLimited,false)
assert.equal(synonyms.canAutomaticallyConsolidate,false,'Never permit a wholesale reference rewrite')
const different=await previewCharacteristicImpact(
 db,{kind:'color',value:'СВЕТЛО-СЕРЫЙ'},{kind:'color',value:'СЕРЫЙ'},month)
assert.equal(different.skuPairs.length,0,'Different business colors must NOT be merged as identical SKUs')
const otherSize=await previewCharacteristicImpact(
 db,{kind:'size',value:'52'},{kind:'size',value:'54'},month)
assert.equal(otherSize.skuPairs.length,0,'Different physical sizes cannot use duplicate-SKU consolidation')
// The keeper must be unambiguous. Two candidates with the same identity
// must not be auto-selected by first ID.
sql.exec("INSERT INTO catalog_variants VALUES (18,1,1,'adult','','СВЕТЛО СЕРЫЙ','ДРАП','СТАНДАРТ','52',1)")
const ambiguous=await previewCharacteristicImpact(
 db,{kind:'color',value:'СВЕТЛО-СЕРЫЙ'},{kind:'color',value:'СВЕТЛО СЕРЫЙ'},month)
assert.equal(ambiguous.skuPairs.length,0,'Multiple keeper SKUs require manual catalog review')
const ui = fs.readFileSync('src/features/sections/ReferenceMergeWorkspace.tsx','utf8')
const api = fs.readFileSync('worker/index.ts','utf8')
assert.match(ui,/reference-merge-sku-guidance/)
assert.match(ui,/api\\/catalog\\/variants\\/consolidation-preview/)
assert.match(ui,/api\\/catalog\\/variants\\/consolidate-unused/)
assert.match(ui,/expectedToken:preview\\.stateToken/)
assert.ok(ui.includes('/api/reference-values/consolidation-preview'))
assert.ok(ui.includes('/api/reference-values/hide-unused-duplicate'))
assert.ok(ui.includes('cleanup.safeToHideSource'))
assert.match(ui,/pairReview\\.preview\\.canConsolidate/)
assert.match(api,/requireAdminUser\\(authUser, 'Объединение вариантов/)
console.log('CHARACTERISTIC SKU GUIDANCE PASSED — equivalent colors only, exact position/size, ambiguous keeper blocked')

console.log('CHARACTERISTIC MERGE IMPACT PASSED — source/keeper choice, material executions, warehouse/boutique, active/historical orders, reserves, ambiguity, read-only')
