import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { applyInventoryMovement } from '../worker/domains/inventory-movement.ts'

class Statement {
  constructor(owner,sql,args=[]){this.owner=owner;this.sql=sql;this.args=args}
  bind(...args){return new Statement(this.owner,this.sql,args)}
  async all(){return {results:this.owner.db.prepare(this.sql).all(...this.args)}}
  async first(){return this.owner.db.prepare(this.sql).get(...this.args)??null}
  async run(){return this.runSync()}
  runSync(){const r=this.owner.db.prepare(this.sql).run(...this.args);return {success:true,meta:{changes:r.changes,last_row_id:Number(r.lastInsertRowid)}}}
}
class TestD1{
 constructor(){this.db=new DatabaseSync(':memory:');this.db.exec('PRAGMA foreign_keys=ON')}
 prepare(sql){return new Statement(this,sql)}
 async batch(stmts){this.db.exec('BEGIN IMMEDIATE');try{const r=stmts.map(s=>s.runSync());this.db.exec('COMMIT');return r}catch(e){this.db.exec('ROLLBACK');throw e}}
 exec(sql){return this.db.exec(sql)}
 get(sql,...p){return this.db.prepare(sql).get(...p)}
}
const db=new TestD1()
db.exec(`
CREATE TABLE catalog_identity_meta(key TEXT PRIMARY KEY,value TEXT);
INSERT INTO catalog_identity_meta VALUES('catalog_identity_v3','active');
CREATE TABLE catalog_products(id INTEGER PRIMARY KEY,name TEXT,category TEXT,gender_scope TEXT,
 is_active INTEGER DEFAULT 1,external_id TEXT UNIQUE,created_at TEXT,updated_at TEXT);
CREATE TABLE catalog_stock_positions(id INTEGER PRIMARY KEY,product_id INTEGER,
 category TEXT DEFAULT 'adult',gender_scope TEXT DEFAULT 'male',material TEXT DEFAULT '',
 length TEXT DEFAULT '',is_default INTEGER DEFAULT 0,is_active INTEGER DEFAULT 1,
 sort_order INTEGER DEFAULT 0,created_at TEXT,updated_at TEXT);
CREATE TABLE catalog_variants(id INTEGER PRIMARY KEY,external_id TEXT UNIQUE,product_id INTEGER,
 stock_position_id INTEGER,category TEXT,gender TEXT,color TEXT,material TEXT,length TEXT,
 size_label TEXT,is_active INTEGER DEFAULT 1,sort_order INTEGER DEFAULT 0,created_at TEXT,updated_at TEXT);
CREATE TABLE inventory_stock(id INTEGER PRIMARY KEY AUTOINCREMENT,inventory_source TEXT,product_id INTEGER,
 variant_id INTEGER,product_name_snapshot TEXT,gender_snapshot TEXT,color_snapshot TEXT,
 material_snapshot TEXT,length_snapshot TEXT,size_snapshot TEXT,quantity INTEGER DEFAULT 0,
 reserved_quantity INTEGER DEFAULT 0,last_action TEXT,last_source_ref TEXT,created_at TEXT,updated_at TEXT,
 UNIQUE(inventory_source,variant_id));
CREATE TABLE inventory_model_meta(key TEXT PRIMARY KEY,value TEXT,updated_at TEXT);
INSERT INTO inventory_model_meta(key,value)VALUES('human_inventory_v2','enabled');
CREATE TABLE inventory_operations(operation_id TEXT PRIMARY KEY,operation_type TEXT,
 source_type TEXT,status TEXT,comment TEXT,item_count INTEGER,total_quantity INTEGER,created_at TEXT,completed_at TEXT);
CREATE TABLE inventory_operation_request_fingerprints(operation_id TEXT PRIMARY KEY,request_fingerprint TEXT,created_at TEXT);
CREATE TABLE inventory_movements(id INTEGER PRIMARY KEY AUTOINCREMENT,inventory_source TEXT,movement_type TEXT,
 product_id INTEGER,variant_id INTEGER,product_name_snapshot TEXT,gender_snapshot TEXT,
 color_snapshot TEXT,material_snapshot TEXT,length_snapshot TEXT,size_snapshot TEXT,
 quantity_delta INTEGER,quantity_after INTEGER,reference_type TEXT,reference_id TEXT,comment TEXT,created_at TEXT);
CREATE TABLE inventory_stock_checks(id INTEGER PRIMARY KEY AUTOINCREMENT,check_key TEXT UNIQUE,inventory_source TEXT,
 product_id INTEGER,variant_id INTEGER,expected_quantity INTEGER,counted_quantity INTEGER,
 difference_quantity INTEGER,reserved_quantity INTEGER,check_type TEXT,reference_type TEXT,
 reference_id TEXT,checked_by TEXT,checked_at TEXT,created_at TEXT);
CREATE TABLE inventory_reservations(id INTEGER PRIMARY KEY,inventory_source TEXT,variant_id INTEGER,quantity INTEGER,status TEXT);
INSERT INTO catalog_products(id,name,category,gender_scope,is_active,external_id)
VALUES(1,'АБАЙ ТАКИЯ','adult','male',1,'TEST-ABA');
INSERT INTO catalog_stock_positions(id,product_id,category,gender_scope,material,length,is_active)
VALUES(2,1,'adult','male','ДРАП КАШЕМИР','СТАНДАРТ',1);
INSERT INTO catalog_variants(id,external_id,product_id,stock_position_id,category,gender,color,material,length,size_label,is_active)
VALUES(7,'TEST-ABA-58',1,2,'adult','МУЖ','БЕЖЕВЫЙ','ДРАП КАШЕМИР','СТАНДАРТ','58',1);
INSERT INTO inventory_stock(inventory_source,product_id,variant_id,product_name_snapshot,gender_snapshot,color_snapshot,
 material_snapshot,length_snapshot,size_snapshot,quantity,reserved_quantity,created_at,updated_at)
VALUES('warehouse',1,7,'АБАЙ ТАКИЯ','МУЖ','БЕЖЕВЫЙ','ДРАП КАШЕМИР','СТАНДАРТ','58',4,0,'now','now');
`)
const item=(size,quantity,extra={})=>({
 productId:1,productName:'АБАЙ ТАКИЯ',category:'adult',gender:'МУЖ',
 color:'БЕЖЕВЫЙ',material:'ДРАП КАШЕМИР',length:'СТАНДАРТ',size,
 quantity,expectedQuantity:0,createMissingVariant:true,...extra
})
const save=(id,rows)=>applyInventoryMovement(db,{requestId:id,inventorySource:'warehouse',
 movementType:'manual_set',comment:'Контрольная корректировка',items:rows},false,'QA')

const created=await save('w11-create-size-40',[item('40',2)])
assert.equal(created.ok,true)
const variant=db.get("SELECT id FROM catalog_variants WHERE size_label='40' AND is_active=1")
assert.ok(variant?.id,'Created variant should exist')
assert.equal(db.get("SELECT quantity FROM inventory_stock WHERE variant_id=?",variant.id)?.quantity,2)
assert.equal(db.get("SELECT quantity_delta FROM inventory_movements WHERE reference_id='w11-create-size-40'")?.quantity_delta,2)
assert.equal(db.get("SELECT counted_quantity FROM inventory_stock_checks WHERE reference_id='w11-create-size-40'")?.counted_quantity,2)
const replay=await save('w11-create-size-40',[item('40',2)])
assert.equal(replay.duplicate,true)
assert.equal(db.get("SELECT quantity FROM inventory_stock WHERE variant_id=?",variant.id)?.quantity,2)

const zero=await save('w11-create-size-42',[item('42',0)])
assert.equal(zero.ok,true)
const z=db.get("SELECT id FROM catalog_variants WHERE size_label='42' AND is_active=1")
assert.ok(z?.id)
assert.equal(db.get("SELECT quantity FROM inventory_stock WHERE variant_id=?",z.id)?.quantity,0)

const normal={...item('58',3),variantId:7,expectedQuantity:4,createMissingVariant:false}
const set=await save('w11-existing-size',[normal])
assert.equal(set.ok,true)
assert.equal(db.get("SELECT quantity FROM inventory_stock WHERE variant_id=7")?.quantity,3)
await assert.rejects(()=>save('w11-stale-size',[{...normal,expectedQuantity:4,quantity:1}]),/изменил/i)
assert.equal(db.get("SELECT quantity FROM inventory_stock WHERE variant_id=7")?.quantity,3)
await assert.rejects(()=>save('w11-wrong-product',[item('60',3,{productId:999})]),/доступн|активн/i)
assert.equal(db.get("SELECT count(*) n FROM catalog_variants WHERE size_label='60'")?.n,0)
console.log('W11_REAL_SQL_CORRECTION_CREATE_ZERO_IDEMPOTENCY_STALE_PASSED')
