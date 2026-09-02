from pathlib import Path

path = Path('scripts/test-d1-read-budget-r3.mjs')
text = path.read_text(encoding='utf-8')
old = "check(attention.includes('(SELECT COUNT(*) FROM inventory_stocktake_sessions WHERE status = 'active') AS stocktake_count'), 'Attention core summary lost stocktake semantics')"
new = 'check(attention.includes("(SELECT COUNT(*) FROM inventory_stocktake_sessions WHERE status = \'active\') AS stocktake_count"), \'Attention core summary lost stocktake semantics\')'
if old not in text:
    raise SystemExit('R3 regression quoting anchor missing')
path.write_text(text.replace(old, new, 1), encoding='utf-8')
print('Repaired R3 regression test quoting')
