// Prevent silent 1500-reference / 2000-SKU cutoffs and false keeper defaults.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {listReferenceDuplicateGroups} from '../worker/domains/reference-integrity.ts'

const sql=new DatabaseSync(':memory:')
sql.exec(`
 CREATE TABLE reference_values(id INTEGER PRIMARY KEY,kind TEXT,value TEXT,is_active INTEGER);
 CREATE TABLE catalog_products(id INTEGER PRIMARY KEY,name TEXT);
 CREATE TABLE catalog_variants(
  id INTEGER PRIMARY KEY,product_id INTEGER,stock_position_id INTEGER,
  category TEXT,gender TEXT,color TEXT,size_label TEXT,material TEXT,length TEXT,is_active INTEGER
 );
 CREATE TABLE inventory_stock(id INTEGER PRIMARY KEY,variant_id INTEGER,quantity INTEGER,reserved_quantity INTEGER);
 INSERT INTO catalog_products VALUES(100,'КАРДИГАН');
`)
const ref=sql.prepare("INSERT INTO reference_values(id,kind,value,is_active) VALUES(?, 'color', ?, 1)")
const v=sql.prepare("INSERT INTO catalog_variants(id,product_id,stock_position_id,category,gender,color,size_label,material,length,is_active) VALUES(?,100,30,'adult','ЖЕН','СИНИЙ',?,'ДРАП','СТАНДАРТ',1)")
sql.exec('BEGIN')
for(let i=1;i<=2301;i++){
 if(i<=1601)ref.run(i,i===3?'СВЕТЛО СЕРЫЙ':i===1601?'СВЕТЛО-СЕРЫЙ':'НЕПОВТОР '+i)
 v.run(i,i===3||i===2201?'ДУБЛЬ':i===2000||i===2001?'ГРАНИЦА':'SIZE-'+i)
}
sql.exec('COMMIT')
sql.exec("INSERT INTO inventory_stock VALUES(1,3,4,1),(2,2201,2,0)")
const db={prepare(query){return {bind(...args){return {all:async()=>({results:sql.prepare(query).all(...args)})}}}}}
let got=await listReferenceDuplicateGroups(db)
assert.equal(got.ok,true)
assert.equal(got.limited,false)
assert.equal(got.skuLimited,false)
assert.equal(got.referenceScanned,1601)
assert.equal(got.skuScanned,2301)
assert.equal(got.crossPageSnapshot,false)
assert.ok(got.groups.some(x=>x.items.some(row=>row.id===3)&&x.items.some(row=>row.id===1601)),
 'Duplicate references across former LIMIT 1500 must be found')
const pair=got.skuGroups.find(x=>x.variants.some(v=>v.id===3)&&x.variants.some(v=>v.id===2201))
assert.ok(pair,'SKU duplicate after old LIMIT 2000 must be found')
assert.equal(pair.variants.length,2)
assert.deepEqual(pair.variants.map(v=>[v.id,v.physical,v.reserved]),[[3,4,1],[2201,2,0]])
assert.ok(got.skuGroups.some(x=>x.variants.some(v=>v.id===2000)&&x.variants.some(v=>v.id===2001)),
 'Variants crossing a scan page boundary must stay in one group')

// Deliberate 12000-row read budget: clearly advertise unscanned records.
const more=sql.prepare("INSERT INTO reference_values(id,kind,value,is_active) VALUES(?, 'color', ?, 1)")
sql.exec('BEGIN')
for(let i=1602;i<=12001;i++)more.run(i,'UNIQUE-'+i)
sql.exec('COMMIT')
got=await listReferenceDuplicateGroups(db)
assert.equal(got.referenceScanned,12000)
assert.equal(got.limited,true,'At 12001 refs exhaustive status must be false')
assert.equal(got.skuLimited,false)
const component=fs.readFileSync('src/features/sections/ReferenceIntegrityPanel.tsx','utf8')
assert.doesNotMatch(component,/const preferred = \[\.\.\.group\.variants\]/,
 'Stock quantity must NEVER preselect keeper automatically')
assert.match(component,/const keeperId = skuKeeper\[key\].*\n\s*\? skuKeeper\[key\] : 0/)
assert.match(component,/<option value="">— Выберите основной вариант —<\/option>/)
assert.match(component,/keeperId>0 && variant\.id !== keeperId/)
assert.match(component,/setSkuKeeper\(\{\}\)/)
assert.match(component,/Каталог больше проверенного объёма/)
console.log('EXHAUSTIVE DUPLICATES PASSED — 2301 SKUs, 1601 references, 12001-row bound, no automatic keeper')
sql.close()
