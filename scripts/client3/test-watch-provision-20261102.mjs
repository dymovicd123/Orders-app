import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import { provisionClient3WatchSku } from '../../worker/domains/client3-watch-provision.ts'

const sql=new DatabaseSync(':memory:')
sql.exec('PRAGMA foreign_keys=ON')
sql.exec([
  'CREATE TABLE managers(id INTEGER PRIMARY KEY);',
  'CREATE TABLE app_users(id INTEGER PRIMARY KEY);',
  "CREATE TABLE catalog_products(id INTEGER PRIMARY KEY,name TEXT NOT NULL UNIQUE,category TEXT NOT NULL,gender_scope TEXT NOT NULL,is_active INTEGER NOT NULL,created_at TEXT,updated_at TEXT);",
  "CREATE TABLE catalog_stock_positions(id INTEGER PRIMARY KEY,product_id INTEGER,category TEXT,gender_scope TEXT,material TEXT,length TEXT,is_default INTEGER,is_active INTEGER,sort_order INTEGER,created_at TEXT,updated_at TEXT);",
  "CREATE UNIQUE INDEX unique_execution ON catalog_stock_positions(product_id,material,length) WHERE is_active=1;",
  "CREATE TABLE catalog_variants(id INTEGER PRIMARY KEY,external_id TEXT,product_id INTEGER,stock_position_id INTEGER,category TEXT,gender TEXT,color TEXT,material TEXT,length TEXT,size_label TEXT,is_active INTEGER,sort_order INTEGER,created_at TEXT,updated_at TEXT);",
  "CREATE UNIQUE INDEX unique_variant ON catalog_variants(stock_position_id,category,gender,color,size_label) WHERE is_active=1;",
  'CREATE TABLE orders(id INTEGER PRIMARY KEY);',
  'CREATE TABLE order_items(id INTEGER PRIMARY KEY);',
  'CREATE TABLE inventory_stock(id INTEGER PRIMARY KEY,variant_id INTEGER,quantity INTEGER,reserved_quantity INTEGER);',
  'CREATE TABLE payments(id INTEGER PRIMARY KEY,amount INTEGER);',
  'INSERT INTO managers(id) VALUES(1);',
  'INSERT INTO app_users(id) VALUES(1);',
  'INSERT INTO inventory_stock(id,variant_id,quantity,reserved_quantity) VALUES(1,999,3,1);',
  'INSERT INTO payments(id,amount) VALUES(1,50000);',
].join('\n'))
sql.exec(fs.readFileSync('migrations/client3-watch/0002_client3_watch_foundation.sql','utf8'))
sql.exec(fs.readFileSync('migrations/client3-watch/0006_client3_watch_sku_generations.sql','utf8'))
// Provisioning now reads the optional editable SKU attribute extension too.
sql.exec(`CREATE TABLE watch_variant_attributes_v5 (
  watch_variant_id INTEGER PRIMARY KEY REFERENCES watch_variants(id),
  movement TEXT,bracelet_material TEXT,dial_color TEXT,bracelet_color TEXT
)`)
sql.exec([
  "INSERT INTO watch_products(brand_id,model_name) VALUES(1,'CLASSIC'),(2,'CLASSIC');",
  "INSERT INTO watch_variants(watch_product_id,gender,movement,bracelet_material,dial_color,bracelet_color) VALUES(1,'male','quartz','leather','black','ЧЁРНЫЙ');",
  "INSERT INTO watch_variants(watch_product_id,gender,movement,bracelet_material,dial_color,bracelet_color) VALUES(1,'male','quartz','leather','black','КОРИЧНЕВЫЙ');",
  "INSERT INTO watch_variants(watch_product_id,gender,movement,bracelet_material,dial_color,bracelet_color) VALUES(2,'male','quartz','leather','black','ЧЁРНЫЙ');",
].join('\n'))
const db={
  prepare(query){
    let args=[]
    return {
      bind(...values){args=values;return this},
      async first(){return sql.prepare(query).get(...args)||null},
      async all(){return {results:sql.prepare(query).all(...args)}},
      async run(){const r=sql.prepare(query).run(...args);return {meta:{changes:r.changes,last_row_id:r.lastInsertRowid}}},
    }
  },
}
const admin={id:1,role:'admin',managerId:null,employeeRole:'Администратор'}
const manager={id:2,role:'manager',managerId:1,employeeRole:'Менеджер'}
const parse=async p=>{const r=await p;return {httpStatus:r.status,...await r.json()}}
const before=()=>({
  inventory:sql.prepare('SELECT * FROM inventory_stock').all(),
  payment:sql.prepare('SELECT * FROM payments').all(),
  orders:sql.prepare('SELECT * FROM orders').all(),
})
const baseline=before()
let r=await parse(provisionClient3WatchSku(db,manager,1,1))
assert.equal(r.httpStatus,403)
r=await parse(provisionClient3WatchSku(db,admin,2,1))
assert.equal(r.httpStatus,404,'Cross-brand watch variant must be rejected')
r=await parse(provisionClient3WatchSku(db,admin,1,1))
assert.equal(r.httpStatus,200)
assert.equal(r.stockCreated,false)
assert.equal(r.physicalQuantityUnchanged,true)
const product1=r.canonicalProductId, variant1=r.canonicalVariantId
r=await parse(provisionClient3WatchSku(db,admin,1,1))
assert.equal(r.canonicalProductId,product1)
assert.equal(r.canonicalVariantId,variant1,'Idempotent retry must reuse exact canonical variant')
r=await parse(provisionClient3WatchSku(db,admin,1,2))
assert.equal(r.canonicalProductId,product1)
assert.notEqual(r.canonicalVariantId,variant1,'Leather color creates a distinct canonical SKU')
r=await parse(provisionClient3WatchSku(db,admin,2,3))
assert.notEqual(r.canonicalProductId,product1,'Equal visible model names of different brands must not merge')
assert.notEqual(r.canonicalVariantId,variant1,'Brand variation must remain a distinct warehouse variant')
assert.equal(sql.prepare('SELECT COUNT(*) AS c FROM catalog_products').get().c,2)
assert.equal(sql.prepare('SELECT COUNT(*) AS c FROM catalog_variants').get().c,3)
assert.deepEqual(before(),baseline,'Provisioning cannot create/modify stock, payments or orders')
assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(),[])
sql.close()
console.log('CLIENT3_CANONICAL_WATCH_SKU_PASS: strict brand mapping, leather color identity, idempotence, zero ghost stock')
