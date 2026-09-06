import fs from 'node:fs'

const read = (p) => fs.readFileSync(p, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }
const app = read('src/App.tsx')
const movement = read('src/features/inventory/views/renderInventoryMovementPanel.tsx')
const worker = read('worker/index.ts')
const inventorySection = read('src/features/sections/InventorySection.tsx')
const frontendPreservation = [
  read('scripts/test-step1906b-frontend-modularization.mjs'),
  fs.existsSync('scripts/test-step1906b-frontend-modularization-legacy.mjs') ? read('scripts/test-step1906b-frontend-modularization-legacy.mjs') : '',
].join('\n')
const w2Manifest = JSON.parse(read('scripts/w2-human-warehouse-frontend-manifest.json'))
const w3Manifest = JSON.parse(read('scripts/w3-1a-warehouse-reliability-frontend-manifest.json'))

const block = (text, start, end) => {
  const from = text.indexOf(start)
  check(from >= 0, `Missing block start: ${start}`)
  const to = text.indexOf(end, from + start.length)
  check(to > from, `Missing block end after: ${start}`)
  return text.slice(from, to)
}

// The shared Operations submit button must not reintroduce a blanket admin-only UI gate.
check(!movement.includes("disabled={inventoryMovementBusy || !isAdmin ||"), 'Operations submit is still blanket admin-only')
check(movement.includes("disabled={inventoryMovementBusy || (inventoryDraft.movementType === 'arrival' ? inventoryArrivalSummary.rows === 0 : inventoryDraftSummary.rows === 0)}"), 'Operations submit does not use the manager-safe gate')
check(!movement.includes("| 'isAdmin'"), 'Movement renderer still requests an unused admin flag')
check(!movement.includes('    isAdmin,'), 'Movement renderer still destructures an unused admin flag')

// The existing frontend boundary remains responsible for unknown Arrival/master-data rows.
check(app.includes("if (!isAdmin && inventoryDraft.movementType === 'arrival' && cleanItems.some((item) => !item.variantId))"), 'known-only Arrival manager boundary disappeared')
check(app.includes('Новый товар или новая характеристика требуют админ-режима'), 'unknown Arrival needs a clear admin explanation')

// Backend permission truth remains the authority: manager-safe existing-stock work, guarded expansion.
const movementsRoute = block(worker, "if (url.pathname === '/api/inventory/movements' && request.method === 'POST')", "if (url.pathname === '/api/inventory/transfer' && request.method === 'POST')")
check(movementsRoute.includes("movementType === 'manual_set' || movementType === 'writeoff'"), 'manager-safe correction/writeoff contract missing')
check(movementsRoute.includes("movementType === 'arrival'"), 'known Arrival contract missing')
check(movementsRoute.includes("input.items.every((item) => toInt(item?.variantId, 0) > 0)"), 'known Arrival exact-variant guard missing')
check(movementsRoute.includes('requireAdminAccess(request)'), 'catalog-expanding movement must remain admin-guarded')
const transferRoute = block(worker, "if (url.pathname === '/api/inventory/transfer' && request.method === 'POST')", "if (url.pathname === '/api/catalog' && request.method === 'GET')")
check(!transferRoute.includes('requireAdminAccess(request)'), 'known-SKU transfer unexpectedly became admin-only')

// Cache invalidation must be side-effect free for Attention: no hidden D1 read after unrelated writes.
const invalidator = block(app, 'function invalidateInventoryStockCaches(includeCatalogReview = false)', 'async function loadCatalogData(force = false)')
check(invalidator.includes('warehouseAttentionSummaryCache = null'), 'Attention summary cache is not invalidated')
check(!invalidator.includes('loadWarehouseAttention('), 'inventory cache invalidation still performs a hidden Attention read')
check(!app.includes('if (postSaveShortages.length) void loadWarehouseAttention()'), 'order save still performs an unsolicited Attention read')

// W2.1 detail ownership/race protection must remain intact.
check(app.includes("const shouldLoadDetails = details || (activeSector === 'inventory' && inventoryPanel === 'attention')"), 'W2.1 detail ownership guard missing')
check(app.includes('setWarehouseAttention((current) => current?.items ? current : cached.data)'), 'W2.1 cached-summary detail preservation missing')

// Preserve the modularization guard as an explicit delta chained after W2, not a rewritten history hash.
check(w3Manifest.version === 1 && w3Manifest.revision === 'w3-1a-warehouse-reliability', 'W3.1A frontend preservation manifest invalid')
check(w3Manifest.frontend?.panelReturnChanges?.renderInventoryMovementPanel?.before === w2Manifest.frontend?.panelReturnChanges?.renderInventoryMovementPanel?.after, 'W3.1A preservation baseline must chain from exact W2 movement hash')
check(frontendPreservation.includes('w3WarehouseReliabilityPath') && frontendPreservation.includes('W3.1A Warehouse reliability panel baseline hash mismatch'), '1906B preservation test is not aware of the W3.1A delta')

// Frozen Arrival interface must remain byte-for-byte recognizable.
check(inventorySection.includes('<div className="inventory-arrival-legacy-workspace">'), 'frozen Arrival workspace changed')
check(inventorySection.includes('<button className="inventory-arrival-add-position" type="button" onClick={addInventoryArrivalPosition}>+ Добавить позицию</button>'), 'frozen Arrival add-position action changed')

console.log('W3.1A WAREHOUSE RELIABILITY PASSED — manager-safe Operations restored; Attention refreshes are demand-driven; Arrival remains frozen')
