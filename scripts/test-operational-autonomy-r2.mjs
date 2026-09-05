import fs from 'node:fs'

const read = (p) => fs.readFileSync(p, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }
const worker = read('worker/index.ts')
const app = read('src/App.tsx')
const section = read('src/features/sections/InventorySection.tsx')
const attention = read('src/features/inventory/views/renderInventoryAttentionPanel.tsx')
const history = read('src/features/inventory/views/renderInventoryHistoryPanel.tsx')

const block = (text, start, end) => {
  const from = text.indexOf(start)
  check(from >= 0, `Missing block start: ${start}`)
  const to = text.indexOf(end, from + start.length)
  check(to > from, `Missing block end after: ${start}`)
  return text.slice(from, to)
}

for (const [label, start, end] of [
  ['cycle count apply', "if (url.pathname === '/api/inventory/cycle-counts/apply'", "if (url.pathname === '/api/inventory/stocktakes' && request.method === 'GET')"],
  ['stocktake list/start/quick', "if (url.pathname === '/api/inventory/stocktakes' && request.method === 'GET')", "if (url.pathname === '/api/inventory/stocktakes/quick' && request.method === 'POST')"],
  ['stocktake get', 'const inventoryStocktakeMatch =', 'const inventoryStocktakeItemMatch ='],
  ['stocktake count', 'const inventoryStocktakeItemMatch =', 'const inventoryStocktakeAddCombinationMatch ='],
  ['stocktake add existing variant', 'const inventoryStocktakeAddItemMatch =', 'const inventoryStocktakeCompleteMatch ='],
  ['stocktake complete', 'const inventoryStocktakeCompleteMatch =', 'const inventoryStocktakeCancelMatch ='],
  ['stocktake cancel', 'const inventoryStocktakeCancelMatch =', "if (url.pathname === '/api/inventory/history' && request.method === 'GET')"],
  ['inventory history reads', "if (url.pathname === '/api/inventory/history' && request.method === 'GET')", "if (url.pathname === '/api/inventory/reservations' && request.method === 'GET')"],
  ['inventory transfer', "if (url.pathname === '/api/inventory/transfer' && request.method === 'POST')", "if (url.pathname === '/api/catalog' && request.method === 'GET')"],
]) {
  check(!block(worker, start, end).includes('requireAdminAccess(request)'), `${label} unexpectedly requires admin`)
}

const combination = block(worker, 'const inventoryStocktakeAddCombinationMatch =', 'const inventoryStocktakeAddItemMatch =')
check(combination.includes('wantsNewReferenceValue'), 'stocktake combination must distinguish master-data creation')
check(combination.includes('requireAdminAccess(request)'), 'new stocktake reference values must remain admin-only')

const movements = block(worker, "if (url.pathname === '/api/inventory/movements' && request.method === 'POST')", "if (url.pathname === '/api/inventory/transfer' && request.method === 'POST')")
check(movements.includes("movementType === 'manual_set' || movementType === 'writeoff'"), 'routine existing-stock movements are not manager-safe')
check(movements.includes("movementType === 'arrival'"), 'known-arrival boundary missing')
check(movements.includes("input.items.every((item) => toInt(item?.variantId, 0) > 0)"), 'ordinary arrival must require an existing exact variant')
check(movements.includes('requireAdminAccess(request)'), 'catalog-expanding movement branch lost its admin guard')

check(block(worker, "const inventoryLifecycleResolveMatch =", "const inventoryLifecycleKnownMatch =").includes('requireAdminAccess(request)'), 'unknown lifecycle identity resolution must remain admin-only')
check(block(worker, "if (url.pathname === '/api/catalog/products'", 'const productMatch =').includes('requireAdminAccess(request)'), 'catalog product creation must remain admin-only')
check(worker.includes("title: 'Отменена складская операция'"), 'inventory reversal audit path missing')

check(!app.includes("Редактирование заказа доступно только в админ-режиме."), 'workshop active-order editor still has a frontend admin blocker')
check(!app.includes("Применить результаты ревизии можно только в админ-режиме."), 'stocktake apply still has a frontend admin blocker')
check(!app.includes("Ручные операции склада доступны только администратору."), 'inventory movement still has a blanket frontend admin blocker')
check(app.includes("if (!isAdmin && inventoryPanel === 'catalog') setInventoryPanel('overview')"), 'working-mode inventory navigation must block only master-data catalog')
check(app.includes("if (!isAdmin && inventoryDraft.movementType === 'arrival' && cleanItems.some((item) => !item.variantId))"), 'known-only Arrival boundary missing in frontend')
check(app.includes("Новый товар или новая характеристика требуют админ-режима"), 'ordinary user needs a clear master-data boundary message')
check(app.includes("if (!isAdmin && (['deleted', 'archived'].includes(order.order_status) || order.shipping_status === 'sent'))"), 'sent/deleted/archived order edit protection must remain')
check(!app.includes("order.order_status !== 'active' || order.shipping_status === 'sent'"), 'closed unshipped orders must remain editable in working mode')

check(section.includes("{ value: 'movement' as const, label: 'Операции'"), 'manager-safe operations tab missing')
check(section.includes("{ value: 'stocktake' as const, label: 'Проверка'"), 'manager-safe physical check tab missing')
check(section.includes("{ value: 'history' as const, label: 'История'"), 'manager-safe history tab missing')
const nav = block(section, '<div className="warehouse-w2-navigation"', '{renderInventoryAttentionPanel({')
check(nav.includes("{ value: 'movement' as const") && nav.includes("{ value: 'stocktake' as const") && nav.includes("{ value: 'history' as const"), 'routine Warehouse tabs left the shared working navigation')
check(nav.includes("{isAdmin ? <button type=\"button\" className={inventoryPanel === 'catalog' ? 'is-active' : ''}"), 'catalog must remain an explicit admin-only secondary action')

check(attention.includes('<button className="secondary compact" type="button" onClick={() => openAttentionStocktake(item)}>Продолжить проверку</button>'), 'unfinished stocktake must be resumable in working mode')
check(!attention.includes('{isAdmin ? <button className="secondary compact" type="button" onClick={() => openAttentionStocktake(item)}>'), 'stocktake attention action still admin-gated')
check(attention.includes('openAttentionLifecycle(item)') && attention.includes('inventory-attention-admin-note">Требуется администратор'), 'unknown identity attention must remain admin-gated')
check(history.includes('entry.row.canReverse && isAdmin'), 'destructive history reversal must remain admin-only')

check(section.includes('<div className="inventory-arrival-legacy-workspace">'), 'frozen Arrival workspace disappeared')
check(section.includes('<button className="inventory-arrival-add-position" type="button" onClick={addInventoryArrivalPosition}>+ Добавить позицию</button>'), 'frozen Arrival action changed')

console.log('OPERATIONAL AUTONOMY R2 PASSED — routine warehouse work is manager-safe; catalog/master-data and destructive reversals remain admin-only')
