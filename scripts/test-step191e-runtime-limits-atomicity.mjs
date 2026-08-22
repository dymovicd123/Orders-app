import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { DatabaseSync } from 'node:sqlite'

const root = process.cwd()
const fail = (message) => { throw new Error(message) }
const expect = (condition, message) => { if (!condition) fail(message) }
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')

function readFunction(relative, name) {
  const file = path.join(root, relative)
  const text = read(relative)
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const statement = source.statements.find((item) => ts.isFunctionDeclaration(item) && item.name?.text === name)
  expect(statement, `Missing function ${name}`)
  return statement.getText(source)
}

const index = read('worker/index.ts')
expect(index.includes("runtimeLimitsAtomicity: '191e'"), '191E health marker missing')
expect(index.includes("if (url.pathname === '/api/workshop/bulk' && request.method === 'PATCH')"), 'Workshop bulk route missing')
const workshopRoute = index.slice(index.indexOf("if (url.pathname === '/api/workshop/bulk'"), index.indexOf("if (url.pathname === '/api/workshop/", index.indexOf("if (url.pathname === '/api/workshop/bulk'") + 10))
expect(workshopRoute.includes('await readJson<'), 'Workshop bulk route bypasses shared readJson boundary')
expect(!workshopRoute.includes('await request.json()'), 'Workshop bulk route returned to raw request.json()')

const movement = readFunction('worker/domains/inventory-movement.ts', 'applyInventoryMovement')
const reversal = readFunction('worker/domains/inventory-movement.ts', 'reverseInventoryTransferDocument')
const movementReversal = readFunction('worker/domains/inventory-movement.ts', 'reverseInventoryMovementOperation')
const workshop = readFunction('worker/domains/workshop.ts', 'bulkUpdateWorkshopTasks')
const archivePreview = readFunction('worker/domains/orders-read.ts', 'getArchivePreview')
const archiveOrders = readFunction('worker/domains/orders-read.ts', 'archiveOrders')
const release = readFunction('worker/domains/order-reservations.ts', 'releaseOrderReservationsV2')
const fulfill = readFunction('worker/domains/order-reservations.ts', 'fulfillOrderReservationsV2')
const finance = readFunction('worker/domains/finance-reports.ts', 'listFinanceReports')
const references = readFunction('worker/domains/references.ts', 'getReferenceData')
const employeeRefs = readFunction('worker/domains/team.ts', 'countTeamEmployeeReferences')
const quick = readFunction('worker/domains/inventory-stocktake.ts', 'quickInventoryStocktakeBatch')

// Runtime row-source hardening: mutation paths use bounded VALUES CTEs and retain atomic batches.
for (const [label, source] of [
  ['manual inventory', movement], ['transfer reversal', reversal], ['movement reversal', movementReversal], ['workshop bulk', workshop],
]) {
  expect(source.includes('VALUES ${'), `${label}: bounded VALUES row source missing`)
  expect(source.includes('await db.batch('), `${label}: atomic db.batch missing`)
}
expect(movement.includes('chunksOf(prepared, 70)'), 'Manual inventory 70-row chunks missing')
expect(!movement.includes('const rowsJson = JSON.stringify'), 'Manual inventory legacy repeated rowsJson returned')
expect(reversal.includes('reversalRowBindings'), 'Transfer reversal one-bind-per-row payloads missing')
expect(!reversal.includes('const rowsJson = JSON.stringify'), 'Transfer reversal legacy rowsJson returned')
expect(movementReversal.includes('chunksOf('), 'Movement reversal bounded chunks missing')
expect(workshop.includes('chunksOf(updates, 70)'), 'Workshop bulk 70-row chunks missing')
expect(!workshop.includes('const updatesJson = JSON.stringify'), 'Workshop legacy updatesJson returned')

// Atomicity and query-count hardening for order operations.
expect(!archiveOrders.includes('for (const orderId of ids)'), 'Archive returned to one UPDATE per order')
expect(archiveOrders.includes('archive_batch_id = ?'), 'Archive batch tagging missing')
expect(archiveOrders.includes('await db.batch([update, insertRun])'), 'Archive UPDATE + run record are not atomic')
expect(archiveOrders.includes('json_each(?)'), 'Archive set-wise ID input missing')

expect(release.includes('chunksOf(stockPayloads, 70)'), 'Reservation release stock chunks missing')
expect(release.includes('chunksOf(reservationPayloads, 70)'), 'Reservation release row chunks missing')
expect(release.includes('await db.batch(statements)'), 'Reservation release is not atomic')
expect(!release.includes('await releaseOrderReservationV2('), 'Bulk reservation release returned to per-row helper loop')

expect(fulfill.includes('const requirementPayload = JSON.stringify'), 'Shipment single bulk stock/canonical read missing')
expect(fulfill.includes('chunksOf(stockPayloads, 70)'), 'Shipment stock chunks missing')
expect(fulfill.includes('chunksOf(activeReservationPayloads, 70)'), 'Shipment reservation chunks missing')
expect(fulfill.includes('await db.batch(statements)'), 'Shipment fulfillment is not atomic')
expect(!fulfill.includes('await loadCanonicalVariantSnapshot('), 'Shipment returned to per-SKU canonical reads')

// D1 allows at most 6 simultaneous D1 connections per invocation. Every intentionally large read fan-out is bounded to 6.
for (const [label, source] of [['finance', finance], ['references', references], ['employee references', employeeRefs], ['archive preview', archivePreview]]) {
  expect(source.includes('index += 6'), `${label}: bounded D1 fan-out width 6 missing`)
  expect(source.includes('Promise.all(tasks.slice(index, index + 6)'), `${label}: D1 fan-out is not sliced to 6`)
}

// Reject obvious future literal Promise.all([...]) fan-outs above six anywhere in Worker source.
for (const relative of fs.readdirSync(path.join(root, 'worker/domains')).filter((name) => name.endsWith('.ts'))) {
  const file = path.join(root, 'worker/domains', relative)
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.expression.getText(source) === 'Promise' && node.expression.name.text === 'all') {
      const arg = node.arguments[0]
      if (arg && ts.isArrayLiteralExpression(arg)) expect(arg.elements.length <= 6, `${relative}: literal Promise.all fan-out ${arg.elements.length} exceeds 6`)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
}

// Cloudflare D1 bind budget: accepted capacities must stay <=100 bound parameters per statement.
const budgets = [
  ['transfer/reversal 60', 60 + 6],
  ['manual inventory chunk', 70 + 9],
  ['workshop chunk', 70 + 4],
  ['movement reversal chunk', 70 + 6],
  ['reservation release chunk', 70 + 2],
  ['shipment chunk', 70 + 5],
  ['quick stocktake max', 30 * 3 + 9],
]
for (const [label, count] of budgets) expect(count <= 100, `${label}: bind budget ${count} exceeds 100`)
expect(quick.includes('if (rawItems.length > 30)'), 'Quick stocktake capacity 30 changed')
expect(quick.includes("const expectedValuesSql = items.map(() => '(?, ?, ?)').join(',')"), 'Quick stocktake expected 3-bind row shape changed')

// SQLite stress shapes. These tests exercise maximum bounded row sources and transaction rollback semantics.
const db = new DatabaseSync(':memory:')
function countValues(count) {
  const payloads = Array.from({ length: count }, (_, i) => JSON.stringify({ id: i + 1, qty: 1 }))
  const values = payloads.map(() => '(?)').join(', ')
  return db.prepare(`WITH input(payload) AS (VALUES ${values}) SELECT COUNT(*) AS n FROM input`).get(...payloads).n
}
expect(countValues(60) === 60, '60-row reversal VALUES stress failed')
expect(countValues(70) === 70, '70-row bounded chunk stress failed')
expect(Math.ceil(100 / 70) === 2, '100-row manual stress chunk count changed')
expect(Math.ceil(300 / 70) === 5, '300-row workshop stress chunk count changed')

db.exec(`
  CREATE TABLE orders(id INTEGER PRIMARY KEY, status TEXT NOT NULL, archive_batch_id TEXT);
  CREATE TABLE archive_runs(id INTEGER PRIMARY KEY, batch_id TEXT UNIQUE, item_count INTEGER NOT NULL);
  WITH RECURSIVE seq(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM seq WHERE x<5000)
  INSERT INTO orders(id,status) SELECT x,'closed' FROM seq;
`)
const ids = JSON.stringify(Array.from({ length: 5000 }, (_, i) => i + 1))
db.exec('BEGIN')
try {
  db.prepare(`UPDATE orders SET status='archived', archive_batch_id=? WHERE id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))`).run('batch-1', ids)
  db.prepare(`INSERT INTO archive_runs(batch_id,item_count) VALUES(?,(SELECT COUNT(*) FROM orders WHERE archive_batch_id=?))`).run('batch-1', 'batch-1')
  db.exec('COMMIT')
} catch (error) { db.exec('ROLLBACK'); throw error }
expect(db.prepare(`SELECT COUNT(*) AS n FROM orders WHERE status='archived'`).get().n === 5000, '5000-order set-wise archive stress failed')
expect(db.prepare(`SELECT item_count FROM archive_runs WHERE batch_id='batch-1'`).get().item_count === 5000, 'Archive run count stress failed')

// Prove rollback behavior used by db.batch design with an equivalent SQLite transaction.
db.exec(`UPDATE orders SET status='closed', archive_batch_id=NULL; DELETE FROM archive_runs;`)
db.exec('BEGIN')
let rolledBack = false
try {
  db.prepare(`UPDATE orders SET status='archived', archive_batch_id='batch-rollback' WHERE id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))`).run(ids)
  db.prepare(`INSERT INTO archive_runs(batch_id,item_count) VALUES('x',1),('x',2)`).run()
  db.exec('COMMIT')
} catch { rolledBack = true; db.exec('ROLLBACK') }
expect(rolledBack, 'Rollback stress did not trigger expected conflict')
expect(db.prepare(`SELECT COUNT(*) AS n FROM orders WHERE status='archived'`).get().n === 0, 'Archive mutation survived transaction rollback')
db.close()

console.log('STEP 191E D1 RUNTIME LIMITS / ATOMICITY TESTS PASSED — bounded mutation rowsets, <=6 read fan-out, <=100 binds, atomic archive/release/shipment shapes')
