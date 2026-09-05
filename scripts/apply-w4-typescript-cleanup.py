from pathlib import Path

path = Path('src/features/inventory/views/renderInventoryMovementPanel.tsx')
text = path.read_text(encoding='utf-8')
old = "                                        const transferFreeAfter = afterPhysical - reservedQuantity\n"
if text.count(old) != 1:
    raise SystemExit(f'W4 cleanup: expected transferFreeAfter once, found {text.count(old)}')
path.write_text(text.replace(old, '', 1), encoding='utf-8')
print('W4 TypeScript cleanup applied')
