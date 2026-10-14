import fs from 'node:fs'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'

const read = path => fs.readFileSync(path, 'utf8')
const reservation = read('worker/domains/order-reservations.ts')
const stocktake = read('worker/domains/inventory-stocktake.ts')
const ui = read('src/features/sections/InventorySection.tsx')
const fulfill = reservation.split('export async function fulfillOrderReservationsV2(')[1]?.split('export async function correctMistakenOrderHandover(')[0] || ''
const guardStart = fulfill.indexOf("  if (stockConfirmationOperation === 'handover') {", fulfill.indexOf('  const statements: D1PreparedStatement[] = [];'))
const guardEnd = fulfill.indexOf('  for (const payloadChunk of chunksOf(stockPayloads, 70)) {', guardStart)
assert.ok(guardStart > 0 && guardEnd > guardStart, 'Early handover atomic guard missing or too late')
const guard = fulfill.slice(guardStart, guardEnd)
assert.ok(guard.includes("r.status = 'active'") && guard.includes('r.order_item_id = ?'), 'Guard must pin exact active reservation')
assert.ok(guard.includes("'__handover_reservation_conflict__'"), 'Handover conflict must abort the D1 batch')
const sql = guard.match(/statements\.push\(db\.prepare\(\s*`([\s\S]*?)`\s*\)\.bind\(/)?.[1]
assert.ok(sql, 'Unable to extract the production SQL gate')

const db = new DatabaseSync(':memory:')
db.exec(`CREATE TABLE inventory_model_meta(key TEXT PRIMARY KEY,value TEXT,updated_at TEXT);
CREATE TABLE inventory_reservations(id INTEGER PRIMARY KEY, order_id INTEGER, order_item_id INTEGER, status TEXT);
INSERT INTO inventory_model_meta VALUES ('human_inventory_v2', '1', 'now');
INSERT INTO inventory_reservations VALUES (22, 7, 91, 'active');`)
const args = ['2026-10-14T00:00:00Z', 7, 91, '[22]', 1]
db.prepare(sql).run(...args)
db.exec("UPDATE inventory_reservations SET status='fulfilled' WHERE id=22")
assert.throws(() => db.prepare(sql).run(...args), /UNIQUE constraint failed/, 'Concurrent stale handover did not abort')
assert.equal(db.prepare("SELECT value FROM inventory_model_meta WHERE key='human_inventory_v2'").get().value, '1', 'Conflict guard mutated inventory metadata')

const conflict = stocktake.split('export async function markInventoryStocktakeConflicts(')[1]?.split('export async function completeInventoryStocktakeSession(')[0] || ''
assert.ok(conflict.includes("status = 'recount_required'"), 'Stocktake concurrency signal missing')
assert.ok(!conflict.includes('counted_quantity = NULL') && !conflict.includes('counted_at = NULL'), 'Stocktake conflict still destroys earlier employee evidence')
const save = stocktake.split('export async function saveInventoryStocktakeCount(')[1]?.split('export async function addInventoryStocktakeVariant(')[0] || ''
assert.ok(save.includes('countedQuantity: persistedCount') && save.includes("persistedStatus === 'recount_required'"), 'Old counted fact is not retained before explicit recount')
assert.ok(save.includes('currentQuantity !== toInt(item.conflict_quantity, 0)'), 'Freshness cannot be checked after a second inventory movement')
assert.ok(ui.includes('dirtyIds = sameSession') && ui.includes('stocktakePendingValues.current'), 'Refresh can discard unsaved entered facts')
const quick = ui.split('  async function submitCycleCount() {')[1]?.split('  useEffect(() => {')[0] || ''
assert.ok(quick.includes("result?.code === 'changed'"), 'Short check concurrency handling missing')
assert.ok(!quick.includes("if (result?.code === 'changed') {\n          setCycleCountValues({})"), 'Short check still wipes submitted counts on conflict')
assert.ok(!ui.includes("эти поля снова оставлены пустыми"), 'Failed zero-confirmations still erase manually entered counts')

console.log('INVENTORY INTEGRITY SAFETY PASSED: stale parallel handover rejected atomically; employee count evidence and pending UI input kept')
