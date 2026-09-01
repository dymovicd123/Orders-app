from pathlib import Path
import json


def read(path: str) -> str:
    return Path(path).read_text(encoding='utf-8')


def write(path: str, text: str) -> None:
    Path(path).write_text(text, encoding='utf-8')


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, got {count}')
    return text.replace(old, new, 1)


# 1) Classify Cloudflare D1 daily-capacity failures before the generic DB sanitizer.
http_path = 'worker/core/http.ts'
http = read(http_path)
needle = """  if (lower.includes('database is locked') || lower.includes('database busy') || lower.includes('d1_db_busy')) {\n    return { status: 503, message: 'База временно занята другой операцией. Повторите действие через несколько секунд.' };\n  }\n\n  const technicalDatabaseError ="""
replacement = """  if (lower.includes('database is locked') || lower.includes('database busy') || lower.includes('d1_db_busy')) {\n    return { status: 503, message: 'База временно занята другой операцией. Повторите действие через несколько секунд.' };\n  }\n\n  if (lower.includes(\"exceeded d1's free tier daily row read limit\") || lower.includes('free tier daily row read limit')) {\n    return {\n      status: 503,\n      code: 'd1_daily_read_limit',\n      message: 'Cloudflare временно остановил чтение базы из-за дневного лимита. Существующие данные не повреждены; доступ возобновится после сброса лимита.',\n    };\n  }\n  if (lower.includes(\"exceeded d1's free tier daily row write limit\") || lower.includes('free tier daily row write limit')) {\n    return {\n      status: 503,\n      code: 'd1_daily_write_limit',\n      message: 'Cloudflare временно остановил запись в базу из-за дневного лимита. Повторите действие после сброса лимита; незавершённая операция не считается сохранённой.',\n    };\n  }\n\n  const technicalDatabaseError ="""
http = replace_once(http, needle, replacement, 'http D1 capacity insertion')
write(http_path, http)

# 2) Permanent regression gate for the public classification.
test_path = 'scripts/test-d1-capacity-autonomy.mjs'
write(test_path, """import fs from 'node:fs'\n\nconst http = fs.readFileSync('worker/core/http.ts', 'utf8')\nconst fail = (message) => { throw new Error(message) }\nconst check = (condition, message) => { if (!condition) fail(message) }\n\ncheck(http.includes(\"code: 'd1_daily_read_limit'\"), 'D1 daily read limit must have a stable public code')\ncheck(http.includes(\"code: 'd1_daily_write_limit'\"), 'D1 daily write limit must have a stable public code')\ncheck(http.includes(\"exceeded d1's free tier daily row read limit\"), 'Cloudflare daily read-limit text must be recognized')\ncheck(http.includes(\"exceeded d1's free tier daily row write limit\"), 'Cloudflare daily write-limit text must be recognized')\ncheck(http.includes('Существующие данные не повреждены'), 'Read-limit response must not tell staff to call an administrator')\ncheck(!/d1_daily_(?:read|write)_limit[\\s\\S]{0,500}сообщите администратору/i.test(http), 'Capacity errors must not fall back to call-admin wording')\n\nconsole.log('D1 capacity autonomy regression: OK')\n""")

# 3) Add regression to cumulative release gate.
package_path = 'package.json'
package = json.loads(read(package_path))
release = package['scripts']['release:check']
marker = 'node scripts/test-d1-capacity-autonomy.mjs'
if marker not in release:
    package['scripts']['release:check'] = release + ' && ' + marker
write(package_path, json.dumps(package, ensure_ascii=False, indent=2) + '\n')

# 4) Extend structural allow-list with one exact declaration delta.
structural_path = 'scripts/test-step1906a-worker-modularization.mjs'
structural = read(structural_path)
structural = replace_once(
    structural,
    "const orderEditAutonomyPath = path.join(root, 'scripts/order-edit-autonomy-worker-manifest.json')\n",
    "const orderEditAutonomyPath = path.join(root, 'scripts/order-edit-autonomy-worker-manifest.json')\nconst d1CapacityAutonomyPath = path.join(root, 'scripts/d1-capacity-autonomy-worker-manifest.json')\n",
    'structural manifest path',
)
structural = replace_once(
    structural,
    "  const orderEditAutonomyChanges = orderEditAutonomy.changes || {}\n",
    "  const orderEditAutonomyChanges = orderEditAutonomy.changes || {}\n  check(fs.existsSync(d1CapacityAutonomyPath), 'D1 capacity autonomy Worker manifest missing')\n  const d1CapacityAutonomy = JSON.parse(fs.readFileSync(d1CapacityAutonomyPath, 'utf8'))\n  check(d1CapacityAutonomy?.version === 1 && d1CapacityAutonomy?.revision === 'd1-capacity-autonomy-r1', 'D1 capacity autonomy Worker manifest invalid')\n  const d1CapacityAutonomyChanges = d1CapacityAutonomy.changes || {}\n",
    'structural manifest load',
)
old_block = """    const orderEditAutonomyChanged = orderEditAutonomyChanges[name]\n    if (orderEditAutonomyChanged) {\n      check(orderEditAutonomyChanged.before === acceptedPostCancellationAutonomyHash, `Order edit autonomy baseline hash mismatch: ${name}`)\n      check(sha(declarations.get(name)) === orderEditAutonomyChanged.after, `Worker declaration changed beyond exact order edit autonomy allow-list: ${name}`)\n    } else {\n      check(sha(declarations.get(name)) === acceptedPostCancellationAutonomyHash, `Worker declaration body changed beyond accepted Finance F1-F9 / Phase 1B / Arrival reliability / Shipping shortage / Exchange stale-handover / payment-method / cancellation-autonomy / order-edit-autonomy deltas: ${name}`)\n    }\n"""
new_block = """    const orderEditAutonomyChanged = orderEditAutonomyChanges[name]\n    let acceptedPostOrderEditAutonomyHash = acceptedPostCancellationAutonomyHash\n    if (orderEditAutonomyChanged) {\n      check(orderEditAutonomyChanged.before === acceptedPostCancellationAutonomyHash, `Order edit autonomy baseline hash mismatch: ${name}`)\n      acceptedPostOrderEditAutonomyHash = orderEditAutonomyChanged.after\n    }\n    const d1CapacityAutonomyChanged = d1CapacityAutonomyChanges[name]\n    if (d1CapacityAutonomyChanged) {\n      check(d1CapacityAutonomyChanged.before === acceptedPostOrderEditAutonomyHash, `D1 capacity autonomy baseline hash mismatch: ${name}`)\n      check(sha(declarations.get(name)) === d1CapacityAutonomyChanged.after, `Worker declaration changed beyond exact D1 capacity autonomy allow-list: ${name}`)\n    } else {\n      check(sha(declarations.get(name)) === acceptedPostOrderEditAutonomyHash, `Worker declaration body changed beyond accepted Finance F1-F9 / Phase 1B / Arrival reliability / Shipping shortage / Exchange stale-handover / payment-method / cancellation-autonomy / order-edit-autonomy / D1-capacity deltas: ${name}`)\n    }\n"""
structural = replace_once(structural, old_block, new_block, 'structural declaration chain')
write(structural_path, structural)

print('Applied D1 capacity autonomy R1')
