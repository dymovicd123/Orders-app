// Disposable SQLite: KPI must count sold quantities before shipment while
// subtracting genuine returned items, not exchange-generated refund links.
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { listProductKpis } from '../worker/domains/product-kpi.ts'

const sql=new DatabaseSync(':memory:')
sql.exec(`
CREATE TABLE product_kpis(id INTEGER PRIMARY KEY,month TEXT,title TEXT,product_id INTEGER,filters_json TEXT,target_quantity INTEGER,updated_at TEXT);
CREATE TABLE product_kpi_participants(kpi_id INTEGER,manager_id INTEGER,quota INTEGER,bonus_amount INTEGER);
CREATE TABLE catalog_products(id INTEGER PRIMARY KEY,name TEXT);
CREATE TABLE managers(id INTEGER PRIMARY KEY,name TEXT);
CREATE TABLE orders(id INTEGER PRIMARY KEY,manager_id INTEGER,order_date TEXT,shipping_date TEXT,shipping_status TEXT,order_status TEXT);
CREATE TABLE order_items(id INTEGER PRIMARY KEY,order_id INTEGER,quantity INTEGER,product_id INTEGER,audience_type TEXT,gender_snapshot TEXT,color_snapshot TEXT,material_snapshot TEXT,length_snapshot TEXT,size_snapshot TEXT);
CREATE TABLE returns(id INTEGER PRIMARY KEY,status TEXT);
CREATE TABLE return_items(order_item_id INTEGER,return_id INTEGER,quantity INTEGER);
CREATE TABLE exchanges(refund_return_id INTEGER,status TEXT);
INSERT INTO catalog_products VALUES(10,'ШАРФ');
INSERT INTO managers VALUES(1,'Менеджер');
INSERT INTO product_kpis VALUES(1,'2026-11','ШАРФ',10,'{}',4,'2026-11-08T00:00:00Z');
INSERT INTO product_kpi_participants VALUES(1,1,4,8000);
INSERT INTO orders VALUES
(1,1,'2026-11-01',NULL,'not_sent','active'),
(2,1,'2026-11-02','2026-11-10','sent','active'),
(3,1,'2026-10-31','2026-11-03','sent','active'),
(4,1,'2026-11-02',NULL,'not_sent','deleted'),
(5,1,'2026-11-02','2026-11-11','sent','active');
INSERT INTO order_items(id,order_id,quantity,product_id) VALUES
(11,1,3,10),(12,2,2,10),(13,3,7,10),(14,4,7,10),(15,5,1,10);
INSERT INTO returns VALUES(101,'completed'),(102,'cancelled'),(103,'completed');
INSERT INTO return_items VALUES(11,101,1),(12,102,1),(15,103,1);
INSERT INTO exchanges VALUES(103,'completed');
`)
const db={
  prepare(source){
    return {bind(...args){
      return {
        async all(){return {results:sql.prepare(source).all(...args)}}
      }
    }}
  }
}
const user={role:'admin',managerId:1}
const check=async(expectedSold)=>{
  const report=await listProductKpis(db,'2026-11',user)
  assert.equal(report.countingRule,'ordered_net_current_v2')
  assert.equal(report.records.length,1)
  const participant=report.records[0].participants[0]
  assert.equal(participant.sold,expectedSold,'KPI counts net sold units in the order month')
  assert.equal(participant.achieved,expectedSold>=4)
  return participant.sold
}
assert.equal(await check(5),5)
// Shipment alone cannot change a sale month or add a duplicate KPI sale.
sql.exec("UPDATE orders SET shipping_status='sent',shipping_date='2026-12-10' WHERE id=1")
assert.equal(await check(5),5)
// Genuine return reduces the KPI; cancellation restores it.
sql.exec("UPDATE returns SET status='completed' WHERE id=102")
assert.equal(await check(4),4)
sql.exec("UPDATE returns SET status='cancelled' WHERE id=101")
assert.equal(await check(5),5)
console.log('BRANCH2_KPI_UNSHIPPED_NET_SQLITE_PASSED')
