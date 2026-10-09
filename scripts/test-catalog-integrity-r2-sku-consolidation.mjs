import assert from 'node:assert/strict'
import fs from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { consolidateUnusedCatalogVariant, listRecentCatalogVariantConsolidations, previewCatalogVariantConsolidation } from '../worker/domains/catalog-variant-consolidation.ts'

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
 CREATE TABLE inventory_movements(id INTEGER PRIMARY KEY,variant_id INTEGER,reference_type TEXT);
 CREATE TABLE inventory_movement_reversals(original_movement_id INTEGER PRIMARY KEY);
 CREATE TABLE inventory_reservations(
    id INTEGER PRIMARY KEY,order_id INTEGER,order_item_id INTEGER,
    inventory_source TEXT,product_id INTEGER,variant_id INTEGER,quantity INTEGER,
    status TEXT,updated_at TEXT);
 CREATE TABLE return_items(id INTEGER PRIMARY KEY,order_item_id INTEGER);
 CREATE TABLE exchanges(id INTEGER PRIMARY KEY,old_order_item_id INTEGER,new_order_item_id INTEGER);
 CREATE TABLE exchange_items(id INTEGER PRIMARY KEY,order_item_id INTEGER);
 CREATE TABLE orders(id INTEGER PRIMARY KEY,order_status TEXT,shipping_status TEXT);
 CREATE TABLE order_items(
   id INTEGER PRIMARY KEY,order_id INTEGER,variant_id INTEGER,product_id INTEGER,
   quantity INTEGER,is_workshop INTEGER DEFAULT 0, source_type TEXT DEFAULT 'warehouse',
   stock_writeoff_status TEXT DEFAULT 'reserved',product_name_snapshot TEXT DEFAULT 'Снимок товара',
   unit_price INTEGER DEFAULT 1000);
 CREATE TABLE workshop_tasks(id INTEGER PRIMARY KEY,variant_id INTEGER,status TEXT);
 CREATE TABLE inventory_lifecycle_events(id INTEGER PRIMARY KEY,variant_id INTEGER,status TEXT);
 CREATE TABLE inventory_stocktake_sessions(id TEXT PRIMARY KEY,status TEXT);
 CREATE TABLE inventory_stocktake_items(id INTEGER PRIMARY KEY,session_id TEXT,variant_id INTEGER);
 INSERT INTO catalog_products(id,name,is_active) VALUES(100,'ЭТНО КАРДИГАН',1);
 INSERT INTO catalog_stock_positions VALUES(30,100,'ДРАП','СТАНДАРТ',1),(31,100,'ШЕРСТЬ','СТАНДАРТ',1);
 INSERT INTO catalog_variants(id,product_id,stock_position_id,category,gender,color,size_label,material,length,is_active,updated_at) VALUES
  (7,100,30,'adult','ЖЕН','СВЕТЛО-СЕРЫЙ','52','ДРАП','СТАНДАРТ',1,'before'),
  (8,100,30,'adult','ЖЕН','СВЕТЛО СЕРЫЙ','52','ДРАП','СТАНДАРТ',1,'before'),
  (9,100,31,'adult','ЖЕН','СВЕТЛО СЕРЫЙ','52','ШЕРСТЬ','СТАНДАРТ',1,'before'),
  (10,100,30,'adult','ЖЕН','СВЕТЛО СЕРЫЙ','54','ДРАП','СТАНДАРТ',1,'before');
 INSERT INTO inventory_stock(id,variant_id,quantity,reserved_quantity) VALUES (10,7,0,0),(11,8,2,0);
 INSERT INTO orders VALUES(1,'active','sent');
 INSERT INTO order_items(id,order_id,variant_id,quantity) VALUES(21,1,7,1);
`)
sqlite.exec(fs.readFileSync('migrations/0090_v72_catalog_variant_consolidations.sql','utf8'))
sqlite.exec(fs.readFileSync('migrations/0091_v72_catalog_variant_stock_consolidation.sql','utf8'))
sqlite.exec(fs.readFileSync('migrations/0092_v72_catalog_variant_reservation_consolidation.sql','utf8'))

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
            if (sql.startsWith('INSERT INTO catalog_variant_consolidations')) beforeUpdate()
            if (sql.startsWith('INSERT INTO catalog_variant_consolidation_validations')) beforeValidation()
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
const activity = () => Number(query('SELECT COUNT(*) AS n FROM catalog_variant_consolidations').n)
const active = (id) => Number(sqlite.prepare('SELECT is_active FROM catalog_variants WHERE id=?').get(id).is_active)

await assert.rejects(() => previewCatalogVariantConsolidation(db,7,9), /отличаются/)
await assert.rejects(() => previewCatalogVariantConsolidation(db,7,10), /отличаются/)
let impact = await previewCatalogVariantConsolidation(db,7,8)
assert.equal(impact.canConsolidate,true, 'Zero-stock SKU with old shipped order is safe to retire')
assert.equal(impact.sourceImpact.historicalOrders,1)
assert.equal(impact.targetImpact.physical,2)

// Physical stock moves have separate R3 tests; this suite covers legacy zero-stock retirement.
sqlite.exec('UPDATE inventory_stock SET reserved_quantity=1 WHERE id=10')
assert.equal((await previewCatalogVariantConsolidation(db,7,8)).canConsolidate,false, 'Stock reserve blocks')
sqlite.exec('UPDATE inventory_stock SET reserved_quantity=0 WHERE id=10')
sqlite.exec("INSERT INTO inventory_reservations(id,variant_id,quantity,status,inventory_source,updated_at) VALUES(1,7,1,'active','warehouse','t')")
assert.equal((await previewCatalogVariantConsolidation(db,7,8)).canConsolidate,false, 'Active reservation blocks')
sqlite.exec("DELETE FROM inventory_reservations")
sqlite.exec("UPDATE orders SET shipping_status='not_sent' WHERE id=1")
assert.equal((await previewCatalogVariantConsolidation(db,7,8)).canConsolidate,false, 'Unsent active order blocks')
sqlite.exec("UPDATE orders SET shipping_status='sent' WHERE id=1")
sqlite.exec("INSERT INTO workshop_tasks VALUES(1,7,'active')")
assert.equal((await previewCatalogVariantConsolidation(db,7,8)).canConsolidate,false, 'Workshop blocks')
sqlite.exec('DELETE FROM workshop_tasks')
sqlite.exec("INSERT INTO inventory_lifecycle_events VALUES(1,7,'pending')")
assert.equal((await previewCatalogVariantConsolidation(db,7,8)).canConsolidate,false, 'Pending return/arrival blocks')
sqlite.exec('DELETE FROM inventory_lifecycle_events')
// Batch exchange item-only references must block cancellation-sensitive SKU identity.
sqlite.exec("INSERT INTO exchange_items VALUES(99,21)")
const batchExchangeImpact=await previewCatalogVariantConsolidation(db,7,8)
assert.equal(batchExchangeImpact.canConsolidate,false,'Batch exchange item must block a reversible SKU retirement')
assert.equal(batchExchangeImpact.sourceImpact.returnExchangeLinks,1)
sqlite.exec("DELETE FROM exchange_items WHERE id=99")
sqlite.exec("INSERT INTO inventory_stocktake_sessions VALUES('rev','active')")
sqlite.exec("INSERT INTO inventory_stocktake_items VALUES(1,'rev',8)")
assert.equal((await previewCatalogVariantConsolidation(db,7,8)).canConsolidate,false, 'Keeper active stocktake blocks')
sqlite.exec('DELETE FROM inventory_stocktake_items')
sqlite.exec('DELETE FROM inventory_stocktake_sessions')

beforeUpdate=()=>{ beforeUpdate=()=>{}; sqlite.exec('UPDATE inventory_stock SET quantity=4 WHERE id=10') }
const stockRacePreview=await previewCatalogVariantConsolidation(db,7,8)
await assert.rejects(() => consolidateUnusedCatalogVariant(db,7,8,'admin-test',stockRacePreview.stateToken),/изменились во время проверки/)
assert.equal(active(7),1, 'Stock race must not deactivate')
assert.equal(activity(),0,'Stock race must not log successful merge')
sqlite.exec('UPDATE inventory_stock SET quantity=0 WHERE id=10')
beforeUpdate=()=>{ beforeUpdate=()=>{}; sqlite.exec("UPDATE catalog_variants SET color='КРАСНЫЙ',updated_at='changed' WHERE id=8") }
const keeperRacePreview=await previewCatalogVariantConsolidation(db,7,8)
await assert.rejects(() => consolidateUnusedCatalogVariant(db,7,8,'admin-test',keeperRacePreview.stateToken),/изменились во время проверки/)
assert.equal(active(7),1,'Keeper rename race must not deactivate')
assert.equal(activity(),0)
sqlite.exec("UPDATE catalog_variants SET color='СВЕТЛО СЕРЫЙ',updated_at='before' WHERE id=8")
assert.equal((await previewCatalogVariantConsolidation(db,7,8)).canConsolidate,true)

const beforeStock=sqlite.prepare('SELECT * FROM inventory_stock ORDER BY id').all()
const beforeOrder=sqlite.prepare('SELECT * FROM order_items ORDER BY id').all()
await assert.rejects(
  () => consolidateUnusedCatalogVariant(db,7,8,'admin-test'),
  /требует подтверждённого предпросмотра/,
)
assert.equal(active(7),1,'No-token zero-stock merge must fail without any mutation')
const zeroStockPreview=await previewCatalogVariantConsolidation(db,7,8)
const result=await consolidateUnusedCatalogVariant(db,7,8,'admin-test',zeroStockPreview.stateToken)
assert.equal(result.consolidated,true)
assert.equal(result.historicalOrdersPreserved,1)
assert.equal(active(7),0)
assert.equal(active(8),1)
assert.equal(active(9),1)
assert.equal(
  JSON.stringify(sqlite.prepare('SELECT id,variant_id,quantity,reserved_quantity FROM inventory_stock ORDER BY id').all()),
  JSON.stringify(beforeStock.map(({id,variant_id,quantity,reserved_quantity})=>({id,variant_id,quantity,reserved_quantity})))
)
assert.deepEqual(sqlite.prepare('SELECT * FROM order_items ORDER BY id').all(),beforeOrder)
assert.equal(activity(),1)
const history=await listRecentCatalogVariantConsolidations(db)
assert.equal(history.items.length,1)
assert.equal(history.items[0].sourceId,7)
assert.equal(history.items[0].targetId,8)
assert.equal(history.items[0].createdBy,'admin-test')
assert.equal(query('SELECT target_variant_id FROM catalog_variant_consolidations').target_variant_id,8)
const replay=await consolidateUnusedCatalogVariant(db,7,8,'admin-test')
assert.equal(replay.alreadyConsolidated,true)
assert.equal(activity(),1,'Idempotent replay must not duplicate journal entries')
await assert.rejects(() => consolidateUnusedCatalogVariant(db,7,9),/уже объединена/)


// R3 — current physical balance is carried over *per location*, not written off.
sqlite.exec(`
 INSERT INTO catalog_variants(id,product_id,stock_position_id,category,gender,color,size_label,material,length,is_active,updated_at)
 VALUES (12,100,30,'adult','ЖЕН','ТЕМНО-СИНИЙ','52','ДРАП','СТАНДАРТ',1,'before'),
        (13,100,30,'adult','ЖЕН','ТЕМНО СИНИЙ','52','ДРАП','СТАНДАРТ',1,'before');
 INSERT INTO inventory_stock(id,inventory_source,variant_id,quantity,reserved_quantity)
 VALUES(120,'warehouse',12,3,2),(121,'warehouse',13,5,1),(122,'boutique',12,4,1);
 INSERT INTO orders VALUES (2,'active','not_sent'),(3,'active','not_sent'),(4,'active','not_sent');
 INSERT INTO order_items(id,order_id,variant_id,product_id,quantity,source_type,product_name_snapshot,unit_price)
 VALUES(22,2,13,100,1,'warehouse','Тёмно синий',1000),
       (23,3,12,100,2,'warehouse','Снимок СТАРОГО цвета',2500),
       (24,4,12,100,1,'boutique','Снимок БУТИКА',3000);
 INSERT INTO inventory_reservations(id,order_id,order_item_id,inventory_source,product_id,variant_id,quantity,status,updated_at)
 VALUES(2,2,22,'warehouse',100,13,1,'active','before'),
       (3,3,23,'warehouse',100,12,2,'active','before'),
       (4,4,24,'boutique',100,12,1,'active','before');
`)
let p=await previewCatalogVariantConsolidation(db,12,13)
assert.equal(p.canConsolidate,true,'Valid stocked SKU can be merged')
assert.equal(p.transferQuantity,7)
assert.equal(p.reservationCount,2)
assert.equal(p.sourceImpact.reserved,3)
assert.deepEqual(p.stockBreakdown.map(x=>x.combinedPhysical),[8,4])
await assert.rejects(()=>consolidateUnusedCatalogVariant(db,12,13,'admin'),/требует подтверждённого предпросмотра/)

// Applied transfers must remain reversible, so cannot retire their live variant.
sqlite.exec("INSERT INTO inventory_transfer_documents VALUES (1,'applied')")
sqlite.exec("INSERT INTO inventory_transfer_items VALUES (1,1,12)")
assert.equal((await previewCatalogVariantConsolidation(db,12,13)).canConsolidate,false,'Applied transfer blocks')
sqlite.exec("UPDATE inventory_transfer_documents SET status='reversed' WHERE id=1")
sqlite.exec("INSERT INTO inventory_lifecycle_events VALUES (2,12,'applied')")
assert.equal((await previewCatalogVariantConsolidation(db,12,13)).canConsolidate,false,
  'An applied return or exchange can still be reversed into an inactive variant')
sqlite.exec('DELETE FROM inventory_lifecycle_events WHERE id=2')
sqlite.exec("INSERT INTO inventory_movements VALUES(1,12,'manual')")
assert.equal((await previewCatalogVariantConsolidation(db,12,13)).canConsolidate,false,
  'An old manual operation can still be reversed into a retired SKU')
sqlite.exec('INSERT INTO inventory_movement_reversals VALUES(1)')
p=await previewCatalogVariantConsolidation(db,12,13)
assert.equal(p.canConsolidate,true)

// Stale browser preview never quietly moves a newly observed quantity.
sqlite.exec('UPDATE inventory_stock SET quantity=6 WHERE id=120')
await assert.rejects(()=>consolidateUnusedCatalogVariant(db,12,13,'admin',p.stateToken),/изменились/)
sqlite.exec('UPDATE inventory_stock SET quantity=3 WHERE id=120')
p=await previewCatalogVariantConsolidation(db,12,13)
// Concurrency: an order is edited while the browser displays a preflight.
sqlite.exec('UPDATE inventory_reservations SET quantity=5,updated_at=\'race\' WHERE id=3')
await assert.rejects(()=>consolidateUnusedCatalogVariant(db,12,13,'admin',p.stateToken),/изменились/)
sqlite.exec("UPDATE inventory_reservations SET quantity=2,updated_at='before' WHERE id=3")
p=await previewCatalogVariantConsolidation(db,12,13)

// Atomic SQL guard catches a concurrent target change after application preview.
beforeUpdate=()=>{ beforeUpdate=()=>{}; sqlite.exec('UPDATE inventory_stock SET quantity=6 WHERE id=121') }
await assert.rejects(()=>consolidateUnusedCatalogVariant(db,12,13,'admin',p.stateToken),/изменились во время проверки/)
assert.equal(active(12),1)
assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM catalog_variant_consolidations WHERE source_variant_id=12').get().n,0)
sqlite.exec('UPDATE inventory_stock SET quantity=5 WHERE id=121')
p=await previewCatalogVariantConsolidation(db,12,13)

// Failed post-transfer conservation assertion must roll back all stock changes.
beforeValidation=()=>{ beforeValidation=()=>{}; sqlite.exec('UPDATE inventory_stock SET quantity=999 WHERE id=121') }
await assert.rejects(()=>consolidateUnusedCatalogVariant(db,12,13,'admin',p.stateToken),/CHECK constraint/)
assert.equal(active(12),1,'Failed postcondition rolls back source deactivation')
assert.equal(sqlite.prepare('SELECT quantity FROM inventory_stock WHERE id=120').get().quantity,3)
assert.equal(sqlite.prepare('SELECT quantity FROM inventory_stock WHERE id=121').get().quantity,5)
assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM catalog_variant_consolidations WHERE source_variant_id=12').get().n,0)

p=await previewCatalogVariantConsolidation(db,12,13)
const stocked=await consolidateUnusedCatalogVariant(db,12,13,'admin',p.stateToken)
assert.equal(stocked.transferredQuantity,7)
assert.equal(active(12),0)
assert.equal(active(13),1)
assert.equal(sqlite.prepare('SELECT quantity FROM inventory_stock WHERE id=120').get().quantity,0)
assert.equal(sqlite.prepare('SELECT quantity FROM inventory_stock WHERE id=122').get().quantity,0)
assert.equal(sqlite.prepare('SELECT quantity FROM inventory_stock WHERE id=121').get().quantity,8)
assert.equal(sqlite.prepare('SELECT reserved_quantity FROM inventory_stock WHERE id=121').get().reserved_quantity,3)
assert.equal(sqlite.prepare("SELECT quantity FROM inventory_stock WHERE variant_id=13 AND inventory_source='boutique'").get().quantity,4)
assert.equal(sqlite.prepare("SELECT reserved_quantity FROM inventory_stock WHERE variant_id=13 AND inventory_source='boutique'").get().reserved_quantity,1)
assert.equal(stocked.transferredReservations,2)
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM inventory_reservations WHERE variant_id=12 AND status='active'").get().n,0)
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM inventory_reservations WHERE variant_id=13 AND status='active'").get().n,3)
assert.equal(sqlite.prepare('SELECT variant_id FROM order_items WHERE id=23').get().variant_id,13)
assert.equal(sqlite.prepare('SELECT variant_id FROM order_items WHERE id=24').get().variant_id,13)
assert.equal(sqlite.prepare('SELECT unit_price FROM order_items WHERE id=23').get().unit_price,2500)
assert.equal(sqlite.prepare('SELECT product_name_snapshot FROM order_items WHERE id=23').get().product_name_snapshot,'Снимок СТАРОГО цвета')
assert.equal(sqlite.prepare('SELECT product_name_snapshot FROM order_items WHERE id=24').get().product_name_snapshot,'Снимок БУТИКА')
const receipt=sqlite.prepare('SELECT id,source_physical_quantity FROM catalog_variant_consolidations WHERE source_variant_id=12').get()
assert.equal(receipt.source_physical_quantity,7)
assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM catalog_variant_consolidation_stock_rows WHERE consolidation_id=?').get(receipt.id).n,2)
assert.equal(sqlite.prepare('SELECT passed FROM catalog_variant_consolidation_validations WHERE consolidation_id=?').get(receipt.id).passed,1)
assert.equal(sqlite.prepare('SELECT passed FROM catalog_variant_consolidation_reservation_validations WHERE consolidation_id=?').get(receipt.id).passed,1)
assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM catalog_variant_consolidation_reservation_rows WHERE consolidation_id=?').get(receipt.id).n,2)
assert.equal((await consolidateUnusedCatalogVariant(db,12,13,'admin',p.stateToken)).alreadyConsolidated,true)
assert.equal(sqlite.prepare('SELECT variant_id FROM inventory_movements WHERE id=1').get().variant_id,12,
  'Historical manual movement keeps its original variant')

assert.equal(sqlite.prepare('SELECT variant_id FROM order_items WHERE id=21').get().variant_id,7,'Old order history unchanged')

const api=fs.readFileSync('worker/index.ts','utf8')
const ui=fs.readFileSync('src/features/sections/ReferenceIntegrityPanel.tsx','utf8')
const moduleText=fs.readFileSync('worker/domains/catalog-variant-consolidation.ts','utf8')
assert.match(api,/\/api\/catalog\/variants\/consolidation-preview/)
assert.match(api,/\/api\/catalog\/variants\/consolidate-unused/)
assert.match(api,/requireAdminUser\(authUser, 'Объединение вариантов/)
assert.match(ui,/Проверить объединение/)
assert.match(ui,/Убрать дублирующий вариант/)
assert.match(ui,/История объединений вариантов/)
assert.match(api,/\/api\/catalog\/variants\/consolidation-history/)
assert.match(moduleText,/AND NOT EXISTS \(SELECT 1 FROM inventory_reservations/)
assert.doesNotMatch(moduleText,/\b(?:UPDATE|DELETE FROM)\s+(?:inventory_movements|payments)\b/i)
assert.match(moduleText,/UPDATE inventory_reservations SET variant_id=/)
assert.match(moduleText,/UPDATE order_items SET variant_id=/)
assert.match(moduleText,/catalog_variant_consolidation_reservation_validations/)
sqlite.close()
console.log('CATALOG INTEGRITY R2 SKU CONSOLIDATION PASSED — distinct material/size, blockers, concurrent races, zero-stock retirement, history and replay')
