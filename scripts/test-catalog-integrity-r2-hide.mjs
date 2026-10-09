import assert from 'node:assert/strict'
import fs from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { hideUnusedEquivalentReference, previewReferenceConsolidation } from '../worker/domains/reference-integrity.ts'

const sqlite=new DatabaseSync(':memory:')
sqlite.exec([
"CREATE TABLE reference_values(id INTEGER PRIMARY KEY,kind TEXT,value TEXT,is_active INTEGER,updated_at TEXT);",
"CREATE TABLE catalog_products(id INTEGER PRIMARY KEY,name TEXT);",
"CREATE TABLE catalog_stock_positions(id INTEGER PRIMARY KEY,product_id INTEGER,material TEXT,length TEXT,is_active INTEGER);",
"CREATE TABLE catalog_variants(id INTEGER PRIMARY KEY,product_id INTEGER,stock_position_id INTEGER,category TEXT,gender TEXT,color TEXT,size_label TEXT,material TEXT,length TEXT,is_active INTEGER);",
"CREATE TABLE inventory_stock(id INTEGER PRIMARY KEY,variant_id INTEGER,quantity INTEGER,reserved_quantity INTEGER);",
"INSERT INTO reference_values VALUES (1,'color','СВЕТЛО-СЕРЫЙ',1,'before'),(2,'color','СВЕТЛО СЕРЫЙ',1,'before'),(3,'material','КОСТЮМНЫЙ-МАТЕРИАЛ',1,'before'),(4,'material','КОСТЮМНЫЙ МАТЕРИАЛ',1,'before');",
"INSERT INTO catalog_products VALUES(100,'ЭТНО КАРДИГАН');",
"INSERT INTO catalog_stock_positions VALUES(30,100,'ДРАП','СТАНДАРТ',1);",
"INSERT INTO catalog_variants VALUES(7,100,30,'adult','ЖЕН','СВЕТЛО-СЕРЫЙ','52','ДРАП','СТАНДАРТ',1);",
"INSERT INTO inventory_stock VALUES(10,7,0,0);",
].join('\n'))
let injectBeforeUpdate=()=>{}
const db={prepare(sql){return{bind(...args){return{
 async all(){return {results:sqlite.prepare(sql).all(...args)}},
 async first(){return sqlite.prepare(sql).get(...args) || null},
 async run(){if(sql.startsWith('UPDATE reference_values')) injectBeforeUpdate();return {meta:{changes:Number(sqlite.prepare(sql).run(...args).changes)}}}
}}}}}
const status=id=>sqlite.prepare('SELECT is_active FROM reference_values WHERE id=?').get(id).is_active
let preview=await previewReferenceConsolidation(db,1,2)
assert.equal(preview.safeToHideSource,false,'Active SKU blocks hiding')
await assert.rejects(()=>hideUnusedEquivalentReference(db,1,2),/используется/)
assert.equal(status(1),1)
sqlite.exec('UPDATE catalog_variants SET is_active=0 WHERE id=7')
preview=await previewReferenceConsolidation(db,1,2)
assert.equal(preview.safeToHideSource,true)
let done=await hideUnusedEquivalentReference(db,1,2)
assert.equal(done.hidden,true)
assert.equal(status(1),0)
assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM catalog_variants').get().n,1)
assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM inventory_stock').get().n,1)
done=await hideUnusedEquivalentReference(db,1,2)
assert.equal(done.alreadyHidden,true,'Duplicate request is harmless')
sqlite.exec('UPDATE reference_values SET is_active=1 WHERE id=1')
sqlite.exec('UPDATE inventory_stock SET quantity=3 WHERE id=10')
preview=await previewReferenceConsolidation(db,1,2)
assert.equal(preview.safeToHideSource,false,'Dormant variant with stock blocks hiding')
await assert.rejects(()=>hideUnusedEquivalentReference(db,1,2),/имеет остатки/)
assert.equal(status(1),1)
sqlite.exec('UPDATE inventory_stock SET quantity=0 WHERE id=10')
assert.equal((await previewReferenceConsolidation(db,1,2)).safeToHideSource,true)
injectBeforeUpdate=()=>{sqlite.exec('UPDATE catalog_variants SET is_active=1 WHERE id=7');injectBeforeUpdate=()=>{}}
await assert.rejects(()=>hideUnusedEquivalentReference(db,1,2),/изменился после проверки/)
assert.equal(status(1),1,'Atomic SQL recheck blocks race')
sqlite.exec('UPDATE catalog_variants SET is_active=0 WHERE id=7')
sqlite.exec("INSERT INTO catalog_stock_positions VALUES (31,100,'КОСТЮМНЫЙ-МАТЕРИАЛ','СТАНДАРТ',1)")
preview=await previewReferenceConsolidation(db,3,4)
assert.equal(preview.safeToHideSource,false,'Live material execution blocks hiding')
await assert.rejects(()=>hideUnusedEquivalentReference(db,3,4),/используется/)
assert.equal(status(3),1)
assert.equal(sqlite.prepare('SELECT quantity FROM inventory_stock WHERE id=10').get().quantity,0)
sqlite.close()
const module=fs.readFileSync('worker/domains/reference-integrity.ts','utf8')
const worker=fs.readFileSync('worker/index.ts','utf8')
const ui=fs.readFileSync('src/features/sections/ReferenceIntegrityPanel.tsx','utf8')
assert.match(module,/UPDATE reference_values SET is_active=0/)
assert.doesNotMatch(module,/\b(?:UPDATE|DELETE FROM)\s+(?:inventory_stock|catalog_variants|order_items|orders)\b/i)
assert.match(worker,/\/api\/reference-values\/hide-unused-duplicate/)
assert.match(worker,/requireAdminUser\(authUser, 'Очистка справочников/)
assert.match(ui,/Убрать лишнее значение из выбора/)
assert.match(ui,/preview\.safeToHideSource && preview\.source\.isActive/)
console.log('CATALOG INTEGRITY R2 HIDE PASSED — active SKU, stock, execution, race, replay and history guards')
