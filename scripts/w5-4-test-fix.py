from pathlib import Path
p = Path('scripts/test-w5-4-full-stocktake.mjs')
s = p.read_text(encoding='utf-8')
old = "check(worker.includes('пересчитайте только их — ничего из ревизии не было применено частично.'), 'Full stocktake all-or-nothing conflict contract missing')"
new = "check(worker.includes('Пересчитайте только их — ничего из ревизии не было применено частично.'), 'Full stocktake all-or-nothing conflict contract missing')"
if s.count(old) != 1:
    raise SystemExit(f'Expected one W5.4 conflict assertion, got {s.count(old)}')
p.write_text(s.replace(old, new, 1), encoding='utf-8')
print('W5.4 conflict assertion corrected')
