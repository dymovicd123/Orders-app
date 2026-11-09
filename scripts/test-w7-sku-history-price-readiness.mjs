import fs from 'node:fs'

const read = (path) => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

const inventory = read('src/features/sections/InventorySection.tsx')
const historyWorkspace = read('src/features/inventory/useInventoryHistoryWorkspace.ts')
const panel = read('src/features/inventory/views/renderInventoryCatalogPanel.tsx')
const sku = read('src/features/inventory/views/catalogPolishExecutionGroups.tsx')
const history = read('src/features/inventory/views/renderInventoryHistoryPanel.tsx')
const initialSchema = read('migrations/0001_init.sql')
const catalogIdentity = read('migrations/0048_v72_catalog_identity_v3.sql')
const stockChecks = read('migrations/0053_v72_inventory_cycle_counts.sql')

check(inventory.includes('useInventoryHistoryWorkspace({') && inventory.includes('clearStockDetail: () => setSimpleStockDetail(null)'),
  'InventorySection must use the single read-only history owner and clear old stock details')
check(historyWorkspace.includes('function openSimpleStockHistory(detail: InventoryHistoryFilter)') && historyWorkspace.includes('setHistoryVariantFilter(detail)') && historyWorkspace.includes("setHistoryMode('movements')") && historyWorkspace.includes("openInventoryPanel('history')"), 'existing exact-position Warehouse history opener is missing')
check(historyWorkspace.includes('const historyRequestRef = useRef(0)') && historyWorkspace.includes('const requestId = ++historyRequestRef.current') && historyWorkspace.includes('if (requestId !== historyRequestRef.current) return') && historyWorkspace.includes('if (requestId === historyRequestRef.current) setHistoryBusy(false)'), 'history source/SKU switching can still be overwritten by a stale in-flight response')
check(historyWorkspace.includes('historyRows.filter') && historyWorkspace.includes("const seenTransfers = new Set<string>()"),
  'Grouped transfer movement history must remain inside the history workspace')
check(historyWorkspace.includes("beforeId: reset ? 0 : Number(historyNextBeforeId || 0)") && historyWorkspace.includes('setHistoryNextBeforeId(Number(data?.nextBeforeId || 0) || null)'),
  'Warehouse history pagination cursor must not be lost in refactor')
check(!inventory.includes('const historyRequestRef') && !inventory.includes('async function loadHistoryMovements('),
  'History state/action implementation was duplicated in oversized InventorySection')
check(inventory.includes('openSimpleStockHistory,\n        openOrderFromFinance,'), 'Catalog does not receive the existing history opener')
check(panel.includes("| 'openSimpleStockHistory'") && panel.includes('openVariantHistory={ctx.openSimpleStockHistory}'), 'Catalog renderer does not pass history through its typed presentation boundary')
check(sku.includes('История · Склад') && sku.includes('История · Бутик'), 'SKU card does not expose both source histories')
check(sku.includes("source: 'warehouse'") && sku.includes("source: 'boutique'") && sku.includes('variantId: Number(cardVariant.id)'), 'SKU history navigation is not exact source + variant')
check(history.includes('Движения') && history.includes('Ревизии и сверки') && history.includes('historyVariantFilter'), 'existing Warehouse history cannot show both movement and physical-check history for the exact filter')
check(stockChecks.includes('idx_inventory_stock_checks_source_variant_time') && stockChecks.includes('(inventory_source, variant_id, checked_at DESC, id DESC)'), 'exact-SKU physical-check history index is missing')
check(initialSchema.includes('unit_price INTEGER NOT NULL DEFAULT 0') && initialSchema.includes('variant_id INTEGER REFERENCES catalog_variants(id)'), 'historical order transaction price is not separated from exact SKU identity')
check(catalogIdentity.includes('Execution identity: product + material + length.') && catalogIdentity.includes('Stock combination identity inside an execution: audience type + gender + color + size.'), 'stable Product -> Execution -> exact SKU identity contract changed')
check(panel.includes('catalog-product-commercial-anchor'), 'future product commercial anchor was lost')
check(sku.includes('catalog-execution-commercial-anchor') && sku.includes('catalog-variant-commercial-anchor'), 'future execution/exact-SKU commercial anchors were lost')
check(inventory.includes('<div className="inventory-arrival-legacy-workspace">'), 'frozen Arrival workspace changed')

console.log('W7 SKU HISTORY / PRICE READINESS PASSED — existing exact history reused lazily; source+variant preserved; transaction price stays separate; no price semantics invented')
