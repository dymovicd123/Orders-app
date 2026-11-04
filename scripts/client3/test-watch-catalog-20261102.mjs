import assert from 'node:assert/strict'
import fs from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {listWatchCatalogDrafts,registerWatchModel,registerWatchVariant} from '../../worker/domains/client3-watch-catalog.ts'

const sqlite=new DatabaseSync(':memory:')
sqlite.exec('PRAGMA foreign_keys=ON')
sqlite.exec([
'CREATE TABLE managers(id INTEGER PRIMARY KEY);',
'CREATE TABLE app_users(id INTEGER PRIMARY KEY);',
'CREATE TABLE catalog_products(id INTEGER PRIMARY KEY,is_active INTEGER DEFAULT 1);',
'CREATE TABLE catalog_stock_positions(id INTEGER PRIMARY KEY,is_active INTEGER DEFAULT 1);',
'CREATE TABLE catalog_variants(id INTEGER PRIMARY KEY,stock_position_id INTEGER,category TEXT DEFAULT \'adult\',is_active INTEGER DEFAULT 1);',
'CREATE TABLE catalog_execution_prices(stock_position_id INTEGER,category TEXT,sale_price INTEGER,PRIMARY KEY(stock_position_id,category));',
'CREATE TABLE orders(id INTEGER PRIMARY KEY);',
'CREATE TABLE order_items(id INTEGER PRIMARY KEY);',
'CREATE TABLE inventory_stock(id INTEGER PRIMARY KEY,variant_id INTEGER,inventory_source TEXT,quantity INTEGER,reserved_quantity INTEGER DEFAULT 0);',
 'CREATE TABLE inventory_reservations(id INTEGER PRIMARY KEY,variant_id INTEGER,inventory_source TEXT,quantity INTEGER,status TEXT);',
'CREATE TABLE payments(id INTEGER PRIMARY KEY,amount INTEGER);',
'INSERT INTO managers VALUES(1);',
'INSERT INTO app_users VALUES(1);',
'INSERT INTO inventory_stock(id,variant_id,inventory_source,quantity,reserved_quantity) VALUES(1,999,\'warehouse\',3,0);',
'INSERT INTO payments VALUES(1,10000);',
].join('\n'))
sqlite.exec(fs.readFileSync('migrations/client3-watch/0002_client3_watch_foundation.sql','utf8'))
sqlite.exec(fs.readFileSync('migrations/client3-watch/0004_client3_shared_reference_values.sql','utf8'))
sqlite.exec(fs.readFileSync('migrations/client3-watch/0005_client3_editable_sku_references.sql','utf8'))
sqlite.exec(fs.readFileSync('migrations/client3-watch/0006_client3_watch_sku_generations.sql','utf8'))
sqlite.exec(fs.readFileSync('migrations/client3-watch/0999_watch_model_aliases.sql','utf8'))
// The small catalogue fixture also needs the v5 characteristic overlay used
// by the current Client3 resolver. The live installation has these tables.
sqlite.exec(`
 CREATE TABLE IF NOT EXISTS watch_variant_attributes_v5 (
   watch_variant_id INTEGER PRIMARY KEY, movement TEXT, bracelet_material TEXT,
   dial_color TEXT, bracelet_color TEXT);
 CREATE TABLE IF NOT EXISTS watch_reference_values_v5(
   id INTEGER PRIMARY KEY,kind TEXT,value TEXT,is_active INTEGER DEFAULT 1);
`)
sqlite.exec("INSERT INTO watch_reference_values(kind,value) VALUES('leatherColors','ЧЁРНЫЙ'),('leatherColors','КОРИЧНЕВЫЙ')")
const db={
  prepare(query){
    let params=[]
    return {
      bind(...args){params=args;return this},
      async first(){return sqlite.prepare(query).get(...params)||null},
      async all(){return {results:sqlite.prepare(query).all(...params)}},
      async run(){const result=sqlite.prepare(query).run(...params);return {meta:{last_row_id:result.lastInsertRowid,changes:result.changes}}},
    }
  },
}
const admin={role:'admin',id:1,managerId:null}
const manager={role:'manager',id:2,managerId:1}
const read=async promise=>{const response=await promise;return {httpStatus:response.status,...await response.json()}}
const before={
  inventory:sqlite.prepare('SELECT * FROM inventory_stock').all(),
  payments:sqlite.prepare('SELECT * FROM payments').all(),
}
let result=await read(registerWatchModel(db,manager,1,{modelName:'CLASSIC'}))
assert.equal(result.httpStatus,403)
result=await read(registerWatchModel(db,admin,1,{modelName:'CLASSIC'}))
assert.equal(result.httpStatus,201)
const firstId=result.watchProductId
result=await read(registerWatchModel(db,admin,1,{modelName:'classic'}))
assert.equal(result.watchProductId,firstId)
assert.equal(result.alreadyExists,true)
result=await read(registerWatchModel(db,admin,2,{modelName:'CLASSIC'}))
assert.equal(result.httpStatus,201)
assert.notEqual(result.watchProductId,firstId)
const base={watchProductId:firstId,gender:'male',movement:'quartz',braceletMaterial:'leather',dialColor:'black'}
result=await read(registerWatchVariant(db,admin,1,{...base,braceletColor:''}))
assert.equal(result.httpStatus,400,'Leather requires color')
result=await read(registerWatchVariant(db,admin,2,{...base,braceletColor:'ЧЁРНЫЙ'}))
assert.equal(result.httpStatus,404,'Cannot use a model from a foreign brand')
result=await read(registerWatchVariant(db,admin,1,{...base,braceletColor:'ЧЁРНЫЙ'}))
assert.equal(result.httpStatus,201)
const blackId=result.watchVariantId
result=await read(registerWatchVariant(db,admin,1,{...base,braceletColor:'ЧЁРНЫЙ'}))
assert.equal(result.alreadyExists,true)
assert.equal(result.watchVariantId,blackId)
result=await read(registerWatchVariant(db,admin,1,{...base,braceletColor:'КОРИЧНЕВЫЙ'}))
assert.equal(result.httpStatus,201,'Leather color must create separate SKU')
assert.notEqual(result.watchVariantId,blackId)
result=await read(registerWatchVariant(db,admin,1,{...base,braceletMaterial:'steel',braceletColor:'ЧЁРНЫЙ'}))
assert.equal(result.httpStatus,400,'Non-leather color forbidden')
result=await read(registerWatchVariant(db,admin,1,{...base,braceletMaterial:'steel',braceletColor:''}))
assert.equal(result.httpStatus,201)
const rows=await read(listWatchCatalogDrafts(db,admin,1))
assert.equal(rows.rows.length,3)
assert(rows.rows.every(x=>x.catalogVariantId==null))
assert.equal((await read(listWatchCatalogDrafts(db,manager,1))).httpStatus,403)
assert.deepEqual(sqlite.prepare('SELECT * FROM inventory_stock').all(),before.inventory)
assert.deepEqual(sqlite.prepare('SELECT * FROM payments').all(),before.payments)
assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(),[])
sqlite.close()
console.log('CLIENT3_WATCH_CATALOG_DRAFT_PASS: brand scoped, leather SKU, no ghost stock/payments')
