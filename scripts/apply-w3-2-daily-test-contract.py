from pathlib import Path

path = Path('scripts/test-step192b2a-daily-warehouse.mjs')
text = path.read_text(encoding='utf-8')

old = """  check(inventory.includes('warehouse-w2-recovery') && inventory.includes('Нужно уточнить') && inventory.includes('warehouseAttention?.total'), 'Warehouse recovery inbox/count missing')
  check(inventory.includes('renderInventoryAttentionPanel'), 'Actionable Attention panel is not mounted')
  check(inventory.includes('useInventoryAttentionActions'), 'B2A daily actions were not kept out of the Inventory controller monolith')
  check(attentionHook.includes('quickInventoryStocktake({') && attentionHook.includes('expectedQuantity: simpleStockDetail.physical'), 'Attention/overview count does not use expected physical CAS')
  check(attentionHook.includes('loadWarehouseAttention(true)'), 'Physical count does not refresh Attention after success')
  check(overview.includes('Сверить количество') && overview.includes('На месте сейчас') && overview.includes('Сохранить факт'), 'Universal exact-SKU count UI missing from stock detail')"""

new = """  const recoveryNav = between(inventory, '<div className=\"warehouse-w2-secondary\">', '{renderInventoryOverviewPanel({')
  check(recoveryNav.includes('warehouse-w2-recovery') && recoveryNav.includes('Нужно уточнить') && recoveryNav.includes('warehouseClarificationCount'), 'Warehouse clarification entry/count missing')
  check(recoveryNav.includes('Ожидают приёма') && recoveryNav.includes('warehousePendingIntakeCount'), 'Known physical intake is not separated from clarification')
  check(!recoveryNav.includes('warehouseAttention?.total'), 'Clarification badge returned to the legacy all-problem total')
  check(inventory.includes('renderInventoryAttentionPanel'), 'Actionable Attention panel is not mounted')
  check(inventory.includes('useInventoryAttentionActions'), 'B2A daily actions were not kept out of the Inventory controller monolith')
  check(attentionHook.includes('quickInventoryStocktake({') && attentionHook.includes('expectedQuantity: simpleStockDetail.physical'), 'Attention/overview count does not use expected physical CAS')
  const quickCountAction = between(attentionHook, '  async function applyQuickStocktake', '  async function refreshWarehouseAttention')
  check(!quickCountAction.includes('loadWarehouseAttention(true)'), 'Successful physical count again forces a detailed recovery read')
  check(quickCountAction.includes('loadInventoryData('), 'Successful physical count no longer refreshes normal inventory data best-effort')
  check(!attentionPanel.includes('items.shortages') && !attentionPanel.includes('items.stocktakes'), 'Shortage/revision leaked back into secondary clarification')
  check(attentionPanel.includes('Ожидают приёма'), 'Known physical intake surface missing')
  check(overview.includes('Сверить количество') && overview.includes('На месте сейчас') && overview.includes('Сохранить факт'), 'Universal exact-SKU count UI missing from stock detail')"""

count = text.count(old)
if count != 1:
    raise SystemExit(f'Step192B2A W3.2 contract: expected 1 block, found {count}')
path.write_text(text.replace(old, new, 1), encoding='utf-8')
print('Step192B2A cumulative contract updated for W3.2 natural recovery')
