import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')
const check = (value, message) => { if (!value) throw new Error(message) }

try {
  const movement = read('src/features/inventory/views/renderInventoryMovementPanel.tsx')
  const overview = read('src/features/inventory/views/renderInventoryOverviewPanel.tsx')
  const stocktake = read('src/features/inventory/views/renderInventoryStocktakePanel.tsx')
  const history = read('src/features/inventory/views/renderInventoryHistoryPanel.tsx')
  const attention = read('src/features/inventory/views/renderInventoryAttentionPanel.tsx')
  const inventory = read('src/features/sections/InventorySection.tsx')
  const importChain = read('src/styles/192b2a-warehouse-attention-actions.css')
  const mobile = read('src/styles/w8-4-final-mobile-acceptance.css')
  const w83 = read('src/styles/w8-3-daily-surfaces.css')
  const w4 = read('src/styles/w4-human-operations.css')

  check(importChain.includes("@import './w8-3-daily-surfaces.css';"), 'W8.3 presentation CSS is not loaded by the Warehouse bundle')
  check(importChain.includes("@import './w8-4-final-mobile-acceptance.css';"), 'W8.4 mobile CSS is not loaded by the Warehouse bundle')
  check(w83.includes('.inventory-history-focus') && w83.includes('.inventory-attention-subgroup'), 'W8.3 styles lost while fixing their import path')

  check(movement.includes('inventory-operation-card-${inventoryDraft.movementType}'), 'Operation mode card hook changed')
  check(movement.includes("['arrival', 'Приход']") && movement.includes("['writeoff', 'Списание']") && movement.includes("['manual_set', 'Исправить количество']"), 'Operation mode choices changed unexpectedly')
  check(movement.includes('saveInventoryMovement()') && movement.includes('setInventoryTransferObservedQuantity'), 'Existing Warehouse mutation/check path changed unexpectedly')

  check(mobile.includes('.inventory-operation-card-writeoff .inventory-operation-variants-table'), 'Writeoff phone card layout missing')
  check(mobile.includes('.inventory-operation-card-manual_set .inventory-operation-variants-table'), 'Manual-set phone card layout missing')
  check(mobile.includes("content: 'Списать'") && mobile.includes("content: 'Фактически'") && mobile.includes('min-height: 44px'), 'Mobile operation labels/touch targets incomplete')
  check(!mobile.includes('.inventory-operation-card-arrival') && !mobile.includes('.inventory-arrival-'), 'Frozen Arrival UI leaked into W8.4 selectors')
  check(w4.includes('.inventory-operation-card-transfer .inventory-operation-variants-table'), 'Accepted transfer phone cards disappeared')

  check(overview.includes("import '../../../styles/w8-2-stock-workspace.css'"), 'W8.2 stock workspace stylesheet is no longer loaded')
  check(overview.includes('openConcreteStockDetail') && overview.includes('inventory-stock-routine-disclosure'), 'W8.2 stock workspace semantics regressed')
  check(stocktake.includes('stocktake-counting-rule') && stocktake.includes('stocktake-outcome-card'), 'Accepted Stocktake workflow regressed')
  check(history.includes('historyVariantIdentity') && history.includes('history-check-product'), 'W8.3 History clarity regressed')
  check(attention.includes('Найдено при проверке') && attention.includes('Приёмка требует определения') && attention.includes('Позиция заказа не определена'), 'W8.3 Attention separation regressed')
  check(inventory.includes('<div className="inventory-arrival-legacy-workspace">'), 'Frozen Arrival workspace disappeared')

  check(!/warehouse_tasks|warehouse_cases|case_owner|\bSLA\b/i.test(mobile + history + attention), 'Task/case-management semantics leaked into final Warehouse UX')

  console.log('W8.4 FINAL MOBILE ACCEPTANCE PASSED — W8.3 styles are actually loaded; transfer/writeoff/manual-set phone flows are readable; Stock, Stocktake, History, Attention and frozen Arrival boundaries remain intact')
} catch (error) {
  console.error(`W8.4 FINAL MOBILE ACCEPTANCE FAILED: ${error?.message || error}`)
  process.exit(1)
}
