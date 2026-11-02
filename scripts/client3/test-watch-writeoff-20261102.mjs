import assert from 'node:assert/strict'
import fs from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {writeoffClient3WatchStock} from '../../worker/domains/client3-watch-writeoff.ts'

const sqlite=new DatabaseSync(':memory:')
sqlite.exec('PRAGMA foreign_keys=ON')
sqlite.exec([
 'CREATE TABLE app_users(id INTEGER PRIMARY KEY);',
 'CREATE TABLE managers(id INTEGER PRIMARY KEY);',
 'CREATE TABLE orders(id INTEGER PRIMARY KEY);',
 'CREATE TABLE order_items(id INTEGER PRIMARY KEY);',
 'CREATE TABLE catalog_products(id INTEGER PRIMARY KEY,name TEXT,is_active INTEGER);',
 'CREATE TABLE catalog_stock_positions(id INTEGER PRIMARY KEY,product_id INTEGER,is_active INTEGER);',
 'CREATE TABLE catalog_variants(id INTEGER PRIMARY KEY,product_id INTEGER,stock_position_id INTEGER,category TEXT,gender TEXT,color TEXT,material TEXT,length TEXT,size_label TEXT,is_active INTEGER);',
 'CREATE TABLE inventory_model_meta(key TEXT PRIMARY KEY,value TEXT);',
 'CREATE TABLE inventory_stock(id INTEGER PRIMARY KEY,variant_id INTEGER,inventory_source TEXT,quantity INTEGER,reserved_quantity INTEGER);',
 'CREATE TABLE inventory_operations(operation_id TEXT PRIMARY KEY,operation_type TEXT,source_type TEXT);',
 'CREATE TABLE inventory_reservations(id INTEGER PRIMARY KEY,variant_id INTEGER,inventory_source TEXT,quantity INTEGER,status TEXT);',
 "INSERT INTO inventory_model_meta VALUES('human_inventory_v2','active');",
 'INSERT INTO app_users VALUES(1);',
 'INSERT INTO managers VALUES(1);',
 "INSERT INTO catalog_products VALUES(10,'WATCH_TAUWACH_MODEL_1',1);",
 'INSERT INTO catalog_stock_positions VALUES(20,10,1);',
 "INSERT INTO catalog_variants VALUES(100,10,20,'adult','МУЖ','WATCH_DIAL_BLACK','WATCH_QUARTZ_LEATHER_ЧЁРНЫЙ','СТАНДАРТ','',1);",
 "INSERT INTO inventory_stock VALUES(1,100,'warehouse',5,2);",
 "INSERT INTO inventory_stock VALUES(2,100,'boutique',1,0);",
 "INSERT INTO inventory_reservations VALUES(1,100,'warehouse',2,'active');",
].join('\n'))
sqlite.exec(fs.readFileSync('migrations/client3-watch/0002_client3_watch_foundation.sql','utf8'))
sqlite.exec([
 "INSERT INTO watch_products(brand_id,model_name,catalog_product_id) VALUES(1,'CLASSIC',10);",
 "INSERT INTO watch_variants(watch_product_id,catalog_variant_id,gender,movement,bracelet_material,dial_color,bracelet_color) VALUES(1,100,'male','quartz','leather','black','ЧЁРНЫЙ');",
].join('\n'))
const db={prepare(query){let args=[];return{
 bind(...values){args=values;return this},
 async first(){return sqlite.prepare(query).get(...args)||null},
}}}
const admin={id:1,role:'admin',managerId:null,employeeRole:'Администратор'}
const manager={id:2,role:'manager',managerId:1,employeeRole:'Менеджер'}
const result=async promise=>{const response=await promise;return {status:response.status,...await response.json()}}
const fingerprints=new Map()
const apply=async(_db,input,returnInventory,actor)=>{
 assert.equal(returnInventory,false)
 assert.equal(actor,'client3-watch:1')
 assert.equal(input.movementType,'writeoff')
 assert.deepEqual(input.stockConfirmations,[])
 assert.equal(input.items.length,1)
 assert.equal(input.items[0].variantId,100)
 assert.equal(input.items[0].productName,'WATCH_TAUWACH_MODEL_1')
 const key=JSON.stringify([input.inventorySource,input.items,input.comment])
 if(fingerprints.has(input.requestId)){
   if(fingerprints.get(input.requestId)!==key)throw Error('Repeated request changed contents')
   return {ok:true,duplicate:true}
 }
 fingerprints.set(input.requestId,key)
 sqlite.prepare('INSERT INTO inventory_operations VALUES(?,?,?)').run(input.requestId,'writeoff',input.inventorySource)
 sqlite.prepare('UPDATE inventory_stock SET quantity=quantity-? WHERE variant_id=? AND inventory_source=?')
  .run(input.items[0].quantity,100,input.inventorySource)
 return {ok:true,duplicate:false,applied:1}
}
const input={source:'office',watchVariantId:1,quantity:2,expectedPhysical:5,
 requestId:'writeoff-unique-001',comment:'Дефект стекла'}
assert.equal((await result(writeoffClient3WatchStock(db,manager,1,input,apply))).status,403)
assert.equal((await result(writeoffClient3WatchStock(db,admin,2,input,apply))).status,409)
assert.equal((await result(writeoffClient3WatchStock(db,admin,1,{...input,comment:''},apply))).status,400)
assert.equal((await result(writeoffClient3WatchStock(db,admin,1,{...input,source:'outside'},apply))).status,400)
assert.equal((await result(writeoffClient3WatchStock(db,admin,1,{...input,expectedPhysical:4},apply))).status,409)
assert.equal((await result(writeoffClient3WatchStock(db,admin,1,{...input,quantity:4},apply))).status,409)
assert.equal(fingerprints.size,0)
const first=await result(writeoffClient3WatchStock(db,admin,1,input,apply))
assert.equal(first.status,200)
assert.equal(first.duplicate,false)
assert.equal(sqlite.prepare("SELECT quantity FROM inventory_stock WHERE inventory_source='warehouse'").get().quantity,3)
assert.equal(sqlite.prepare("SELECT quantity FROM inventory_stock WHERE inventory_source='boutique'").get().quantity,1)
const replay=await result(writeoffClient3WatchStock(db,admin,1,input,apply))
assert.equal(replay.duplicate,true)
assert.equal(sqlite.prepare("SELECT quantity FROM inventory_stock WHERE inventory_source='warehouse'").get().quantity,3)
const collision=await result(writeoffClient3WatchStock(db,admin,1,{...input,quantity:1},apply))
assert.equal(collision.status,409,'Reusing a request ID with a changed quantity must conflict')
assert.equal(fingerprints.size,1)
sqlite.prepare("UPDATE inventory_stock SET reserved_quantity=0 WHERE inventory_source='warehouse'").run()
sqlite.prepare("UPDATE inventory_reservations SET quantity=3 WHERE id=1").run()
const liveReservation=await result(writeoffClient3WatchStock(db,admin,1,{
 ...input,requestId:'writeoff-unique-002',quantity:1,expectedPhysical:3,
},apply))
assert.equal(liveReservation.status,409,'Live reservation ledger wins over stale stock counter')
assert.equal(fingerprints.size,1)
assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(),[])
sqlite.close()
console.log('CLIENT3_WATCH_WRITEOFF_GUARDS_PASS: brand, role, source, reason, reserve, stale quantity, idempotent retry (simulated Main writeoff)')
