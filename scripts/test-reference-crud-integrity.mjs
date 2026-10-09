import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import {
 countCatalogReferenceUsage, assertReferenceValueCanChange,
} from '../worker/domains/references.ts'

const sql=new DatabaseSync(':memory:')
sql.exec(`
CREATE TABLE reference_values(id INTEGER PRIMARY KEY,kind TEXT,value TEXT,is_active INTEGER);
CREATE TABLE catalog_stock_positions(id INTEGER PRIMARY KEY,material TEXT,length TEXT,is_active INTEGER);
CREATE TABLE catalog_variants(
 id INTEGER PRIMARY KEY, category TEXT, color TEXT, material TEXT,
 length TEXT, size_label TEXT, is_active INTEGER
);
CREATE TABLE inventory_stock(id INTEGER PRIMARY KEY,variant_id INTEGER,quantity INTEGER,reserved_quantity INTEGER);
INSERT INTO reference_values VALUES
 (1,'material','КОСТЮМНЫЙ',1),(2,'length','ДЛИННЫЙ',1),
 (3,'color','СИНИЙ',1),(4,'size','52',1),(5,'child_age','1',1),
 (6,'material','НЕИСПОЛЬЗУЕМЫЙ',1);
INSERT INTO catalog_stock_positions VALUES(1,'КОСТЮМНЫЙ','ДЛИННЫЙ',1);
`)
const db={prepare(q){return{
 bind(...args){return{
  async first(){return sql.prepare(q).get(...args)||null},
  async all(){return {results:sql.prepare(q).all(...args)}},
  async run(){return {meta:sql.prepare(q).run(...args)}},
 }},
}}}
// No active variant exists but execution is a live catalog business identity.
assert.equal(await countCatalogReferenceUsage(db,'material','КОСТЮМНЫЙ'),1)
assert.equal(await countCatalogReferenceUsage(db,'length','ДЛИННЫЙ'),1)
await assert.rejects(
 ()=>assertReferenceValueCanChange(db,'material',1,'ДРАП',1),
 /исполнения или складские остатки/
)
await assert.rejects(
 ()=>assertReferenceValueCanChange(db,'length',2,undefined,0),
 /исполнения или складские остатки/
)
sql.exec("UPDATE catalog_stock_positions SET is_active=0 WHERE id=1")
// No live execution, but inactive SKU with real stock still needs preservation.
sql.exec(`
INSERT INTO catalog_variants VALUES(10,'adult','СИНИЙ','КОСТЮМНЫЙ','ДЛИННЫЙ','52',0);
INSERT INTO inventory_stock VALUES(1,10,2,0);
`)
for(const [kind,value,id] of [
 ['color','СИНИЙ',3],['size','52',4],
 ['material','КОСТЮМНЫЙ',1],['length','ДЛИННЫЙ',2],
]) {
 assert.equal(await countCatalogReferenceUsage(db,kind,value),1,
  'An inactive SKU carrying physical stock must block '+kind)
 await assert.rejects(
  ()=>assertReferenceValueCanChange(db,kind,id,undefined,0),
  /исполнения или складские остатки/,
 )
}
sql.exec("UPDATE inventory_stock SET quantity=0,reserved_quantity=1 WHERE id=1")
assert.equal(await countCatalogReferenceUsage(db,'color','СИНИЙ'),1,
 'A dormant SKU carrying only a reservation also blocks disabling')
sql.exec("UPDATE inventory_stock SET quantity=0,reserved_quantity=0 WHERE id=1")
assert.equal(await countCatalogReferenceUsage(db,'color','СИНИЙ'),0)
assert.equal(await countCatalogReferenceUsage(db,'material','НЕИСПОЛЬЗУЕМЫЙ'),0)
await assertReferenceValueCanChange(db,'material',6,'ДРАП',1)
sql.exec("UPDATE catalog_variants SET is_active=1 WHERE id=10")
assert.equal(await countCatalogReferenceUsage(db,'color','СИНИЙ'),1)
await assert.rejects(()=>assertReferenceValueCanChange(db,'color',3,'КРАСНЫЙ',1),
 /исполнения или складские остатки/)
sql.exec(`
INSERT INTO catalog_variants VALUES(11,'child','СИНИЙ','КОСТЮМНЫЙ','ДЛИННЫЙ','1',1);
`)
assert.equal(await countCatalogReferenceUsage(db,'child_age','1'),1)
assert.equal(await countCatalogReferenceUsage(db,'size','52'),1,
 'Adult sizes and child ages must never be conflated')
assert.equal(await countCatalogReferenceUsage(db,'size','1'),0)
assert.equal(await countCatalogReferenceUsage(db,'child_age','52'),0)
console.log('REFERENCE CRUD INTEGRITY PASSED — detached executions, dormant stock/reserve, adult/child split, zero-impact edits')
