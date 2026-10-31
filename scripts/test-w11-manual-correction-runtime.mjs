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
 CREATE TABLE inventory_operation_evidence(evidence_key TEXT PRIMARY KEY,inventory_source TEXT,
  variant_id INTEGER,operation_type TEXT,operation_reference TEXT,tracked_physical_before INTEGER,
  confirmed_operation_quantity INTEGER,explained_quantity INTEGER,unexplained_quantity INTEGER,
  confirmed_by TEXT,occurred_at TEXT,created_at TEXT);
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

const mixed=await save('w11-multi-row',[
 {...normal,expectedQuantity:3,quantity:5},
 item('44',6),
])
assert.equal(mixed.ok,true)
assert.equal(mixed.applied,2)
const fresh=db.get("SELECT id FROM catalog_variants WHERE size_label='44' AND is_active=1")
assert.ok(fresh?.id)
assert.equal(db.get("SELECT quantity FROM inventory_stock WHERE variant_id=7").quantity,5)
assert.equal(db.get("SELECT quantity FROM inventory_stock WHERE variant_id=?",fresh.id).quantity,6)
assert.equal(db.get("SELECT count(*) AS n FROM inventory_movements WHERE reference_id='w11-multi-row'").n,2)
assert.equal(db.get("SELECT count(*) AS n FROM inventory_stock_checks WHERE reference_id='w11-multi-row'").n,2)
const multiReplay=await save('w11-multi-row',[{...normal,expectedQuantity:3,quantity:5},item('44',6)])
assert.equal(multiReplay.duplicate,true)
assert.equal(db.get("SELECT quantity FROM inventory_stock WHERE variant_id=7").quantity,5)
assert.equal(db.get("SELECT quantity FROM inventory_stock WHERE variant_id=?",fresh.id).quantity,6)

db.db.exec("INSERT INTO catalog_variants(id,external_id,product_id,stock_position_id,category,gender,color,material,length,size_label,is_active) VALUES(88,'RETIRED-46',1,2,'adult','МУЖ','БЕЖЕВЫЙ','ДРАП КАШЕМИР','СТАНДАРТ','46',0)")
await assert.rejects(()=>save('w11-retired-size',[item('46',3)]),/удален|удалена|удалено|каталог/i)
assert.equal(db.get("SELECT count(*) AS n FROM catalog_variants WHERE size_label='46' AND is_active=1").n,0)
await assert.rejects(
  ()=>save('w11-atomic-mixed-failure',[item('52',2),item('60',2,{productId:999})]),
  /доступн|активн/i
)
assert.equal(db.get("SELECT count(*) AS n FROM catalog_variants WHERE size_label='52'").n,0,
  'Failed multi-row operation must not create first variant')
assert.equal(db.get("SELECT count(*) AS n FROM inventory_operations WHERE operation_id='w11-atomic-mixed-failure'").n,0,
  'Rejected operation must not leave a completed movement')
// Stage 2.2: real SQLite atomic writeoff + stale-form + replay + source isolation.
// No new infrastructure or historical snapshot tests.
const doWriteoff=(id,source,rows)=>applyInventoryMovement(db,{
 requestId:id,inventorySource:source,movementType:'writeoff',comment:'',items:rows
},false,'QA')
const removal={...normal,expectedQuantity:5,quantity:2}
const writeoff=await doWriteoff('w11-writeoff-exact','warehouse',[removal])
assert.equal(writeoff.ok,true)
assert.equal(db.get('SELECT quantity FROM inventory_stock WHERE variant_id=7 AND inventory_source=?','warehouse').quantity,3)
assert.equal(db.get("SELECT quantity_delta FROM inventory_movements WHERE reference_id='w11-writeoff-exact'").quantity_delta,-2)
const writeoffReplay=await doWriteoff('w11-writeoff-exact','warehouse',[removal])
assert.equal(writeoffReplay.duplicate,true)
assert.equal(db.get("SELECT COUNT(*) AS n FROM inventory_movements WHERE reference_id='w11-writeoff-exact'").n,1)
assert.equal(db.get('SELECT quantity FROM inventory_stock WHERE variant_id=7 AND inventory_source=?','warehouse').quantity,3)
await assert.rejects(()=>doWriteoff('w11-writeoff-exact','warehouse',[{...removal,quantity:1}]),/уже была сохранена|отличается от исходной/i)
await assert.rejects(()=>doWriteoff('w11-writeoff-stale','warehouse',[{...removal,quantity:1}]),/остаток изменился/i)
assert.equal(db.get('SELECT quantity FROM inventory_stock WHERE variant_id=7 AND inventory_source=?','warehouse').quantity,3)
const boutiqueUntracked=await doWriteoff('w11-writeoff-other-source','boutique',[{...removal,expectedQuantity:0,quantity:1}])
assert.equal(boutiqueUntracked.code,'stock_resolution_required','Other source cannot consume warehouse stock')
assert.equal(db.get("SELECT COUNT(*) AS n FROM inventory_stock WHERE inventory_source='boutique' AND variant_id=7").n,0)
assert.equal(db.get("SELECT COUNT(*) AS n FROM inventory_movements WHERE reference_id='w11-writeoff-other-source'").n,0)

const appSource=(await import('node:fs')).readFileSync('src/App.tsx','utf8')
const inventoryUi=(await import('node:fs')).readFileSync('src/features/inventory/views/InventoryUnifiedQuantityWorkspace.tsx','utf8')
assert.ok(appSource.includes('const alreadyInDraft = current.items.some(item =>'),'Double-click cannot create duplicated correction draft')
assert.ok(appSource.includes('if(alreadyInDraft)return current'),'Second click is harmless')
assert.ok(inventoryUi.includes('Впишите число вещей, переносимых в другую точку.') ||
 inventoryUi.includes('переносимых в другую точку.'),'Transfer progress describes moved units')
assert.ok(inventoryUi.includes('Впишите, сколько вещей перемещаете.'),'Transfer numeric input does not pretend to be a correction')
console.log('W11_REAL_SQL_CORRECTION_WRITE_OFF_STALE_REPLAY_SOURCE_PASSED')
