import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import { persistWatchOrderCommit } from '../../worker/domains/client3-watch-order-commit.ts'

const sql=new DatabaseSync(':memory:')
sql.exec('PRAGMA foreign_keys=ON')
sql.exec([
'CREATE TABLE managers(id INTEGER PRIMARY KEY);',
'CREATE TABLE app_users(id INTEGER PRIMARY KEY);',
'CREATE TABLE catalog_products(id INTEGER PRIMARY KEY);',
'CREATE TABLE catalog_variants(id INTEGER PRIMARY KEY,product_id INTEGER);',
"CREATE TABLE orders(id INTEGER PRIMARY KEY,source_type TEXT DEFAULT 'warehouse');",
"CREATE TABLE order_items(id INTEGER PRIMARY KEY,order_id INTEGER,product_id INTEGER,variant_id INTEGER,quantity INTEGER,is_workshop INTEGER,source_type TEXT DEFAULT 'warehouse');",
'CREATE TABLE inventory_stock(id INTEGER PRIMARY KEY,variant_id INTEGER,quantity INTEGER,reserved_quantity INTEGER);',
'CREATE TABLE payments(id INTEGER PRIMARY KEY,order_id INTEGER,amount INTEGER);',
'INSERT INTO catalog_products VALUES(10);',
'INSERT INTO catalog_variants VALUES(100,10);',
'INSERT INTO orders(id) VALUES(7);',
'INSERT INTO order_items(id,order_id,product_id,variant_id,quantity,is_workshop) VALUES(71,7,10,100,1,0);',
'INSERT INTO inventory_stock VALUES(1,100,3,1);',
'INSERT INTO payments VALUES(1,7,10000);',
].join('\n'))
sql.exec(fs.readFileSync('migrations/client3-watch/0002_client3_watch_foundation.sql','utf8'))
sql.exec([
"INSERT INTO watch_products(brand_id,model_name,catalog_product_id) VALUES(1,'CLASSIC',10);",
"INSERT INTO watch_variants(watch_product_id,catalog_variant_id,gender,movement,bracelet_material,dial_color,bracelet_color) VALUES(1,100,'male','quartz','leather','black','ЧЁРНЫЙ');",
].join('\n'))
const db={
  prepare(query){
    let bindings=[]
    return {
      bind(...values){bindings=values;return this},
      async first(){return sql.prepare(query).get(...bindings)||null},
      async run(){const r=sql.prepare(query).run(...bindings);return {meta:{changes:r.changes,last_row_id:r.lastInsertRowid}}},
    }
  },
  async batch(statements){
    sql.exec('BEGIN IMMEDIATE')
    try{
      const out=[]
      for(const st of statements)out.push(await st.run())
      sql.exec('COMMIT')
      return out
    }catch(error){sql.exec('ROLLBACK');throw error}
  },
}
const snapshot=()=>({
  stock:sql.prepare('SELECT * FROM inventory_stock').all(),
  payment:sql.prepare('SELECT * FROM payments').all(),
  order:sql.prepare('SELECT * FROM orders').all(),
})
const before=snapshot()
const data={
  brand:'TAUWACH',brandId:1,watchVariantId:1,catalogProductId:10,catalogVariantId:100,source:'office',
  recipientName:'Тестовый получатель',recipientPhone:'7777',address:'Тест адрес 10',
  postalCode:'050000',city:'Алматы',deliveryMethod:'Казпочта',
  shippingDeadlineAt:'2026-11-15T12:00:00.000Z',urgent:true,
  paymentMethod:'KASPI GOLD',engravingText:'A + M',
}
await persistWatchOrderCommit(db,7,71,data)
await persistWatchOrderCommit(db,7,71,data)
assert.equal(sql.prepare('SELECT count(*) AS c FROM watch_order_details').get().c,1)
assert.equal(sql.prepare('SELECT count(*) AS c FROM watch_order_item_details').get().c,1)
assert.equal(sql.prepare('SELECT count(*) AS c FROM watch_logistics_jobs').get().c,1)
assert.equal(sql.prepare('SELECT engraving_text FROM watch_order_item_details').get().engraving_text,'A + M')
assert.equal(sql.prepare('SELECT shipping_deadline_at FROM watch_order_details').get().shipping_deadline_at,'2026-11-15T12:00:00.000Z')
assert.equal(sql.prepare('SELECT status FROM watch_logistics_jobs').get().status,'pending')
await assert.rejects(()=>persistWatchOrderCommit(db,7,71,{...data,engravingText:'CHANGED'}))
await assert.rejects(()=>persistWatchOrderCommit(db,7,71,{...data,brandId:2}))
await assert.rejects(()=>persistWatchOrderCommit(db,7,72,data))
assert.deepEqual(snapshot(),before,'Brand attachment cannot alter legacy orders, stock or payments')
assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(),[])
sql.close()
console.log('CLIENT3_WATCH_ORDER_ATTACHMENT_PASS: exact SKU, idempotent detail writes, replay conflict, no stock/payment mutation')
