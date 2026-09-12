import fs from 'node:fs'
import assert from 'node:assert/strict'

const workshop = fs.readFileSync('worker/domains/workshop.ts', 'utf8')
const dashboardWorker = fs.readFileSync('worker/domains/inventory-read.ts', 'utf8')
const dashboardSection = fs.readFileSync('src/features/sections/DashboardSection.tsx', 'utf8')
const returnsDomain = fs.readFileSync('worker/domains/returns-exchanges.ts', 'utf8')
const returnSection = fs.readFileSync('src/features/sections/OrderReturnsSection.tsx', 'utf8')
const exchangeSection = fs.readFileSync('src/features/sections/OrderExchangeSection.tsx', 'utf8')

// A return must suppress only a concrete legacy task. Modern partial returns already
// update task quantity/status and carry a reversal snapshot, so sibling lines stay visible.
assert.ok(workshop.includes('hidden_return_workshop_tasks AS ('), 'task-level return visibility CTE missing')
assert.ok(workshop.includes('rwt.workshop_task_id = wt_hidden.id'), 'modern returned task snapshot exemption missing')
assert.ok(workshop.includes('returned.workshop_task_id = wt.id'), 'Workshop list must join return visibility by task id')
assert.ok(!workshop.includes('returned.order_id IS NULL'), 'Workshop list must not hide a whole order because one item was returned')

// Dashboard must use the same Workshop truth and limit the number of ORD cards, not task rows.
const dashboardStart = dashboardWorker.indexOf('export async function getDashboardInsights')
assert.ok(dashboardStart >= 0, 'dashboard declaration missing')
const dashboard = dashboardWorker.slice(dashboardStart)
assert.ok(dashboard.includes('WITH ${workshopStandaloneReturnOrdersCte}'), 'Dashboard must reuse Workshop return visibility')
assert.ok(!dashboard.includes('COALESCE(o.return_amount, 0) <= 0'), 'Dashboard must not hide a whole Workshop order after any return')
assert.ok(dashboard.includes('const selectedWorkshopOrderKeys = new Set<string>()'), 'Dashboard order-level attention cap missing')
assert.ok(dashboard.includes('selectedWorkshopOrderKeys.size >= 80'), 'Dashboard must cap attention by order count')
assert.ok(!dashboard.includes('.slice(0, 80);'), 'Dashboard must not truncate task rows before order grouping')
assert.ok(dashboardSection.includes('dashboardSummary.workshopActiveTotal ?? workshopData?.activeCount ?? summary.workshop ?? 0'), 'zero active Workshop tasks must not fall through to stale fallback data')

// If physical receipt committed but lifecycle creation/apply did not, history must expose
// a safe idempotent resume using the persisted destination instead of pretending success.
assert.ok(returnSection.includes('returnReceiptNeedsRecovery'), 'return receipt recovery predicate missing')
assert.ok(returnSection.includes('складской учёт не завершён'), 'return history must show incomplete stock accounting')
assert.ok(returnSection.includes('destination: item.inventorySource as'), 'return recovery must reuse the persisted destination')
assert.ok(returnSection.includes('Завершить учёт'), 'return recovery action missing')
assert.ok(exchangeSection.includes('oldReceiptNeedsRecovery'), 'exchange receipt recovery predicate missing')
assert.ok(exchangeSection.includes('destination: entry.oldReturnSource as'), 'exchange recovery must reuse the persisted destination')
assert.ok(exchangeSection.includes('Завершить учёт'), 'exchange recovery action missing')

// Return activity must describe per-line physical truth; the obsolete global fallback could
// log a Warehouse return as Boutique when the new UI sent restockSource=none.
assert.ok(returnsDomain.includes('const returnActivityItemDetails = validatedSelectedItems.map'), 'per-line return activity details missing')
assert.ok(returnsDomain.includes("entry.physicalState === 'warehouse'"), 'Warehouse physical state missing from return activity')
assert.ok(returnsDomain.includes("entry.physicalState === 'boutique'"), 'Boutique physical state missing from return activity')
assert.ok(returnsDomain.includes("entry.physicalState === 'pending'"), 'pending physical state missing from return activity')
assert.ok(!returnsDomain.includes("restockSource === 'warehouse' ? 'склад' : 'бутик'"), 'obsolete global return activity destination must stay removed')

console.log('September 12 stabilization R1 regression: OK')
