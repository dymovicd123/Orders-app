from pathlib import Path

path = Path('scripts/test-w5-checking-ux.mjs')
text = path.read_text(encoding='utf-8')

old_head = "const renderer = read('src/features/inventory/views/renderInventoryStocktakePanel.tsx')\nconst section = read('src/features/sections/InventorySection.tsx')\n"
new_head = "const renderer = read('src/features/inventory/views/renderInventoryStocktakePanel.tsx')\nconst overview = read('src/features/inventory/views/renderInventoryOverviewPanel.tsx')\nconst section = read('src/features/sections/InventorySection.tsx')\n"
if old_head not in text:
    raise SystemExit('W5.3R legacy-test fix: header baseline not found')
text = text.replace(old_head, new_head, 1)

old_checks = '''check(renderer.includes("const needsIndependentCount = Number(row.free || 0) < 0 || Number(row.lastDifference || 0) !== 0"), 'Risk-sensitive short check is not blind-first')
check(renderer.includes("needsIndependentCount ? <span><strong>Сначала посчитайте физически</strong></span>"), 'Risk-sensitive short check still leaks the expected physical number')
'''
new_checks = '''check(overview.includes("const needsIndependentCount = Number(row.free || 0) < 0 || Number(row.lastDifference || 0) !== 0"), 'Risk-sensitive short check is not blind-first')
check(overview.includes('inventory-cycle-count-system is-blind') && overview.includes('Сначала посчитайте физически'), 'Risk-sensitive short check still leaks the expected physical number')
check(!renderer.includes('<strong>Короткая проверка</strong>'), 'Duplicate short-check workflow returned to Check page')
'''
if old_checks not in text:
    raise SystemExit('W5.3R legacy-test fix: blind-first baseline not found')
text = text.replace(old_checks, new_checks, 1)

old_log = "console.log('W5 CHECKING UX PASSED — clearer hierarchy/cancel/completion, blind-first risk rows, small-screen actions protected')"
new_log = "console.log('W5 CHECKING UX PASSED — clearer Check hierarchy/cancel/completion; contextual blind-first quick check and small-screen actions protected')"
text = text.replace(old_log, new_log)

path.write_text(text, encoding='utf-8')
print('W5.3R legacy W5 checking regression aligned with unified flow')
