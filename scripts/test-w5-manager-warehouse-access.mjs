import fs from 'node:fs'
const check = (ok, message) => { if (!ok) throw new Error(message) }
const section = fs.readFileSync('src/features/sections/InventorySection.tsx', 'utf8')
const overview = fs.readFileSync('src/features/inventory/views/renderInventoryOverviewPanel.tsx', 'utf8')
const history = fs.readFileSync('src/features/inventory/views/renderInventoryHistoryPanel.tsx', 'utf8')
const attention = fs.readFileSync('src/features/inventory/views/renderInventoryAttentionPanel.tsx', 'utf8')
const worker = fs.readFileSync('worker/index.ts', 'utf8')

check(section.includes("async function startStocktake() {\n    if (stocktakeBusy) return"), 'Manager stocktake start still has a role gate')
check(!section.includes("async function startStocktake() {\n    if (!isAdmin"), 'Manager stocktake start silently returns')
check(section.includes("async function refreshActiveStocktakes() {\n    try {"), 'Active stocktakes are not manager-readable')
check(!section.includes("if (inventoryPanel !== 'stocktake' || !isAdmin) return"), 'Stocktake resume effect is still admin-only')
check(section.includes("if (inventoryPanel === 'catalog' && !isAdmin) return"), 'Catalog/master-data admin boundary was weakened')
check(section.includes("if (inventoryPanel !== 'stocktake' && inventoryPanel !== 'catalog') return"), 'Stocktake reference read is not scoped')

check(section.includes("async function loadHistoryMovements(reset = true) {\n    if (historyBusy) return"), 'Movement history still blocks managers')
check(section.includes("async function loadHistoryChecks() {\n    if (historyBusy) return"), 'Check history still blocks managers')
check(!section.includes("if (!isAdmin || inventoryPanel !== 'history') return"), 'History auto-load is still admin-only')
check(!overview.includes("{isAdmin ? <button className=\"secondary compact\" type=\"button\" onClick={() => openInventoryPanel('stocktake')}>Открыть проверку</button> : null}"), 'Open-check recovery action still hidden from managers')
check(overview.includes("onClick={() => openSimpleStockHistory(simpleStockDetail)}>История позиции</button>"), 'Exact SKU history action missing')
check(!overview.includes("{isAdmin ? <div className=\"inventory-calm-detail-actions\">"), 'Exact SKU history is still admin-only')

check(history.includes("entry.row.canReverse && isAdmin"), 'Destructive movement reversal must stay admin-only')
check(history.includes("{isAdmin ? <button className=\"link-button inventory-service-link\""), 'Service/diagnostics must stay admin-only')
check(attention.includes('Требуется администратор'), 'Structural identity recovery admin boundary disappeared')
check(worker.includes("const wantsNewReferenceValue = Object.values(createReferenceFields).some((value) => value === true);"), 'New reference-value boundary missing')
check(worker.includes("if (wantsNewReferenceValue) {\n          const denied = requireAdminAccess(request);"), 'Managers must not create master-data values implicitly during stocktake')
check(worker.includes("if (url.pathname === '/api/inventory/stocktakes' && request.method === 'GET') {\n        return json(await listInventoryStocktakeSessions(env.DB, url));"), 'Stocktake list backend unexpectedly admin-gated')
check(worker.includes("if (url.pathname === '/api/inventory/history' && request.method === 'GET') {\n        return json(await listInventoryHistory(env.DB, url));"), 'Warehouse history backend unexpectedly admin-gated')
check(worker.includes("if (url.pathname === '/api/inventory/check-history' && request.method === 'GET') {\n        return json(await listInventoryCheckHistory(env.DB, url));"), 'Check history backend unexpectedly admin-gated')

const arrivalStart = section.indexOf('<div className="inventory-arrival-legacy-workspace">')
const arrivalButton = '<button className="inventory-arrival-add-position" type="button" onClick={addInventoryArrivalPosition}>+ Добавить позицию</button>'
check(arrivalStart >= 0 && section.indexOf(arrivalButton, arrivalStart) >= 0, 'Frozen Arrival structure changed')
console.log('W5 MANAGER WAREHOUSE ACCESS PASSED — managers can start/resume checks and read Warehouse history; master-data, diagnostics and destructive reversal remain admin-only')
