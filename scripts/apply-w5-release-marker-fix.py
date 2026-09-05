from pathlib import Path
p = Path('src/features/inventory/views/renderInventoryStocktakePanel.tsx')
text = p.read_text(encoding='utf-8')
old = "`Есть несохранённые изменения: ${stocktakeUnsavedCount}`"
new = "`Не сохранено: ${stocktakeUnsavedCount}`"
count = text.count(old)
if count != 1:
    raise SystemExit(f'W5 unsaved-state marker: expected 1 occurrence, found {count}')
p.write_text(text.replace(old, new, 1), encoding='utf-8')
print('W5 release marker preserved')
