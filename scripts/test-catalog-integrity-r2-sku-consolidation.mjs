import assert from 'node:assert/strict'
import fs from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { consolidateUnusedCatalogVariant, listRecentCatalogVariantConsolidations, previewCatalogVariantConsolidation } from '../worker/domains/catalog-variant-consolidation.ts'

const sqlite = new DatabaseSync(':memory:')
sqlite.exec(`
 PRAGMA foreign_keys=ON;
 CREATE TABLE catalog_products(id INTEGER PRIMARY KEY,name TEXT,is_active INTEGER);
 CREATE TABLE catalog_stock_positions(id INTEGER PRIMARY KEY,product_id INTEGER,material TEXT,length TEXT,is_active INTEGER);
 CREATE TABLE catalog_variants(
   id INTEGER PRIMARY KEY,product_id INTEGER,stock_position_id INTEGER,
   category TEXT,gender TEXT,color TEXT,size_label TEXT,material TEXT,length TEXT,
   is_active INTEGER,updated_at TEXT
 );
 CREATE TABLE inventory_stock(id INTEGER PRIMARY KEY,variant_id INTEGER,quantity INTEGER,reserved_quantity INTEGER);
 CREATE TABLE inventory_reservations(id INTEGER PRIMARY KEY,variant_id INTEGER,quantity INTEGER,status TEXT);
 CREATE TABLE orders(id INTEGER PRIMARY KEY,order_status TEXT,shipping_status TEXT);
 CREATE TABLE order_items(id INTEGER PRIMARY KEY,order_id INTEGER,variant_id INTEGER,quantity INTEGER);
 CREATE TABLE workshop_tasks(id INTEGER PRIMARY KEY,variant_id INTEGER,status TEXT);
 CREATE TABLE inventory_lifecycle_events(id INTEGER PRIMARY KEY,variant_id INTEGER,status TEXT);
 CREATE TABLE inventory_stocktake_sessions(id TEXT PRIMARY KEY,status TEXT);
 CREATE TABLE inventory_stocktake_items(id INTEGER PRIMARY KEY,session_id TEXT,variant_id INTEGER);
 INSERT INTO catalog_products VALUES(100,'ЭТНО КАРДИГАН',1);
 INSERT INTO catalog_stock_positions VALUES(30,100,'ДРАП','СТАНДАРТ',1),(31,100,'ШЕРСТЬ','СТАНДАРТ',1);
 INSERT INTO catalog_variants VALUES
  (7,100,30,'adult','ЖЕН','СВЕТЛО-СЕРЫЙ','52','ДРАП','СТАНДАРТ',1,'before'),
  (8,100,30,'adult','ЖЕН','СВЕТЛО СЕРЫЙ','52','ДРАП','СТАНДАРТ',1,'before'),
  (9,100,31,'adult','ЖЕН','СВЕТЛО СЕРЫЙ','52','ШЕРСТЬ','СТАНДАРТ',1,'before'),
  (10,100,30,'adult','ЖЕН','СВЕТЛО СЕРЫЙ','54','ДРАП','СТАНДАРТ',1,'before');
 INSERT INTO inventory_stock VALUES (10,7,0,0),(11,8,2,0);
 INSERT INTO orders VALUES(1,'active','sent');
 INSERT INTO order_items VALUES(21,1,7,1);
`)
sqlite.exec(fs.readFileSync('migrations/0083_v72_catalog_variant_consolidations.sql','utf8'))

let beforeUpdate = () => {}
const db = {
  prepare(sql) {
    return {
      bind(...values) {
        return {
          async first() { return sqlite.prepare(sql).get(...values) || null },
          async all() { return { results: sqlite.prepare(sql).all(...values) } },
          async run() {
            if (sql.startsWith('UPDATE catalog_variants AS v')) beforeUpdate()
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

sqlite.exec('UPDATE inventory_stock SET quantity=3 WHERE id=10')
impact=await previewCatalogVariantConsolidation(db,7,8)
assert.equal(impact.canConsolidate,false)
assert.match(impact.blockers.join(' '),/остаток/)
await assert.rejects(() => consolidateUnusedCatalogVariant(db,7,8),/невозможно/)
sqlite.exec('INSERT INTO inventory_stock VALUES(12,7,-3,0)')
assert.equal((await previewCatalogVariantConsolidation(db,7,8)).canConsolidate,false,
  'Compensating nonzero warehouse rows must not look like an empty SKU')
sqlite.exec('DELETE FROM inventory_stock WHERE id=12')
sqlite.exec('UPDATE inventory_stock SET quantity=0,reserved_quantity=1 WHERE id=10')
assert.equal((await previewCatalogVariantConsolidation(db,7,8)).canConsolidate,false, 'Stock reserve blocks')
sqlite.exec('UPDATE inventory_stock SET reserved_quantity=0 WHERE id=10')
sqlite.exec("INSERT INTO inventory_reservations VALUES(1,7,1,'active')")
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
sqlite.exec("INSERT INTO inventory_stocktake_sessions VALUES('rev','active')")
sqlite.exec("INSERT INTO inventory_stocktake_items VALUES(1,'rev',8)")
assert.equal((await previewCatalogVariantConsolidation(db,7,8)).canConsolidate,false, 'Keeper active stocktake blocks')
sqlite.exec('DELETE FROM inventory_stocktake_items')
sqlite.exec('DELETE FROM inventory_stocktake_sessions')

beforeUpdate=()=>{ beforeUpdate=()=>{}; sqlite.exec('UPDATE inventory_stock SET quantity=4 WHERE id=10') }
await assert.rejects(() => consolidateUnusedCatalogVariant(db,7,8),/изменились во время проверки/)
assert.equal(active(7),1, 'Stock race must not deactivate')
assert.equal(activity(),0,'Stock race must not log successful merge')
sqlite.exec('UPDATE inventory_stock SET quantity=0 WHERE id=10')
beforeUpdate=()=>{ beforeUpdate=()=>{}; sqlite.exec("UPDATE catalog_variants SET color='КРАСНЫЙ',updated_at='changed' WHERE id=8") }
await assert.rejects(() => consolidateUnusedCatalogVariant(db,7,8),/изменились во время проверки/)
assert.equal(active(7),1,'Keeper rename race must not deactivate')
assert.equal(activity(),0)
sqlite.exec("UPDATE catalog_variants SET color='СВЕТЛО СЕРЫЙ',updated_at='before' WHERE id=8")
assert.equal((await previewCatalogVariantConsolidation(db,7,8)).canConsolidate,true)

const beforeStock=sqlite.prepare('SELECT * FROM inventory_stock ORDER BY id').all()
const beforeOrder=sqlite.prepare('SELECT * FROM order_items ORDER BY id').all()
const result=await consolidateUnusedCatalogVariant(db,7,8,'admin-test')
assert.equal(result.consolidated,true)
assert.equal(result.historicalOrdersPreserved,1)
assert.equal(active(7),0)
assert.equal(active(8),1)
assert.equal(active(9),1)
assert.deepEqual(sqlite.prepare('SELECT * FROM inventory_stock ORDER BY id').all(),beforeStock)
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
await assert.rejects(() => consolidateUnusedCatalogVariant(db,7,9),/отличаются/)

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
assert.doesNotMatch(moduleText,/\b(?:UPDATE|DELETE FROM)\s+(?:inventory_stock|order_items|inventory_movements|inventory_reservations|payments)\b/i)
sqlite.close()
console.log('CATALOG INTEGRITY R2 SKU CONSOLIDATION PASSED — distinct material/size, blockers, concurrent races, zero-stock retirement, history and replay')
