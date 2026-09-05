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
p.write_text(s.replace(old, new, 1), encoding='utf-8')
print('W5.5 patcher completion fix applied')
