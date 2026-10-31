import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

const backend=readFileSync(new URL('../worker/domains/warehouse-attention.ts',import.meta.url),'utf8')
const ui=readFileSync(new URL('../src/features/inventory/views/renderInventoryAttentionPanel.tsx',import.meta.url),'utf8')
const controller=readFileSync(new URL('../src/features/sections/InventorySection.tsx',import.meta.url),'utf8')
const app=readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8')
assert.ok(app.includes('const refreshProblems = loadWarehouseAttention(false, true)') && app.includes('await Promise.allSettled([refreshProblems])'),
  'Committed manual warehouse movement refreshes server live problem counts without repeating the operation')
assert.ok(ui.includes("identify: Number(counts?.found || 0)"),'Only physically discovered things belong in staff identify queue')
assert.ok(!ui.includes('items.lifecycle.length') && !ui.includes('items.catalog.length'),'Engineering SKU/lifecycle incidents cannot be staff tasks')
assert.ok(ui.includes("openInventoryPanel('settings')"),'Administrator retains a route to engineering diagnostics')
assert.ok(ui.includes('технические ошибки находятся в сервисе'))
assert.ok(controller.includes("const warehouseClarificationCount = Number(warehouseAttention?.counts?.handover || 0)\n    + Number(warehouseAttention?.counts?.found || 0)"),
  'Warehouse work badge must not include engineering diagnoses')
assert.equal((backend.match(/total: counts\.shortage \+ counts\.intake \+ counts\.handover \+ counts\.stocktake \+ counts\.found/g)||[]).length,2,
  'Both summary and details must exclude lifecycle/catalog from human total')
assert.equal((backend.match(/AND COALESCE\(e\.operation_type, ''\) <> 'workshop_intake'/g)||[]).length,2,
  'Old workshop intake must never be classified as direct physical receiving action')
assert.ok(backend.includes("&& cleanText(row.operation_type) !== 'workshop_intake'"),
  'Detail projection agrees with aggregate count')
assert.ok(backend.includes("AND (s.quantity IS NULL OR s.quantity >= 0)"),
  'Negative corrupt tracked stock requires engineering diagnostics, not a physical order shortage')

// Execute the actual source summary subquery, not a hand-crafted substitute.
const snippet=backend.match(/\(SELECT COUNT\(\*\) FROM \(\s*(SELECT r\.inventory_source, r\.variant_id[\s\S]*?)\)\) AS shortage_count/)
assert.ok(snippet,'Find current live shortage summary SQL')
const sql=new DatabaseSync(':memory:')
sql.exec(`
 CREATE TABLE inventory_stock(id INTEGER PRIMARY KEY,inventory_source TEXT,variant_id INTEGER,quantity INTEGER);
 CREATE TABLE inventory_reservations(id INTEGER PRIMARY KEY,inventory_source TEXT,variant_id INTEGER,quantity INTEGER,status TEXT);
 INSERT INTO inventory_stock VALUES(1,'warehouse',91,1),(2,'boutique',91,12),(3,'warehouse',92,-2),(4,'warehouse',93,3);
 INSERT INTO inventory_reservations VALUES(1,'warehouse',91,3,'active'),(2,'boutique',91,6,'active'),
 (3,'warehouse',92,1,'active'),(4,'warehouse',93,1,'released');
`)
let count=sql.prepare('SELECT COUNT(*) AS c FROM ('+snippet[1]+')').get().c
assert.equal(count,1,'Only the real live reservation/physical shortage is a staff question')
sql.prepare("UPDATE inventory_stock SET quantity=3 WHERE inventory_source='warehouse' AND variant_id=91").run()
count=sql.prepare('SELECT COUNT(*) AS c FROM ('+snippet[1]+')').get().c
assert.equal(count,0,'After a real physical reconciliation the live problem disappears')
sql.prepare("UPDATE inventory_reservations SET status='released' WHERE id=1").run()
assert.equal(sql.prepare('SELECT COUNT(*) AS c FROM ('+snippet[1]+')').get().c,0)
assert.ok(backend.includes('AND (s.quantity IS NULL OR s.quantity >= 0)'), 'Corrupt negative stock excluded from staff list')

// SQL classification also excludes late workshop intake without rewriting those old events.
sql.exec(`
 CREATE TABLE inventory_lifecycle_events(id INTEGER PRIMARY KEY,status TEXT,direction TEXT,operation_type TEXT,pending_reason TEXT);
 INSERT INTO inventory_lifecycle_events VALUES(1,'pending','in','return',''),
 (2,'pending','in','workshop_intake',''),
 (3,'pending','in','return','retired_historical'),
 (4,'pending','out','return',''),(5,'cancelled','in','return','');
`)
const intake=sql.prepare("SELECT COUNT(*) AS c FROM inventory_lifecycle_events e WHERE e.status='pending' AND e.direction='in' AND COALESCE(e.pending_reason,'') <> 'retired_historical' AND COALESCE(e.operation_type,'') <> 'workshop_intake'").get().c
assert.equal(intake,1)
assert.equal(sql.prepare("SELECT COUNT(*) AS c FROM inventory_lifecycle_events WHERE status='pending'").get().c,4,
  'Raw engineering evidence remains in DB, nothing silently removed')
console.log('STAGE4_HUMAN_ONLY_PROBLEMS_SQL_UI_PASS: real shortage count, closure, invalid stock, technical queue and workshop intake')
