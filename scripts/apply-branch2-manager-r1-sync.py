from pathlib import Path
import json

p = Path('package.json')
data = json.loads(p.read_text(encoding='utf-8'))
cmd = data['scripts']['release:check']
needle = 'node scripts/test-d1-read-budget-r4.mjs && node scripts/test-operational-autonomy-r2.mjs'
replacement = 'node scripts/test-d1-read-budget-r4.mjs && node scripts/test-manager-routine-access-r1.mjs && node scripts/test-operational-autonomy-r2.mjs'
if 'test-manager-routine-access-r1.mjs' not in cmd:
    if needle not in cmd:
        raise SystemExit('Branch2 release gate anchor missing')
    data['scripts']['release:check'] = cmd.replace(needle, replacement, 1)
p.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print('Branch2 manager R1 package chain patched')
