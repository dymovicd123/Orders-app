from pathlib import Path
p = Path('scripts/test-w5-checking-ux.mjs')
s = p.read_text(encoding='utf-8')
replacements = [
    ("  'Сохранено автоматически ✓',", "  'Всё сохранено ✓',", 'saved-state marker'),
    ("  'Чтобы продолжить позже, отменять не нужно',", "  'Отмена закроет эту проверку без изменения остатков.',\n  'Чтобы продолжить позже, просто выйдите из раздела.',", 'cancel/resume marker'),
]
for old, new, label in replacements:
    if s.count(old) != 1:
        raise SystemExit(f'{label}: expected 1 match, got {s.count(old)}')
    s = s.replace(old, new, 1)
p.write_text(s, encoding='utf-8')
print('W5.1 regression aligned with W5.4 human copy while preserving save/cancel/resume invariants')
