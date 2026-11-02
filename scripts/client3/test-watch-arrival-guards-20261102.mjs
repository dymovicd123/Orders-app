import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import fs from 'node:fs'
import {receiveClient3WatchArrival} from '../../worker/domains/client3-watch-inventory.ts'

const source=fs.readFileSync('worker/domains/client3-watch-inventory.ts','utf8')
assert(source.includes('applyInventoryMovement'), 'Physical arrival must reuse existing audited Main inventory engine')
assert(source.includes("movementType:'arrival'"), 'Physical receipt must explicitly be an arrival')
assert(source.includes('returnInventory=false')===false)
assert(!source.includes('UPDATE inventory_stock'), 'Watch route may not perform ad hoc stock increments')
assert(!source.includes('INSERT INTO inventory_stock'), 'Watch route may not invent physical stock itself')

const sql=new DatabaseSync(':memory:')
sql.exec('PRAGMA foreign_keys=ON')
sql.exec([
  'CREATE TABLE managers(id INTEGER PRIMARY KEY);',
  'CREATE TABLE app_users(id INTEGER PRIMARY KEY);',
  'CREATE TABLE catalog_products(id INTEGER PRIMARY KEY,name TEXT,is_active INTEGER);',
  'CREATE TABLE catalog_variants(id INTEGER PRIMARY KEY,product_id INTEGER,stock_position_id INTEGER,category TEXT,gender TEXT,color TEXT,material TEXT,length TEXT,size_label TEXT,is_active INTEGER);',
  'CREATE TABLE catalog_stock_positions(id INTEGER PRIMARY KEY,product_id INTEGER,is_active INTEGER);',
  'CREATE TABLE orders(id INTEGER PRIMARY KEY);',
  'CREATE TABLE order_items(id INTEGER PRIMARY KEY);',
  'CREATE TABLE inventory_stock(id INTEGER PRIMARY KEY,quantity INTEGER);',
  "CREATE TABLE inventory_model_meta(key TEXT PRIMARY KEY,value TEXT);",
  "INSERT INTO inventory_model_meta VALUES('human_inventory_v2','active');",
  'INSERT INTO managers VALUES(1);',
  'INSERT INTO app_users VALUES(1);',
  'INSERT INTO inventory_stock VALUES(1,4);',
].join('\n'))
sql.exec(fs.readFileSync('migrations/client3-watch/0002_client3_watch_foundation.sql','utf8'))
sql.exec("INSERT INTO watch_products(brand_id,model_name) VALUES(1,'CLASSIC')")
sql.exec("INSERT INTO watch_variants(watch_product_id,gender,movement,bracelet_material,dial_color,bracelet_color) VALUES(1,'male','quartz','leather','black','ЧЁРНЫЙ')")
const db={prepare(query){
  let args=[]
  return{
    bind(...a){args=a;return this},
    async first(){return sql.prepare(query).get(...args)||null},
  }
}}
const admin={id:1,role:'admin',managerId:null}
const manager={id:2,role:'manager',managerId:1}
const input={watchVariantId:1,quantity:1,source:'office',requestId:'arrival-test-1'}
const answer=async result=>{const r=await result;return{status:r.status,...await r.json()}}
assert.equal((await answer(receiveClient3WatchArrival(db,manager,1,input))).status,403)
assert.equal((await answer(receiveClient3WatchArrival(db,admin,1,{...input,quantity:-1}))).status,400)
assert.equal((await answer(receiveClient3WatchArrival(db,admin,1,{...input,source:'external'}))).status,400)
assert.equal((await answer(receiveClient3WatchArrival(db,admin,1,{...input,requestId:''}))).status,400)
assert.equal((await answer(receiveClient3WatchArrival(db,admin,2,input))).status,409)
assert.equal((await answer(receiveClient3WatchArrival(db,admin,1,input))).status,409,'Unmapped watch must not be received')
assert.equal(sql.prepare('SELECT quantity FROM inventory_stock WHERE id=1').get().quantity,4)
sql.close()
console.log('CLIENT3_WATCH_ARRIVAL_GUARDS_PASS: manager denied, no external source, no unlinked SKU, no invented physical stock')
