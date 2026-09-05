import fs from 'node:fs'

const app = fs.readFileSync('src/App.tsx', 'utf8')
const types = fs.readFileSync('src/app/types.ts', 'utf8')
const workshop = fs.readFileSync('worker/domains/workshop.ts', 'utf8')
const workshopUi = fs.readFileSync('src/features/sections/WorkshopSection.tsx', 'utf8')
const ordersWrite = fs.readFileSync('worker/domains/orders-write.ts', 'utf8')
const fail = (message) => { throw new Error(message) }
const check = (condition, message) => { if (!condition) fail(message) }

try {
  check(types.includes("WorkshopPeriodPreset = 'all' | 'today' | 'yesterday' | 'month' | 'custom'"), 'Workshop all-period type is missing')
  check(app.includes("period: 'all' as WorkshopPeriodPreset,\n    dateFrom: '',\n    dateTo: ''"), 'Workshop must start as an all-date operational queue')
  check(app.includes("const range = preset === 'all' ? { dateFrom: '', dateTo: '' } : getPeriodRange(preset)"), 'All-period preset must clear date bounds without growing the App controller')
  check(workshopUi.includes("{ value: 'all' as const, label: 'Все' }"), 'Workshop UI must expose all dates')
  check(workshopUi.includes("const needsInvoiceRange = entry.value === 'invoice' && (workshopFilters.period === 'all' || !workshopFilters.dateFrom || !workshopFilters.dateTo)"), 'Only Invoice may force a bounded month from the all-date queue')
  check(workshopUi.includes("if (entry.value === 'done') setWorkshopSortDirection('newest')"), 'Done queue must show newest completions first so accidental ready clicks remain recoverable')
  check(workshopUi.includes("if (entry.value === 'active' || entry.value === 'urgent') setWorkshopSortDirection('oldest')"), 'Active backlog must keep oldest work first')
  check(workshop.includes("return {\n    dateFrom: cleanText(url.searchParams.get('dateFrom')),\n    dateTo: cleanText(url.searchParams.get('dateTo')),\n  };"), 'Worker fallback must preserve blank all-date bounds without a Worker declaration change')
  check(ordersWrite.includes("item.isWorkshop ? 'warehouse' : item.inventorySource"), 'Workshop storage fallback convention unexpectedly changed')
  const repairStart = workshop.indexOf('if (itemNeedsRepair) {')
  const repairEnd = workshop.indexOf('if (statements.length) await db.batch(statements);', repairStart)
  check(repairStart >= 0 && repairEnd > repairStart, 'Workshop linked-item repair block missing')
  const repair = workshop.slice(repairStart, repairEnd)
  check(repair.includes('SET is_workshop = 1'), 'Workshop status action must repair the canonical workshop flag')
  check(repair.includes("THEN 'workshop'"), 'Workshop status action must repair workshop stock semantics')
  check(!repair.includes('source_type ='), 'Ready/restore action must never rewrite source_type')
  console.log('WORKSHOP BACKLOG VISIBILITY R1 PASSED — old active/done work remains discoverable, Done opens newest first, Invoice stays bounded, and ready/restore cannot rewrite source_type')
} catch (error) {
  console.error(`WORKSHOP BACKLOG VISIBILITY R1 FAILED: ${error?.message || error}`)
  process.exit(1)
}
