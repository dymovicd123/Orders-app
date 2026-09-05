from pathlib import Path
p = Path('scripts/w5-5-patcher.py')
s = p.read_text(encoding='utf-8')

old = '''needle = "return {\\n      ok: true,\\n      changed,\\n"
count = s.count(needle)
if count != 2:
    raise SystemExit(f'completion success return count: expected 2, got {count}')
s = s.replace(needle, "return {\\n      ok: true,\\n      changed,\\n      unresolvedFoundCount: await countUnresolvedFound(),\\n", 2)
'''
new = '''needle_replay = "return {\\n      ok: true,\\n      changed,\\n"
if s.count(needle_replay) != 1:
    raise SystemExit(f'completed replay return count: expected 1, got {s.count(needle_replay)}')
s = s.replace(needle_replay, "return {\\n      ok: true,\\n      changed,\\n      unresolvedFoundCount: await countUnresolvedFound(),\\n", 1)
needle_final = "  return {\\n    ok: true,\\n    changed,\\n"
if s.count(needle_final) != 1:
    raise SystemExit(f'final completion return count: expected 1, got {s.count(needle_final)}')
s = s.replace(needle_final, "  return {\\n    ok: true,\\n    changed,\\n    unresolvedFoundCount: await countUnresolvedFound(),\\n", 1)
'''
if old not in s:
    raise SystemExit('old completion patch block not found')
s = s.replace(old, new, 1)

old = '''s = one(s,\n"         (SELECT COUNT(*) FROM inventory_stocktake_sessions WHERE status = 'active') AS stocktake_count`\\n",\n"         (SELECT COUNT(*) FROM inventory_stocktake_sessions WHERE status = 'active') AS stocktake_count,\\n         (SELECT COUNT(*) FROM inventory_stock s WHERE s.variant_id IS NULL AND s.quantity > 0 AND s.last_source_ref LIKE 'stocktake-unresolved:%') AS found_count`\\n",\n'found summary count')\n'''
new = '''old_found_count_sql = "         (SELECT COUNT(*) FROM inventory_stocktake_sessions WHERE status = 'active') AS stocktake_count`\\n"\nnew_found_count_sql = "         (SELECT COUNT(*) FROM inventory_stocktake_sessions WHERE status = 'active') AS stocktake_count,\\n         (SELECT COUNT(*) FROM inventory_stock s WHERE s.variant_id IS NULL AND s.quantity > 0 AND s.last_source_ref LIKE 'stocktake-unresolved:%') AS found_count`\\n"\nif s.count(old_found_count_sql) < 1:\n    raise SystemExit('found summary stocktake_count SQL anchor missing')\ns = s.replace(old_found_count_sql, new_found_count_sql, 1)\n'''
if old not in s:
    raise SystemExit('old found summary SQL patch block not found')
s = s.replace(old, new, 1)

p.write_text(s, encoding='utf-8')
print('W5.5 temporary patcher fixes applied')
