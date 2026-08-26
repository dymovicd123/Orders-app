import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

function section(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker)
  check(start >= 0, `Section start missing: ${startMarker}`)
  const end = text.indexOf(endMarker, start + startMarker.length)
  check(end > start, `Section end missing: ${endMarker}`)
  return text.slice(start, end)
}

try {
  const worker = read('worker/index.ts')
  const stocktake = read('worker/domains/inventory-stocktake.ts')
  const inventory = read('src/features/sections/InventorySection.tsx')
  const overview = read('src/features/inventory/views/renderInventoryOverviewPanel.tsx')
  const stocktakePanel = read('src/features/inventory/views/renderInventoryStocktakePanel.tsx')
  const pkg = JSON.parse(read('package.json'))

  const readRoute = section(worker, "if (url.pathname === '/api/inventory/cycle-counts' && request.method === 'GET')", "if (url.pathname === '/api/inventory/cycle-counts/apply' && request.method === 'POST')")
  const batchRoute = section(worker, "if (url.pathname === '/api/inventory/cycle-counts/apply' && request.method === 'POST')", "if (url.pathname === '/api/inventory/stocktakes' && request.method === 'GET')")
  const fullRoute = section(worker, "if (url.pathname === '/api/inventory/stocktakes' && request.method === 'POST')", "if (url.pathname === '/api/inventory/stocktakes/quick-batch' && request.method === 'POST')")
  const exactRoute = section(worker, "if (url.pathname === '/api/inventory/stocktakes/quick' && request.method === 'POST')", 'const inventoryStocktakeMatch')
  check(!readRoute.includes('requireAdminAccess'), 'Routine recommendations remain admin-only')
  check(batchRoute.includes('requireAdminAccess'), 'Admin cycle batch mutation was opened')
  check(fullRoute.includes('requireAdminAccess'), 'Full/selective revision creation was opened')
  check(!exactRoute.includes('requireAdminAccess'), 'Safe exact quick check is no longer available to workers')
  check(worker.includes('request = withAuthenticatedHeaders(request, authUser)'), 'Server-owned access role headers are not enforced')

  check(stocktake.includes("Math.min(24, Math.max(3, toInt(url.searchParams.get('limit'), 12)))"), '3–5 item recommendation limit is unsupported')
  check(stocktake.includes('row.priority >= 25 && !(row.lastCheckedAt && row.daysSinceCheck === 0 && row.movementsSinceCheck === 0)'), 'Just-confirmed SKU suppression is missing')

  check(inventory.includes('loadInventoryCycleCounts(source, limit)'), 'Cycle loader still hardcodes the old batch size')
  check(inventory.includes("inventoryPanel === 'overview'"), 'Routine suggestions are not loaded in Остатки')
  check(inventory.includes('refreshCycleCountSuggestions(simpleStockSource, false, 5)'), 'Остатки does not request five SKUs')
  check(inventory.includes('async function submitRoutineCycleCount'), 'Routine exact-confirm action is missing')
  check(inventory.includes('await quickInventoryStocktake({'), 'Routine action does not reuse exact quick check')
  check(inventory.includes("items: (current.items || []).filter((item: any) => Number(item.variantId) !== Number(row.variantId))"), 'Confirmed SKU does not disappear immediately')
  check(!section(inventory, 'async function refreshCycleCountSuggestions', 'async function submitRoutineCycleCount').includes('if (!isAdmin) return'), 'Routine loader still blocks workers')

  check(overview.includes('data-smart-daily-stock="routine"'), 'Smart Daily Stock Truth is absent from Остатки')
  check(overview.includes('Полезно сверить сейчас'), 'Routine cue wording is missing')
  check(overview.includes('Совпадает:'), 'One-tap matching action is missing')
  check(overview.includes('Другое количество'), 'Mismatch action is missing')
  check(overview.includes('Незавершённая ревизия блокирует короткие сверки'), 'Active-revision explanation is missing')
  check(overview.includes('(row.reasons || [])[0]'), 'Routine view shows more than the dominant reason')
  check(!overview.includes('recommendedCount'), 'Routine view exposes the total backlog')
  check(stocktakePanel.includes('cycleCountData.recommendedCount'), 'Admin Revision cycle-count surface disappeared')

  check(String(pkg.scripts?.['release:check'] || '').includes('test-phase2-smart-daily-stock.mjs'), 'Phase 2 regression is not wired into release:check')
  console.log('PHASE 2 SMART DAILY STOCK TRUTH TESTS PASSED')
} catch (error) {
  console.error(`PHASE 2 SMART DAILY STOCK TRUTH TESTS FAILED: ${error?.message || error}`)
  process.exit(1)
}
