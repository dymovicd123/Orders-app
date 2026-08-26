from pathlib import Path

def rw(path, before, after):
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    if text.count(before) != 1:
        raise RuntimeError(f'Unexpected match count for {path}: {text.count(before)}')
    p.write_text(text.replace(before, after, 1), encoding='utf-8')

rw('src/features/sections/InventorySection.tsx',
"""        inventoryQuery,
        isAdmin,
        openOrderFromFinance,""",
"""        inventoryQuery,
        isAdmin,
        openInventoryPanel,
        openOrderFromFinance,""")

rw('src/features/sections/InventorySection.tsx',
"""        setQuickStocktakeValues,
        setSimpleStockAvailabilityFilter,""",
"""        setQuickStocktakeValues,
        setCycleCountValues,
        setSimpleStockAvailabilityFilter,""")

rw('src/features/inventory/views/renderInventoryOverviewPanel.tsx',
"""  | 'inventoryQuery'
  | 'isAdmin'
  | 'openOrderFromFinance'""",
"""  | 'inventoryQuery'
  | 'isAdmin'
  | 'openInventoryPanel'
  | 'openOrderFromFinance'""")

rw('src/features/inventory/views/renderInventoryOverviewPanel.tsx',
"""  | 'setQuickStocktakeValues'
  | 'setSimpleStockAvailabilityFilter'""",
"""  | 'setQuickStocktakeValues'
  | 'setCycleCountValues'
  | 'setSimpleStockAvailabilityFilter'""")

p = Path('scripts/test-phase2-smart-daily-stock.mjs')
text = p.read_text(encoding='utf-8')
needle = "  check(inventory.includes('runRoutineCycleCount'), 'Routine exact-confirm action is not wired')\n"
addition = needle + "  check(inventory.includes('openInventoryPanel,') && inventory.includes('setCycleCountValues,'), 'Routine overview is missing required action/setter wiring')\n"
if text.count(needle) != 1:
    raise RuntimeError('Phase 2 regression insertion point missing')
p.write_text(text.replace(needle, addition, 1), encoding='utf-8')
print('PHASE 2 OVERVIEW WIRING FIX APPLIED')
