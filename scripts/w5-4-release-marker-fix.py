from pathlib import Path
p = Path('scripts/release-check.mjs')
s = p.read_text(encoding='utf-8')
old = "for (const marker of ['Не добавлять в каталог', 'Здесь только недавние позиции', 'Не сохранено:', 'openStocktakeInlineSize'])"
new = "for (const marker of ['Не добавлять в каталог', 'Здесь только недавние позиции', 'Ждут сохранения:', 'openStocktakeInlineSize'])"
if s.count(old) != 1:
    raise SystemExit(f'Expected one legacy stocktake save-state marker, got {s.count(old)}')
p.write_text(s.replace(old, new, 1), encoding='utf-8')
print('Release invariant aligned with W5.4 save-state wording')
