import assert from 'node:assert/strict'
import fs from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {receiveClient3WatchArrival} from '../../worker/domains/client3-watch-inventory.ts'

const sqlite=new DatabaseSync(':memory:')
sqlite.exec('PRAGMA foreign_keys=ON')
sqlite.exec([
 'CREATE TABLE managers(id INTEGER PRIMARY KEY);',
 'CREATE TABLE app_users(id INTEGER PRIMARY KEY);',
 'CREATE TABLE orders(id INTEGER PRIMARY KEY);',
 'CREATE TABLE order_items(id INTEGER PRIMARY KEY);',
 'CREATE TABLE catalog_products(id INTEGER PRIMARY KEY,name TEXT,is_active INTEGER);',
 'CREATE TABLE catalog_stock_positions(id INTEGER PRIMARY KEY,product_id INTEGER,is_active INTEGER);',
 'CREATE TABLE catalog_variants(id INTEGER PRIMARY KEY,product_id INTEGER,stock_position_id INTEGER,category TEXT,gender TEXT,color TEXT,material TEXT,length TEXT,size_label TEXT,is_active INTEGER);',
 'CREATE TABLE inventory_model_meta(key TEXT PRIMARY KEY,value TEXT);',
 'CREATE TABLE inventory_stock(id INTEGER PRIMARY KEY,variant_id INTEGER,inventory_source TEXT,quantity INTEGER,reserved_quantity INTEGER);',
 "INSERT INTO inventory_model_meta VALUES('human_inventory_v2','active');",
 'INSERT INTO managers VALUES(1);',
 'INSERT INTO app_users VALUES(1);',
 "INSERT INTO catalog_products VALUES(10,'WATCH_TAUWACH_MODEL_1',1);",
 'INSERT INTO catalog_stock_positions VALUES(20,10,1);',
 "INSERT INTO catalog_variants VALUES(100,10,20,'adult','МУЖ','WATCH_DIAL_BLACK','WATCH_QUARTZ_LEATHER_ЧЁРНЫЙ','СТАНДАРТ','',1);",
 "INSERT INTO inventory_stock(id,variant_id,inventory_source,quantity,reserved_quantity) VALUES(1,100,'warehouse',0,0),(2,100,'boutique',0,0);",
].join('\n'))
sqlite.exec(fs.readFileSync('migrations/client3-watch/0002_client3_watch_foundation.sql','utf8'))
sqlite.exec([
 "INSERT INTO watch_products(brand_id,model_name,catalog_product_id) VALUES(1,'CLASSIC',10);",
 "INSERT INTO watch_variants(watch_product_id,catalog_variant_id,gender,movement,bracelet_material,dial_color,bracelet_color) VALUES(1,100,'male','quartz','leather','black','ЧЁРНЫЙ');",
].join('\n'))
const db={prepare(statement){
 let params=[]
 return {bind(...values){params=values;return this},async first(){return sqlite.prepare(statement).get(...params)||null}}
}}
const admin={id:1,role:'admin',managerId:null,employeeRole:'Администратор'}
const seen=new Map()
const requests=[]
// Simulated, idempotent Main movement boundary: tests watch adapter mapping, NOT the
// full Main movement engine or the real Client3 tenant's D1 schema.
async function movementWriter(_db,input,includeInventory,actor){
 const row=input.items?.[0]
 assert.equal(includeInventory,false)
 assert.equal(actor,'client3-watch:1')
 assert.equal(input.movementType,'arrival')
 assert.equal(input.items.length,1)
 assert.equal(row.variantId,100)
 assert.equal(row.productId,10)
 assert.equal(row.productName,'WATCH_TAUWACH_MODEL_1')
 assert.equal(row.material,'WATCH_QUARTZ_LEATHER_ЧЁРНЫЙ')
 assert.equal(row.color,'WATCH_DIAL_BLACK')
 assert.equal(row.gender,'МУЖ')
 assert.equal(row.quantity>0,true)
 const fingerprint=JSON.stringify([input.inventorySource,row.variantId,row.quantity,input.comment])
 if(seen.has(input.requestId)){
   if(seen.get(input.requestId)!==fingerprint)throw Error('Different operation with reused request ID')
   return {ok:true,duplicate:true}
 }
 seen.set(input.requestId,fingerprint)
 sqlite.prepare('UPDATE inventory_stock SET quantity=quantity+? WHERE inventory_source=? AND variant_id=?')
   .run(row.quantity,input.inventorySource,row.variantId)
 requests.push(input)
 return {ok:true,applied:1,duplicate:false}
}
const read=async p=>{const response=await p;return {status:response.status,...await response.json()}}
const base={watchVariantId:1,quantity:3,source:'office',requestId:'watch-positive-0001',comment:'накладная 301'}
const first=await read(receiveClient3WatchArrival(db,admin,1,base,movementWriter))
assert.equal(first.status,200)
assert.equal(first.ok,true)
assert.equal(first.physicalStockRecorded,true)
assert.equal(first.duplicate,false)
assert.equal(requests.length,1)
assert.equal(sqlite.prepare("SELECT quantity FROM inventory_stock WHERE inventory_source='warehouse'").get().quantity,3)
const repeat=await read(receiveClient3WatchArrival(db,admin,1,base,movementWriter))
assert.equal(repeat.ok,true)
assert.equal(repeat.duplicate,true)
assert.equal(requests.length,1)
assert.equal(sqlite.prepare("SELECT quantity FROM inventory_stock WHERE inventory_source='warehouse'").get().quantity,3)
const conflict=await read(receiveClient3WatchArrival(db,admin,1,{...base,quantity:5},movementWriter))
assert.equal(conflict.status,409)
assert.equal(requests.length,1)
const showcase=await read(receiveClient3WatchArrival(db,admin,1,{
 ...base,source:'showcase',requestId:'watch-positive-0002',quantity:2
},movementWriter))
assert.equal(showcase.ok,true)
assert.equal(sqlite.prepare("SELECT quantity FROM inventory_stock WHERE inventory_source='boutique'").get().quantity,2)
assert.equal(sqlite.prepare("SELECT quantity FROM inventory_stock WHERE inventory_source='warehouse'").get().quantity,3)
const crossBrand=await read(receiveClient3WatchArrival(db,admin,2,{
 ...base,requestId:'watch-positive-0003'
},movementWriter))
assert.equal(crossBrand.status,409)
assert.equal(requests.length,2)
assert.deepEqual(sqlite.prepare('SELECT * FROM orders').all(),[])
assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(),[])
sqlite.close()
console.log('CLIENT3_WATCH_ARRIVAL_ADAPTER_PASS: exact canonical SKU, split sources, replay, conflict, foreign-brand rejection (simulated movement boundary)')
