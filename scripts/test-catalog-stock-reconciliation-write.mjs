import assert from 'node:assert/strict'
import fs from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { previewCatalogVariantConsolidation } from '../worker/domains/catalog-variant-consolidation.ts'
import { applyCatalogStockReconciliation, recentCatalogStockReconciliations } from '../worker/domains/catalog-stock-reconciliation-write.ts'

const sqlite = new DatabaseSync(':memory:')
sqlite.exec(`
 PRAGMA foreign_keys=ON;
 CREATE TABLE catalog_products(id INTEGER PRIMARY KEY,name TEXT,is_active INTEGER,external_id TEXT);
 CREATE TABLE catalog_stock_positions(id INTEGER PRIMARY KEY,product_id INTEGER,material TEXT,length TEXT,is_active INTEGER);
 CREATE TABLE catalog_variants(
   id INTEGER PRIMARY KEY,product_id INTEGER,stock_position_id INTEGER,
   category TEXT,gender TEXT,color TEXT,size_label TEXT,material TEXT,length TEXT,
   is_active INTEGER,updated_at TEXT,external_id TEXT
 );
 CREATE TABLE inventory_stock(
   id INTEGER PRIMARY KEY, variant_id INTEGER, inventory_source TEXT NOT NULL DEFAULT 'warehouse',
   product_id INTEGER,product_name_snapshot TEXT,gender_snapshot TEXT,color_snapshot TEXT,
   material_snapshot TEXT,length_snapshot TEXT,size_snapshot TEXT,
   quantity INTEGER,reserved_quantity INTEGER,
   last_action TEXT,last_source_ref TEXT, created_at TEXT,updated_at TEXT,
   external_product_id TEXT,external_variant_id TEXT
 );
 CREATE UNIQUE INDEX idx_inventory_stock_variant_unique ON inventory_stock(inventory_source,variant_id) WHERE variant_id IS NOT NULL;
 CREATE TABLE inventory_transfer_documents(id INTEGER PRIMARY KEY,status TEXT);
 CREATE TABLE inventory_transfer_items(id INTEGER PRIMARY KEY,transfer_id INTEGER,variant_id INTEGER);
 CREATE TABLE inventory_movements(
 id INTEGER PRIMARY KEY,inventory_source TEXT,movement_type TEXT,product_id INTEGER,variant_id INTEGER,
 product_name_snapshot TEXT NOT NULL,gender_snapshot TEXT,color_snapshot TEXT,material_snapshot TEXT,
 length_snapshot TEXT,size_snapshot TEXT,quantity_delta INTEGER,quantity_after INTEGER,
 reference_type TEXT,reference_id TEXT,comment TEXT,created_at TEXT
 );
 CREATE TABLE inventory_movement_reversals(original_movement_id INTEGER PRIMARY KEY);
 CREATE TABLE inventory_stock_checks(
 id INTEGER PRIMARY KEY,check_key TEXT UNIQUE,inventory_source TEXT,product_id INTEGER,
 variant_id INTEGER,expected_quantity INTEGER,counted_quantity INTEGER,
 difference_quantity INTEGER,reserved_quantity INTEGER,check_type TEXT,
 reference_type TEXT,reference_id TEXT,checked_by TEXT,checked_at TEXT,created_at TEXT
 );
 CREATE TABLE inventory_reservations(
    id INTEGER PRIMARY KEY,order_id INTEGER,order_item_id INTEGER,
    inventory_source TEXT,product_id INTEGER,variant_id INTEGER,quantity INTEGER,
    status TEXT,updated_at TEXT);
 CREATE TABLE return_items(id INTEGER PRIMARY KEY,order_item_id INTEGER);
 CREATE TABLE exchanges(id INTEGER PRIMARY KEY,old_order_item_id INTEGER,new_order_item_id INTEGER);
 CREATE TABLE exchange_items(id INTEGER PRIMARY KEY,order_item_id INTEGER);
 CREATE TABLE orders(id INTEGER PRIMARY KEY,order_status TEXT,shipping_status TEXT,order_date TEXT NOT NULL DEFAULT (date('now','+5 hours')));
 CREATE TABLE order_items(
   id INTEGER PRIMARY KEY,order_id INTEGER,variant_id INTEGER,product_id INTEGER,
   quantity INTEGER,is_workshop INTEGER DEFAULT 0, source_type TEXT DEFAULT 'warehouse',
   stock_writeoff_status TEXT DEFAULT 'reserved',product_name_snapshot TEXT DEFAULT 'Снимок товара',
   unit_price INTEGER DEFAULT 1000);
 CREATE TABLE workshop_tasks(id INTEGER PRIMARY KEY,variant_id INTEGER,status TEXT);
 CREATE TABLE inventory_lifecycle_events(id INTEGER PRIMARY KEY,variant_id INTEGER,status TEXT);
 CREATE TABLE inventory_stocktake_sessions(id TEXT PRIMARY KEY,status TEXT,inventory_source TEXT NOT NULL DEFAULT 'warehouse');
 CREATE TABLE inventory_stocktake_items(id INTEGER PRIMARY KEY,session_id TEXT,variant_id INTEGER);
 INSERT INTO catalog_products(id,name,is_active) VALUES(100,'ЭТНО КАРДИГАН',1);
 INSERT INTO catalog_stock_positions VALUES(30,100,'ДРАП','СТАНДАРТ',1),(31,100,'ШЕРСТЬ','СТАНДАРТ',1);
 INSERT INTO catalog_variants(id,product_id,stock_position_id,category,gender,color,size_label,material,length,is_active,updated_at) VALUES
  (7,100,30,'adult','ЖЕН','СВЕТЛО-СЕРЫЙ','52','ДРАП','СТАНДАРТ',1,'before'),
  (8,100,30,'adult','ЖЕН','СВЕТЛО СЕРЫЙ','52','ДРАП','СТАНДАРТ',1,'before'),
  (9,100,31,'adult','ЖЕН','СВЕТЛО СЕРЫЙ','52','ШЕРСТЬ','СТАНДАРТ',1,'before'),
  (10,100,30,'adult','ЖЕН','СВЕТЛО СЕРЫЙ','54','ДРАП','СТАНДАРТ',1,'before');
 INSERT INTO inventory_stock(id,variant_id,quantity,reserved_quantity) VALUES (10,7,0,0),(11,8,2,0);
 INSERT INTO orders(id,order_status,shipping_status) VALUES(1,'active','sent');
 INSERT INTO order_items(id,order_id,variant_id,quantity) VALUES(21,1,7,1);
`)
sqlite.exec(fs.readFileSync('migrations/0090_v72_catalog_variant_consolidations.sql','utf8'))
sqlite.exec(fs.readFileSync('migrations/0091_v72_catalog_variant_stock_consolidation.sql','utf8'))
sqlite.exec(fs.readFileSync('migrations/0092_v72_catalog_variant_reservation_consolidation.sql','utf8'))
sqlite.exec(fs.readFileSync('migrations/0095_v72_catalog_stock_reconciliation_journal.sql','utf8'))

let beforeUpdate = () => {}
let beforeValidation = () => {}
const db = {
  prepare(sql) {
    return {
      async all() { return { results: sqlite.prepare(sql).all() } },
      bind(...values) {
        return {
          async first() { return sqlite.prepare(sql).get(...values) || null },
          async all() { return { results: sqlite.prepare(sql).all(...values) } },
          async run() {
            if (sql.startsWith('INSERT INTO catalog_stock_reconciliation_journal')) beforeUpdate()
            if (sql.startsWith('INSERT INTO catalog_stock_reconciliation_validations')) beforeValidation()
            return { meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } }
          },
        }
      },
    }
  },
  async batch(statements) {
    sqlite.exec('BEGIN IMMEDIATE')
    try {
      const result = []
      for (const statement of statements) result.push(await statement.run())
      sqlite.exec('COMMIT')
      return result
    } catch (e) {
      sqlite.exec('ROLLBACK')
      throw e
    }
  },
}
const query = (sql) => sqlite.prepare(sql).get()

const q=(sql)=>sqlite.prepare(sql).get()
const qty=(id,where='warehouse')=>sqlite.prepare('SELECT quantity FROM inventory_stock WHERE variant_id=? AND inventory_source=?').get(id,where)?.quantity??0
const count=(table)=>q('SELECT COUNT(*) AS n FROM '+table).n
const journal=()=>sqlite.prepare('SELECT * FROM catalog_stock_reconciliation_journal ORDER BY created_at,request_id').all()
const baseReason='Подтверждена ошибка двойного учёта после проверки'
const request=(method,requestId,opts={})=>({
 sourceId:7,keeperId:8,location:'warehouse',method,reason:baseReason,
 requestId,physicallyVerified:true,expectedToken:opts.expectedToken??'',
 ...(method==='physical_count'?{countedQuantity:opts.countedQuantity??6}:{}),
})
sqlite.exec('UPDATE inventory_stock SET quantity=8 WHERE id=10')
sqlite.exec('UPDATE inventory_stock SET quantity=5 WHERE id=11')
const opening=await previewCatalogVariantConsolidation(db,7,8)
assert.equal(opening.blockers.length,0,'Exact SKU identities with only shipped history are safe to inspect')
assert.equal(opening.canConsolidate,false,'Physical stock must not be silently summed')
const first=request('keep_keeper','reconcile-keeper-20261010',{expectedToken:opening.stateToken})
await assert.rejects(()=>applyCatalogStockReconciliation(db,{...first,physicallyVerified:false},'admin'),/фактическая проверка/)
await assert.rejects(()=>applyCatalogStockReconciliation(db,{...first,reason:'short'},'admin'),/причину/)
await assert.rejects(()=>applyCatalogStockReconciliation(db,{...first,method:'defer'},'admin'),/совместимых варианта/)
await assert.rejects(()=>applyCatalogStockReconciliation(db,{...first,expectedToken:'stale'},'admin'),/изменились после предпросмотра/)
assert.equal(count('catalog_stock_reconciliation_journal'),0,'Preflight cannot change inventory')
const result=await applyCatalogStockReconciliation(db,first,'admin')
assert.equal(result.applied,true)
assert.equal(result.finalQuantity,5)
assert.equal(result.adjustmentQuantity,-8)
assert.equal(qty(7),0)
assert.equal(qty(8),5)
assert.equal(count('catalog_stock_reconciliation_journal'),1)
assert.equal(count('catalog_stock_reconciliation_validations'),1)
assert.equal(count('inventory_movements'),2)
assert.equal(count('inventory_stock_checks'),2)
assert.equal(q('SELECT COUNT(*) AS n FROM inventory_movements WHERE reference_type="catalog_stock_reconciliation"').n,2)
assert.equal(q('SELECT COUNT(*) AS n FROM inventory_stock_checks WHERE check_type="catalog_merge_correction"').n,2)
assert.equal(q('SELECT COUNT(*) AS n FROM order_items WHERE variant_id=7').n,1,
 'Shipped order must preserve its historical source SKU')
assert.equal(q('SELECT is_active FROM catalog_variants WHERE id=7').is_active,1,
 'Correction is not a hidden automatic SKU retirement')
assert.equal(journal()[0].decision_method,'keep_keeper')
assert.equal(journal()[0].reason,baseReason)
assert.equal((await recentCatalogStockReconciliations(db)).items.length,1)
const replay=await applyCatalogStockReconciliation(db,first,'admin')
assert.equal(replay.alreadyApplied,true)
assert.equal(count('inventory_movements'),2,'Idempotent replay must not create duplicate movements')
await assert.rejects(
 ()=>applyCatalogStockReconciliation(db,{...first,reason:'Совершенно другое подтверждённое основание'},'admin'),
 /идентификатор действия уже использован/,
)
// Test both other corrective choices with their own immutable journals.
sqlite.exec('UPDATE inventory_stock SET quantity=8 WHERE id=10')
sqlite.exec('UPDATE inventory_stock SET quantity=5 WHERE id=11')
let token=(await previewCatalogVariantConsolidation(db,7,8)).stateToken
const keepSource=await applyCatalogStockReconciliation(db,
 request('keep_source','reconcile-source-20261010',{expectedToken:token}),'admin')
assert.equal(keepSource.finalQuantity,8)
assert.equal(keepSource.adjustmentQuantity,-5)
assert.equal(qty(7),0)
assert.equal(qty(8),8)
sqlite.exec('UPDATE inventory_stock SET quantity=8 WHERE id=10')
sqlite.exec('UPDATE inventory_stock SET quantity=5 WHERE id=11')
token=(await previewCatalogVariantConsolidation(db,7,8)).stateToken
const counted=await applyCatalogStockReconciliation(db,
 request('physical_count','reconcile-count-20261010',{expectedToken:token,countedQuantity:6}),'admin')
assert.equal(counted.finalQuantity,6)
assert.equal(counted.adjustmentQuantity,-7)
assert.equal(qty(8),6)
assert.equal(count('catalog_stock_reconciliation_journal'),3)
assert.equal(q('SELECT COUNT(*) AS n FROM catalog_stock_reconciliation_validations WHERE passed=1').n,3)
const later=await previewCatalogVariantConsolidation(db,7,8)
assert.equal(later.stockReconciliation.locations[0].lastSourceCount,null,
 'Accounting corrections are not independent physical stocktake evidence')
// Per-location independence: warehouse stays untouched when correcting boutique.
sqlite.exec("INSERT INTO inventory_stock(id,variant_id,inventory_source,quantity,reserved_quantity) VALUES (12,7,'boutique',4,0),(13,8,'boutique',2,0)")
token=(await previewCatalogVariantConsolidation(db,7,8)).stateToken
const boutique=await applyCatalogStockReconciliation(db,
 {...request('physical_count','reconcile-boutique-20261010',{expectedToken:token,countedQuantity:3}),location:'boutique'},'admin')
assert.equal(boutique.finalQuantity,3)
assert.equal(qty(7,'boutique'),0)
assert.equal(qty(8,'boutique'),3)
assert.equal(qty(8,'warehouse'),6)
assert.equal(count('catalog_stock_reconciliation_journal'),4)
// Outstanding order or reservation on either SKU must block all corrections.
sqlite.exec("INSERT INTO orders(id,order_status,shipping_status) VALUES(2,'active','not_sent')")
sqlite.exec("INSERT INTO order_items(id,order_id,variant_id,product_id,quantity) VALUES(22,2,8,100,1)")
token=(await previewCatalogVariantConsolidation(db,7,8)).stateToken
await assert.rejects(
 ()=>applyCatalogStockReconciliation(db,request('physical_count','reconcile-live-order-20261010',{expectedToken:token,countedQuantity:1}),'admin'),
 /Сначала урегулируйте связи/,
)
sqlite.exec("DELETE FROM order_items WHERE id=22")
sqlite.exec("DELETE FROM orders WHERE id=2")
// Active stocktake session with no line registered still blocks an adjustment.
sqlite.exec("INSERT INTO inventory_stocktake_sessions VALUES('rev','active')")
sqlite.exec("UPDATE inventory_stock SET quantity=2 WHERE id=10")
token=(await previewCatalogVariantConsolidation(db,7,8)).stateToken
await assert.rejects(
 ()=>applyCatalogStockReconciliation(db,request('keep_keeper','reconcile-active-rev-20261010',{expectedToken:token}),'admin'),
 /отменена целиком|изменились|Корректировка пока невозможна/,
)
sqlite.exec("DELETE FROM inventory_stocktake_sessions WHERE id='rev'")
// Explicit concurrent quantity change between preview and D1 batch is caught
// at the database write boundary (no journal, no correction movements).
token=(await previewCatalogVariantConsolidation(db,7,8)).stateToken
const before=count('catalog_stock_reconciliation_journal')
beforeUpdate=()=>{beforeUpdate=()=>{};sqlite.exec('UPDATE inventory_stock SET quantity=99 WHERE id=11')}
await assert.rejects(
 ()=>applyCatalogStockReconciliation(db,request('keep_keeper','reconcile-race-qty-20261010',{expectedToken:token}),'admin'),
 /не применена|отменена целиком/,
)
assert.equal(count('catalog_stock_reconciliation_journal'),before)
assert.equal(qty(7),2,'Raced operation must not modify the source stock')
sqlite.exec('UPDATE inventory_stock SET quantity=6 WHERE id=11')
// Postcondition failure forces the entire journal/stock/movement batch to roll back.
token=(await previewCatalogVariantConsolidation(db,7,8)).stateToken
const snapshot={
 src:qty(7),dst:qty(8),
 records:count('catalog_stock_reconciliation_journal'),
 moves:count('inventory_movements'),checks:count('inventory_stock_checks'),
}
beforeValidation=()=>{beforeValidation=()=>{};sqlite.exec('UPDATE inventory_stock SET quantity=999 WHERE id=11')}
await assert.rejects(
 ()=>applyCatalogStockReconciliation(db,request('keep_keeper','reconcile-rollback-20261010',{expectedToken:token}),'admin'),
 /отменена целиком/,
)
assert.equal(qty(7),snapshot.src)
assert.equal(qty(8),snapshot.dst)
assert.equal(count('catalog_stock_reconciliation_journal'),snapshot.records)
assert.equal(count('inventory_movements'),snapshot.moves)
assert.equal(count('inventory_stock_checks'),snapshot.checks)
assert.equal(q('SELECT COUNT(*) AS n FROM catalog_stock_reconciliation_validations WHERE passed=1').n,4)
const api=fs.readFileSync('worker/index.ts','utf8')
assert.ok(api.includes("requireAdminUser(authUser, 'Корректировка остатков при объединении"))
assert.ok(api.includes('/api/catalog/variants/reconcile-stock/history'))
assert.ok(api.includes('/api/catalog/variants/reconcile-stock'))
console.log('CATALOG STOCK RECONCILIATION WRITE PASSED — 3 audited choices, separate locations, replay, reserved-order protection, stale token, race guard, atomic rollback, history unchanged')
