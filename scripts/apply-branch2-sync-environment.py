from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[1]

def read(path):
    return (ROOT / path).read_text(encoding='utf-8')

def write(path, text):
    (ROOT / path).write_text(text, encoding='utf-8')

def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected exactly 1 match, got {count}')
    return text.replace(old, new, 1)

# Branch2 owns a distinct Worker/D1 binding. Preserve the historically deployed binding
# unless Cloudflare provides a separately verified replacement; never substitute Primary.
write('wrangler.jsonc', '''{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "orders-app-branch2",
  "main": "worker/index.ts",
  "compatibility_date": "2026-07-06",
  "workers_dev": true,
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "orders_db_branch2",
      "database_id": "40065052-854e-44b8-bcd5-251bdd488301"
    }
  ],
  "assets": {
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/api/*"]
  },
  "observability": {
    "enabled": true
  },
  "upload_source_maps": true,
  "compatibility_flags": ["nodejs_compat"]
}
''')

index = read('index.html')
index = replace_once(index, '<title>orders-app</title>', '<title>Система заказов 2</title>', 'Branch2 title marker')
write('index.html', index)

auth = read('worker/domains/auth.ts')
auth = replace_once(
    auth,
    "  }\n  return password === getAdminModePassword(env);\n}",
    "  }\n  const storedPasswordRequired = (await getAppSetting(db, 'require_stored_admin_password', '0')) === '1';\n  if (storedPasswordRequired) return false;\n  return password === getAdminModePassword(env);\n}",
    'Branch2 stored-password fallback guard',
)
write('worker/domains/auth.ts', auth)

# A permanent branch-only regression makes environment separation obvious on every future gate.
test = '''import fs from 'node:fs'\n\nconst read = (p) => fs.readFileSync(p, 'utf8')\nconst check = (condition, message) => { if (!condition) throw new Error(message) }\nconst wrangler = read('wrangler.jsonc')\nconst index = read('index.html')\nconst auth = read('worker/domains/auth.ts')\ncheck(wrangler.includes('"name": "orders-app-branch2"'), 'Branch2 Worker name drifted')\ncheck(wrangler.includes('"database_name": "orders_db_branch2"'), 'Branch2 D1 logical binding drifted')\ncheck(!wrangler.includes('orders_db_prod'), 'Primary D1 binding leaked into Branch2')\ncheck(index.includes('<title>Система заказов 2</title>'), 'Branch2 visual title marker missing')\ncheck(auth.includes("getAppSetting(db, 'require_stored_admin_password', '0')"), 'Branch2 stored-password safety gate missing')\ncheck(auth.includes('if (storedPasswordRequired) return false;'), 'Branch2 admin fallback guard missing')\nconsole.log('BRANCH2 ENVIRONMENT SAFETY PASSED — separate Worker/D1 identity, title marker and stored-password fallback guard preserved')\n'''
write('scripts/test-branch2-environment.mjs', test)

pkg_path = ROOT / 'package.json'
pkg = json.loads(pkg_path.read_text(encoding='utf-8'))
release = pkg['scripts']['release:check']
needle = 'node scripts/test-operational-autonomy-r2.mjs'
addition = f'{needle} && node scripts/test-branch2-environment.mjs'
if 'test-branch2-environment.mjs' not in release:
    if needle not in release:
        raise RuntimeError('Branch2 release gate anchor missing')
    pkg['scripts']['release:check'] = release.replace(needle, addition, 1)
pkg_path.write_text(json.dumps(pkg, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

print('Applied Branch2 environment deltas on current main source')
