import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { confirmRetiredOrderItemDelivered } from '../worker/domains/retired-item-handover.ts';
const source=readFileSync('worker/domains/retired-item-handover.ts','utf8');
const worker=readFileSync('worker/index.ts','utf8');
const reservation=readFileSync('worker/domains/order-reservations.ts','utf8');
const modal=readFileSync('src/features/orders/OrderCatalogResolutionModal.tsx','utf8');
for(const [name,code,pattern] of [
 ['worker',worker,/confirm-retired-delivery/],
 ['worker',worker,/confirmRetiredOrderItemDelivered/],
 ['reservation',reservation,/'retired_physically_issued'/],
 ['modal',modal,/В заказе указан неправильный товар/],
 ['modal',modal,/Клиенту передают именно этот удалённый товар/],
 ['modal',modal,/onEditOrder\(order\)/]])assert.match(code,pattern,name);
for(const forbidden of ['UPDATE inventory_stock','INSERT INTO inventory_movements','UPDATE catalog_variants','INSERT INTO payments','UPDATE orders'])
 assert(!source.includes(forbidden),'Forbidden stock/finance write: '+forbidden);
const sqlite=new DatabaseSync(':memory:');
sqlite.exec("\nCREATE TABLE orders(id INTEGER PRIMARY KEY,external_id TEXT,shipping_status TEXT,order_status TEXT,archived_at TEXT);\nCREATE TABLE catalog_stock_positions(id INTEGER PRIMARY KEY,is_active INTEGER);\nCREATE TABLE catalog_variants(id INTEGER PRIMARY KEY,stock_position_id INTEGER,is_active INTEGER);\nCREATE TABLE order_items(id INTEGER PRIMARY KEY,order_id INTEGER,variant_id INTEGER,is_workshop INTEGER,\n quantity INTEGER,stock_writeoff_status TEXT,product_name_snapshot TEXT,stock_quantity_before INTEGER,stock_quantity_after INTEGER);\nCREATE TABLE inventory_reservations(id INTEGER PRIMARY KEY,order_item_id INTEGER,status TEXT);\nCREATE TABLE returns(id INTEGER PRIMARY KEY,status TEXT);\nCREATE TABLE return_items(id INTEGER PRIMARY KEY,return_id INTEGER,order_item_id INTEGER);\nCREATE TABLE inventory_stock(id INTEGER PRIMARY KEY,variant_id INTEGER,quantity INTEGER,reserved_quantity INTEGER);\nCREATE TABLE inventory_movements(id INTEGER PRIMARY KEY,variant_id INTEGER,quantity_delta INTEGER);\nCREATE TABLE payments(id INTEGER PRIMARY KEY,order_id INTEGER,amount INTEGER);\nINSERT INTO orders VALUES(1,'ORD-TEST','not_sent','active',''),(2,'ORD-CLOSED','sent','active',''),(3,'ORD-ARCHIVED','not_sent','archived','');\nINSERT INTO catalog_stock_positions VALUES(20,0),(21,1);\nINSERT INTO catalog_variants VALUES(30,20,0),(31,21,1);\nINSERT INTO order_items VALUES\n (100,1,30,0,1,'catalog_retired','ЭТНО КАРДИГАН',NULL,NULL),\n (101,1,30,0,1,'catalog_retired','ЭТНО КАРДИГАН',NULL,NULL),\n (102,1,31,0,1,'reserved','ДРУГОЙ',NULL,NULL),\n (103,2,30,0,1,'catalog_retired','ЭТНО',NULL,NULL),\n (104,3,30,0,1,'catalog_retired','ЭТНО',NULL,NULL),\n (105,1,30,0,1,'catalog_retired','ЭТНО',NULL,NULL),\n (106,1,30,0,1,'catalog_retired','ЭТНО',NULL,NULL);\nINSERT INTO inventory_reservations VALUES(1,100,'released'),(2,101,'released'),(3,105,'active');\nINSERT INTO returns VALUES(1,'completed');\nINSERT INTO return_items VALUES(1,1,106);\nINSERT INTO inventory_stock VALUES(1,30,0,0),(2,31,12,3);\nINSERT INTO inventory_movements VALUES(1,30,-2);\nINSERT INTO payments VALUES(1,1,5000);\n");
const migration=readFileSync('migrations/0113_retired_order_item_actual_handover.sql','utf8');
sqlite.exec(migration);sqlite.exec(migration);
const d1={
 prepare(sql){
  const statement=sqlite.prepare(sql);
  return {bind(...args){return {
   async first(){return statement.get(...args)||null},
   async run(){const result=statement.run(...args);return {...result,meta:{changes:result.changes}}}
  }}};
 },
 async batch(statements){
  sqlite.exec('BEGIN IMMEDIATE');
  try{
   const results=[];
   for(const statement of statements)results.push(await statement.run());
   sqlite.exec('COMMIT');return results;
  }catch(error){sqlite.exec('ROLLBACK');throw error}
 }
};
const good={orderId:1,orderItemId:100,expectedVariantId:30,expectedQuantity:1,confirmedPhysicallyDelivered:true,actor:'manager-test'};
const before={
 stock:{...sqlite.prepare('SELECT SUM(quantity) q,SUM(reserved_quantity) r FROM inventory_stock').get()},
 movements:sqlite.prepare('SELECT COUNT(*) n FROM inventory_movements').get().n,
 payments:sqlite.prepare('SELECT COUNT(*) n FROM payments').get().n,
 activeVariants:sqlite.prepare('SELECT COUNT(*) n FROM catalog_variants WHERE is_active=1').get().n,
};
await assert.rejects(()=>confirmRetiredOrderItemDelivered(d1,{...good,confirmedPhysicallyDelivered:false}),/подтвердите/i);
await assert.rejects(()=>confirmRetiredOrderItemDelivered(d1,{...good,expectedQuantity:2}),/изменилась/i);
await assert.rejects(()=>confirmRetiredOrderItemDelivered(d1,{...good,orderId:2,orderItemId:103}),/Уже отправленный/i);
await assert.rejects(()=>confirmRetiredOrderItemDelivered(d1,{...good,orderId:3,orderItemId:104}),/архивный/i);
await assert.rejects(()=>confirmRetiredOrderItemDelivered(d1,{...good,orderItemId:105}),/Подтверждение не записано/i);
await assert.rejects(()=>confirmRetiredOrderItemDelivered(d1,{...good,orderItemId:106}),/Подтверждение не записано/i);
const result=await confirmRetiredOrderItemDelivered(d1,good);
assert.equal(result.ok,true);assert.equal(result.alreadyConfirmed,false);
const retry=await confirmRetiredOrderItemDelivered(d1,good);
assert.equal(retry.alreadyConfirmed,true);
assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM retired_order_item_issues').get().n,1);
assert.equal(sqlite.prepare('SELECT confirmed_by FROM retired_order_item_issues WHERE order_item_id=100').get().confirmed_by,'manager-test');
assert.equal(sqlite.prepare('SELECT stock_writeoff_status FROM order_items WHERE id=100').get().stock_writeoff_status,'retired_physically_issued');
assert.equal(sqlite.prepare('SELECT stock_writeoff_status FROM order_items WHERE id=101').get().stock_writeoff_status,'catalog_retired');
const after={
 stock:{...sqlite.prepare('SELECT SUM(quantity) q,SUM(reserved_quantity) r FROM inventory_stock').get()},
 movements:sqlite.prepare('SELECT COUNT(*) n FROM inventory_movements').get().n,
 payments:sqlite.prepare('SELECT COUNT(*) n FROM payments').get().n,
 activeVariants:sqlite.prepare('SELECT COUNT(*) n FROM catalog_variants WHERE is_active=1').get().n,
};
assert.deepEqual(after,before);
console.log('RETIRED_SKU_ONE_ROW_IDEMPOTENT_NO_DOUBLE_STOCK_NO_CATALOG_REVIVAL_PASSED');
sqlite.close();
