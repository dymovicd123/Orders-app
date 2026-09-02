from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, got {count}')
    return text.replace(old, new, 1)

# --- Worker route guards: routine operations become manager-safe; master-data creation stays admin-only.
worker_path = ROOT / 'worker/index.ts'
worker = worker_path.read_text(encoding='utf-8')

for label, marker in [
    ('cycle-count apply', "if (url.pathname === '/api/inventory/cycle-counts/apply' && request.method === 'POST')"),
    ('stocktake list', "if (url.pathname === '/api/inventory/stocktakes' && request.method === 'GET')"),
    ('stocktake start', "if (url.pathname === '/api/inventory/stocktakes' && request.method === 'POST')"),
    ('stocktake quick batch', "if (url.pathname === '/api/inventory/stocktakes/quick-batch' && request.method === 'POST')"),
    ('stocktake get', "if (inventoryStocktakeMatch && request.method === 'GET')"),
    ('stocktake count', "if (inventoryStocktakeItemMatch && request.method === 'PATCH')"),
    ('stocktake add existing variant', "if (inventoryStocktakeAddItemMatch && request.method === 'POST')"),
    ('stocktake complete', "if (inventoryStocktakeCompleteMatch && request.method === 'POST')"),
    ('stocktake cancel', "if (inventoryStocktakeCancelMatch && request.method === 'POST')"),
    ('inventory history', "if (url.pathname === '/api/inventory/history' && request.method === 'GET')"),
    ('inventory check history', "if (url.pathname === '/api/inventory/check-history' && request.method === 'GET')"),
    ('inventory transfer', "if (url.pathname === '/api/inventory/transfer' && request.method === 'POST')"),
]:
    old = marker + " {\n        const denied = requireAdminAccess(request);\n        if (denied) return denied;"
    new = marker + " {"
    worker = replace_once(worker, old, new, label)

old_combo = """      const inventoryStocktakeAddCombinationMatch = url.pathname.match(/^\\/api\\/inventory\\/stocktakes\\/([^/]+)\\/items\\/combination$/);\n      if (inventoryStocktakeAddCombinationMatch && request.method === 'POST') {\n        const denied = requireAdminAccess(request);\n        if (denied) return denied;\n        const input = await readJson<{ productId?: unknown; material?: unknown; length?: unknown; category?: unknown; gender?: unknown; color?: unknown; size?: unknown; createReferenceFields?: unknown }>(request);\n        return json(await addInventoryStocktakeCombination(env.DB, decodeURIComponent(inventoryStocktakeAddCombinationMatch[1]), input), { status: 201 });\n      }"""
new_combo = """      const inventoryStocktakeAddCombinationMatch = url.pathname.match(/^\\/api\\/inventory\\/stocktakes\\/([^/]+)\\/items\\/combination$/);\n      if (inventoryStocktakeAddCombinationMatch && request.method === 'POST') {\n        const input = await readJson<{ productId?: unknown; material?: unknown; length?: unknown; category?: unknown; gender?: unknown; color?: unknown; size?: unknown; createReferenceFields?: unknown }>(request);\n        const createReferenceFields = input.createReferenceFields && typeof input.createReferenceFields === 'object'\n          ? input.createReferenceFields as Record<string, unknown>\n          : {};\n        const wantsNewReferenceValue = Object.values(createReferenceFields).some((value) => value === true);\n        if (wantsNewReferenceValue) {\n          const denied = requireAdminAccess(request);\n          if (denied) return denied;\n        }\n        return json(await addInventoryStocktakeCombination(env.DB, decodeURIComponent(inventoryStocktakeAddCombinationMatch[1]), input), { status: 201 });\n      }"""
worker = replace_once(worker, old_combo, new_combo, 'stocktake combination conditional admin')

old_movement = """      if (url.pathname === '/api/inventory/movements' && request.method === 'POST') {\n        const denied = requireAdminAccess(request);\n        if (denied) return denied;\n        const input = await readJson<{ requestId?: unknown; inventorySource?: unknown; movementType?: unknown; comment?: unknown; items?: InventoryItemInput[] }>(request);\n        const returnInventory = url.searchParams.get('returnInventory') !== '0';"""
new_movement = """      if (url.pathname === '/api/inventory/movements' && request.method === 'POST') {\n        const input = await readJson<{ requestId?: unknown; inventorySource?: unknown; movementType?: unknown; comment?: unknown; items?: InventoryItemInput[] }>(request);\n        const movementType = cleanText(input.movementType).toLowerCase();\n        const routineExistingStockOperation = movementType === 'manual_set' || movementType === 'writeoff';\n        const knownArrival = movementType === 'arrival'\n          && Array.isArray(input.items)\n          && input.items.length > 0\n          && input.items.every((item) => toInt(item?.variantId, 0) > 0);\n        if (!routineExistingStockOperation && !knownArrival) {\n          const denied = requireAdminAccess(request);\n          if (denied) return denied;\n        }\n        const returnInventory = url.searchParams.get('returnInventory') !== '0';"""
worker = replace_once(worker, old_movement, new_movement, 'conditional inventory movement admin')
worker_path.write_text(worker, encoding='utf-8')

# --- App: expose only safe operational paths in ordinary working mode.
app_path = ROOT / 'src/App.tsx'
app = app_path.read_text(encoding='utf-8')
app = replace_once(app,
    "if (!isAdmin && inventoryPanel !== 'overview' && inventoryPanel !== 'attention') setInventoryPanel('overview')",
    "if (!isAdmin && inventoryPanel === 'catalog') setInventoryPanel('overview')",
    'inventory entry manager panel guard')
app = replace_once(app,
    "if (activeSector === 'inventory' && inventoryPanel !== 'overview' && inventoryPanel !== 'attention') setInventoryPanel('overview')",
    "if (activeSector === 'inventory' && inventoryPanel === 'catalog') setInventoryPanel('overview')",
    'inventory manager redirect effect')
app = replace_once(app,
    "if (!isAdmin || !row.variantId || Number(row.quantity || 0) <= 0) return",
    "if (!row.variantId || Number(row.quantity || 0) <= 0) return",
    'start transfer from stock row')

app = replace_once(app,
"""  async function openWorkshopOrderEditor(task: WorkshopTaskRecord) {\n    if (!isAdmin) {\n      setMessage('Редактирование заказа доступно только в админ-режиме.')\n      return\n    }\n\n    setError(null)""",
"""  async function openWorkshopOrderEditor(task: WorkshopTaskRecord) {\n    setError(null)""",
    'workshop active order editor')

app = replace_once(app,
"""  ): Promise<InventoryStocktakeApplyResult> {\n    if (!isAdmin) {\n      const message = 'Применить результаты ревизии можно только в админ-режиме.'\n      setError(message)\n      return { ok: false, appliedKeys: [], message }\n    }\n\n    const cleanItems""",
"""  ): Promise<InventoryStocktakeApplyResult> {\n    const cleanItems""",
    'legacy stocktake apply manager guard')

app = replace_once(app,
"""  async function saveInventoryMovement() {\n    if (!isAdmin) {\n      setError('Ручные операции склада доступны только администратору.')\n      return\n    }\n    if (inventoryMovementBusy) return""",
"""  async function saveInventoryMovement() {\n    if (inventoryMovementBusy) return""",
    'inventory movement frontend blanket guard')

app = replace_once(app,
"""      if (!cleanItems.length) {\n        throw new Error('Выберите хотя бы один товар/вариант.')\n      }\n\n      if ((inventoryDraft.movementType === 'writeoff'""",
"""      if (!cleanItems.length) {\n        throw new Error('Выберите хотя бы один товар/вариант.')\n      }\n\n      if (!isAdmin && inventoryDraft.movementType === 'arrival' && cleanItems.some((item) => !item.variantId)) {\n        throw new Error('Новый товар или новая характеристика требуют админ-режима. В рабочем режиме выберите готовый существующий вариант.')\n      }\n\n      if ((inventoryDraft.movementType === 'writeoff'""",
    'known arrival boundary')
app_path.write_text(app, encoding='utf-8')

# --- Operational visibility: routine Warehouse panels become usable, catalog/master-data stays admin-only.
operational_path = ROOT / 'src/app/controllers/useOperationalViewModel.ts'
operational = operational_path.read_text(encoding='utf-8')
operational = replace_once(operational,
    "const inventoryManagerPanels: InventoryPanel[] = ['overview', 'attention']",
    "const inventoryManagerPanels: InventoryPanel[] = ['overview', 'attention', 'movement', 'stocktake', 'history']",
    'manager inventory panel allow-list')
operational_path.write_text(operational, encoding='utf-8')

# --- Inventory navigation: routine tabs for working mode; catalog remains admin-only.
section_path = ROOT / 'src/features/sections/InventorySection.tsx'
section = section_path.read_text(encoding='utf-8')
old_tabs = """                  { value: 'overview' as const, label: 'Остатки', hint: 'Просмотр текущих остатков' },\n                  { value: 'attention' as const, label: `Внимание${Number(warehouseAttention?.total || 0) ? ` · ${warehouseAttention?.total}` : ''}`, hint: 'То, что сейчас требует конкретного действия' },\n                  ...(isAdmin ? [\n                    { value: 'movement' as const, label: 'Движение товара', hint: 'Приход, списание, перемещение и корректировка' },\n                    { value: 'stocktake' as const, label: 'Ревизия', hint: 'Пересчёт того, что реально находится на месте' },\n                    { value: 'catalog' as const, label: 'Товары', hint: 'Какие товары и варианты существуют' },\n                    { value: 'history' as const, label: 'История', hint: 'Хронология изменений склада и бутика' },\n                  ] : []),"""
new_tabs = """                  { value: 'overview' as const, label: 'Остатки', hint: 'Просмотр текущих остатков' },\n                  { value: 'attention' as const, label: `Внимание${Number(warehouseAttention?.total || 0) ? ` · ${warehouseAttention?.total}` : ''}`, hint: 'То, что сейчас требует конкретного действия' },\n                  { value: 'movement' as const, label: 'Движение товара', hint: 'Приход, списание, перемещение и корректировка' },\n                  { value: 'stocktake' as const, label: 'Ревизия', hint: 'Пересчёт того, что реально находится на месте' },\n                  ...(isAdmin ? [\n                    { value: 'catalog' as const, label: 'Товары', hint: 'Какие товары и варианты существуют' },\n                  ] : []),\n                  { value: 'history' as const, label: 'История', hint: 'Хронология изменений склада и бутика' },"""
section = replace_once(section, old_tabs, new_tabs, 'inventory manager navigation')
section_path.write_text(section, encoding='utf-8')

# --- Attention: an unfinished stocktake is routine, unknown identity remains admin-only.
attention_path = ROOT / 'src/features/inventory/views/renderInventoryAttentionPanel.tsx'
attention = attention_path.read_text(encoding='utf-8')
attention = replace_once(attention,
    "{isAdmin ? <button className=\"secondary compact\" type=\"button\" onClick={() => openAttentionStocktake(item)}>Продолжить</button> : <span className=\"inventory-attention-admin-note\">Нужен администратор</span>}",
    "<button className=\"secondary compact\" type=\"button\" onClick={() => openAttentionStocktake(item)}>Продолжить</button>",
    'attention stocktake manager action')
attention_path.write_text(attention, encoding='utf-8')

# --- Update old cumulative tests to the intentional new least-privilege policy.
daily_test_path = ROOT / 'scripts/test-step192b2a-daily-warehouse.mjs'
daily_test = daily_test_path.read_text(encoding='utf-8')
daily_test = replace_once(daily_test,
    "check(operational.includes(\"const inventoryManagerPanels: InventoryPanel[] = ['overview', 'attention']\"), 'Attention tab can be selected by a manager but the panel visibility allow-list hides it')",
    "check(operational.includes(\"const inventoryManagerPanels: InventoryPanel[] = ['overview', 'attention', 'movement', 'stocktake', 'history']\"), 'Routine Warehouse panels are not available to a manager')",
    '192B2A manager panel expectation')
daily_test = replace_once(daily_test,
    "check(app.includes(\"nextPanel !== 'overview' && nextPanel !== 'attention'\") && app.includes(\"inventoryPanel !== 'overview' && inventoryPanel !== 'attention'\"), 'Managers are not allowed to open Attention safely')",
    "check(app.includes(\"if (!isAdmin && inventoryPanel === 'catalog')\") && app.includes(\"if (activeSector === 'inventory' && inventoryPanel === 'catalog')\"), 'Working mode must block only the master-data catalog panel')",
    '192B2A app visibility expectation')
daily_test = replace_once(daily_test,
    "check(batchRoute.includes('requireAdminAccess'), 'Batch stocktake must remain admin-only')",
    "check(!batchRoute.includes('requireAdminAccess'), 'CAS-protected batch stocktake is still admin-only')",
    '192B2A batch stocktake expectation')
daily_test = replace_once(daily_test,
    "check(cycleRoute.includes('requireAdminAccess'), 'Cycle-count administration must remain admin-only in 192B2A')",
    "check(!cycleRoute.includes('requireAdminAccess'), 'Routine cycle-count apply is still admin-only')",
    '192B2A cycle count expectation')
daily_test_path.write_text(daily_test, encoding='utf-8')

visibility_test_path = ROOT / 'scripts/test-step192b2a1-attention-visibility.mjs'
visibility_test = visibility_test_path.read_text(encoding='utf-8')
visibility_test = replace_once(visibility_test,
    "check(operational.includes(\"const inventoryManagerPanels: InventoryPanel[] = ['overview', 'attention']\"), 'Manager visibility allow-list still hides Attention')",
    "check(operational.includes(\"const inventoryManagerPanels: InventoryPanel[] = ['overview', 'attention', 'movement', 'stocktake', 'history']\"), 'Manager visibility allow-list does not include routine Warehouse panels')",
    '192B2A1 manager panel expectation')
visibility_test_path.write_text(visibility_test, encoding='utf-8')

# --- Permanent regression entry.
package_path = ROOT / 'package.json'
package = package_path.read_text(encoding='utf-8')
package = replace_once(package,
    "node scripts/test-d1-read-budget-r1.mjs && node scripts/test-d1-read-budget-r2.mjs\"",
    "node scripts/test-d1-read-budget-r1.mjs && node scripts/test-d1-read-budget-r2.mjs && node scripts/test-operational-autonomy-r2.mjs\"",
    'package release gate')
package_path.write_text(package, encoding='utf-8')

print('Operational autonomy R2 source patch applied')
