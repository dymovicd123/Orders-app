import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8')
const migration = read('../migrations/0117_v72_inventory_manual_operation_receipts.sql')
const movement = read('../worker/domains/inventory-movement.ts')
const history = read('../worker/domains/inventory-stocktake.ts')
const worker = read('../worker/index.ts')
const timeline = read('../src/features/inventory/views/StockVariantTimeline.tsx')
const panel = read('../src/features/inventory/views/renderInventoryHistoryPanel.tsx')
const types = read('../src/app/types.ts')

// Source-level contract: a persisted successful receipt must share the stock/movement batch,
// not be a best-effort write from the HTTP route after the physical operation.
assert.match(movement, /statements\.push\([\s\S]*?INSERT INTO inventory_manual_operation_receipts[\s\S]*?await db\.batch\(statements\)/)
assert.match(movement, /Math\.max\(0, toInt\(actorUserId, 0\)\) \|\| null/)
assert.match(worker, /withAuthenticatedHeaders\(request, authUser\)/)
assert.match(worker, /applyInventoryMovement\(env\.DB, input, returnInventory, actor, authUser\?\.id \|\| 0\)/)
assert.ok(!worker.includes('result = await applyInventoryMovement(env.DB, input, returnInventory, actor);'))
assert.match(history, /manual_receipt\.operation_id = m\.reference_id/)
assert.match(history, /m\.reference_type = 'manual'/)
assert.match(history, /performedBy: cleanText\(row\.performed_by\) \|\| null/)
assert.match(types, /performedByUserId\?: number \| null/)
assert.match(timeline, /movement\.performedBy \|\| 'не зафиксирован'/)
assert.match(panel, /entry\.row\.performedBy \|\| 'Не зафиксирован в момент операции'/)

// SQLite/D1 transaction semantics with the EXACT receipt INSERT extracted from the Worker.
// A failed receipt INSERT must roll back the whole stock/movement operation.
const match = movement.match(/`(INSERT INTO inventory_manual_operation_receipts[\s\S]*?VALUES \(\?, \?, \?, \?\))`/)
assert.ok(match, 'The executable receipt INSERT exists in the movement batch')
const db = new DatabaseSync(':memory:')
db.exec(`
 PRAGMA foreign_keys=ON;
 CREATE TABLE inventory_operations(operation_id TEXT PRIMARY KEY, operation_type TEXT NOT NULL, source_type TEXT NOT NULL);
 CREATE TABLE inventory_movements(id INTEGER PRIMARY KEY, reference_type TEXT NOT NULL, reference_id TEXT NOT NULL, inventory_source TEXT NOT NULL, variant_id INTEGER NOT NULL, quantity_delta INTEGER NOT NULL);
 CREATE TABLE inventory_stock(inventory_source TEXT NOT NULL, variant_id INTEGER NOT NULL, quantity INTEGER NOT NULL, PRIMARY KEY(inventory_source, variant_id));
 INSERT INTO inventory_stock VALUES('warehouse', 77, 8);
`)
db.exec(migration)
const stamp = db.prepare(match[1])
const addOp = db.prepare('INSERT INTO inventory_operations(operation_id,operation_type,source_type) VALUES(?, ?, ?)')
const addMovement = db.prepare('INSERT INTO inventory_movements(reference_type,reference_id,inventory_source,variant_id,quantity_delta) VALUES(?, ?, ?, ?, ?)')
const updateStock = db.prepare('UPDATE inventory_stock SET quantity = quantity + ? WHERE inventory_source = ? AND variant_id = ?')
db.exec('BEGIN')
addOp.run('warehouse-op-1', 'writeoff', 'warehouse')
updateStock.run(-2, 'warehouse', 77)
addMovement.run('manual', 'warehouse-op-1', 'warehouse', 77, -2)
stamp.run('warehouse-op-1', 42, 'Работник из сеанса', '2026-11-01T01:00:00Z')
db.exec('COMMIT')
assert.equal(db.prepare("SELECT quantity FROM inventory_stock WHERE inventory_source='warehouse' AND variant_id=77").get().quantity, 6)
let receipt = db.prepare("SELECT actor_user_id,actor_label FROM inventory_manual_operation_receipts WHERE operation_id='warehouse-op-1'").get()
assert.deepEqual(receipt, { actor_user_id:42, actor_label:'Работник из сеанса' })
// A lost response must return prior result, not attribute the operation to a retrying colleague.
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM inventory_manual_operation_receipts").get().n, 1)
assert.equal(db.prepare("SELECT actor_user_id FROM inventory_manual_operation_receipts WHERE operation_id='warehouse-op-1'").get().actor_user_id, 42)
// Failed atomic batch: operation, movement and physical update must all roll back.
db.exec('BEGIN')
addOp.run('warehouse-op-rejected', 'arrival', 'warehouse')
updateStock.run(5, 'warehouse', 77)
addMovement.run('manual', 'warehouse-op-rejected', 'warehouse', 77, 5)
assert.throws(() => stamp.run('no-such-operation', 43, 'Чужой', '2026-11-01T01:01:00Z'))
db.exec('ROLLBACK')
assert.equal(db.prepare("SELECT quantity FROM inventory_stock WHERE inventory_source='warehouse' AND variant_id=77").get().quantity, 6)
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM inventory_movements WHERE reference_id='warehouse-op-rejected'").get().n, 0)
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM inventory_operations WHERE operation_id='warehouse-op-rejected'").get().n, 0)
// Attribution is strictly manual movement + operation ID. Never guess for historical records.
addMovement.run('manual','historic-unknown','warehouse',77,-1)
addMovement.run('shipment','warehouse-op-1','warehouse',77,-1)
const rows = db.prepare(`SELECT m.reference_type,m.reference_id,r.actor_label AS performed_by FROM inventory_movements m
 LEFT JOIN inventory_manual_operation_receipts r ON m.reference_type='manual' AND r.operation_id=m.reference_id
 WHERE m.variant_id=77 ORDER BY m.id`).all()
assert.equal(rows[0].performed_by, 'Работник из сеанса')
assert.equal(rows[1].performed_by, null)
assert.equal(rows[2].performed_by, null)
console.log('STAGE4_MANUAL_PERFORMER_ATOMIC_SQL_AND_SOURCE_PASS')
