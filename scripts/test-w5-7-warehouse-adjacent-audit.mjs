import fs from 'node:fs'

const check = (ok, message) => { if (!ok) throw new Error(message) }

const routine = fs.readFileSync('src/features/inventory/routineCycleCount.ts', 'utf8')
const attentionActions = fs.readFileSync('src/features/inventory/useInventoryAttentionActions.ts', 'utf8')
const section = fs.readFileSync('src/features/sections/InventorySection.tsx', 'utf8')
const overview = fs.readFileSync('src/features/inventory/views/renderInventoryOverviewPanel.tsx', 'utf8')
const stocktake = fs.readFileSync('src/features/inventory/views/renderInventoryStocktakePanel.tsx', 'utf8')
const attention = fs.readFileSync('src/features/inventory/views/renderInventoryAttentionPanel.tsx', 'utf8')
const history = fs.readFileSync('src/features/inventory/views/renderInventoryHistoryPanel.tsx', 'utf8')
const worker = fs.readFileSync('worker/index.ts', 'utf8')
const activity = fs.readFileSync('worker/domains/activity.ts', 'utf8')

// W5.7A: all three physical-check paths must tell the truth after a durable mutation.
check(routine.includes('const successNotice = Boolean(result.changed)'), 'Routine short-check does not retain an authoritative success notice')
check(routine.includes('Остаток уже сохранён; общий список обновится при следующем обновлении.'), 'Routine short-check can still turn a saved count into an apparent save failure after refresh trouble')
check(routine.includes('const refreshes = await Promise.allSettled(['), 'Routine conflict recovery still lets a secondary refresh overwrite the authoritative conflict result')
check(routine.includes('Свежие данные не удалось загрузить автоматически; обновите остатки перед повторным подсчётом.'), 'Routine conflict refresh failure is not explained safely')
check(attentionActions.includes('Остаток сохранён; список обновится при следующем обновлении.'), 'Exact one-position check lost its post-write refresh isolation')
check(section.includes('await Promise.allSettled([refreshInventoryModule(true), refreshActiveStocktakes()])'), 'Full/selective stocktake completion can again look failed because of a secondary refresh')

// W5.7B: manager gets routine stock work, while structural/destructive administration stays admin-only.
check(section.includes("async function startStocktake() {\n    if (stocktakeBusy) return"), 'Manager full/selective stocktake start is role-gated again')
check(!section.includes("async function startStocktake() {\n    if (!isAdmin"), 'Manager stocktake start silently returns')
check(section.includes("async function refreshActiveStocktakes() {\n    try {"), 'Manager cannot discover/resume active stocktakes')
check(!section.includes("if (!isAdmin || inventoryPanel !== 'history') return"), 'Manager Warehouse history auto-load is role-gated again')
check(history.includes('entry.row.canReverse && isAdmin'), 'Destructive movement reversal is no longer admin-only')
check(history.includes('{isAdmin ? <button className="link-button inventory-service-link"'), 'Service/diagnostics link is no longer admin-only')
check(attention.includes('Требуется администратор'), 'Structural identity ambiguity lost its admin boundary')
check(attention.includes('Связать с вариантом'), 'Manager cannot resolve an already-known exact found item')
check(worker.includes("if (wantsNewReferenceValue) {\n          const denied = requireAdminAccess(request);"), 'Stocktake can create new reference/master-data values without admin')
check(worker.includes("if (url.pathname === '/api/inventory/stocktakes' && request.method === 'GET') {\n        return json(await listInventoryStocktakeSessions(env.DB, url));"), 'Active stocktake list is unexpectedly admin-only')
check(worker.includes("if (url.pathname === '/api/inventory/history' && request.method === 'GET') {\n        return json(await listInventoryHistory(env.DB, url));"), 'Warehouse history backend is unexpectedly admin-only')

// W5.7C: recovery should be explicit and non-destructive rather than forcing navigation.
check(overview.includes("if (current?.blockedByStocktake) return ("), 'Short-check active-stocktake blocker disappeared')
check(overview.includes("onClick={() => openInventoryPanel('stocktake')}>Открыть проверку</button>"), 'Blocked short-check has no direct recovery path to the active check')
check(stocktake.includes('Уточнить найденные'), 'Completed stocktake has no explicit found-item follow-up')
check(stocktake.includes('Дополнительных действий не требуется'), 'Completed stocktake lacks a calm no-follow-up state')
const applyStart = section.indexOf('  async function applyStocktake() {')
const applyEnd = section.indexOf('\n  async function addStocktakeCatalogVariant', applyStart)
check(applyStart >= 0 && applyEnd > applyStart, 'applyStocktake block not found')
check(!section.slice(applyStart, applyEnd).includes("openInventoryPanel('attention')"), 'Successful stocktake still forces the user into recovery')

// W5.7D: secondary audit/history must never be able to break the primary mutation response.
check(activity.includes("try {\n    await db.prepare("), 'Activity journal write is not isolated')
check(activity.includes("console.warn('Activity log write skipped:'"), 'Activity journal failures can propagate into Warehouse mutations')

// Frozen boundary.
const arrivalStart = section.indexOf('<div className="inventory-arrival-legacy-workspace">')
const arrivalButton = '<button className="inventory-arrival-add-position" type="button" onClick={addInventoryArrivalPosition}>+ Добавить позицию</button>'
check(arrivalStart >= 0 && section.indexOf(arrivalButton, arrivalStart) >= 0, 'Frozen Arrival workspace changed during W5.7')

console.log('W5.7 WAREHOUSE ADJACENT AUDIT PASSED — manager/admin boundaries, quick/selective/full check recovery, truthful post-write state, history and frozen Arrival remain consistent')
