import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {previewRetiredItemCorrection,correctRetiredItem} from '../worker/domains/retired-item-correction.ts'
const source=readFileSync('worker/domains/retired-item-correction.ts','utf8')
const modal=readFileSync('src/features/orders/OrderCatalogResolutionModal.tsx','utf8')
const router=readFileSync('worker/index.ts','utf8')
for(const forbidden of ['DELETE FROM order_items','UPDATE payments','INSERT INTO inventory_movements','INSERT INTO catalog_variants'])
 assert(!source.includes(forbidden),'Unsafe correction side effect: '+forbidden)
assert.match(router,/correct-retired-item/)
assert.match(modal,/В заказе указан неправильный товар/)
assert.match(modal,/Исправить товар и резерв/)
const sql=new DatabaseSync(':memory:')
sql.exec("\nCREATE TABLE orders(id INTEGER PRIMARY KEY,external_id TEXT,order_status TEXT,archived_at TEXT,shipping_status TEXT,total_amount INTEGER,received_amount INTEGER,debt_amount INTEGER,return_amount INTEGER,updated_at TEXT);\nCREATE TABLE catalog_products(id INTEGER PRIMARY KEY,name TEXT,is_active INTEGER,category TEXT);\nCREATE TABLE catalog_stock_positions(id INTEGER PRIMARY KEY,is_active INTEGER);\nCREATE TABLE catalog_variants(id INTEGER PRIMARY KEY,product_id INTEGER,stock_position_id INTEGER,is_active INTEGER,category TEXT,gender TEXT,color TEXT,material TEXT,length TEXT,size_label TEXT);\nCREATE TABLE order_items(id INTEGER PRIMARY KEY,order_id INTEGER,product_id INTEGER,variant_id INTEGER,product_name_snapshot TEXT,audience_type TEXT,gender_snapshot TEXT,color_snapshot TEXT,material_snapshot TEXT,length_snapshot TEXT,size_snapshot TEXT,source_type TEXT,is_workshop INTEGER,quantity INTEGER,unit_price INTEGER,line_total INTEGER,stock_writeoff_status TEXT,stock_quantity_before INTEGER,stock_quantity_after INTEGER);\nCREATE TABLE inventory_reservations(id INTEGER PRIMARY KEY,order_id INTEGER,order_item_id INTEGER UNIQUE,inventory_source TEXT,product_id INTEGER,variant_id INTEGER,quantity INTEGER,status TEXT,reference_type TEXT,reference_id TEXT,created_at TEXT,updated_at TEXT,released_at TEXT,unresolved_reason TEXT);\nCREATE TABLE inventory_stock(id INTEGER PRIMARY KEY,inventory_source TEXT,variant_id INTEGER,quantity INTEGER,reserved_quantity INTEGER,last_action TEXT,last_source_ref TEXT,updated_at TEXT);\nCREATE TABLE exchanges(id INTEGER PRIMARY KEY,order_id INTEGER,status TEXT);\nCREATE TABLE returns(id INTEGER PRIMARY KEY,order_id INTEGER,status TEXT);\nCREATE TABLE retired_order_item_issues(order_item_id INTEGER PRIMARY KEY);\nCREATE TABLE payments(id INTEGER PRIMARY KEY,order_id INTEGER,amount INTEGER);\nCREATE TABLE inventory_movements(id INTEGER PRIMARY KEY,quantity_delta INTEGER);\nINSERT INTO catalog_products VALUES(1,'ЭТНО КАРДИГАН',1,'adult');\nINSERT INTO catalog_stock_positions VALUES(10,0),(11,1),(12,1);\nINSERT INTO catalog_variants VALUES\n(20,1,10,0,'adult','ЖЕН','СВЕТЛО СЕРЫЙ','ДРАП','СТАНДАРТ','52'),\n(21,1,11,1,'adult','ЖЕН','СВЕТЛО СЕРЫЙ','ШЕРСТЬ','СТАНДАРТ','52'),\n(22,1,12,1,'adult','ЖЕН','СВЕТЛО СЕРЫЙ','ШЕРСТЬ','СТАНДАРТ','54');\nINSERT INTO orders VALUES(1,'O1','active','','not_sent',20000,5000,15000,0,NULL),\n(2,'O2','active','','not_sent',27000,0,27000,0,NULL),\n(3,'O3','active','','sent',20000,0,20000,0,NULL);\nINSERT INTO order_items VALUES\n(100,1,1,20,'ЭТНО КАРДИГАН','adult','ЖЕН','СВЕТЛО СЕРЫЙ','ДРАП','СТАНДАРТ','52','warehouse',0,1,20000,20000,'catalog_retired',NULL,NULL),\n(200,2,1,20,'ЭТНО КАРДИГАН','adult','ЖЕН','СВЕТЛО СЕРЫЙ','ДРАП','СТАНДАРТ','52','warehouse',0,1,20000,20000,'catalog_retired',NULL,NULL),\n(201,2,1,20,'ЭТНО КАРДИГАН','adult','ЖЕН','СВЕТЛО СЕРЫЙ','ДРАП','СТАНДАРТ','54','warehouse',0,1,2000,2000,'catalog_retired',NULL,NULL),\n(300,3,1,20,'ЭТНО КАРДИГАН','adult','ЖЕН','СВЕТЛО СЕРЫЙ','ДРАП','СТАНДАРТ','52','warehouse',0,1,20000,20000,'catalog_retired',NULL,NULL);\nINSERT INTO inventory_reservations VALUES\n(1,1,100,'warehouse',1,20,1,'released','order','O1','t','t','t',NULL),\n(2,2,200,'warehouse',1,20,1,'released','order','O2','t','t','t',NULL);\nINSERT INTO inventory_stock VALUES(1,'warehouse',21,3,0,NULL,NULL,NULL),(2,'warehouse',22,1,1,NULL,NULL,NULL);\nINSERT INTO payments VALUES(1,1,5000);\nINSERT INTO inventory_movements VALUES(1,-2);\n")
sql.exec(readFileSync('migrations/0114_retired_item_one_line_corrections.sql','utf8'))
sql.exec(readFileSync('migrations/0114_retired_item_one_line_corrections.sql','utf8'))
const db={
 prepare(q){const stmt=sql.prepare(q);return {bind(...args){return {
  async first(){return stmt.get(...args)||null},
  async all(){return {results:stmt.all(...args)}},
  async run(){const r=stmt.run(...args);return {meta:{changes:r.changes}}}
 }}}},
 async batch(statements){sql.exec('BEGIN IMMEDIATE');try{
  const out=[];for(const s of statements)out.push(await s.run())
  sql.exec('COMMIT');return out
 }catch(e){sql.exec('ROLLBACK');throw e}}
}
const before={stock:sql.prepare('SELECT SUM(quantity) q,SUM(reserved_quantity) r FROM inventory_stock').get(),
 movements:sql.prepare('SELECT COUNT(*) n FROM inventory_movements').get().n,
 payments:sql.prepare('SELECT COUNT(*) n FROM payments').get().n}
const preview=await previewRetiredItemCorrection(db,1,100)
assert.equal(preview.oldPrice,20000)
assert.equal(preview.canEditPrice,true)
assert(preview.variants.some(v=>v.variantId===21&&v.free===3))
assert(preview.variants.some(v=>v.variantId===22&&v.free===0))
const req={orderId:1,itemId:100,oldVariantId:20,newVariantId:21,quantity:1,
 oldPrice:20000,newPrice:22000,oldTotal:20000,actor:'manager-1'}
await assert.rejects(()=>correctRetiredItem(db,{...req,newVariantId:22}),/недостаточно/i)
await assert.rejects(()=>correctRetiredItem(db,{...req,oldPrice:30000}),/изменились/i)
const saved=await correctRetiredItem(db,req)
assert.equal(saved.ok,true)
assert.equal(saved.totalAmount,22000)
assert.equal(saved.debtAmount,17000)
assert.equal((await correctRetiredItem(db,req)).alreadyCorrected,true)
assert.equal(sql.prepare('SELECT COUNT(*) n FROM retired_order_item_corrections').get().n,1)
assert.equal(sql.prepare('SELECT status FROM retired_order_item_corrections WHERE order_item_id=100').get().status,'completed')
assert.equal(sql.prepare('SELECT material_snapshot FROM order_items WHERE id=100').get().material_snapshot,'ШЕРСТЬ')
assert.equal(sql.prepare('SELECT unit_price FROM order_items WHERE id=100').get().unit_price,22000)
assert.equal(sql.prepare('SELECT total_amount FROM orders WHERE id=1').get().total_amount,22000)
assert.equal(sql.prepare('SELECT received_amount FROM orders WHERE id=1').get().received_amount,5000)
assert.equal(sql.prepare('SELECT reserved_quantity FROM inventory_stock WHERE id=1').get().reserved_quantity,1)
assert.equal(sql.prepare('SELECT variant_id FROM inventory_reservations WHERE order_item_id=100').get().variant_id,21)
assert.equal(sql.prepare('SELECT COUNT(*) n FROM inventory_movements').get().n,before.movements)
assert.equal(sql.prepare('SELECT COUNT(*) n FROM payments').get().n,before.payments)
const legacy=await previewRetiredItemCorrection(db,2,200)
assert.equal(legacy.canEditPrice,false)
await assert.rejects(()=>correctRetiredItem(db,{...req,orderId:2,itemId:200,oldTotal:27000,newPrice:23000}),/не совпадает/i)
const old=await correctRetiredItem(db,{...req,orderId:2,itemId:200,oldTotal:27000,newPrice:20000})
assert.equal(old.ok,true)
assert.equal(sql.prepare('SELECT total_amount FROM orders WHERE id=2').get().total_amount,27000)
assert.equal(sql.prepare('SELECT line_total FROM order_items WHERE id=200').get().line_total,20000)
await assert.rejects(()=>previewRetiredItemCorrection(db,3,300),/неотправленной/i)
assert.equal(sql.prepare('SELECT COUNT(*) n FROM inventory_movements').get().n,before.movements)
assert.equal(sql.prepare('SELECT COUNT(*) n FROM payments').get().n,before.payments)
assert.equal(sql.prepare('SELECT quantity FROM inventory_stock WHERE id=1').get().quantity,3)
console.log('RETIRED_MANAGER_ONE_LINE_PRODUCT_PRICE_IDEMPOTENT_NO_MONEY_STOCK_WRITE_PASSED')
sql.close()
