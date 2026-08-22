import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'

import { readWorkerSource } from './lib/worker-source.mjs'
import { readInventorySource } from './lib/frontend-source.mjs'
const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const worker = readWorkerSource()
const migration = read('migrations/0060_v72_storage_database_hygiene.sql')
const types = read('src/app/types.ts')
const ordersView = read('src/features/sections/OrdersTableSection.tsx')
const clientsView = read('src/features/sections/ClientsSection.tsx')
const storageView = read('src/features/storage/DatabaseStorageMaintenance.tsx')
const inventory = readInventorySource()
const fail = (message) => { throw new Error(message) }
const expect = (condition, message) => { if (!condition) fail(message) }

expect(worker.includes("storageDatabaseHygiene: '1904'"), 'Missing Step 190.4 health marker')
expect(worker.includes("readPathSafety: '1903'"), 'Step 190.3 prerequisite marker disappeared')
expect(worker.includes('CREATE TABLE IF NOT EXISTS import_runs') === false, 'Import endpoint still creates schema during requests')
expect(worker.includes('ALTER TABLE workshop_tasks ADD COLUMN') === false, 'Workshop request path still adds columns dynamically')
const cleanup1906c = worker.includes("deadLegacyCleanup: '1906c'")
if (cleanup1906c) {
  expect(!worker.includes('async function assertImportControlSchema'), 'Step 190.6C: retired import runtime still keeps its schema assertion')
  expect(!worker.includes('/api/import/'), 'Step 190.6C: retired import routes resurfaced after storage cleanup')
} else {
  expect(worker.includes('async function assertImportControlSchema'), 'Read-only import schema assertion missing')
}
expect(worker.includes('async function assertWorkshopTaskDetailSchema'), 'Read-only workshop schema assertion missing')

const legacyTables = [
  'legacy_import_batches','legacy_import_customer_map','legacy_import_decisions','legacy_import_entity_map','legacy_import_manager_map',
  'legacy_import_order_audit','legacy_import_trial_checks','legacy_import_trial_runs','legacy_import_workshop_audit','legacy_incremental_checks',
  'legacy_incremental_item_resolution','legacy_incremental_order_matches','legacy_incremental_order_plan','legacy_incremental_runs',
  'legacy_incremental_source_signatures','legacy_incremental_stock_plan','legacy_incremental_target_signatures','legacy_stage_exchange_lines',
  'legacy_stage_ignored_rows','legacy_stage_issues','legacy_stage_order_items','legacy_stage_orders','legacy_stage_payments','legacy_stage_returns',
  'legacy_stage_stock_reviews','legacy_stage_workshop',
]
for (const table of legacyTables) {
  const activeSqlRef = new RegExp(`(?:FROM|JOIN|INTO|UPDATE|DELETE\\s+FROM)\\s+${table}\\b`, 'i')
  expect(!activeSqlRef.test(worker), `Worker still depends on dropped legacy table ${table}`)
  expect(migration.includes(`DROP TABLE IF EXISTS ${table}`), `Migration does not drop proven legacy table ${table}`)
}

expect(migration.includes('CREATE TABLE IF NOT EXISTS retained_order_summaries'), 'Retained order summary table missing')
expect(migration.includes('UNIQUE(original_order_id)') && migration.includes('UNIQUE(external_id)'), 'Retained summary identity guards missing')
expect(migration.includes('DROP INDEX IF EXISTS idx_inventory_stock_lookup'), 'Exact duplicate inventory product index not removed')
expect(migration.includes('DROP INDEX IF EXISTS idx_inventory_stock_variant_lookup'), 'Exact duplicate inventory variant index not removed')
expect(migration.includes('CREATE INDEX IF NOT EXISTS idx_workshop_tasks_variant_id'), 'Workshop variant index not schema-owned')
expect(migration.includes('CREATE INDEX IF NOT EXISTS idx_workshop_tasks_product_id'), 'Workshop product index not schema-owned')
expect(migration.includes('PRAGMA optimize'), 'PRAGMA optimize missing after schema hygiene')

expect(worker.includes('async function retainOrderSummariesForStorageCleanup'), 'Storage cleanup does not retain compact order history')
expect(worker.includes('await retainOrderSummariesForStorageCleanup(db, orderIds);'), 'Retained summary is not saved before core deletion')
expect(worker.includes("throw new Error('Не удалось сохранить краткую историю всех заказов."), 'Storage cleanup lacks retained-summary verification stop')
expect(worker.includes('NOT EXISTS (SELECT 1 FROM orders current_order WHERE current_order.id = s.original_order_id)'), 'Retained/current overlap is not deduplicated after interrupted cleanup')
expect(worker.includes('async function findRetainedOrderSummary'), 'Exact old ORD lookup fallback missing')
expect(worker.includes('retainedOrderSummaryPayload'), 'Retained order API shape missing')
expect(worker.includes('FROM retained_order_summaries s'), 'Client lifetime/history does not read retained summaries')
expect(!worker.includes('DELETE FROM legacy_import_order_audit'), 'Future month cleanup still depends on removed legacy audit tables')

for (const routeMetric of ["'orders.list'", "'orders.open-debts'", "'clients.list'", "'clients.details'", "'team.activity'", "'cash.cycles'"]) {
  expect(worker.includes(routeMetric), `Heavy read instrumentation missing: ${routeMetric}`)
}
expect(worker.includes("event: 'heavy_read_metric'"), 'Structured heavy-read metric event missing')

expect(types.includes('retained_only?: boolean'), 'Order type lacks retained_only')
expect(types.includes('retained_summary_text?: string | null'), 'Order type lacks retained summary text')
expect(ordersView.includes('const retainedOnly = Boolean(order.retained_only)'), 'Orders table does not recognize retained-only history')
expect(ordersView.includes('Только история'), 'Orders table does not disable retained-only actions visibly')
expect(ordersView.includes('isAdmin && archived && !retainedOnly'), 'Retained-only order can still expose restore action')
expect(clientsView.includes('Краткая история'), 'Client drawer does not label retained-only orders')
expect(storageView.includes('система сохраняет краткую историю заказа'), 'Storage cleanup UI does not explain retained summary behavior')

// Migration must be executable and retry-safe on a minimal SQLite shape.
const db = new DatabaseSync(':memory:')
db.exec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE workshop_tasks(id INTEGER PRIMARY KEY, variant_id INTEGER, product_id INTEGER);
  CREATE TABLE inventory_stock(id INTEGER PRIMARY KEY, inventory_source TEXT, product_name_snapshot TEXT, quantity INTEGER, variant_id INTEGER);
  CREATE INDEX idx_inventory_stock_lookup ON inventory_stock(inventory_source, product_name_snapshot, quantity);
  CREATE INDEX idx_inventory_stock_source_product_qty ON inventory_stock(inventory_source, product_name_snapshot, quantity);
  CREATE INDEX idx_inventory_stock_variant_lookup ON inventory_stock(inventory_source, variant_id);
  CREATE INDEX idx_inventory_stock_source_variant_manual ON inventory_stock(inventory_source, variant_id);
  CREATE TABLE legacy_import_batches(id INTEGER PRIMARY KEY);
  CREATE TABLE legacy_stage_orders(id INTEGER PRIMARY KEY, batch_id INTEGER REFERENCES legacy_import_batches(id));
  CREATE TABLE legacy_stage_order_items(id INTEGER PRIMARY KEY, legacy_order_id INTEGER REFERENCES legacy_stage_orders(id));
  CREATE TABLE legacy_stage_workshop(id INTEGER PRIMARY KEY, legacy_item_id INTEGER REFERENCES legacy_stage_order_items(id));
`)
for (const table of legacyTables) {
  const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)
  if (!exists) db.exec(`CREATE TABLE ${table}(id INTEGER PRIMARY KEY)`)
}
db.exec(migration)
db.exec(migration)
expect(Number(db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name LIKE 'legacy_%'").get().count) === 0, 'Legacy tables remain after migration')
expect(Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='retained_order_summaries'").get()), 'Retained summary table not created')
expect(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_inventory_stock_lookup'").get(), 'Old duplicate inventory lookup index remains')
expect(Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_inventory_stock_source_product_qty'").get()), 'Replacement product lookup index was lost')
expect(Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_inventory_stock_source_variant_manual'").get()), 'Replacement variant lookup index was lost')
db.close()

// Retained-history SQL must preserve one logical order across the cleanup boundary.
const historyDb = new DatabaseSync(':memory:')
historyDb.exec(`
  CREATE TABLE workshop_tasks(id INTEGER PRIMARY KEY, variant_id INTEGER, product_id INTEGER);
  CREATE TABLE inventory_stock(id INTEGER PRIMARY KEY, inventory_source TEXT, product_name_snapshot TEXT, quantity INTEGER, variant_id INTEGER);
  CREATE INDEX idx_inventory_stock_source_product_qty ON inventory_stock(inventory_source, product_name_snapshot, quantity);
  CREATE INDEX idx_inventory_stock_source_variant_manual ON inventory_stock(inventory_source, variant_id);
  CREATE TABLE customers(id INTEGER PRIMARY KEY, phone_normalized TEXT, display_name TEXT);
  CREATE TABLE managers(id INTEGER PRIMARY KEY, name TEXT);
  CREATE TABLE orders(
    id INTEGER PRIMARY KEY, external_id TEXT UNIQUE, order_date TEXT, customer_id INTEGER, manager_id INTEGER, manager_snapshot_name TEXT,
    city TEXT, delivery_type TEXT, source_type TEXT, total_amount REAL, received_amount REAL, debt_amount REAL, return_amount REAL,
    order_status TEXT, shipping_status TEXT, shipping_date TEXT
  );
  CREATE TABLE order_items(id INTEGER PRIMARY KEY, order_id INTEGER, product_name_snapshot TEXT, size_snapshot TEXT, quantity INTEGER);
  CREATE TABLE payments(id INTEGER PRIMARY KEY, order_id INTEGER);
  CREATE TABLE returns(id INTEGER PRIMARY KEY, order_id INTEGER, status TEXT);
`)
historyDb.exec(migration)
historyDb.exec(`
  INSERT INTO customers VALUES(1, '77001234567', 'Клиент');
  INSERT INTO managers VALUES(2, 'Менеджер');
  INSERT INTO orders VALUES(10, 'ORD-TEST-10', '2026-01-02', 1, 2, 'Старое имя', 'Алматы', 'delivery', 'manager', 10000, 8000, 0, 2000, 'archived', 'sent', '2026-01-03');
  INSERT INTO order_items VALUES(1, 10, 'Шапан', '48', 1);
  INSERT INTO order_items VALUES(2, 10, 'Жилет', '', 2);
  INSERT INTO payments VALUES(1, 10);
  INSERT INTO payments VALUES(2, 10);
  INSERT INTO returns VALUES(1, 10, 'completed');
`)
const retainSql = `INSERT INTO retained_order_summaries (
  original_order_id, external_id, order_date, customer_id, customer_phone, customer_name,
  manager_id, manager_name, city, delivery_type, source_type,
  total_amount, received_amount, debt_amount, return_amount,
  order_status, shipping_status, shipping_date,
  item_count, payment_count, return_count, item_summary,
  retained_reason, retained_at
)
SELECT
  o.id, o.external_id, o.order_date, o.customer_id, c.phone_normalized, c.display_name,
  o.manager_id, COALESCE(NULLIF(m.name, ''), NULLIF(o.manager_snapshot_name, ''), ''),
  o.city, o.delivery_type, o.source_type,
  o.total_amount, o.received_amount, o.debt_amount, o.return_amount,
  o.order_status, o.shipping_status, o.shipping_date,
  (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id AND oi.quantity > 0),
  (SELECT COUNT(*) FROM payments p WHERE p.order_id = o.id),
  (SELECT COUNT(*) FROM returns r WHERE r.order_id = o.id AND COALESCE(r.status, 'completed') <> 'cancelled'),
  COALESCE((
    SELECT GROUP_CONCAT(
      TRIM(COALESCE(oi.product_name_snapshot, '') ||
        CASE WHEN NULLIF(TRIM(COALESCE(oi.size_snapshot, '')), '') IS NOT NULL THEN ' · ' || TRIM(oi.size_snapshot) ELSE '' END ||
        ' × ' || CAST(COALESCE(oi.quantity, 0) AS TEXT)),
      '; '
    )
    FROM order_items oi
    WHERE oi.order_id = o.id AND oi.quantity > 0
  ), ''),
  'storage_cleanup', ?
FROM orders o
LEFT JOIN customers c ON c.id = o.customer_id
LEFT JOIN managers m ON m.id = o.manager_id
WHERE o.id IN (?)
ON CONFLICT(external_id) DO UPDATE SET
  original_order_id = excluded.original_order_id,
  order_date = excluded.order_date,
  customer_id = excluded.customer_id,
  customer_phone = excluded.customer_phone,
  customer_name = excluded.customer_name,
  manager_id = excluded.manager_id,
  manager_name = excluded.manager_name,
  city = excluded.city,
  delivery_type = excluded.delivery_type,
  source_type = excluded.source_type,
  total_amount = excluded.total_amount,
  received_amount = excluded.received_amount,
  debt_amount = excluded.debt_amount,
  return_amount = excluded.return_amount,
  order_status = excluded.order_status,
  shipping_status = excluded.shipping_status,
  shipping_date = excluded.shipping_date,
  item_count = excluded.item_count,
  payment_count = excluded.payment_count,
  return_count = excluded.return_count,
  item_summary = excluded.item_summary,
  retained_reason = excluded.retained_reason,
  retained_at = excluded.retained_at`
const retainStmt = historyDb.prepare(retainSql)
retainStmt.run('2026-08-19T12:00:00.000Z', 10)
retainStmt.run('2026-08-19T12:01:00.000Z', 10)
const retained = historyDb.prepare("SELECT * FROM retained_order_summaries WHERE external_id='ORD-TEST-10'").get()
expect(Number(historyDb.prepare('SELECT COUNT(*) AS count FROM retained_order_summaries').get().count) === 1, 'Retained summary upsert created a duplicate')
expect(Number(retained.item_count) === 2 && Number(retained.payment_count) === 2 && Number(retained.return_count) === 1, 'Retained summary lost operation counts')
expect(retained.item_summary === 'Шапан · 48 × 1; Жилет × 2', 'Retained summary lost compact item history')
const logicalHistoryCount = () => Number(historyDb.prepare(`WITH h AS (
  SELECT o.id AS original_order_id FROM orders o WHERE o.customer_id = 1
  UNION ALL
  SELECT s.original_order_id FROM retained_order_summaries s
  WHERE s.customer_id = 1 AND NOT EXISTS (SELECT 1 FROM orders current_order WHERE current_order.id = s.original_order_id)
) SELECT COUNT(*) AS count FROM h`).get().count)
expect(logicalHistoryCount() === 1, 'Retained summary double-counts while original order still exists')
historyDb.exec('DELETE FROM orders WHERE id = 10')
expect(logicalHistoryCount() === 1, 'Lifetime history disappears after original order deletion')
expect(Boolean(historyDb.prepare("SELECT 1 FROM retained_order_summaries WHERE external_id='ORD-TEST-10'").get()), 'Exact historical ORD identity disappeared')
historyDb.close()

// Arrival is frozen and Step 190.4 must not touch it.
const ARRIVAL_START = '<div className="inventory-arrival-legacy-workspace">'
const ARRIVAL_END = '<button className="inventory-arrival-add-position" type="button" onClick={addInventoryArrivalPosition}>+ Добавить позицию</button>'
const start = inventory.indexOf(ARRIVAL_START)
const end = start >= 0 ? inventory.indexOf(ARRIVAL_END, start) : -1
expect(start >= 0 && end >= 0, 'Frozen Arrival block missing')
const hash = crypto.createHash('sha256').update(inventory.slice(start, end + ARRIVAL_END.length)).digest('hex')
expect(hash === 'd8806f8f7971d6ee5c4c656d5cdf1551297ecc6ad01cc84730b16c3153bd05bf', 'Arrival UI changed during Step 190.4')

console.log('STEP 190.4 STORAGE / DATABASE HYGIENE TESTS PASSED')
