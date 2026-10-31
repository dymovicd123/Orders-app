import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { reconcileFoundInventoryStock } from '../worker/domains/inventory-stocktake.ts'

class Statement {
 constructor(owner,sql,values=[]) { this.owner=owner;this.sql=sql;this.values=values }
 bind(...values){return new Statement(this.owner,this.sql,values)}
 async first(){return this.owner.sqlite.prepare(this.sql).get(...this.values)??null}
 async all(){return {results:this.owner.sqlite.prepare(this.sql).all(...this.values)}}
 async run(){
  if(this.owner.beforeNextRun){const f=this.owner.beforeNextRun;this.owner.beforeNextRun=null;f(this.owner)}
  return this.runSync()
 }
 runSync(){
  const r=this.owner.sqlite.prepare(this.sql).run(...this.values)
  return {success:true,meta:{changes:Number(r.changes),last_row_id:Number(r.lastInsertRowid)}}
 }
}
class DB {
 constructor(){
  this.sqlite=new DatabaseSync(':memory:')
  this.beforeNextRun=null
  this.beforeNextBatch=null
  this.sqlite.exec([
  'CREATE TABLE catalog_products(id INTEGER PRIMARY KEY,name TEXT,category TEXT,is_active INTEGER)',
  'CREATE TABLE catalog_variants(id INTEGER PRIMARY KEY,product_id INTEGER,category TEXT,gender TEXT,color TEXT,material TEXT,length TEXT,size_label TEXT,is_active INTEGER)',
  'CREATE TABLE inventory_stock(id INTEGER PRIMARY KEY,inventory_source TEXT,product_id INTEGER,variant_id INTEGER,product_name_snapshot TEXT,gender_snapshot TEXT,color_snapshot TEXT,material_snapshot TEXT,length_snapshot TEXT,size_snapshot TEXT,quantity INTEGER,reserved_quantity INTEGER DEFAULT 0,last_source_ref TEXT,last_action TEXT,updated_at TEXT)',
  'CREATE TABLE inventory_stocktake_items(id INTEGER PRIMARY KEY,stock_id INTEGER,category_snapshot TEXT)',
  'CREATE TABLE inventory_movements(id INTEGER PRIMARY KEY,inventory_source TEXT,movement_type TEXT,product_id INTEGER,variant_id INTEGER,product_name_snapshot TEXT,gender_snapshot TEXT,color_snapshot TEXT,material_snapshot TEXT,length_snapshot TEXT,size_snapshot TEXT,quantity_delta INTEGER,quantity_after INTEGER,reference_type TEXT,reference_id TEXT,comment TEXT,created_at TEXT)',
  "INSERT INTO catalog_products VALUES(1,'АБАЙКА','adult',1)",
  "INSERT INTO catalog_variants VALUES(10,1,'adult','ЖЕН','ЗЕЛЕНЫЙ','ДАК','СТАНДАРТ','СТАНДАРТ',1)",
  "INSERT INTO inventory_stock(id,inventory_source,product_id,variant_id,product_name_snapshot,gender_snapshot,color_snapshot,material_snapshot,length_snapshot,size_snapshot,quantity,reserved_quantity,last_source_ref) VALUES(1,'warehouse',1,NULL,'АБАЙКА','ЖЕН','ЗЕЛЕНЫЙ','ДАК','СТАНДАРТ','СТАНДАРТ',2,0,'stocktake-unresolved:ABC')"
  ].join(';')+';')
 }
 prepare(sql){return new Statement(this,sql)}
 run(sql,...params){return this.sqlite.prepare(sql).run(...params)}
 row(sql,...params){return this.sqlite.prepare(sql).get(...params)}
 rows(sql,...params){return this.sqlite.prepare(sql).all(...params)}
 async batch(statements){
  if(this.beforeNextBatch){const f=this.beforeNextBatch;this.beforeNextBatch=null;f(this)}
  this.sqlite.exec('BEGIN IMMEDIATE')
  try{const r=statements.map(s=>s.runSync());this.sqlite.exec('COMMIT');return r}
  catch(e){this.sqlite.exec('ROLLBACK');throw e}
 }
}
const addTarget=(db,id=2,qty=5)=>db.run(
  "INSERT INTO inventory_stock(id,inventory_source,product_id,variant_id,product_name_snapshot,gender_snapshot,color_snapshot,material_snapshot,length_snapshot,size_snapshot,quantity,reserved_quantity,last_source_ref) VALUES(?,'warehouse',1,10,'АБАЙКА','ЖЕН','ЗЕЛЕНЫЙ','ДАК','СТАНДАРТ','СТАНДАРТ',?,0,'test')",id,qty)
{
 const db=new DB()
 const result=await reconcileFoundInventoryStock(db,1)
 assert.equal(result.ok,true)
 assert.equal(result.merged,false)
 assert.equal(db.row('SELECT variant_id FROM inventory_stock WHERE id=1').variant_id,10)
 assert.equal(db.row('SELECT SUM(quantity) qty FROM inventory_stock').qty,2)
 assert.equal((await reconcileFoundInventoryStock(db,1)).already,true)
}
{
 const db=new DB();addTarget(db)
 const result=await reconcileFoundInventoryStock(db,1)
 assert.equal(result.ok,true)
 assert.equal(result.merged,true)
 assert.equal(db.row('SELECT quantity FROM inventory_stock WHERE id=2').quantity,7)
 assert.equal(db.row('SELECT quantity FROM inventory_stock WHERE id=1').quantity,0)
 assert.equal(db.row('SELECT SUM(quantity) qty FROM inventory_stock').qty,7)
 assert.deepEqual(db.rows("SELECT quantity_delta FROM inventory_movements WHERE reference_type='identity_resolution' ORDER BY id").map(r=>r.quantity_delta),[2,-2])
 assert.equal((await reconcileFoundInventoryStock(db,1)).already,true)
 assert.equal(db.row('SELECT COUNT(*) n FROM inventory_movements').n,2)
}
{
 const db=new DB()
 db.run("INSERT INTO catalog_variants VALUES(11,1,'adult','ЖЕН','ЗЕЛЕНЫЙ','ДАК','СТАНДАРТ','СТАНДАРТ',1)")
 const r=await reconcileFoundInventoryStock(db,1)
 assert.equal(r.code,'identity_ambiguous')
 assert.equal(db.row('SELECT variant_id FROM inventory_stock WHERE id=1').variant_id,null)
}
{
 const db=new DB();addTarget(db,2);addTarget(db,3,4)
 const r=await reconcileFoundInventoryStock(db,1)
 assert.equal(r.code,'stock_identity_duplicate')
 assert.equal(db.row('SELECT SUM(quantity) qty FROM inventory_stock').qty,11)
}
{
 const db=new DB()
 db.run('UPDATE inventory_stock SET reserved_quantity=1 WHERE id=1')
 const r=await reconcileFoundInventoryStock(db,1)
 assert.equal(r.code,'identity_has_reservations')
 assert.equal(db.row('SELECT variant_id FROM inventory_stock WHERE id=1').variant_id,null)
}
{
 const db=new DB()
 db.beforeNextRun=d=>d.run('UPDATE inventory_stock SET quantity=1 WHERE id=1')
 const r=await reconcileFoundInventoryStock(db,1)
 assert.equal(r.code,'identity_changed')
 assert.equal(db.row('SELECT variant_id FROM inventory_stock WHERE id=1').variant_id,null)
}
{
 const db=new DB();addTarget(db)
 db.beforeNextBatch=d=>d.run("UPDATE inventory_stock SET last_source_ref='another-review' WHERE id=1")
 const r=await reconcileFoundInventoryStock(db,1)
 assert.equal(r.code,'identity_changed')
 assert.equal(db.row('SELECT quantity FROM inventory_stock WHERE id=2').quantity,5)
 assert.equal(db.row('SELECT COUNT(*) n FROM inventory_movements').n,0)
}
console.log('WAREHOUSE_BARCODE_FOUND_STOCK_SKU_GUARD_PASSED — seven SQLite cases; no phantom stock or ambiguous SKU identity')
