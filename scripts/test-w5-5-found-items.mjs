import fs from 'node:fs'

const check = (ok, message) => { if (!ok) throw new Error(message) }
const stocktake = fs.readFileSync('worker/domains/inventory-stocktake.ts', 'utf8')
const attention = fs.readFileSync('worker/domains/warehouse-attention.ts', 'utf8')
const router = fs.readFileSync('worker/index.ts', 'utf8')
const section = fs.readFileSync('src/features/sections/InventorySection.tsx', 'utf8')
const stocktakeView = fs.readFileSync('src/features/inventory/views/renderInventoryStocktakePanel.tsx', 'utf8')
const attentionView = fs.readFileSync('src/features/inventory/views/renderInventoryAttentionPanel.tsx', 'utf8')
const contracts = fs.readFileSync('shared/api-contracts.ts', 'utf8')

check(stocktake.includes("const deferUnknown = input.deferUnknown === true"), 'Unknown found values are not explicitly deferred')
check(stocktake.includes("last_source_ref LIKE 'stocktake-unresolved:%'"), 'Persistent unresolved found marker missing')
check(stocktake.includes("deferredUnknownCount: addedCount"), 'Deferred found position response missing')
check(stocktake.includes('export async function reconcileFoundInventoryStock'), 'Found-item reconciliation endpoint domain missing')
check(stocktake.includes("WHERE id = ? AND variant_id IS NULL AND quantity = ? AND last_source_ref LIKE 'stocktake-unresolved:%'"), 'Found-item exact resolution lacks source-row guard')
check(stocktake.includes("AND EXISTS (SELECT 1 FROM inventory_stock u WHERE u.id = ? AND u.variant_id IS NULL AND u.quantity = ?"), 'Found-item merge is not retry-safe against a consumed unresolved row')
check(stocktake.includes("unresolvedFoundCount: await countUnresolvedFound()"), 'Stocktake completion does not report unresolved found items')
check(stocktake.includes("stocktake-cancelled:${sessionId}"), 'Cancelled checks leave unresolved found marker active')

check(attention.includes("AS found_count"), 'Warehouse attention does not count unresolved found items')
check(attention.includes('exactFoundVariantSql'), 'Warehouse attention does not detect newly available exact variants')
check(attention.includes('found: (foundResult.results || []).map'), 'Warehouse attention does not return found item details')
check(contracts.includes('export type WarehouseAttentionFoundItem'), 'Found attention API contract missing')

check(router.includes('inventoryFoundStockReconcileMatch') && router.includes('reconcileFoundInventoryStock(env.DB'), 'Found-item reconcile route missing')
check(router.includes('Array.isArray(createReferenceFields)'), 'Stocktake reference creation admin gate still misreads array payloads')
check(router.includes('createReferenceFields.length > 0'), 'New reference values are not admin-gated')
check(!router.includes("Object.values(createReferenceFields).some((value) => value === true);"), 'Old broken reference-field admin gate remains')

check(section.includes('deferUnknown ? [] : createReferenceFields'), 'Stocktake UI still creates unknown reference values directly')
check(section.includes('deferUnknown,'), 'Stocktake UI does not tell server to defer unknown identity')
check(section.includes("openInventoryPanel('attention')"), 'Completed stocktake cannot route user to clarification')
check(section.includes("Number(warehouseAttention?.counts?.found || 0)"), 'Found items are not included in Warehouse clarification badge')
check(section.includes('Promise.allSettled([refreshInventoryModule(true), refreshActiveStocktakes()])'), 'Read refresh failure can still make a successful stocktake look failed')

check(stocktakeView.includes('мы не будем создавать вариант автоматически'), 'Found modal does not explain deferred identity')
check(!stocktakeView.includes('Новое значение будет добавлено только после отдельного подтверждения.'), 'Old master-data creation promise still shown in stocktake')
check(attentionView.includes('Вариант товара ещё не определён'), 'Prominent unresolved found warning missing')
check(attentionView.includes('пока не появилась среди обычных вариантов этого товара'), 'User is not told why found stock is absent from ordinary variants')
check(attentionView.includes('Связать с вариантом'), 'Exact found variant has no recovery action')
check(attentionView.includes('Требуется администратор'), 'True identity ambiguity no longer preserves admin boundary')

check(section.includes('<div className="inventory-arrival-legacy-workspace">'), 'Frozen Arrival workspace changed')
check(section.includes('<button className="inventory-arrival-add-position" type="button" onClick={addInventoryArrivalPosition}>+ Добавить позицию</button>'), 'Frozen Arrival add-position control changed')

console.log('W5.5 FOUND ITEMS PASSED — unknown physical finds stay visible, do not create junk catalog values, and remain actionable until exact identity is resolved')
