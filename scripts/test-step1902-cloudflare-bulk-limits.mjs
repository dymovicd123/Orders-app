import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import ts from 'typescript'

const root = process.cwd()
const fail = (message) => { throw new Error(message) }
const expect = (condition, message) => { if (!condition) fail(message) }

function readFunction(relative, name) {
  const file = path.join(root, relative)
  const text = fs.readFileSync(file, 'utf8')
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const statement = source.statements.find((item) => ts.isFunctionDeclaration(item) && item.name?.text === name)
  expect(statement, `Missing function ${name}`)
  return statement.getText(source)
}

const index = fs.readFileSync(path.join(root, 'worker/index.ts'), 'utf8')
expect(index.includes("cloudflareBulkLimits: '1902'"), 'Missing Step 190.2 live health marker')

const stocktake = readFunction('worker/domains/inventory-stocktake.ts', 'addInventoryStocktakeCombination')
const movement = readFunction('worker/domains/inventory-movement.ts', 'applyInventoryMovement')
const transfer = readFunction('worker/domains/inventory-movement.ts', 'applyInventoryTransfer')
const reversal = readFunction('worker/domains/inventory-movement.ts', 'reverseInventoryTransferDocument')
const workshop = readFunction('worker/domains/workshop.ts', 'bulkUpdateWorkshopTasks')
const timesheet = readFunction('worker/domains/team.ts', 'saveTeamTimesheet')

expect(transfer.includes("if (rawItems.length > 60) throw new Error('За одно перемещение можно перенести не больше 60 строк."), 'Transfer capacity 60 changed')
expect(movement.includes("if (items.length > 100) throw new Error('За одну ручную операцию можно сохранить не больше 100 позиций."), 'Manual inventory capacity 100 changed')
expect(workshop.includes('.slice(0, 300)'), 'Workshop capacity 300 changed')
expect(stocktake.includes('.slice(0, 40)'), 'Stocktake inline size capacity 40 changed')

expect(stocktake.includes('FROM json_each(?) j'), 'Stocktake catalog input rowset changed unexpectedly')
expect(stocktake.includes('INSERT OR IGNORE INTO catalog_variants'), 'Stocktake variants are not set-based')
expect(!stocktake.includes('createCatalogCombinationV3('), 'Stocktake creates selected sizes one by one')
expect(!stocktake.includes('catalogReferenceValueExists('), 'Stocktake validates selected sizes one by one')

// 191D/191E: mutating bulk paths use one compact JSON bind per row in ordinary VALUES CTEs.
expect(movement.includes('resolveInventoryCreatableItemsBulk'), 'Manual inventory bulk resolver missing')
expect(movement.includes('const preparedChunks = chunksOf(prepared, 70)'), 'Manual inventory bounded chunks missing')
expect(movement.includes('input(payload) AS (VALUES ${valuesSql})'), 'Manual inventory VALUES row source missing')
expect(!movement.includes('const rowsJson = JSON.stringify'), 'Manual inventory returned to repeated JSON rowset')
expect(!movement.includes('await findInventoryStockRow('), 'Manual inventory resolves source stock per row')

expect(transfer.includes('const transferRowBindings = prepared.map'), 'Transfer one-bind-per-row write rowset missing')
expect(transfer.includes("const transferInputValuesSql = transferRowBindings.map(() => '(?)').join(', ')"), 'Transfer bounded VALUES row source missing')
expect(transfer.includes('input(payload) AS (VALUES ${transferInputValuesSql})'), 'Transfer VALUES CTE missing')
expect(transfer.includes('await db.batch(['), 'Transfer atomic batch missing')
expect(!transfer.includes('FROM json_each(?) j'), 'Transfer writes returned to json_each expansion')
expect(!transfer.includes('loadCanonicalVariantSnapshot('), 'Transfer loads canonical variants one by one')

expect(reversal.includes('const reversalRowBindings = prepared.map'), 'Transfer reversal one-bind-per-row rowset missing')
expect(reversal.includes("const reversalValuesSql = reversalRowBindings.map(() => '(?)').join(', ')"), 'Transfer reversal bounded VALUES source missing')
expect(reversal.includes('input(payload) AS (VALUES ${reversalValuesSql})'), 'Transfer reversal VALUES CTE missing')
expect(!reversal.includes('const rowsJson = JSON.stringify'), 'Transfer reversal returned to repeated JSON rowset')
expect(!reversal.includes('const rowsSql = `SELECT'), 'Transfer reversal returned to legacy shared json_each mutation rowset')

expect(workshop.includes('for (const updateChunk of chunksOf(updates, 70))'), 'Workshop 70-row bounded chunks missing')
expect(workshop.includes('input(payload) AS (VALUES ${valuesSql})'), 'Workshop VALUES row source missing')
expect(workshop.includes('await db.batch(statements)'), 'Workshop bulk updates are not one atomic batch')
expect(!workshop.includes('const updatesJson = JSON.stringify'), 'Workshop returned to repeated JSON rowset')
expect(!workshop.includes('refreshOrderWorkshopStatusFromTasks('), 'Workshop refreshes affected orders one by one')

expect(timesheet.includes('CROSS JOIN json_each(?) m'), 'Timesheet dates × managers set expansion changed unexpectedly')
expect(!timesheet.includes('const statements: D1PreparedStatement[]'), 'Timesheet creates one statement per cell')
expect(!timesheet.includes('for (const managerId'), 'Timesheet loops employees into D1 statements')

// SQLite validates the bounded VALUES sources at accepted UI capacities.
const db = new DatabaseSync(':memory:')
function countValues(count) {
  const payloads = Array.from({ length: count }, (_, i) => JSON.stringify({ id: i + 1 }))
  const sql = payloads.map(() => '(?)').join(', ')
  return db.prepare(`WITH input(payload) AS (VALUES ${sql}) SELECT COUNT(*) AS n FROM input`).get(...payloads).n
}
expect(countValues(60) === 60, '60-line transfer VALUES source failed')
expect(countValues(70) === 70, '70-line bounded chunk VALUES source failed')
expect(60 + 6 <= 100, '60-line transfer bind budget exceeds D1 100-bind ceiling')
expect(70 + 9 <= 100, '70-line bounded bulk bind budget exceeds D1 100-bind ceiling')
expect(Math.ceil(100 / 70) === 2, '100-line manual operation chunk budget changed')
expect(Math.ceil(300 / 70) === 5, '300-line workshop chunk budget changed')

db.exec(`CREATE TABLE sample_timesheet (work_date TEXT NOT NULL, manager_id INTEGER NOT NULL, work_until TEXT, comment TEXT, created_at TEXT, updated_at TEXT, UNIQUE(work_date, manager_id));`)
const dates = Array.from({ length: 31 }, (_, i) => `2026-08-${String(i + 1).padStart(2, '0')}`)
const managers = Array.from({ length: 20 }, (_, i) => i + 1)
db.prepare(`
  INSERT INTO sample_timesheet (work_date, manager_id, work_until, comment, created_at, updated_at)
  SELECT CAST(d.value AS TEXT), CAST(m.value AS INTEGER), ?, ?, ?, ?
  FROM json_each(?) d CROSS JOIN json_each(?) m WHERE 1
  ON CONFLICT(work_date, manager_id) DO UPDATE SET work_until=excluded.work_until, comment=excluded.comment, updated_at=excluded.updated_at
`).run('18:00', null, 'now', 'now', JSON.stringify(dates), JSON.stringify(managers))
expect(db.prepare('SELECT COUNT(*) AS n FROM sample_timesheet').get().n === 620, 'Timesheet set expansion failed at 31×20 cells')
db.close()

console.log('STEP 190.2 CLOUDFLARE BULK-LIMIT TESTS PASSED — accepted capacities preserved with bounded VALUES mutation row sources')
