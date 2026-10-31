import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { applyInventoryMovement } from '../worker/domains/inventory-movement.ts'
import { fetchOrderStockHandoverRows, getOrderStockHandoverState } from '../worker/domains/order-reservations.ts'

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
CREATE TABLE inventory_reservations(id INTEGER PRIMARY KEY,inventory_source TEXT,variant_id INTEGER,quantity INTEGER,status TEXT,order_id INTEGER,order_item_id INTEGER,created_at TEXT);
CREATE TABLE orders(id INTEGER PRIMARY KEY,external_id TEXT,order_date TEXT,created_at TEXT,order_status TEXT DEFAULT 'active',archived_at TEXT,shipping_status TEXT DEFAULT 'not_sent',workshop_status TEXT,customer_id INTEGER);
CREATE TABLE order_items(id INTEGER PRIMARY KEY,order_id INTEGER,quantity INTEGER DEFAULT 1,is_workshop INTEGER DEFAULT 0,created_at TEXT,inventory_obligation_key TEXT,inventory_obligation_origin_at TEXT,product_name_snapshot TEXT,gender_snapshot TEXT,color_snapshot TEXT,material_snapshot TEXT,length_snapshot TEXT,size_snapshot TEXT,source_type TEXT,stock_writeoff_status TEXT,product_id INTEGER,variant_id INTEGER);
CREATE TABLE inventory_stocktake_sessions(id TEXT PRIMARY KEY,inventory_source TEXT,status TEXT,started_at TEXT,completed_at TEXT);
CREATE TABLE inventory_handover_reviews(id INTEGER PRIMARY KEY,order_id INTEGER,order_item_id INTEGER,reservation_id INTEGER,decision TEXT,checkpoint_id INTEGER,checkpoint_at TEXT);
CREATE TABLE customers(id INTEGER PRIMARY KEY,display_name TEXT);
CREATE TABLE workshop_tasks(id INTEGER PRIMARY KEY,order_id INTEGER,quantity INTEGER,status TEXT);
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

// Stages 2.5+2.6: execute an actual correction and inspect the same
// order-handover projection used by Orders. No fake checkpoint inserted.
db.exec(`
INSERT INTO orders(id,external_id,order_date,created_at,shipping_status)
 VALUES(901,'QA-STAGE2-HANDOVER','2026-10-14','2026-10-14T08:00:00Z','not_sent');
INSERT INTO order_items(id,order_id,quantity,is_workshop,created_at,inventory_obligation_origin_at,
 product_name_snapshot,gender_snapshot,color_snapshot,material_snapshot,length_snapshot,size_snapshot,
 source_type,stock_writeoff_status,product_id,variant_id)
 VALUES(902,901,2,0,'2026-10-14T08:00:00Z','2026-10-14T08:00:00Z',
 'АБАЙ ТАКИЯ','МУЖ','БЕЖЕВЫЙ','ДРАП КАШЕМИР','СТАНДАРТ','58',
 'warehouse','reserved',1,7);
INSERT INTO inventory_reservations(id,inventory_source,variant_id,quantity,status,order_id,order_item_id,created_at)
 VALUES(903,'warehouse',7,2,'active',901,902,'2026-10-14T08:00:00Z');
UPDATE inventory_stock SET reserved_quantity=2 WHERE inventory_source='warehouse' AND variant_id=7;
`)
// Older corrections from this same W11 fixture have already created later
// checkpoints. Mark the last one reviewed, so this test measures only the
// newly performed physical correction, not an unrelated historical warning.
const priorHandover=(await getOrderStockHandoverState(db,901)).items[0]
assert.equal(priorHandover.reviewNeeded,true,'Fixture should see older stock check')
db.db.prepare(`INSERT INTO inventory_handover_reviews
 (id,order_id,order_item_id,reservation_id,decision,checkpoint_id,checkpoint_at)
 VALUES(1,901,902,903,'still_here',?,?)`).run(priorHandover.checkpointId,priorHandover.checkpointAt)
const beforeHandover=(await getOrderStockHandoverState(db,901)).items[0]
assert.equal(beforeHandover.reviewNeeded,false,'Reviewed prior checkpoint must not prompt twice')
assert.equal(beforeHandover.reservationStatus,'active')
const actualCorrection=await save('w11-handover-correction',[
 {...normal,expectedQuantity:3,quantity:1}
])
assert.equal(actualCorrection.ok,true)
assert.equal(db.get("SELECT quantity,reserved_quantity FROM inventory_stock WHERE inventory_source='warehouse' AND variant_id=7").quantity,1)
assert.equal(db.get("SELECT quantity,reserved_quantity FROM inventory_stock WHERE inventory_source='warehouse' AND variant_id=7").reserved_quantity,2,'Physical correction must never consume live reservation')
assert.equal(db.get("SELECT status FROM inventory_reservations WHERE id=903").status,'active','Physical correction must not silently fulfill reservation')
const correctionMovement=db.get("SELECT quantity_delta,quantity_after FROM inventory_movements WHERE reference_id='w11-handover-correction'")
assert.deepEqual([correctionMovement.quantity_delta,correctionMovement.quantity_after],[-2,1],
 'Correction movement should explain exact physical delta')
const correctionCheck=db.get("SELECT id,expected_quantity,counted_quantity,reserved_quantity FROM inventory_stock_checks WHERE reference_id='w11-handover-correction'")
assert.deepEqual([correctionCheck.expected_quantity,correctionCheck.counted_quantity,correctionCheck.reserved_quantity],[3,1,2],
 'Exact correction check must preserve before/after and live reserve context')
const handover=(await getOrderStockHandoverState(db,901)).items[0]
const listHandover=(await fetchOrderStockHandoverRows(db,[901],{listFlagsOnly:true}))[0]
assert.equal(handover.reviewNeeded,true,'Actual correction must prompt order handover decision')
assert.equal(handover.checkpointId,correctionCheck.id,'Handover must reference exact correction checkpoint')
assert.equal(handover.variantId,7,'Handover must retain exact SKU')
assert.equal(handover.source,'warehouse','Handover must retain source')
assert.equal(handover.physicalQuantity,1)
assert.equal(handover.totalReservedQuantity,2)
assert.equal(Number(listHandover.review_needed),1,'Order-table handover badge must agree with detailed order')
const again=await save('w11-handover-correction',[{...normal,expectedQuantity:3,quantity:1}])
assert.equal(again.duplicate,true)
assert.equal(db.get("SELECT COUNT(*) n FROM inventory_stock_checks WHERE reference_id='w11-handover-correction'").n,1)
assert.equal(db.get("SELECT COUNT(*) n FROM inventory_movements WHERE reference_id='w11-handover-correction'").n,1)
assert.equal(db.get("SELECT quantity FROM inventory_stock WHERE inventory_source='warehouse' AND variant_id=7").quantity,1)

const appSource=(await import('node:fs')).readFileSync('src/App.tsx','utf8')
const inventoryUi=(await import('node:fs')).readFileSync('src/features/inventory/views/InventoryUnifiedQuantityWorkspace.tsx','utf8')
assert.ok(appSource.includes('const alreadyInDraft = current.items.some(item =>'),'Double-click cannot create duplicated correction draft')
assert.ok(appSource.includes('if(alreadyInDraft)return current'),'Second click is harmless')
assert.ok(inventoryUi.includes('Впишите число вещей, переносимых в другую точку.') ||
 inventoryUi.includes('переносимых в другую точку.'),'Transfer progress describes moved units')
assert.ok(inventoryUi.includes('Впишите, сколько вещей перемещаете.'),'Transfer numeric input does not pretend to be a correction')
console.log('W11_REAL_SQL_CORRECTION_HANDOVER_INVARIANTS_PASSED')
