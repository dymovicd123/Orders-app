from pathlib import Path

path = Path('scripts/test-contextual-catalog-resolution-r1.mjs')
text = path.read_text(encoding='utf-8')
old = "  check(modal.includes('Новое значение — добавить'), 'R3 must add a new reference value inline with explicit confirmation')\n"
new = "  check(modal.includes('Подтвердить новое значение'), 'R4 must add a new reference value inline with explicit confirmation')\n"
if text.count(old) != 1:
    raise SystemExit(f'R4 new-value assertion anchor count={text.count(old)}')
path.write_text(text.replace(old, new, 1), encoding='utf-8')
print('R4 regression wording aligned')
