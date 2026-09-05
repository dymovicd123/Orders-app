from pathlib import Path

path = Path('src/features/sections/InventorySection.tsx')
text = path.read_text(encoding='utf-8')
old = "        inventoryPanelStyle,\n        isAdmin,\n        movementSourceLoadError,"
new = "        inventoryPanelStyle,\n        movementSourceLoadError,"
count = text.count(old)
if count != 1:
    raise SystemExit(f'InventorySection movement caller: expected 1 match, found {count}')
path.write_text(text.replace(old, new, 1), encoding='utf-8')
print('W3.1A movement caller cleanup applied')
